// Overview stats for the admin dashboard. admin_dashboard_stats() embeds
// its own admin check (current_admin_user_id()), so this is a single
// Postgres round trip per request -- no separate pre-flight auth call.
// See 0023_admin_single_roundtrip_reads.sql.
//
// Also adds installer download counts from the public GitHub releases repo
// the website and the auto-updater download from. Downloads are anonymous,
// so these are totals only -- they can't be tied to a user.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

const RELEASES_URL = "https://api.github.com/repos/aniruddhkadam7/SmallBird-releases/releases?per_page=100";
// GitHub allows 60 unauthenticated calls an hour per IP; the counts don't
// need to be fresher than this.
const CACHE_MS = 10 * 60 * 1000;

interface Downloads {
  windowsInstaller: number; // Smallbird-Setup.exe -- the website's download link
  windowsUpdates: number; // Smallbird_<version>_x64-setup.exe -- fetched by the auto-updater
  mac: number;
  latestVersion: string | null;
  latestVersionDownloads: number;
}

let cached: { at: number; value: Downloads } | null = null;

async function fetchDownloads(): Promise<Downloads | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json", "user-agent": "smallbird-admin" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const releases: { tag_name: string; assets: { name: string; download_count: number }[] }[] = await res.json();

    const value: Downloads = { windowsInstaller: 0, windowsUpdates: 0, mac: 0, latestVersion: null, latestVersionDownloads: 0 };
    for (const release of releases) {
      for (const asset of release.assets) {
        const name = asset.name.toLowerCase();
        if (name === "smallbird-setup.exe") value.windowsInstaller += asset.download_count;
        else if (name.endsWith(".exe") || name.endsWith(".msi")) value.windowsUpdates += asset.download_count;
        else if (name.endsWith(".dmg")) value.mac += asset.download_count;
      }
    }
    const latest = releases[0];
    if (latest) {
      value.latestVersion = latest.tag_name;
      value.latestVersionDownloads = latest.assets
        .filter((a) => /\.(exe|msi|dmg)$/i.test(a.name))
        .reduce((sum, a) => sum + a.download_count, 0);
    }

    cached = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("admin-dashboard-stats: GitHub downloads failed", err);
    return cached?.value ?? null;
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const [{ data, error }, downloads] = await Promise.all([client.rpc("admin_dashboard_stats"), fetchDownloads()]);
    if (error) throwOnRpcError(error);

    return jsonResponse({ ...data, downloads });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
