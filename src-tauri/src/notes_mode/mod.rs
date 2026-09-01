//! Notes Mode: a normal in-app workspace (no overlay window, unlike
//! Interview/Meeting) for quick notes, AI summaries, and "ask AI about my
//! notes".

pub mod ai;
pub mod store;

pub use store::NotesStore;
