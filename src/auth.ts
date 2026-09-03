import { invoke } from "@tauri-apps/api/core";

// Thin wrappers around the auth Tauri commands (see
// src-tauri/src/auth/commands.rs). Passwordless email-OTP login against
// Supabase Auth — the same account works on the website and here.

export interface AuthSessionInfo {
  loggedIn: boolean;
  email: string | null;
}

export function requestLoginOtp(email: string): Promise<void> {
  return invoke<void>("request_login_otp", { email });
}

export function verifyLoginOtp(email: string, code: string): Promise<AuthSessionInfo> {
  return invoke<AuthSessionInfo>("verify_login_otp", { email, code });
}

export function logout(): Promise<void> {
  return invoke<void>("logout");
}

export function getAuthSession(): Promise<AuthSessionInfo> {
  return invoke<AuthSessionInfo>("get_auth_session");
}

export interface EntitlementInfo {
  planId: string;
  remainingMinutes: number;
  interviewPassCount: number;
}

export function getEntitlement(): Promise<EntitlementInfo> {
  return invoke<EntitlementInfo>("get_entitlement");
}
