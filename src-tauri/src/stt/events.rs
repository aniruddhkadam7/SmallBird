use crate::audio::AudioSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SttEventKind {
    Partial,
    Final,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SttEvent {
    pub kind: SttEventKind,
    pub text: String,
    pub source: AudioSource,
    /// Present only for `Final` events; Deepgram's turn-relative audio window
    /// timestamps (seconds).
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    /// Deepgram's speaker number (0-based) within this stream — only set by
    /// the diarized Notes Mode connection (see `SttModel::DiarizedNova`).
    pub speaker: Option<u32>,
}
