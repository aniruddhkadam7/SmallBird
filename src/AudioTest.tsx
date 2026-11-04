import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button, Spinner } from "./ui";
import type { AudioLevelEvent, TranscriptSegment } from "./types";

// Pre-interview "Test Audio" check. It contains NO capture or transcription
// code of its own. It makes the computer speak a random test sentence through
// the default output device, then drives the exact commands Start Interview
// uses (start_backend_session -> start_system_audio_capture, later
// stop_audio_capture -> end_backend_session) and only observes the events that
// pipeline already emits. Success therefore requires the real chain
//   speakers' render mix -> WASAPI loopback -> resample/gap-fill -> Deepgram
//   STT -> transcript:update
// to have produced text that contains the words that were spoken. Playing the
// sound is just the signal source: a muted output, the wrong default device or
// a broken capture path all still fail, because the words never come back.

export type AudioTestState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "listening"; transcript: string }
  | { phase: "success"; transcript: string }
  | { phase: "no-audio" }
  | { phase: "no-transcript" }
  | { phase: "error"; message: string };

/// RMS (0..1, computed in Rust on each captured chunk) above which a chunk
/// counts as real audio. WASAPI loopback delivers nothing - or exact zeros -
/// while nothing is playing, so this only has to clear numeric noise (about
/// -66 dBFS), not separate speech from a noise floor.
const AUDIO_ACTIVITY_RMS = 0.0005;
/// From capture being live: no audible frames at all in this long -> no system audio.
const NO_AUDIO_TIMEOUT_MS = 10_000;
/// From the first audible frame: no matching transcript in this long -> ASR failed.
const NO_TRANSCRIPT_TIMEOUT_MS = 8_000;
/// After the words are recognised, keep listening this long (or until the
/// utterance finalizes) so the shown sentence isn't cut off mid-way.
const SUCCESS_GRACE_MS = 1_500;
/// Starting the STT session or capture must never leave the panel spinning forever.
const STARTUP_TIMEOUT_MS = 20_000;
/// Stopping capture flushes and closes the STT connection; if that ever stalls
/// the STT session must still be ended, or the account looks "busy" afterwards.
const STOP_TIMEOUT_MS = 8_000;
/// Give the last events (the flush on stop emits a final) a moment to arrive.
const EVENT_DRAIN_MS = 300;
/// How many of the three random words must appear in the transcript. Two of
/// three tolerates one mis-heard word without letting unrelated speech through.
const REQUIRED_WORD_MATCHES = 2;

// Distinct-sounding words, so a slightly-off transcription still matches.
const COLORS = ["red", "blue", "green", "yellow", "purple", "orange"];
const ANIMALS = ["horse", "tiger", "rabbit", "dolphin", "eagle", "monkey"];
const MOODS = ["quick", "quiet", "happy", "strong", "brave", "clever"];

const pick = (words: string[]) => words[Math.floor(Math.random() * words.length)];

/// A fresh sentence every run, so the result can't be satisfied by anything
/// but what was actually played just now.
function makeTestPhrase() {
  const words = [pick(COLORS), pick(ANIMALS), pick(MOODS)];
  return { sentence: `Testing SmallBird AI audio. The ${words[0]} ${words[1]} is ${words[2]}.`, words };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      },
    );
  });
}

const log = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug("[audio-test]", ...args);
};

function usableText(segment: TranscriptSegment): string {
  const text = (segment.final_text ?? segment.partial_text ?? "").trim();
  // Must contain a real letter/digit - punctuation-only output isn't a transcript.
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

function matchedWords(transcript: string, words: string[]): number {
  const heard = transcript.toLowerCase();
  return words.filter((word) => heard.includes(word)).length;
}

interface TestRun {
  cancel: () => Promise<void>;
  finished: Promise<void>;
}

/// The caller shows the "listening" state itself; `setState` is only ever
/// called asynchronously after this returns.
function beginAudioTest(setState: (state: AudioTestState) => void): TestRun {
  const phrase = makeTestPhrase();
  const t0 = performance.now();
  const since = () => `+${Math.round(performance.now() - t0)}ms`;
  let settled = false;
  let cancelled = false;
  let sessionStarted = false;
  let captureStarted = false;
  let chunkCount = 0;
  let audioSeen = false;
  let succeeded = false;
  // Latest text per STT segment id, so a sentence split across several
  // utterances is judged (and shown) as a whole.
  const heardSegments = new Map<string, string>();
  const heardText = () => [...heardSegments.values()].join(" ");
  const unlisteners: UnlistenFn[] = [];
  const timers: number[] = [];

  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const clearTimers = () => {
    timers.splice(0).forEach((id) => window.clearTimeout(id));
  };

  // Releases everything the test acquired, in the reverse order it was
  // acquired, so the interview that follows starts from a clean slate.
  const teardown = async () => {
    clearTimers();
    // Cut the test sentence off first so its tail can't leak into the interview.
    await invoke("stop_audio_test_phrase").catch(() => {});
    if (captureStarted) {
      await withTimeout(invoke("stop_audio_capture"), STOP_TIMEOUT_MS, "stop_audio_capture").catch((e) =>
        log("stop_audio_capture failed:", e),
      );
      log("system-audio capture stopped");
    }
    // Always end the session, even if stopping capture failed or timed out.
    if (sessionStarted) {
      await invoke("end_backend_session").catch((e) => log("end_backend_session failed:", e));
    }
    // The flush on stop can still emit a final transcript; let it land first.
    await new Promise((resolve) => window.setTimeout(resolve, EVENT_DRAIN_MS));
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };

  // `outcome` is shown as-is; null means the user cancelled, so the panel resets.
  const settle = async (outcome: AudioTestState | null) => {
    if (settled) return;
    settled = true;
    cancelled = outcome === null;
    setState(outcome ?? { phase: "idle" });
    await started; // never tear down underneath a startup that is still in flight
    await teardown();
    resolveFinished();
  };

  const onTranscript = (segment: TranscriptSegment) => {
    const text = usableText(segment);
    if (!text || cancelled) return;
    heardSegments.set(segment.id, text);
    const transcript = heardText();
    const matches = matchedWords(transcript, phrase.words);
    if (settled) {
      // Late text from the stop-time flush: show the finished sentence.
      if (succeeded) setState({ phase: "success", transcript });
      return;
    }
    // Show what the ASR is hearing as it happens, before it is judged.
    if (!succeeded) setState({ phase: "listening", transcript });
    log(`ASR transcript received: "${transcript}" (${matches}/${phrase.words.length} test words)`);
    if (!audioSeen) {
      // Text with no audible frame beforehand shouldn't happen; if it ever
      // does, it must not stand in for evidence that audio was captured.
      log("transcript arrived without any audible frames - ignoring");
      return;
    }
    if (matches < REQUIRED_WORD_MATCHES) return; // not (yet) what was played
    if (!succeeded) {
      succeeded = true;
      clearTimers();
      log("test succeeded");
      timers.push(
        window.setTimeout(() => void settle({ phase: "success", transcript: heardText() }), SUCCESS_GRACE_MS),
      );
    }
    setState({ phase: "success", transcript });
    // The utterance finalized - nothing more is coming worth waiting for.
    if (segment.final_text) void settle({ phase: "success", transcript });
  };

  const onAudioLevel = (payload: AudioLevelEvent) => {
    if (settled || payload.source !== "SYSTEM_AUDIO") return;
    chunkCount += 1;
    if (chunkCount === 1) log("first system-audio frames received");
    if (!audioSeen && payload.rms_level > AUDIO_ACTIVITY_RMS) {
      audioSeen = true;
      log(`audio activity detected (rms ${payload.rms_level.toFixed(4)}) - waiting for ASR`);
      // Audio is real; now the only thing left to prove is the ASR side.
      clearTimers();
      timers.push(
        window.setTimeout(() => {
          log("test failed: audio detected but the spoken words were not transcribed");
          void settle({ phase: "no-transcript" });
        }, NO_TRANSCRIPT_TIMEOUT_MS),
      );
    }
  };

  // Resolves with the failure to show, or null once capture is live and armed.
  const startup = async (): Promise<AudioTestState | null> => {
    try {
      // Synthesize the sentence now, in parallel with the network round trips
      // below, so it can play the moment capture is live instead of after.
      const prepared = invoke("prepare_audio_test_phrase", { phrase: phrase.sentence }).then(
        () => log(`test sentence prepared ${since()}`),
      );
      prepared.catch(() => {}); // surfaced when it's awaited below

      // Clear anything an earlier run on this device left behind. The server
      // allows one active session per account, so an orphaned one would make
      // this look like "another device" is in use. Both calls are no-ops when
      // nothing is running, and this only ever runs while no interview is.
      await withTimeout(invoke("stop_audio_capture"), STOP_TIMEOUT_MS, "stop_audio_capture").catch(() => {});
      await withTimeout(invoke("end_backend_session"), STOP_TIMEOUT_MS, "end_backend_session").catch(() => {});
      // A test that was cut off (crash, quit, update) leaves its session open
      // on the server for a couple of minutes; close it now rather than wait.
      await withTimeout(
        invoke("close_orphaned_audio_test_session"),
        STOP_TIMEOUT_MS,
        "close_orphaned_audio_test_session",
      ).catch(() => {});

      // Same order Start Interview uses: session (Deepgram key) first, then capture.
      const session = await withTimeout(
        invoke<{ rejection: string | null; activeElsewhere: boolean }>("start_backend_session", {
          sttMode: "local",
          force: false,
          audioTest: true,
        }),
        STARTUP_TIMEOUT_MS,
        "start_backend_session",
      );
      // Never force here: that would end the user's interview on another device.
      if (session.activeElsewhere) {
        return {
          phase: "error",
          message: "An interview is currently running on another device, so the audio test can't run right now.",
        };
      }
      if (session.rejection) return { phase: "error", message: session.rejection };
      sessionStarted = true;
      log(`STT session started ${since()}`);

      // Subscribe before capture starts so no early event can be missed.
      unlisteners.push(
        await listen<AudioLevelEvent>("audio:level", (e) => onAudioLevel(e.payload)),
        await listen<TranscriptSegment>("transcript:update", (e) => onTranscript(e.payload)),
      );

      // Set first: audio can start flowing (and settle the test) before this
      // command's reply arrives, and stopping a capture that never started is harmless.
      captureStarted = true;
      await withTimeout(invoke("start_system_audio_capture"), STARTUP_TIMEOUT_MS, "start_system_audio_capture");
      log(`system-audio capture started; ASR session connected ${since()}; playing: "${phrase.sentence}"`);
      if (!settled) setState({ phase: "listening", transcript: "" });

      timers.push(
        window.setTimeout(() => {
          log(`test failed: no audible frames (chunks received: ${chunkCount})`);
          void settle({ phase: "no-audio" });
        }, NO_AUDIO_TIMEOUT_MS),
      );
      // Not awaited: the sentence plays for a few seconds while we listen. A
      // playback failure is its own error - it says nothing about capture.
      prepared.then(() => (settled ? undefined : invoke("play_audio_test_phrase"))).catch((e) => {
        if (settled) return;
        log("could not play the test sound:", e);
        void settle({
          phase: "error",
          message: "Couldn't play the test sound. Check that your speakers or headphones are working.",
        });
      });
      return null;
    } catch (err) {
      log("test could not start:", err);
      return { phase: "error", message: "Couldn't start the audio test. Please try again." };
    }
  };

  const started = startup();
  void started.then((failure) => failure && settle(failure));

  return {
    cancel: async () => {
      await settle(null);
      await finished;
    },
    finished,
  };
}

export function useAudioTest() {
  const [state, setState] = useState<AudioTestState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const runRef = useRef<TestRun | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void runRef.current?.cancel();
    };
  }, []);

  const start = useCallback(() => {
    if (runRef.current) return;
    setBusy(true);
    setState({ phase: "connecting" });
    const run = beginAudioTest((next) => {
      if (mountedRef.current && runRef.current === run) setState(next);
    });
    runRef.current = run;
    void run.finished.then(() => {
      if (runRef.current === run) runRef.current = null;
      if (mountedRef.current) setBusy(false);
    });
  }, []);

  // Resolves once every temporary resource (capture, STT session) is released.
  // Also clears any finished result so the panel starts fresh next time.
  const cancel = useCallback(async () => {
    await runRef.current?.cancel();
    if (mountedRef.current) setState({ phase: "idle" });
  }, []);

  return { state, busy, start, cancel };
}

export function AudioTestStatus({
  state,
  busy,
  onRetry,
}: {
  state: AudioTestState;
  /// True until the previous run has released capture; retrying earlier would be ignored.
  busy: boolean;
  onRetry: () => void;
}) {
  if (state.phase === "idle") return null;

  if (state.phase === "connecting") {
    return (
      <div className="audio-test-status" role="status">
        <span className="audio-test-title listening">
          <Spinner className="on-light" /> Getting ready...
        </span>
        <p className="setup-hint">Connecting to the transcription service. This takes a few seconds.</p>
      </div>
    );
  }

  if (state.phase === "listening") {
    return (
      <div className="audio-test-status" role="status">
        <span className="audio-test-title listening">
          <Spinner className="on-light" /> Listening...
        </span>
        {state.transcript ? (
          <blockquote className="audio-test-transcript">“{state.transcript}”</blockquote>
        ) : (
          <p className="setup-hint">Playing a short test sound. Keep your volume up.</p>
        )}
      </div>
    );
  }

  if (state.phase === "success") {
    return (
      <div className="audio-test-status success" role="status">
        <span className="audio-test-title">✓ System Audio Working</span>
        <blockquote className="audio-test-transcript">“{state.transcript}”</blockquote>
      </div>
    );
  }

  const failure =
    state.phase === "no-audio"
      ? {
          title: "⚠️ No System Audio Detected",
          detail: "Make sure your speakers or headphones are on and not muted, then try again.",
        }
      : state.phase === "no-transcript"
        ? { title: "⚠️ Audio detected, but transcription failed", detail: null }
        : { title: "⚠️ Audio test unavailable", detail: state.message };

  return (
    <div className="audio-test-status failure" role="alert">
      <span className="audio-test-title">{failure.title}</span>
      {failure.detail && <p className="setup-hint">{failure.detail}</p>}
      <div>
        <Button size="sm" onClick={onRetry} disabled={busy}>
          Try Again
        </Button>
      </div>
    </div>
  );
}
