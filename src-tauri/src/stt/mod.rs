//! Speech-to-text via Deepgram Flux.
//!
//! `SttClient` streams 16kHz mono PCM16 audio to
//! `wss://api.deepgram.com/v2/listen` over a WebSocket and turns Deepgram's
//! turn-based transcript events into partial/final `SttEvent`s. Unlike the
//! local model this replaced, this module does make a network call — audio
//! leaves this machine, encrypted, directly to Deepgram, and nowhere else.
//!
//! No component in this module (or anywhere else in the app) tries to detect
//! whether a piece of text is a "question" or decide when to call an LLM. It
//! only turns audio into partial/final text events.

pub mod backend_token;
mod client;
mod events;

pub use backend_token::SttSession;
pub use client::{SttClient, SttModel};
pub use events::{SttEvent, SttEventKind};
