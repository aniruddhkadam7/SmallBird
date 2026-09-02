//! The AI client: routes every call through the deployed `llm-proxy`
//! Supabase Edge Function using the signed-in user's access token (see
//! `crate::auth`) — no API key is ever stored or used client-side anymore.
//! See `client::DirectLlmClient` for the call path used at every AI call
//! site.

pub mod client;
pub mod prompts;
pub mod provider;
pub mod providers;

pub use client::DirectLlmClient;
