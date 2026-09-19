// Microphone -> 16 kHz mono PCM16 in 80 ms frames (1280 samples), the format
// and chunk size the desktop app sends to Deepgram Flux
// (src-tauri/src/stt/client.rs). Phones capture at 44.1/48 kHz and Safari
// ignores a requested AudioContext sample rate, so the worklet resamples
// itself instead of relying on the browser to.

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1280;

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.acc = 0; this.count = 0; this.t = 0; this.next = this.ratio;
    this.frame = new Int16Array(${FRAME_SAMPLES}); this.n = 0;
    this.sumSq = 0; this.levelSamples = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      this.sumSq += x * x; this.levelSamples++;
      // Box-average down to the target rate: cheap, and enough of a low-pass
      // for speech.
      this.acc += x; this.count++; this.t++;
      if (this.t >= this.next) {
        const s = Math.max(-1, Math.min(1, this.acc / this.count));
        this.frame[this.n++] = s < 0 ? s * 32768 : s * 32767;
        this.acc = 0; this.count = 0; this.next += this.ratio;
        if (this.n === ${FRAME_SAMPLES}) {
          const out = this.frame.buffer;
          this.port.postMessage({ type: "pcm", buffer: out }, [out]);
          this.frame = new Int16Array(${FRAME_SAMPLES}); this.n = 0;
        }
      }
    }
    if (this.levelSamples >= sampleRate / 10) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.sumSq / this.levelSamples) });
      this.sumSq = 0; this.levelSamples = 0;
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export interface MicHandle {
  stop(): void;
}

export class MicError extends Error {
  constructor(message: string, public kind: "denied" | "unavailable") {
    super(message);
  }
}

/**
 * The phone is listening to the interviewer through the room, so echo
 * cancellation and noise suppression are OFF: they're tuned for a near-field
 * voice and treat far-field speech from a laptop speaker as noise to remove.
 * Auto gain stays ON to lift the quiet, distant signal.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

/**
 * Audio that was set up inside the user's tap.
 *
 * iOS Safari only lets an AudioContext start (resume) synchronously inside a
 * touch handler, and the interview can't start capturing until after network
 * calls (minting the session, connecting to Deepgram). So the context and the
 * microphone request are created here, in the tap, and handed to startMic()
 * once everything else is ready. Call prepareAudio() directly from the click
 * handler, before any await.
 */
export interface PreparedAudio {
  context: AudioContext;
  stream: Promise<MediaStream>;
  released: boolean;
}

export function prepareAudio(): PreparedAudio | null {
  try {
    const context = new AudioContext();
    void context.resume();
    const stream = navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    // A denied permission is reported when startMic awaits this; without a
    // handler attached now it would also surface as an unhandled rejection.
    stream.catch(() => {});
    return { context, stream, released: false };
  } catch {
    // No AudioContext / mediaDevices (old browser or insecure page): startMic
    // falls back to creating them itself and reports the real problem.
    return null;
  }
}

/** Releases audio that was prepared but never used (e.g. the session failed to start). Safe to call twice. */
export function discardPrepared(prepared: PreparedAudio | null | undefined): void {
  if (!prepared || prepared.released) return;
  prepared.released = true;
  prepared.stream.then(
    (stream) => stream.getTracks().forEach((track) => track.stop()),
    () => {},
  );
  void prepared.context.close().catch(() => {});
}

function micErrorFrom(err: unknown): MicError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new MicError("Microphone access is blocked. Allow it in your browser's site settings and try again.", "denied");
  }
  return new MicError("No microphone found on this device.", "unavailable");
}

/** Starts capture, using `prepared` audio when given (see prepareAudio). */
export async function startMic(
  onFrame: (pcm16: ArrayBuffer) => void,
  onLevel: (rms: number) => void,
  prepared?: PreparedAudio | null,
): Promise<MicHandle> {
  let context: AudioContext;
  let stream: MediaStream;
  try {
    if (prepared && !prepared.released) {
      context = prepared.context;
      stream = await prepared.stream;
      // Ownership moves to the handle below; discardPrepared must no longer touch it.
      prepared.released = true;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      context = new AudioContext();
    }
  } catch (err) {
    discardPrepared(prepared);
    throw micErrorFrom(err);
  }

  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(workletUrl);
    // A context created outside a tap starts suspended; on desktop and
    // Android that is resumable here, on iOS it was already resumed in the tap.
    if (context.state === "suspended") await context.resume();
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
    throw err;
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "pcm-capture");
  node.port.onmessage = (event: MessageEvent<{ type: "pcm"; buffer: ArrayBuffer } | { type: "level"; rms: number }>) => {
    if (event.data.type === "pcm") onFrame(event.data.buffer);
    else onLevel(event.data.rms);
  };
  source.connect(node);
  // Not connected to context.destination: the phone must never play the
  // room audio back out of its own speaker.

  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
