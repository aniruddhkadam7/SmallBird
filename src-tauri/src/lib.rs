mod analyzer;
mod autostart;
// Public so the `audio_probe` example (examples/audio_probe.rs) can drive the
// real capture path when measuring the pipeline, rather than a copy of it that
// could drift from what actually ships.
pub mod audio;
mod audio_test;
mod auth;
mod backend;
mod backend_warmup;
mod bubble_window;
mod commands;
mod crash_guard;
mod documents;
// Public so `examples/hw_probe.rs` can reference `PerformanceConfig` without
// a re-export chain.
pub mod hardware;
mod history;
mod interview_mode;
mod main_window;
mod notes_mode;
mod overlay_window;
mod personal;
mod shortcuts;
mod state;
mod tls_init;
mod tray;
// Public alongside `audio` so `examples/pipeline_test.rs` can drive the real
// recording pipeline headlessly instead of a reimplementation of it.
pub mod stt;
pub mod transcript;
#[cfg(windows)]
mod windows_capture_protection;
// Same API, NSWindow sharingType instead of display affinity.
#[cfg(target_os = "macos")]
#[path = "macos_capture_protection.rs"]
mod windows_capture_protection;

use tauri::{Emitter, Manager};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First, so a panic anywhere after this (including during startup) is
    // recorded to crash.log — see `crash_guard`.
    crash_guard::install_panic_hook();
    tls_init::ensure_installed();

    let result = tauri::Builder::default()
        // Must be the very first plugin registered (Tauri requirement). A
        // second launch of the app (double-clicking the exe/shortcut again,
        // including while the first launch is still mid-startup and its
        // window isn't visible yet) is redirected here instead of spawning a
        // second, fully separate process — the new invocation exits
        // immediately and this callback just brings the existing app to the
        // front instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let overlay_visible = app
                .get_webview_window(interview_mode::OVERLAY_WINDOW_LABEL)
                .is_some_and(|w| w.is_visible().unwrap_or(false));
            if overlay_visible {
                if let Some(window) = app.get_webview_window(interview_mode::OVERLAY_WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // Reassert exclusion on the redirect path too — this is
                    // the one way the overlay gets re-shown outside
                    // `show_overlay_window`/its watchdog, so it shouldn't
                    // rely solely on the watchdog's next tick (up to 3s
                    // away) to notice if affinity had silently dropped.
                    windows_capture_protection::reconcile(&window, interview_mode::OVERLAY_WINDOW_LABEL, true);
                }
                return;
            }
            // The main window is hidden (not just unminimized) while the
            // floating bubble is up (see `bubble_window`) — restoring
            // through it rather than a plain main.show() also hides the
            // bubble, instead of leaving both on screen at once.
            let bubble_visible = app
                .get_webview_window(bubble_window::BUBBLE_WINDOW_LABEL)
                .is_some_and(|w| w.is_visible().unwrap_or(false));
            if bubble_visible {
                let _ = bubble_window::restore_from_bubble(app);
                return;
            }
            if let Some(window) = app.get_webview_window(main_window::MAIN_WINDOW_LABEL) {
                // Same reasoning as `overlay_window::close_overlay_window`'s
                // fix: reassert before showing a main window that's been
                // hidden (and therefore unchecked by the watchdog) for an
                // unknown amount of time.
                windows_capture_protection::reconcile(&window, main_window::MAIN_WINDOW_LABEL, true);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // `env_logger` alone (the previous setup) writes to a stderr handle
        // that simply doesn't exist in a release build — `main.rs` marks
        // release builds `windows_subsystem = "windows"` (no console
        // attached), so every `log::info!`/`log::warn!` call, including the
        // screen-capture-exclusion diagnostics in `overlay_window.rs` and
        // `windows_capture_protection.rs`, was silently discarded in
        // production. It only ever "worked" when run via `cargo tauri dev`,
        // which keeps the console subsystem and a real attached console.
        // Logging to a file (in addition to stdout, so `cargo tauri dev`
        // keeps showing logs in the terminal) means a packaged build's
        // actual capture-exclusion failures are inspectable after the fact
        // instead of invisible by construction.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("nav-guard")
                .on_navigation(|webview, url| overlay_window::allow_navigation(webview.app_handle(), url))
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![autostart::AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Only react on key-down, not key-up, so holding the
                    // combination doesn't repeatedly toggle anything. Which
                    // action a combination runs is user-configurable — see
                    // `shortcuts`.
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        shortcuts::handle(app, shortcut);
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .manage(history::HistoryStore::default())
        .manage(shortcuts::ShortcutManager::default())
        .setup(|app| {
            // macOS counterpart of `skipTaskbar`: no Dock icon or app-switcher
            // entry — the app lives in the menu bar tray, as on Windows.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Hardware detection + performance mode load first, synchronously
            // — cheap (a few sysinfo/DXGI/IOCTL calls, no network/process
            // spawn).
            let performance_state = hardware::init(&app.handle().clone());
            app.manage(performance_state);

            main_window::apply_light_titlebar(&app.handle().clone());

            // Exclude the main window from screen captures/screen-share too,
            // not just the Interview Mode overlay (see
            // `windows_capture_protection` for what this does and does not
            // cover — the window stays normally visible locally, it's only
            // omitted from what capture pipelines record/stream). Applied
            // BEFORE `position_top_center`'s show()/set_focus(): setting
            // display affinity on this transparent, undecorated window
            // while it's already shown was observed to knock DWM into
            // minimizing it (its rect ends up at the classic off-screen
            // iconic placement) — doing it first, while the window is still
            // hidden (tauri.conf.json's `"visible": false`), avoids that.
            // Best-effort: an older Windows build without the API just
            // leaves the window normally capturable.
            if let Some(main_window) = app.get_webview_window(main_window::MAIN_WINDOW_LABEL) {
                windows_capture_protection::reconcile(&main_window, main_window::MAIN_WINDOW_LABEL, true);
            }

            main_window::position_top_center(&app.handle().clone(), !autostart::launched_at_login());

            // Tray icon: closing Smallbird hides it here instead of quitting,
            // so global shortcuts keep working (see `tray`). Start-with-
            // Windows is on by default for installed builds (see `autostart`).
            if let Err(err) = tray::init(&app.handle().clone()) {
                log::warn!("failed to create tray icon: {err}");
            }
            autostart::apply_default(&app.handle().clone());

            // Self-healing capture exclusion: `SetWindowDisplayAffinity` has
            // been observed to silently revert (monitor/DPI change, GPU
            // driver reset, wake from sleep) with no event this process can
            // hook, so both windows periodically reassert it while visible
            // rather than relying on the one-time call above/at overlay-open
            // time. See `overlay_window::spawn_capture_protection_watchdog`.
            overlay_window::spawn_unconditional_capture_protection_watchdog(
                app.handle().clone(),
                main_window::MAIN_WINDOW_LABEL,
            );
            overlay_window::spawn_unconditional_capture_protection_watchdog(
                app.handle().clone(),
                bubble_window::BUBBLE_WINDOW_LABEL,
            );
            interview_mode::spawn_capture_protection_watchdog(app.handle().clone());

            // Global shortcuts (overlay toggle, default Ctrl+Shift+Space; main
            // window toggle, unbound by default) — user-configurable from
            // Settings → Shortcuts. Registration failure (e.g. a combination
            // already claimed by another application) is logged, not fatal.
            shortcuts::init(&app.handle().clone());

            // Recovers transcripts a crashed/killed run left behind, then keeps
            // retrying any that haven't reached the server yet.
            history::spawn_background_tasks(app.handle().clone());

            // System-audio capture that stops mid-session and can't recover
            // (output device gone, nothing to fall back to) — tell the UI
            // rather than leaving it showing "Listening" over silence.
            let capture_app = app.handle().clone();
            audio::set_capture_failure_handler(move |source, message| {
                // A microphone failure only turns the Mic off — the session
                // itself keeps listening to the call.
                let event = match source {
                    audio::AudioSource::SystemAudio => "audio:capture-error",
                    audio::AudioSource::Microphone => "audio:mic-error",
                };
                let _ = capture_app.emit(event, message);
            });

            bubble_window::ensure_bubble_window(&app.handle().clone());

            // Keep the session-start and answer backend functions warm so a
            // Start/shortcut press never waits on a cold start (see module).
            backend_warmup::spawn_keep_warm();

            // Pre-build the (hidden) overlay a few seconds after launch so
            // the first Start/shortcut press only has to show it. Delayed so
            // it never slows the app's own startup; built on the main thread
            // (window creation must be). No capture or session is started.
            let prebuild_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let inner = prebuild_handle.clone();
                let _ = prebuild_handle.run_on_main_thread(move || interview_mode::prebuild_overlay_window(&inner));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_output_devices,
            commands::list_input_devices,
            commands::start_system_audio_capture,
            commands::pause_recording,
            commands::resume_recording,
            commands::stop_audio_capture,
            commands::begin_audio_prebuffer,
            commands::set_microphone_enabled,
            commands::set_system_audio_enabled,
            commands::set_source_defaults,
            audio_test::prepare_audio_test_phrase,
            audio_test::play_audio_test_phrase,
            audio_test::stop_audio_test_phrase,
            audio_test::close_orphaned_audio_test_session,
            commands::get_current_session,
            commands::get_recording_state,
            commands::start_new_interview,
            commands::clear_transcript,
            commands::export_transcript_txt,
            commands::export_transcript_json,
            commands::check_backend_connection,
            commands::analyze_interview,
            commands::analyze_setup_context,
            documents::upload_document,
            documents::upload_image_document,
            shortcuts::get_shortcuts,
            shortcuts::set_shortcut,
            shortcuts::suspend_shortcuts,
            shortcuts::shortcut_session_settled,
            tray::hide_to_tray,
            backend_warmup::warm_backend,
            interview_mode::commands::capture_screenshot,
            interview_mode::commands::remove_screenshot,
            interview_mode::commands::clear_screenshots,
            autostart::get_autostart,
            autostart::set_autostart,
            personal::client::debug_set_ask_model,
            personal::client::debug_track_state,
            documents::get_document_text,
            documents::list_documents,
            documents::delete_document,
            commands::quit_app,
            commands::signal_window_content_ready,
            crash_guard::log_frontend_error,
            commands::minimize_to_bubble,
            commands::restore_from_bubble,
            commands::drag_bubble_window,
            interview_mode::commands::show_interview_overlay,
            interview_mode::commands::hide_interview_overlay,
            interview_mode::commands::minimize_interview_overlay,
            interview_mode::commands::restore_interview_overlay,
            interview_mode::commands::toggle_maximize_interview_overlay,
            interview_mode::commands::toggle_interview_overlay,
            interview_mode::commands::open_dashboard,
            interview_mode::commands::open_upgrade,
            interview_mode::commands::ask_interview_question,
            interview_mode::commands::analyze_screen_question,
            interview_mode::commands::set_overlay_always_on_top,
            interview_mode::commands::set_overlay_capture_exclusion,
            interview_mode::commands::resize_interview_overlay,
            interview_mode::commands::start_backend_session,
            interview_mode::commands::end_backend_session,
            history::list_interview_history,
            history::refresh_interview_history,
            history::save_interview_session,
            history::resync_pending_interview_transcripts,
            notes_mode::store::list_notes,
            notes_mode::store::get_note,
            notes_mode::store::create_note,
            notes_mode::store::update_note,
            notes_mode::store::delete_note,
            notes_mode::store::search_notes,
            notes_mode::ai::summarize_note,
            notes_mode::ai::ask_about_notes,
            hardware::commands::get_performance_mode,
            main_window::set_popover_content_height,
            auth::commands::request_login_otp,
            auth::commands::verify_login_otp,
            auth::commands::login_with_google,
            auth::commands::logout,
            auth::commands::get_auth_session,
            auth::commands::get_entitlement,
        ])
        .run(tauri::generate_context!());

    // Startup failures (most commonly a missing/broken WebView2 runtime)
    // used to `expect()`-panic here, which in a windowless release build
    // meant the app silently never appeared. Explain it instead.
    if let Err(err) = result {
        log::error!("failed to start Smallbird: {err}");
        crash_guard::show_fatal_error(&format!(
            "Smallbird couldn't start.

{err}

             If this keeps happening, reinstall Smallbird or install the              Microsoft Edge WebView2 Runtime, then try again."
        ));
        std::process::exit(1);
    }
}
