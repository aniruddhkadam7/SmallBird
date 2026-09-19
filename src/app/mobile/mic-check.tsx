"use client";

import { useEffect, useRef, useState } from "react";
import { MicError, startMic, type MicHandle } from "@/lib/mobile/mic";

/** RMS (0..1) above which the phone is treated as actually hearing speech-level audio. */
const HEARD_RMS = 0.012;
/** Consecutive 100 ms readings above the threshold needed to call it "heard" (~0.8 s), so a cough or bump doesn't count. */
const HEARD_READINGS = 8;

interface Props {
  onReady: () => void;
  onBack: () => void;
}

export default function MicCheck({ onReady, onBack }: Props) {
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState("");
  const streak = useRef(0);

  useEffect(() => {
    let handle: MicHandle | null = null;
    let cancelled = false;

    // Only the level is measured: this check never opens a transcription
    // session, so it doesn't cost any minutes.
    startMic(
      () => {},
      (rms) => {
        setLevel(rms);
        streak.current = rms > HEARD_RMS ? streak.current + 1 : 0;
        if (streak.current >= HEARD_READINGS) setHeard(true);
      },
    ).then(
      (mic) => {
        if (cancelled) mic.stop();
        else handle = mic;
      },
      (err: unknown) => setError(err instanceof MicError ? err.message : "Couldn't start the microphone."),
    );

    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, []);

  // sqrt stretches the quiet end so a distant laptop speaker still visibly moves the bar.
  const fill = Math.min(1, Math.sqrt(level) * 2.2);

  return (
    <main className="screen center">
      <h2>Check the microphone</h2>
      <p className="muted">
        Place the phone next to your laptop, then play any voice on the laptop&apos;s speakers, or say something to the
        interviewer as they would.
      </p>

      <div className="meter" aria-hidden>
        <div className="meter-fill" style={{ width: `${fill * 100}%` }} data-heard={heard} />
      </div>

      {error ? (
        <p className="error">{error}</p>
      ) : heard ? (
        <p className="ok">✓ The phone can hear it.</p>
      ) : (
        <p className="muted">Listening for audio…</p>
      )}

      <p className="warn">Don&apos;t wear headphones: the phone can only hear what comes out of the laptop&apos;s speakers.</p>

      <button className="primary" onClick={onReady} disabled={!heard}>
        Continue
      </button>
      {!heard && !error && (
        <button className="link" onClick={onReady}>
          Skip the check
        </button>
      )}
      <button className="link" onClick={onBack}>
        Back
      </button>
    </main>
  );
}
