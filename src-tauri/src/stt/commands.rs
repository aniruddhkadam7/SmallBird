//! Thin Tauri commands over `stt::key_store`, mirroring
//! `personal::commands`'s `personal_*_api_key` commands exactly (same
//! Windows-Credential-Manager-backed storage, just for the single Deepgram
//! slot rather than a per-`LlmProvider` one).

use super::key_store;

#[tauri::command]
pub fn stt_get_api_key() -> Result<Option<String>, String> {
    key_store::load_key()
}

#[tauri::command]
pub fn stt_set_api_key(key: String) -> Result<(), String> {
    key_store::store_key(&key)
}

#[tauri::command]
pub fn stt_clear_api_key() -> Result<(), String> {
    key_store::clear_key()
}
