// Works out which kind of device a request came from and records it in
// public.user_devices (see 0039_user_devices.sql), so the admin console can
// show whether a user runs the desktop app (Windows / Mac) or the phone /
// browser page.
//
// The desktop app sends `x-smallbird-client: desktop/<version> (<os>)`.
// Older desktop builds send no header and no user agent at all (reqwest's
// default), so a request without a browser user agent is also treated as
// desktop, OS unknown.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { clientIp } from "./ratelimit.ts";

export type ClientKind = "desktop" | "browser";
export type ClientOs = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

export interface ClientInfo {
  kind: ClientKind;
  os: ClientOs;
  appVersion: string | null;
  userAgent: string | null;
}

const KNOWN_OS: ClientOs[] = ["windows", "macos", "linux", "android", "ios"];

function osFromUserAgent(ua: string): ClientOs {
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/windows/i.test(ua)) return "windows";
  if (/macintosh|mac os x/i.test(ua)) return "macos";
  if (/linux|cros/i.test(ua)) return "linux";
  return "unknown";
}

export function detectClient(req: Request): ClientInfo {
  const userAgent = req.headers.get("user-agent");
  const header = req.headers.get("x-smallbird-client");

  const desktop = header?.match(/^desktop\/([\w.\-]+)\s*\((\w+)\)/i);
  if (desktop) {
    const os = desktop[2].toLowerCase() as ClientOs;
    return { kind: "desktop", os: KNOWN_OS.includes(os) ? os : "unknown", appVersion: desktop[1].slice(0, 32), userAgent };
  }

  if (userAgent && /^mozilla\//i.test(userAgent)) {
    return { kind: "browser", os: osFromUserAgent(userAgent), appVersion: null, userAgent };
  }

  return { kind: "desktop", os: "unknown", appVersion: null, userAgent };
}

/// Never throws: device tracking must not block a sign-in or a session.
export async function recordDevice(
  admin: SupabaseClient,
  req: Request,
  userId: string,
  event: "sign_in" | "session",
): Promise<ClientInfo> {
  const info = detectClient(req);
  const ip = clientIp(req);
  const { error } = await admin.rpc("record_user_device", {
    p_user_id: userId,
    p_client_kind: info.kind,
    p_os: info.os,
    p_app_version: info.appVersion,
    p_user_agent: info.userAgent,
    p_ip: ip === "unknown" ? null : ip,
    p_event: event,
  });
  if (error) console.error("recordDevice failed", error);
  return info;
}
