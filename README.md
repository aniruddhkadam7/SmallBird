# Smallbird website

The Smallbird marketing site, dashboard and **phone version** (`/mobile`), built with [Next.js](https://nextjs.org) (App Router) and deployed on Vercel at https://smallbird.in.

## Getting started

Needs Node.js 20+ (developed on 24).

```bash
npm ci                      # exact versions from package-lock.json
cp .env.example .env.local  # then fill in the values (see the comments in that file)
npm run dev                 # http://localhost:3000
```

`.env.local` is git-ignored and holds real keys: ask the project owner for the Supabase anon key (and Razorpay test keys if you need checkout). The site builds without it (`npm run build`), but sign-in and anything that talks to Supabase will not work.

Checks before pushing: `npx tsc --noEmit`, `npx eslint src`, `npm run build`.

## Branches

| Branch | What it is |
|---|---|
| `company-website` | **Production.** Every push here deploys to https://smallbird.in via Vercel. |
| `mobile-version` | Work on the phone version. Merge into `company-website` when ready. Pushes get a Vercel preview, not production. |
| `wip/pricing-features` | Unfinished pricing-page copy. Deliberately not on `company-website`. |

## The phone version (`/mobile`)

Put a phone next to the laptop: its microphone hears the interviewer, transcribes live (Deepgram Flux) and streams suggested answers. Nothing is installed on the laptop.

- Route: `src/app/mobile/` (screens and styles). Logic: `src/lib/mobile/` (microphone, Flux client, interview session, answer prompt, CV/JD reading, transcript saving).
- **One login for the whole site.** It reuses the Supabase session cookie the dashboard uses; signed-out visitors get the site's normal login dialog (`requestPageAccess` in `src/lib/purchase-flow.tsx`) and are sent back to `/mobile`.
- CV / job description are PDF, DOCX, TXT or MD, read **in the browser** (pdf.js legacy build, loaded only when a PDF is picked). Nothing is uploaded.
- Answers are sized to the question (`answerDepth` in `src/lib/mobile/answer.ts`); the role, company, job description and CV are sent as one "supporting background" message, the same shape the desktop app uses.
- Each answered question is saved to `interview_transcripts` (the table the dashboard reads).
- `src/lib/mobile/question-completeness.ts` is a **copy** of the desktop app's `src/questionCompleteness.ts`; keep the two in sync.
- Testing on a real phone needs HTTPS for the microphone: `npx next dev --experimental-https -H 0.0.0.0`, open `https://<your-lan-ip>:3000/mobile`, and add that origin to the `WEB_ALLOWED_ORIGINS` secret (below).

## Backend (lives in a different repo)

Accounts, minutes, transcription tokens and AI calls go through Supabase Edge Functions in the **desktop app repo** (same GitHub project, branch `product`, folder `backend/supabase/functions/`): `request-otp`, `verify-otp`, `stt-token`, `session-heartbeat`, `usage-report`, `llm-proxy`.

- Deploy: `npx supabase functions deploy <names> --project-ref xubbwgrjvvsbfvxcuzav` (run from that repo's `backend/` folder).
- Browsers may only call them from origins listed in the `WEB_ALLOWED_ORIGINS` Supabase secret (comma-separated). It must include `https://smallbird.in`, `https://www.smallbird.in`, and `http://localhost:3000` / `https://localhost:3000` for development. Set it with `npx supabase secrets set WEB_ALLOWED_ORIGINS="..." --project-ref xubbwgrjvvsbfvxcuzav`.
- Session length is capped at 4 hours (`MAX_SESSION_SECONDS` in `stt-token`).

## Notes

- Files in this repo are stored with LF line endings; if your editor writes CRLF, git will show whole files as changed. Use `git diff --ignore-space-at-eol` to see real changes.
- Local HTTPS certificates created by `next dev --experimental-https` go in `certificates/` (git-ignored, contain a private key).
