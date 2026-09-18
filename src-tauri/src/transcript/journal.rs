//! Crash-proof journal of the raw speech-to-text feed.
//!
//! `history.rs` only ever saw Ask AI question/answer turns, so an interview
//! where the user never pressed Ask AI -- or where the app died before the
//! first answer finished -- left *nothing* behind, even though the session
//! was billed. Every finalized STT segment is therefore appended here the
//! moment it arrives, one JSON object per line, flushed to disk before the
//! call returns. Losing power mid-interview costs at most the sentence being
//! spoken at that instant, and a torn last line is simply skipped on read.
//!
//! One file per recording session (`<dir>/<session_id>.jsonl`) rather than
//! one shared file, so a damaged file can only ever affect its own session.
//! Nothing in here depends on Tauri, which keeps it unit-testable and usable
//! from the headless pipeline binaries.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::audio::AudioSource;

/// First line of every journal: identifies the session and carries the id the
/// finished transcript will be stored under. Generated once, at creation, so
/// recovering the same journal twice (crash during recovery, say) upserts the
/// same row instead of creating a duplicate.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JournalHeader {
    /// Id of the recording session (`InterviewSession::id`).
    pub session_id: String,
    /// UUID the resulting `interview_transcripts` row will use.
    pub entry_id: String,
    pub started_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JournalSegment {
    pub at_ms: u64,
    pub source: AudioSource,
    pub text: String,
}

/// One line of the file: either the header or a segment. Tagged so the
/// reader never has to guess by position.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum Line {
    Header(JournalHeader),
    Segment(JournalSegment),
}

/// A journal read back from disk.
#[derive(Debug, Clone)]
pub struct LoadedJournal {
    pub path: PathBuf,
    pub header: JournalHeader,
    pub segments: Vec<JournalSegment>,
    /// Modification time of the file, ms since Unix epoch -- when the last
    /// segment was written. Used to tell a finished session from a live one.
    pub last_write_ms: u64,
}

/// Appends to the journal of the recording session currently in progress.
pub struct JournalWriter {
    file: File,
    path: PathBuf,
}

impl JournalWriter {
    /// Creates (or, if it already exists, reopens for append) the journal for
    /// `session_id` under `dir`.
    pub fn open(dir: &Path, session_id: &str, started_at_ms: u64) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| format!("create journal dir: {e}"))?;
        let path = journal_path(dir, session_id);
        let existed = path.exists();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("open journal: {e}"))?;
        if !existed {
            let header = JournalHeader {
                session_id: session_id.to_string(),
                entry_id: new_uuid(),
                started_at_ms,
            };
            write_line(&mut file, &Line::Header(header))?;
        }
        Ok(Self { file, path })
    }

    pub fn append(&mut self, source: AudioSource, text: &str, at_ms: u64) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(());
        }
        write_line(
            &mut self.file,
            &Line::Segment(JournalSegment {
                at_ms,
                source,
                text: text.to_string(),
            }),
        )
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn journal_path(dir: &Path, session_id: &str) -> PathBuf {
    // Session ids are "<hex>-<hex>", but never trust that for a filename.
    let safe: String = session_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    dir.join(format!("{safe}.jsonl"))
}

/// Serialises `line` and writes it as a single `write_all` (so a crash can
/// only ever tear the *last* line) and forces it to disk.
fn write_line(file: &mut File, line: &Line) -> Result<(), String> {
    let mut buf = serde_json::to_vec(line).map_err(|e| format!("serialize journal line: {e}"))?;
    buf.push(b'\n');
    file.write_all(&buf).map_err(|e| format!("write journal: {e}"))?;
    // sync_data, not just flush: flush only hands the bytes to the OS, which
    // is exactly what a power cut or hard kill loses.
    file.sync_data().map_err(|e| format!("sync journal: {e}"))
}

/// Reads one journal file. Unparseable lines (a torn final line after a
/// crash, or damage anywhere else) are skipped rather than failing the whole
/// file -- every intact segment is still recovered. Returns `None` only when
/// there's no usable header, in which case the file can't be attributed to a
/// session at all.
pub fn read_journal(path: &Path) -> Option<LoadedJournal> {
    let file = File::open(path).ok()?;
    let last_write_ms = file
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut header = None;
    let mut segments = Vec::new();
    for raw in BufReader::new(file).lines() {
        let Ok(raw) = raw else { continue };
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        match serde_json::from_str::<Line>(raw) {
            Ok(Line::Header(h)) => {
                header.get_or_insert(h);
            }
            Ok(Line::Segment(s)) => segments.push(s),
            Err(_) => continue,
        }
    }
    Some(LoadedJournal {
        path: path.to_path_buf(),
        header: header?,
        segments,
        last_write_ms,
    })
}

/// Every readable journal in `dir`, oldest first. Files that aren't journals
/// (or have no header) are ignored, never deleted.
pub fn list_journals(dir: &Path) -> Vec<LoadedJournal> {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<LoadedJournal> = read_dir
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .filter_map(|p| read_journal(&p))
        .collect();
    out.sort_by_key(|j| j.header.started_at_ms);
    out
}

/// Random (v4-shaped) UUID for the row id. Uniqueness is all that matters
/// here -- the id is not a secret and is scoped per-user by row-level
/// security -- so this avoids a dependency for it.
fn new_uuid() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut bytes = [0u8; 16];
    for chunk in bytes.chunks_mut(8) {
        // RandomState is seeded from the OS RNG per instance.
        let mut h = RandomState::new().build_hasher();
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sb-journal-test-{tag}-{}", new_uuid()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn round_trips_segments_in_order() {
        let dir = tmp_dir("rt");
        let mut w = JournalWriter::open(&dir, "abc-1", 1000).unwrap();
        w.append(AudioSource::SystemAudio, "Tell me about yourself.", 1100).unwrap();
        w.append(AudioSource::Microphone, "  I build things.  ", 1200).unwrap();
        w.append(AudioSource::Microphone, "   ", 1300).unwrap(); // blank: skipped

        let j = read_journal(w.path()).unwrap();
        assert_eq!(j.header.session_id, "abc-1");
        assert_eq!(j.header.started_at_ms, 1000);
        assert_eq!(j.segments.len(), 2);
        assert_eq!(j.segments[1].text, "I build things.");
        assert_eq!(j.segments[0].source, AudioSource::SystemAudio);
    }

    #[test]
    fn torn_last_line_only_loses_that_line() {
        let dir = tmp_dir("torn");
        let mut w = JournalWriter::open(&dir, "abc-2", 1000).unwrap();
        w.append(AudioSource::SystemAudio, "first", 1).unwrap();
        w.append(AudioSource::SystemAudio, "second", 2).unwrap();
        // Simulate a crash mid-write: half a JSON object, no newline.
        let mut f = OpenOptions::new().append(true).open(w.path()).unwrap();
        f.write_all(br#"{"t":"segment","at_ms":3,"source":"SYST"#).unwrap();

        let j = read_journal(w.path()).unwrap();
        assert_eq!(
            j.segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(),
            vec!["first", "second"]
        );
    }

    #[test]
    fn garbage_in_the_middle_is_skipped_not_fatal() {
        let dir = tmp_dir("mid");
        let mut w = JournalWriter::open(&dir, "abc-3", 1000).unwrap();
        w.append(AudioSource::SystemAudio, "before", 1).unwrap();
        let mut f = OpenOptions::new().append(true).open(w.path()).unwrap();
        f.write_all(b"\x00\x00not json at all\n").unwrap();
        w.append(AudioSource::SystemAudio, "after", 2).unwrap();

        let j = read_journal(w.path()).unwrap();
        assert_eq!(j.segments.len(), 2);
    }

    #[test]
    fn reopening_keeps_the_same_entry_id() {
        let dir = tmp_dir("reopen");
        let first = JournalWriter::open(&dir, "abc-4", 1000).unwrap();
        let id_a = read_journal(first.path()).unwrap().header.entry_id;
        drop(first);
        let second = JournalWriter::open(&dir, "abc-4", 9999).unwrap();
        let j = read_journal(second.path()).unwrap();
        assert_eq!(j.header.entry_id, id_a);
        assert_eq!(j.header.started_at_ms, 1000);
    }

    #[test]
    fn headerless_file_is_ignored() {
        let dir = tmp_dir("nohdr");
        let p = dir.join("x.jsonl");
        fs::write(&p, "{\"t\":\"segment\",\"at_ms\":1,\"source\":\"MICROPHONE\",\"text\":\"hi\"}\n").unwrap();
        assert!(read_journal(&p).is_none());
        assert!(list_journals(&dir).is_empty());
    }

    #[test]
    fn uuid_has_v4_shape_and_is_unique() {
        let a = new_uuid();
        let b = new_uuid();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(a.as_bytes()[14], b'4');
        assert!(matches!(a.as_bytes()[19], b'8' | b'9' | b'a' | b'b'));
    }
}
