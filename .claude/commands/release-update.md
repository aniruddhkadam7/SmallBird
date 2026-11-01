---
description: Publish a new Smallbird desktop release for Windows and macOS (version bump, tag push; GitHub Actions builds, signs and publishes) so existing installs auto-update.
---

# Releasing a Smallbird desktop update

Built installers and the update manifest are published to a separate public
repo, `aniruddhkadam7/SmallBird-releases`, which holds nothing but release
assets — this is what the website's download links and the app's in-app
auto-updater both point at.

**Releases are built by GitHub Actions, not locally**
(`.github/workflows/desktop-release.yml`). Pushing a `v<version>` tag builds
the Windows installer *and* the universal macOS app on GitHub's runners, signs
the updater artifacts, and publishes one release whose `latest.json` covers
`windows-x86_64`, `darwin-aarch64` and `darwin-x86_64`. No Mac is needed.
Never build and upload a release by hand: a hand-made `latest.json` with only
the Windows entry would silently stop every Mac install from updating.

## One-time setup this depends on (already done, just context)

- Updater signing keypair: `~/.tauri/smallbird-updater.key` (private key) +
  `~/.tauri/smallbird-updater.pw.txt` (its password) on the Windows PC. The
  public half is embedded in `src-tauri/tauri.conf.json`'s
  `plugins.updater.pubkey`. If this key is ever lost, no future update can be
  signed with a key existing installs trust — back it up.
- `SmallBird` repo Actions secrets: `TAURI_SIGNING_PRIVATE_KEY` (contents of
  the key file), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and `RELEASES_TOKEN` (a
  fine-grained PAT with Contents read/write on `SmallBird-releases`). PATs
  expire — if the publish job fails with 401/403, ask the user for a fresh
  token and update the secret (`gh secret set RELEASES_TOKEN -R aniruddhkadam7/SmallBird`).
- Optional `APPLE_*` secrets (see the workflow header) turn on Apple signing +
  notarization. Without them the Mac app is ad-hoc signed: first install needs
  right-click > Open once; auto-updates work either way.

## Steps

1. Confirm what's changing — read the actual diff/recent commits if the user
   hasn't already described the change clearly enough for release notes.

2. Bump the version (pick the next patch/minor number) in all three places — they
   must match: `src-tauri/tauri.conf.json`'s top-level version field,
   `package.json`'s version field, and `src-tauri/Cargo.toml`'s version field.
   **Never reuse a version number that was already tagged/published once** —
   even if the first attempt had a bug and never went out, bump to a new
   version instead (a reused tag once left an installed build permanently
   unable to update). The workflow refuses a tag that doesn't match
   `tauri.conf.json`.

3. Verify it compiles before tagging: a TypeScript no-emit check on the
   frontend, and a cargo check in `src-tauri`. Platform code is split with
   `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` — a change to anything
   under `src-tauri/src/audio/`, `*_capture_protection.rs`, `audio_test.rs` or
   `hardware/` usually needs both halves updated. A local check only covers
   the OS you're on; the pull-request build of the workflow covers the other.

4. Commit and push the version bump (plus whatever code change prompted the
   release).

5. Tag and push the tag: `v<version>`, annotated. **The tag message becomes the
   release notes** shown in `latest.json`, so write a short user-facing summary.

6. Watch the run: `gh run watch -R aniruddhkadam7/SmallBird` (or
   `gh run list --workflow desktop-release.yml`). A full run takes roughly
   15–25 minutes. If a build job fails, read its log (`gh run view <id> --log-failed`),
   fix, and release under a **new** version number.

7. The workflow's last step verifies both public endpoints; double-check
   `https://github.com/aniruddhkadam7/SmallBird-releases/releases/latest/download/latest.json`
   prints the new version with all three platforms.

## What the user experiences after this

Anyone running v0.1.1 or later on Windows, or any macOS build, gets this
silently on their next app launch: a small spinner + "Updating…" next to the
logo while it downloads and installs in the background, then the app
relaunches into the new version. Versions before 0.1.1 have no updater code at
all; those users need to download once from the website (stable links:
`.../releases/latest/download/Smallbird-Setup.exe` and
`.../releases/latest/download/Smallbird-Mac.dmg`).
