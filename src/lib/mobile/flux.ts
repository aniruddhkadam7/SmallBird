// Deepgram Flux streaming client — the browser counterpart of
// src-tauri/src/stt/client.rs, with the same URL, wire protocol and bounded
// reconnect behaviour.

const FLUX_URL = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000";
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 2;
const RECONNECT_BACKOFF_MS = 500;

export type FluxState = "connecting" | "live" | "reconnecting" | "closed";

export interface FluxHandlers {
  /** Interim text for the turn still being spoken. */
  onPartial(text: string): void;
  /** A finished turn (Flux's end-of-turn). */
  onTurn(text: string): void;
  onState(state: FluxState, detail?: string): void;
}

/** The subset of Flux server messages this client acts on; anything else is ignored. */
interface ServerMessage {
  type?: string;
  event?: string;
  transcript?: string;
  code?: string;
  description?: string;
}

export class FluxClient {
  private socket: WebSocket | null = null;
  private closedByUs = false;
  private attempts = 0;

  constructor(
    private readonly key: string,
    private readonly handlers: FluxHandlers,
  ) {}

  /** Resolves once Deepgram confirms the connection, so no audio is captured before it can be used. */
  async connect(): Promise<void> {
    this.handlers.onState("connecting");
    await this.open();
    this.handlers.onState("live");
  }

  /** Audio sent while the socket is down or reconnecting is dropped, not queued: stale audio would arrive late and out of turn. */
  sendAudio(pcm16: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(pcm16);
  }

  /** Ask Flux to finish the current turn now (used when the user taps "Answer this"). */
  forceEndTurn(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "ForceEndTurn" }));
  }

  close(): void {
    this.closedByUs = true;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    socket?.close();
    this.handlers.onState("closed");
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Browsers can't set an Authorization header on a WebSocket; Deepgram
      // accepts the key as a "token" subprotocol instead.
      const socket = new WebSocket(FLUX_URL, ["token", this.key]);
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      let ready = false;
      const timer = window.setTimeout(() => {
        if (!ready) {
          socket.close();
          reject(new Error("Transcription didn't respond in time."));
        }
      }, CONNECT_TIMEOUT_MS);

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === "Connected" && !ready) {
          ready = true;
          window.clearTimeout(timer);
          resolve();
        } else if (message.type === "Error") {
          const text = `${message.code ?? "error"}: ${message.description ?? ""}`;
          if (!ready) {
            window.clearTimeout(timer);
            reject(new Error(text));
          }
        } else if (message.type === "TurnInfo") {
          this.handleTurnInfo(message);
        }
      };

      socket.onclose = () => {
        window.clearTimeout(timer);
        if (this.closedByUs || this.socket !== socket) return;
        if (!ready) {
          reject(new Error("Transcription connection failed."));
          return;
        }
        void this.reconnect();
      };
      socket.onerror = () => {
        // onclose always follows and carries the handling.
      };
    });
  }

  private handleTurnInfo(message: ServerMessage): void {
    const text = message.transcript ?? "";
    if (message.event === "Update") this.handlers.onPartial(text);
    else if (message.event === "EndOfTurn" && text.trim()) this.handlers.onTurn(text);
  }

  private async reconnect(): Promise<void> {
    while (!this.closedByUs && this.attempts < MAX_RECONNECT_ATTEMPTS) {
      this.attempts++;
      this.handlers.onState("reconnecting");
      await new Promise((r) => setTimeout(r, RECONNECT_BACKOFF_MS));
      if (this.closedByUs) return;
      try {
        await this.open();
        this.attempts = 0;
        this.handlers.onState("live");
        return;
      } catch {
        // Try again until the budget is spent.
      }
    }
    if (!this.closedByUs) this.handlers.onState("closed", "Transcription disconnected. Check your connection.");
  }
}
