import { classifyQuestionCompleteness, joinSpeech } from "./question-completeness";
import { ApiError, mintSttSession, reportUsage, sendHeartbeat } from "./api";
import { FluxClient, type FluxState } from "./flux";
import { discardPrepared, startMic, type MicHandle, type PreparedAudio } from "./mic";
import { shouldAutoAnswer } from "./questions";

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

// Flux has already waited for the speaker to stop before it reports the end
// of a turn, so only a short extra pause is needed before answering.
const ANSWER_DELAY_MS = 400;
// Longer when the words trail off mid-clause ("... and", "... with the").
const ANSWER_DELAY_INCOMPLETE_MS = 1400;
// A phone microphone hears the whole room, and in a noisy one Flux can keep a
// turn open for a long time. If the words have stopped changing for this
// long, the speaker is done, whatever Flux says.
const STALLED_TURN_MS = 1800;

/** Case, punctuation and spacing don't matter when checking whether two transcripts are the same words. */
const normalizeWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

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
  private stallTimer = 0;
  /** Words already handled by finishing a stalled turn; Flux may still report the end of that same turn. */
  private stalledWords = "";
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
    window.clearTimeout(this.stallTimer);
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
    // Tell the screen straight away. Closing the billing record is a network
    // call, and waiting for it before moving on made "End" feel broken.
    this.events.onStatus("ended");
    this.events.onEnded(message);
    const elapsed = Math.min(Math.max(1, Math.round((Date.now() - this.startedAt) / 1000)), this.authorizedSeconds);
    try {
      // Callers that must know the session is really closed (before starting
      // another one) await end(); the screen does not.
      await reportUsage(this.sessionId, elapsed);
    } catch (err) {
      // Not fatal for the user, so it is only logged: the transcript is theirs either way.
      console.error("Couldn't record interview usage", err);
    }
  }

  private teardown(): void {
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.autoAskTimer);
    window.clearTimeout(this.stallTimer);
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
    // Noise with no words, or the same words again, tells us nothing.
    if (!text.trim() || text.trim() === this.partial.trim()) return;

    this.partial = text;
    this.events.onHearing(joinSpeech(this.pending, this.partial));

    // A question that already sounds finished is answered on schedule: what
    // is heard next (the candidate starting to answer, a cough, the laptop)
    // must not cancel it, or it would be merged with that and lost. Only a
    // sentence that trails off mid-clause is held, because more of it is coming.
    if (this.pending && classifyQuestionCompleteness(this.pending) === "incomplete") {
      window.clearTimeout(this.autoAskTimer);
    }

    // If no new words arrive for a while, the speaker is done even though
    // Flux hasn't ended the turn (it stays open in a noisy room).
    window.clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => this.finishStalledTurn(), STALLED_TURN_MS);
  }

  private finishStalledTurn(): void {
    const text = this.partial.trim();
    if (!text) return;
    // Flux may still report the end of this same turn; remember these words so they aren't handled twice.
    this.stalledWords = normalizeWords(text);
    this.flux?.forceEndTurn();
    this.acceptTurn(text);
  }

  private handleTurn(rawText: string): void {
    window.clearTimeout(this.stallTimer);
    let text = rawText;

    // The end of a turn that was already finished because it stalled.
    if (this.stalledWords) {
      const handled = this.stalledWords;
      this.stalledWords = "";
      const heard = normalizeWords(text);
      if (heard === handled || heard.startsWith(handled)) {
        const extra = heard.slice(handled.length).trim();
        if (extra.split(" ").filter(Boolean).length < 3) return;
        text = text.trim().split(/\s+/).slice(handled.split(" ").length).join(" ");
      }
    }

    this.acceptTurn(text);
  }

  // A finished turn: record it, and answer it shortly if it needs answering.
  private acceptTurn(text: string): void {
    window.clearTimeout(this.stallTimer);
    this.events.onTurn({ id: ++this.turnId, text });
    this.partial = "";
    this.pending = joinSpeech(this.pending, text);
    this.events.onHearing(this.pending);

    // Wait a little longer when the text trails off mid-clause.
    const wait = classifyQuestionCompleteness(this.pending) === "complete" ? ANSWER_DELAY_MS : ANSWER_DELAY_INCOMPLETE_MS;
    window.clearTimeout(this.autoAskTimer);
    this.autoAskTimer = window.setTimeout(() => this.fireAuto(), wait);
  }

  private fireAuto(): void {
    const text = this.pending.trim();
    if (!text) return;
    this.pending = "";
    // Whatever is being said right now stays on screen.
    const showing = this.partial;

    // Pleasantries and the candidate's own words stay in the transcript, but aren't answered.
    if (!shouldAutoAnswer(text)) {
      this.events.onHearing(showing);
      return;
    }
    if (this.autoAnswer) {
      this.detected = "";
      this.events.onHearing(showing);
      this.events.onQuestion(text);
    } else {
      // Held, and left on screen, so it is clear what "Answer this" will answer.
      this.detected = text;
      this.events.onHearing(text);
    }
  }
}
