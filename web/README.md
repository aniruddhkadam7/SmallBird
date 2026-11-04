# Smallbird Web (phone as the listener)

A mobile-first web app: the user signs in on their phone, puts it next to the
laptop, and the phone's microphone hears the interviewer through the laptop's
speakers. It transcribes live (Deepgram Flux) and streams suggested answers.
Nothing runs on the laptop, so nothing shows in screen share.

It uses the same Supabase backend as the desktop app — `request-otp`,
`verify-otp`, `stt-token`, `session-heartbeat`, `usage-report`, `llm-proxy` —
so accounts, minutes and the one-active-session rule are shared.

## Run

```
cd web
npm install
npm run dev      # https://<your-lan-ip>:5173 (self-signed cert)
npm run build    # static files in web/dist
```

`getUserMedia` needs HTTPS, hence the self-signed dev cert (accept the browser
warning once on the phone).

## Before it works from a browser

The edge functions in `backend/supabase/functions/` were wrapped with
`_shared/cors.ts`. **They must be redeployed** (`supabase functions deploy
request-otp verify-otp stt-token session-heartbeat usage-report llm-proxy`)
or every browser call fails its CORS preflight. Allowed origins default to
`smallbirdai.com`, `www.smallbirdai.com`, `smallbird.in`, `www.smallbird.in` and `localhost:5173/4173`; to test from a
phone on your LAN or host the page elsewhere, set the `WEB_ALLOWED_ORIGINS`
secret (comma-separated, e.g. `https://192.168.1.20:5173`).

## Layout

- `src/mic.ts` — mic capture, in-worklet resample to 16 kHz PCM16 (80 ms frames)
- `src/flux.ts` — Deepgram Flux client (token subprotocol auth, bounded reconnect)
- `src/interview.ts` — session controller: mint, heartbeat, billing, Auto AI
- `src/answer.ts` — prompt + streaming; key points first, full answer after `[[FULL]]`
- `src/questions.ts` — question-vs-statement check (the phone also hears the candidate)
- `../src/questionCompleteness.ts` — shared with the desktop app, not copied

## Not built yet

- Resume/JD upload with PDF/DOCX extraction (v1: paste text or load `.txt`/`.md`; stored in `localStorage`)
- Saving transcripts to the account's history (v1: copy from the summary screen)
- Speaker diarization (v1 relies on the question heuristic + "That was me" / "Answer this")
- Full port of the desktop's depth-tier prompt logic (`personal/prompts/ask.rs`); the web prompt is a condensed version
