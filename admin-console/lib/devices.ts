// Labels for the device rows recorded in public.user_devices
// (see backend/supabase/migrations/0039_user_devices.sql).

export type DeviceKind = "desktop" | "browser" | "website";
export type DeviceOs = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

export interface DeviceSummary {
  kind: DeviceKind;
  os: DeviceOs;
  appVersion: string | null;
  lastSeenAt: string;
}

const OS_LABEL: Record<DeviceOs, string> = {
  windows: "Windows",
  macos: "Mac",
  linux: "Linux",
  android: "Android",
  ios: "iPhone",
  unknown: "",
};

export function deviceLabel(d: { kind: DeviceKind; os: DeviceOs }): string {
  const os = OS_LABEL[d.os] ?? "";
  if (d.kind === "desktop") return os ? `Desktop app · ${os}` : "Desktop app";
  if (d.kind === "browser") {
    if (d.os === "android" || d.os === "ios") return `Phone · ${os}`;
    return os ? `Browser · ${os}` : "Browser";
  }
  return "Website";
}

export function deviceBadge(d: { kind: DeviceKind }): string {
  if (d.kind === "desktop") return "badge-ok";
  if (d.kind === "browser") return "badge-warn";
  return "badge-muted";
}

/// One-line answer to "how far did this user get". Desktop use before device
/// tracking started isn't recorded, so an older user with interviews but no
/// desktop row is shown as plain "Did interviews".
export function userStage(devices: { kind: DeviceKind }[], interviewCount: number): string {
  const usedApp = devices.some((d) => d.kind === "desktop");
  if (interviewCount > 0) return usedApp ? "Uses desktop app" : "Did interviews";
  if (usedApp) return "Installed app, no interview yet";
  return "Signed up only";
}

/// Badge for the Users list: did they only register, or actually get the
/// app? Older users with interviews but no device on record (from before
/// device tracking) clearly used the app, so they count as "Used the app".
/// A computer browser only means they signed in on the website.
export function appStatus(
  devices: { kind: DeviceKind; os: DeviceOs }[],
  interviewCount: number,
): { label: string; badge: string } {
  if (devices.some((d) => d.kind === "desktop")) return { label: "App installed", badge: "badge-ok" };
  if (devices.some((d) => d.kind === "browser" && (d.os === "android" || d.os === "ios"))) {
    return { label: "Phone only", badge: "badge-warn" };
  }
  if (interviewCount > 0) return { label: "Used the app", badge: "badge-ok" };
  return { label: "Just registered", badge: "badge-muted" };
}
