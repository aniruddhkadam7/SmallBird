# Smallbird Local

A personal, standalone build of the Smallbird desktop app. It talks directly
to your own OpenAI, Anthropic, or Gemini API key — no account, no
subscription, no SaaS backend, no Supabase, no cloud entitlement system.
This repository is completely independent of the Smallbird SaaS product and
can be built and modified on its own.

## What this is

- A Tauri (Rust + React/TypeScript) desktop app for Windows.
- Interview Mode, Notes, resume/JD setup analysis, and full
  interview scoring — all calling your configured AI provider directly.
- Speech-to-text via Deepgram Flux (cloud, streaming, low-latency) — audio
  goes only to Deepgram, encrypted, and nowhere else.
- Local resume/CV and job-description text extraction (bundled, offline, no
  cloud dependency) — the extracted text is sent directly to your LLM as
  context, no search/retrieval involved.
- Your API keys are stored in Windows Credential Manager via the `keyring`
  crate — never in a file, never logged, never sent anywhere except
  directly to the provider you configure.

## Architecture

```
Smallbird Local (this repo)
        |
        +-- Tauri Desktop App (src/, src-tauri/)
        +-- Deepgram Flux STT client (src-tauri/src/stt/)
        +-- Local document text extraction (sidecars/rag-lite/)
        +-- Direct AI provider client (src-tauri/src/personal/)
        +-- Your API keys (Windows Credential Manager)
        |
        +-- Windows EXE
```

There is no backend server, no Fly.io, no Supabase, and no billing/
entitlement system anywhere in this repository.

## Prerequisites

- Windows 10/11 (x64)
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 18+ and npm
- The [Tauri CLI](https://tauri.app/) prerequisites for Windows (WebView2
  runtime, MSVC build tools) — see https://tauri.app/start/prerequisites/

## Setup

```powershell
npm install
```

### Getting the RAG sidecar binary

`sidecars/` is **not tracked in this git repository** — it's a prebuilt
binary build input, not a source file. You need to place it yourself before
`npm run tauri build` will produce a working EXE:

```
sidecars/rag-lite/                           <- rag-lite.exe + _internal/
```

Copy this directory in from wherever you have a working Smallbird desktop
build (e.g. `apps/desktop/src-tauri/target/release/bundle`'s resource
inputs in the original monorepo: `packages/rag/dist/rag-lite/` — copy the
folder's *contents* directly into the path above, no extra nesting). Once
copied, this never needs to change again unless you intentionally rebuild
the sidecar executable from source.

## Development

```powershell
npm run tauri dev
```

## Building the Windows EXE

```powershell
npm run tauri build
```

Output:
- `src-tauri/target/release/desktop.exe` — the raw executable
- `src-tauri/target/release/bundle/nsis/*.exe` — the NSIS installer
  (recommended for actually installing the app)
- `src-tauri/target/release/bundle/msi/*.msi` — an MSI installer

## First run

1. Launch the app (or run the installer, then launch it).
2. Open Settings (gear icon) -> API Keys.
3. Paste in your OpenAI, Anthropic, and/or Gemini API key. Each is stored
   independently in Windows Credential Manager.
4. Also paste in a [Deepgram](https://deepgram.com) API key — required for
   speech-to-text in Interview Mode (get a free-tier key at
   console.deepgram.com). Stored the same way, in Windows Credential Manager.
5. Pick which LLM provider to use from the header's model picker (this is
   separate from the API Keys panel — the API Keys panel only manages your
   keys, the header picker decides which one is actually used for a
   request).
6. Use Interview Mode or Notes as normal.

## Customizing

This is your personal copy — feel free to:
- Edit the prompts in `src-tauri/src/personal/prompts/` (ask, analysis,
  notes, setup).
- Add/adjust AI provider behavior in `src-tauri/src/personal/providers/`.
- Change the UI in `src/`.

Changes here never affect the Smallbird SaaS product — the two are
completely independent codebases with no shared dependency, submodule, or
deployment path.

## What's intentionally not here

This repo does not include and does not need:
- A backend server / API
- Fly.io configuration
- Supabase (database, auth, migrations)
- Stripe or any billing/subscription logic
- A usage/entitlement/minute-balance system
- Production deployment scripts or secrets

If you ever see the app behave as if it's missing one of these (it
shouldn't — sign-in and cloud sync were removed from this build entirely),
that's a bug to fix in this repo, not a missing integration to add back.
