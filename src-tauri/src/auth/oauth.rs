//! Google sign-in for the desktop app. Unlike the website (a full-page
//! browser redirect back to itself), a native app has nowhere for Supabase
//! to redirect to — so this opens the system browser at Supabase's OAuth
//! authorize URL, and catches the resulting redirect with a one-shot local
//! HTTP listener on a loopback port, using the PKCE flow (an authorization
//! code in the query string, not a token in a URL fragment a plain TCP
//! listener could never see).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::client::{client, now_unix, parse_auth_error, TokenResponse, SUPABASE_ANON_KEY, SUPABASE_URL};
use super::session_store;
use super::AuthSession;

/// How long the local listener waits for the browser to complete the flow
/// and redirect back — generous, since it includes however long the user
/// takes to pick an account/approve on Google's own pages.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

/// Not cryptographically hardened, but this only ever needs to be
/// unguessable for the few seconds of one local, same-process login
/// attempt — nothing here is transmitted anywhere except back to Supabase
/// itself as the PKCE `code_verifier`.
fn random_verifier() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("{nanos:x}{pid:x}smallbirddesktopverifierpadding")
        .chars()
        .cycle()
        .take(64)
        .collect()
}

/// Percent-encodes just the characters that actually appear in a
/// `http://127.0.0.1:PORT/callback` value when used inside another URL's
/// query string — avoids pulling in a URL-encoding crate for one value.
fn percent_encode_redirect(url: &str) -> String {
    url.replace(':', "%3A").replace('/', "%2F")
}

pub async fn login_with_google(app: AppHandle) -> Result<AuthSession, String> {
    let verifier = random_verifier();

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("could not open a local port for login: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_to = format!("http://127.0.0.1:{port}/callback");

    let authorize_url = format!(
        "{SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={}&code_challenge={verifier}&code_challenge_method=plain",
        percent_encode_redirect(&redirect_to),
    );

    app.opener()
        .open_url(&authorize_url, None::<&str>)
        .map_err(|e| format!("could not open your browser: {e}"))?;

    let code = tokio::time::timeout(LOGIN_TIMEOUT, tokio::task::spawn_blocking(move || accept_one_callback(listener)))
        .await
        .map_err(|_| "Login timed out — please try again.".to_string())?
        .map_err(|e| format!("internal error waiting for login: {e}"))??;

    exchange_code_for_session(&code, &verifier).await
}

/// Blocks on this thread (spawned via `spawn_blocking`, not the async
/// runtime) waiting for exactly one HTTP request — Supabase's redirect
/// after the user finishes on Google's pages — parses the `code` query
/// param out of it, and returns a plain confirmation page to the browser.
fn accept_one_callback(listener: TcpListener) -> Result<String, String> {
    let (mut stream, _) = listener.accept().map_err(|e| format!("login connection failed: {e}"))?;
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let request_line = request.lines().next().unwrap_or("");
    let path_and_query = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path_and_query.split_once('?').map(|(_, q)| q).unwrap_or("");

    let code = query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "code").then(|| value.to_string())
    });
    let error = query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "error_description" || key == "error").then(|| value.to_string())
    });

    let (title, body) = if code.is_some() {
        ("You're signed in", "You can close this tab and return to Smallbird.")
    } else {
        ("Sign-in didn't complete", "You can close this tab and try again in Smallbird.")
    };
    let html = format!(
        "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:80px\"><h2>{title}</h2><p>{body}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    let _ = stream.write_all(response.as_bytes());

    code.ok_or_else(|| error.unwrap_or_else(|| "Google did not return an authorization code.".to_string()))
}

async fn exchange_code_for_session(auth_code: &str, verifier: &str) -> Result<AuthSession, String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/auth/v1/token?grant_type=pkce"))
        .header("apikey", SUPABASE_ANON_KEY)
        .json(&serde_json::json!({ "auth_code": auth_code, "code_verifier": verifier }))
        .send()
        .await
        .map_err(|e| format!("failed to complete Google sign-in: {e}"))?;

    if !response.status().is_success() {
        return Err(parse_auth_error(response).await);
    }

    let body: TokenResponse = response.json().await.map_err(|e| format!("unexpected response from auth service: {e}"))?;
    let session = AuthSession {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: now_unix() + body.expires_in,
        email: body.user.email.unwrap_or_default(),
    };
    session_store::store_refresh_token(&session.refresh_token, &session.email)?;
    Ok(session)
}
