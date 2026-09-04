//! Resume/CV, job-description, and additional-context document handling.
//!
//! Text extraction runs in-process (pdf-extract for PDF, a minimal zip/XML
//! strip for DOCX, plain UTF-8 for txt/md) — there is no external sidecar
//! process to spawn, poll for health, or fail to find, unlike the old
//! rag-lite Python service this replaces. Uploaded documents live only in
//! memory (`AppState.documents`), cleared on app restart, which matches the
//! old sidecar's behavior closely enough: it was killed on every app exit
//! too.

use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub document_id: String,
    pub filename: String,
    pub document_type: String,
    pub file_size: u64,
    pub created_at: f64,
    pub updated_at: f64,
    pub status: String,
    pub error_message: Option<String>,
}

pub struct DocumentRecord {
    pub metadata: DocumentMetadata,
    pub text: String,
}

fn now_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn new_document_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("doc-{}-{n}", now_secs())
}

/// Reads the most recently uploaded, successfully-extracted document of
/// `document_type` — used by `interview_mode::commands` to build ASK AI's
/// LLM context without going through the Tauri command layer.
pub fn latest_ready_text(state: &AppState, document_type: &str) -> Option<String> {
    let store = state.documents.lock().ok()?;
    store
        .values()
        .filter(|r| r.metadata.document_type == document_type && r.metadata.status == "READY")
        .max_by(|a, b| a.metadata.updated_at.total_cmp(&b.metadata.updated_at))
        .map(|r| r.text.clone())
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Pulls plain text out of a .docx's `word/document.xml` — paragraph/line
/// breaks and tabs are turned into real whitespace before every remaining
/// XML tag is stripped, so words don't run together. Not a full OOXML
/// parser (tables/headers/footers/footnotes are skipped), but that's the
/// same scope the old rag-lite sidecar's python-docx extraction covered.
fn extract_docx_text(bytes: &[u8]) -> Result<String, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("not a valid .docx file: {e}"))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| format!(".docx is missing its document content: {e}"))?
        .read_to_string(&mut xml)
        .map_err(|e| format!("failed to read .docx content: {e}"))?;

    let with_breaks = xml.replace("</w:p>", "\n").replace("<w:tab/>", "\t").replace("<w:br/>", "\n");
    let tag_re = regex::Regex::new(r"<[^>]+>").expect("static regex is valid");
    let text = tag_re.replace_all(&with_breaks, "");
    Ok(decode_xml_entities(&text).trim().to_string())
}

fn extract_text(filename: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "txt" | "md" | "markdown" => {
            String::from_utf8(bytes.to_vec()).map_err(|_| "file is not valid UTF-8 text".to_string())
        }
        "pdf" => pdf_extract::extract_text_from_mem(bytes).map_err(|e| format!("failed to extract PDF text: {e}")),
        "docx" => extract_docx_text(bytes),
        "" => Err("file has no extension — can't tell what type it is".to_string()),
        other => Err(format!("unsupported file type: .{other}")),
    }
}

#[tauri::command]
pub async fn upload_document(
    state: State<'_, AppState>,
    filename: String,
    bytes: Vec<u8>,
    document_type: String,
) -> Result<DocumentMetadata, String> {
    let file_size = bytes.len() as u64;
    let now = now_secs();
    let (status, error_message, text) = match extract_text(&filename, &bytes) {
        Ok(text) => ("READY".to_string(), None, text),
        Err(e) => ("ERROR".to_string(), Some(e), String::new()),
    };
    let metadata = DocumentMetadata {
        document_id: new_document_id(),
        filename,
        document_type,
        file_size,
        created_at: now,
        updated_at: now,
        status,
        error_message,
    };

    let mut store = state.documents.lock().map_err(|e| e.to_string())?;
    store.insert(metadata.document_id.clone(), DocumentRecord { metadata: metadata.clone(), text });
    Ok(metadata)
}

#[tauri::command]
pub async fn get_document_text(state: State<'_, AppState>, document_id: String) -> Result<Option<String>, String> {
    let store = state.documents.lock().map_err(|e| e.to_string())?;
    Ok(store.get(&document_id).map(|r| r.text.clone()))
}

#[tauri::command]
pub async fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentMetadata>, String> {
    let store = state.documents.lock().map_err(|e| e.to_string())?;
    Ok(store.values().map(|r| r.metadata.clone()).collect())
}

#[tauri::command]
pub async fn delete_document(state: State<'_, AppState>, document_id: String) -> Result<(), String> {
    let mut store = state.documents.lock().map_err(|e| e.to_string())?;
    store.remove(&document_id);
    Ok(())
}
