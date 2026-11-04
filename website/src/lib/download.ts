// The stable "always points at the newest release" URL — GitHub resolves
// /releases/latest/download/<asset-name> to whatever the latest tagged
// release's matching asset is, so this link never needs updating per release.
// Points at the separate SmallBird-releases repo (public installer builds
// only) rather than this project's own SmallBird AI repo, which holds the
// actual source and is private — a private repo's release assets 404 for
// anyone without repo access, so a public download link can't point there.
export const WINDOWS_INSTALLER_URL = "https://github.com/aniruddhkadam7/SmallBird-releases/releases/latest/download/Smallbird-Setup.exe"

// Universal build (Apple Silicon + Intel), published under this fixed name by
// the desktop release workflow alongside the Windows installer.
export const MAC_INSTALLER_URL = "https://github.com/aniruddhkadam7/SmallBird-releases/releases/latest/download/Smallbird-Mac.dmg"
