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

export function verifyLoginOtp(email: string, code: string, name?: string): Promise<AuthSessionInfo> {
  return invoke<AuthSessionInfo>("verify_login_otp", { email, code, name: name || null });
}

// Opens the system browser for Google sign-in and resolves once it
// completes — see auth/oauth.rs for the local-loopback-listener mechanism a
// desktop app needs instead of the website's plain page redirect.
export function loginWithGoogle(): Promise<AuthSessionInfo> {
  return invoke<AuthSessionInfo>("login_with_google");
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
