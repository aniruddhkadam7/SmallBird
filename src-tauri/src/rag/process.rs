use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::process_util::hidden_command;

const RAG_PORT: u16 = 8100;

/// Per-launch shared secret required on every RAG service request (except
/// /health) — see packages/rag/app/main.py's auth middleware. Generated once
/// per desktop app process and handed to the RAG child via env var at spawn
/// time, so no other local process can drive this service just by knowing
/// its (fixed, well-known) port.
static INTERNAL_TOKEN: OnceLock<String> = OnceLock::new();

fn internal_token() -> &'static str {
    INTERNAL_TOKEN.get_or_init(|| {
        use ring::rand::{SecureRandom, SystemRandom};
        let mut bytes = [0u8; 32];
        SystemRandom::new()
            .fill(&mut bytes)
            .expect("failed to generate RAG internal auth token");
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    })
}

fn rag_package_dir() -> PathBuf {
    // This personal repo's flat layout has no packages/rag monorepo tree —
    // only the prebuilt rag-lite resource (sidecars/rag-lite/) at the repo
    // root. `rag_venv_python()` below will simply never find a venv here
    // (there isn't one in this repo), which is expected: the frozen
    // `rag-lite` resource (see `frozen_rag_lite_path`) is the only supported
    // path in a release build, and is what `tauri dev` needs to resolve too.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Locates the document-extraction service's own virtualenv interpreter
/// (`packages/rag/.venv`, e.g. `fastapi`/`uvicorn`/`pypdf`/`python-docx`) —
/// its own venv rather than sharing one, mirroring how `apps/backend` has
/// its own venv too.
///
/// Dev/test only, same caveat as `stt::sidecar`'s `stt_venv_python`: a venv
/// is not relocatable (its `python.exe` hardcodes the absolute path of the
/// base Python install it was created from), so it's never what a release
/// build ships or runs — see `frozen_rag_lite_path` below.
fn rag_venv_python() -> Option<PathBuf> {
    let candidate = rag_package_dir().join(".venv").join("Scripts").join("python.exe");
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

/// The PyInstaller-frozen "rag-lite" service bundled as a resource for
/// release builds (see `bundle.resources` in `tauri.conf.json`, built via
/// `packages/rag/scripts/freeze_rag_lite.py`) — plain text extraction
/// (pypdf/python-docx), so CV/job-description upload works with nothing
/// installed on the target machine. `None` when there's no `AppHandle` or
/// the resource isn't there (plain `cargo build`/`tauri dev`, where the dev
/// venv above is used instead).
fn frozen_rag_lite_path(app: Option<&AppHandle>) -> Option<PathBuf> {
    let app = app?;
    let candidate = app.path().resolve("rag-lite/rag-lite.exe", BaseDirectory::Resource).ok()?;
    candidate.exists().then_some(candidate)
}

pub struct RagServiceHandle {
    child: Option<Child>,
}

impl RagServiceHandle {
    pub fn base_url() -> String {
        format!("http://127.0.0.1:{RAG_PORT}")
    }

    /// The shared secret required on every RAG service request — see
    /// `internal_token()`. Generated lazily so callers (e.g. `RagClient::new`)
    /// can fetch it even before `spawn` has run.
    pub fn auth_token() -> &'static str {
        internal_token()
    }

    /// Spawns the document-extraction service as a child process. Returns
    /// `Ok(None)` (not an error) if neither the frozen `rag-lite` resource
    /// nor the dev venv are available — the caller can still run the rest
    /// of the app without document upload available, rather than failing
    /// the whole app to launch.
    ///
    /// `app`: threaded through so a release build can find and run the
    /// frozen `rag-lite` resource — see `frozen_rag_lite_path`. `None` keeps
    /// today's dev-tree venv behavior unchanged.
    pub fn spawn(app: Option<&AppHandle>) -> Result<Option<Self>, String> {
        let mut command = if let Some(frozen) = frozen_rag_lite_path(app) {
            let mut command = hidden_command(&frozen);
            command.env("RAG_PORT", RAG_PORT.to_string());
            // Defense in depth: RAG_INTERNAL_TOKEN is always set below
            // regardless, so this fail-closed check (packages/rag/app/
            // main.py) never actually fires today — but a release build is
            // exactly the case where "silently start unauthenticated if the
            // token were ever missing" must be a hard error, not a warning.
            // Never set on the dev-tree venv path (the `else` branch below),
            // which should keep failing open/warning for local development.
            command.env("RAG_ENV", "production");
            command
        } else {
            let Some(python) = rag_venv_python() else {
                log::warn!(
                    "document extraction service venv not found at packages/rag/.venv — document upload will be unavailable"
                );
                return Ok(None);
            };
            let mut command = hidden_command(&python);
            command
                .args([
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    &RAG_PORT.to_string(),
                ])
                .current_dir(rag_package_dir());
            command
        };

        let mut child = command
            .env("RAG_INTERNAL_TOKEN", internal_token())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn RAG service: {e}"))?;

        forward_child_output(child.stdout.take(), "stdout");
        forward_child_output(child.stderr.take(), "stderr");

        Ok(Some(Self { child: Some(child) }))
    }

    pub fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Kills the current process and spawns a fresh one. Callers should
    /// treat the brief gap between shutdown and the new process becoming
    /// healthy the same way initial startup is treated (poll `/health`),
    /// not as an error.
    pub fn restart(&mut self, app: Option<&AppHandle>) -> Result<(), String> {
        self.shutdown();
        let Some(mut spawned) = Self::spawn(app)? else {
            return Err("document extraction service venv not found — cannot restart".to_string());
        };
        // `.take()`, not a whole-struct move — `spawned` still runs its
        // `Drop` impl at the end of this scope, which is a no-op once its
        // `child` has been taken (mirrors `shutdown()`'s own `self.child.take()`).
        self.child = spawned.child.take();
        Ok(())
    }
}

impl Drop for RagServiceHandle {
    /// Without this, an unclean Rust-side exit would leave the RAG service
    /// (and the memory-heavy embedding model it has loaded) running as an
    /// orphaned process — the same class of problem the old local STT
    /// sidecar's Drop impl guarded against before STT became a cloud
    /// connection with no child process to orphan.
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Forwards a child process's stdout/stderr into the `log` crate on a
/// dedicated thread, the same pattern used for the STT sidecar's stderr
/// (`stt::sidecar`) — keeps RAG service logs visible in the desktop app's own
/// log output without blocking anything on the pipe being drained.
fn forward_child_output<R>(pipe: Option<R>, label: &'static str)
where
    R: std::io::Read + Send + 'static,
{
    let Some(pipe) = pipe else { return };
    std::thread::Builder::new()
        .name(format!("rag-service-{label}"))
        .spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(pipe);
            for line in reader.lines().map_while(Result::ok) {
                log::info!("[rag service {label}] {line}");
            }
        })
        .ok();
}

/// Polls the RAG service's `/health` endpoint until it responds or the timeout
/// elapses. Called once after spawning, before the app reports the service as
/// available.
pub fn wait_until_healthy(timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    let url = format!("{}/health", RagServiceHandle::base_url());
    while std::time::Instant::now() < deadline {
        if let Ok(response) = reqwest::blocking::get(&url) {
            if response.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// The embedding model can take a while to load on first request (see
/// docs/progress.md Step 9 — ~35s cold, cached after) plus uvicorn's own
/// startup, so this uses a generous timeout; a `false` return just means the
/// RAG service commands will report "unavailable" until it does come up.
pub fn wait_until_healthy_default() -> bool {
    wait_until_healthy(Duration::from_secs(60))
}
