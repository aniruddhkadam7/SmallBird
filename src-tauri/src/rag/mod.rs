//! Local document text-extraction service process management + HTTP client.
//!
//! The extraction engine (`packages/rag`) is a separate local-only
//! Python/FastAPI process, managed here as a child process — unlike
//! `crate::stt`, which no longer spawns a local process at all (STT is a
//! Deepgram Flux WebSocket connection, see `stt::client`). This one speaks
//! plain request/response HTTP (bound to 127.0.0.1 only): a user uploads a
//! CV/resume or job description (PDF/DOCX/text), this service extracts
//! plain text from it, and that text is sent directly to the LLM as
//! context (see `interview_mode::commands::fetch_document_full_text`). No
//! chunking, embedding, or vector search — that RAG-search layer existed
//! before but never worked in this build (the bundled `rag-lite` sidecar is
//! extraction-only) and has been removed entirely.
//!
//! This module has no code path that sends documents to any remote server —
//! every request it makes goes to the local extraction service's 127.0.0.1
//! port, and that service in turn never calls out anywhere either.

mod client;
mod process;
pub mod types;

pub use client::RagClient;
pub use process::{wait_until_healthy_default, RagServiceHandle};
pub use types::DocumentMetadata;
