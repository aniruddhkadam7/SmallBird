//! AI operations for Notes: summarizing a note, and asking a question with
//! one or more notes as optional context. Stateless — no session concept.

use tauri::State;

use crate::backend::{NoteContext, NotesAskRequest, NotesSummaryRequest};
use crate::state::AppState;

#[derive(Debug, serde::Deserialize)]
pub struct NoteAskContext {
    pub title: Option<String>,
    pub body: String,
}

#[tauri::command]
pub async fn summarize_note(
    state: State<'_, AppState>,
    title: Option<String>,
    body: String,
) -> Result<crate::backend::NoteSummary, String> {
    let request = NotesSummaryRequest { title, body };
    let access_token = crate::auth::current_access_token(&state).await?;
    crate::personal::DirectLlmClient::new(None, access_token).notes_summarize(&request).await
}

#[tauri::command]
pub async fn ask_about_notes(
    state: State<'_, AppState>,
    question: String,
    notes: Vec<NoteAskContext>,
) -> Result<crate::backend::NotesAskResponse, String> {
    let request = NotesAskRequest {
        question,
        notes: notes.into_iter().map(|n| NoteContext { title: n.title, body: n.body }).collect(),
    };
    let access_token = crate::auth::current_access_token(&state).await?;
    crate::personal::DirectLlmClient::new(None, access_token).notes_ask(&request).await
}
