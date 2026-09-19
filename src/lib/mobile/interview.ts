import {
  AUTO_AI_SILENCE_MS_COMPLETE,
  AUTO_AI_SILENCE_MS_INCOMPLETE,
  classifyQuestionCompleteness,
  joinSpeech,
} from "./question-completeness";
import { ApiError, mintSttSession, reportUsage, sendHeartbeat } from "./api";
import { FluxClient, type FluxState } from "./flux";
import { discardPrepared, startMic, type MicHandle, type PreparedAudio } from "./mic";
import { looksLikeQuestion } from "./questions";

export type LiveStatus = "starting" | "listening" | "reconnecting" | "paused" | "ended";

export interface Turn {
  id: number;
  text: string;
}

export interface InterviewEvents {
  onStatus(status: LiveStatus, detail?: string): void;
  /** Speech heard but not yet answered: buffered finished turns plus the words still being spoken. */
  onHearing(text: string): void;
  /** A finished turn, for the transcript. */
  onTurn(turn: Turn): void;
  /** Auto AI decided the interviewer finished asking something. */
  onQuestion(question: string): void;
  onLevel(rms: number): void;
  onRemaining(seconds: number): void;
  /** Called once when the session is over, whatever the reason. */
  onEnded(message: string): void;
}

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Owns one interview session end to end: the server-side session (minutes,
 * one-active-session rule, heartbeat), the microphone, and the Deepgram
 * stream — the same responsibilities `start_capture_inner` and
 * `stt/backend_token.rs` split between them on desktop.
 */
export class InterviewController {
  sessionId = "";

  private flux: FluxClient | null = null;
  private mic: MicHandle | null = null;
  private heartbeatTimer = 0;
  private tickTimer = 0;
  private autoAskTimer = 0;
  private startedAt = 0;
  private authorizedSeconds = 0;
  private pending = "";
  private partial = "";
  private paused = false;
  private autoAnswer = true;
  /** A question Auto answer detected while it was off, kept so "Answer this" can answer it. */
  private detected = "";
  private ended = false;
  private turnId = 0;

  constructor(private readonly events: InterviewEvents) {}

  /**
   * Throws ApiError (code ACTIVE_SESSION_ELSEWHERE / 402 out of minutes) or
   * MicError; nothing is left running on failure. `prepared` is audio set up
   * inside the user's tap (see prepareAudio) and is released on any failure.
   */
  async start(force: boolean, prepared?: PreparedAudio | null): Promise<void> {
    this.events.onStatus("starting");
    let minted;
    try {
      minted = await mintSttSession(force);
    } catch (err) {
      discardPrepared(prepared);
      throw err;
    }
    this.sessionId = minted.sessionId;
    this.authorizedSeconds = minted.expiresInSeconds;

    try {
      const flux = new FluxClient(minted.key, {
        onPartial: (text) => this.handlePartial(text),
        onTurn: (text) => this.handleTurn(text),
        onState: (state, detail) => this.handleFluxState(state, detail),
      });
      this.flux = flux;
      await flux.connect();
      this.mic = await startMic(
        (pcm) => {
          if (!this.paused) flux.sendAudio(pcm);
        },
        (rms) => this.events.onLevel(rms),
        prepared,
      );
    } catch (err) {
      // Close the session so one that can never be used doesn't hold the
      // account's single active-session slot. usage-report needs a positive
      // duration, so this bills 1 second — the smallest amount it accepts.
      discardPrepared(prepared);
      this.flux?.close();
      this.flux = null;
      void reportUsage(this.sessionId, 1).catch(() => {});
      this.ended = true;
      throw err;
    }

    this.startedAt = Date.now();
    this.events.onStatus("listening");
    this.events.onRemaining(this.authorizedSeconds);
    this.heartbeatTimer = window.setInterval(() => void this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    // Wall-clock based, not counted ticks: a backgrounded tab throttles
    // timers, and billing must follow real elapsed time.
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
  }

  setPaused(paused: boolean): void {
    if (this.ended || this.paused === paused) return;
    this.paused = paused;
    if (paused) this.flux?.forceEndTurn();
    this.events.onStatus(paused ? "paused" : "listening");
  }

  /**
   * When on (the default), a finished question is answered as soon as it is
   * detected. When off, it is only shown, and "Answer this" answers it.
   */
  setAutoAnswer(enabled: boolean): void {
    this.autoAnswer = enabled;
  }

  /**
   * For "Answer this": whatever the interviewer has said since the last
   * answer, or else the last question detected while Auto answer was off.
   * Clears both.
   */
  takePending(): string {
    this.flux?.forceEndTurn();
    window.clearTimeout(this.autoAskTimer);
    const heard = joinSpeech(this.pending, this.partial);
    const text = heard.trim() ? heard : this.detected;
    this.pending = "";
    this.partial = "";
    this.detected = "";
    this.events.onHearing("");
    return text;
  }

  async end(message = "Interview ended."): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.teardown();
    const elapsed = Math.min(Math.max(1, Math.round((Date.now() - this.startedAt) / 1000)), this.authorizedSeconds);
    let note = message;
    try {
      await reportUsage(this.sessionId, elapsed);
    } catch (err) {
      // The transcript is still the user's; just be honest that billing didn't close cleanly.
      note = `${message} (Couldn't record usage: ${err instanceof Error ? err.message : "unknown error"})`;
    }
    this.events.onStatus("ended");
    this.events.onEnded(note);
  }

  private teardown(): void {
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.autoAskTimer);
    this.mic?.stop();
    this.mic = null;
    this.flux?.close();
    this.flux = null;
  }

  private tick(): void {
    const remaining = Math.max(0, this.authorizedSeconds - Math.floor((Date.now() - this.startedAt) / 1000));
    this.events.onRemaining(remaining);
    if (remaining === 0) void this.end("You've used all your minutes.");
  }

  private async heartbeat(): Promise<void> {
    try {
      await sendHeartbeat(this.sessionId);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SESSION_ENDED") {
        // The server already closed this session (started elsewhere, or
        // expired) — there is nothing left to report usage against.
        if (this.ended) return;
        this.ended = true;
        this.teardown();
        this.events.onStatus("ended");
        this.events.onEnded(err.message);
      }
      // Anything else is a network blip; the next tick retries.
    }
  }

  private handleFluxState(state: FluxState, detail?: string): void {
    if (this.ended) return;
    if (state === "reconnecting") this.events.onStatus("reconnecting");
    else if (state === "live" && !this.paused) this.events.onStatus("listening");
    else if (state === "closed" && detail) void this.end(detail);
  }

  private handlePartial(text: string): void {
    // New speech means the speaker isn't done: hold off answering.
    window.clearTimeout(this.autoAskTimer);
    this.partial = text;
    this.events.onHearing(joinSpeech(this.pending, this.partial));
  }

  private handleTurn(text: string): void {
    this.events.onTurn({ id: ++this.turnId, text });
    this.partial = "";
    this.pending = joinSpeech(this.pending, text);
    this.events.onHearing(this.pending);

    // Same "is it finished or still being assembled" gate as desktop Auto AI:
    // wait longer when the text trails off mid-clause.
    const wait =
      classifyQuestionCompleteness(this.pending) === "complete" ? AUTO_AI_SILENCE_MS_COMPLETE : AUTO_AI_SILENCE_MS_INCOMPLETE;
    window.clearTimeout(this.autoAskTimer);
    this.autoAskTimer = window.setTimeout(() => this.fireAuto(), wait);
  }

  private fireAuto(): void {
    const text = this.pending.trim();
    if (!text) return;
    // A statement (very likely the candidate's own answer) stays in the
    // transcript but isn't answered automatically.
    if (!looksLikeQuestion(text)) {
      this.pending = "";
      this.events.onHearing("");
      return;
    }
    this.pending = "";
    if (this.autoAnswer) {
      this.detected = "";
      this.events.onHearing("");
      this.events.onQuestion(text);
    } else {
      // Held, and left on screen, so it is clear what "Answer this" will answer.
      this.detected = text;
      this.events.onHearing(text);
    }
  }
}
