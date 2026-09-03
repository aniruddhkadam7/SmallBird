import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Checks the endpoint configured in tauri.conf.json's plugins.updater
// (a `latest.json` manifest published alongside each GitHub Release) for a
// newer signed build than the one currently running. Network/parse failures
// (offline, no release published yet, manifest not uploaded for this
// release) are swallowed as "no update" rather than surfaced as an error —
// this runs silently in the background on every launch, not as a
// user-initiated action with something to report failure to.
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (err) {
    console.warn("update check failed:", err);
    return null;
  }
}

// Downloads the new version, installs it, then restarts into it — the
// installed app is fully replaced before relaunch, so there is no
// intermediate "half updated" state to land in if this is interrupted
// partway (Tauri's updater applies the new installer atomically before
// returning from downloadAndInstall).
export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
