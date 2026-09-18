mod analyzer;
// Public so the `audio_probe` binary (src/bin/audio_probe.rs) can drive the
// real capture path when measuring the pipeline, rather than a copy of it that
// could drift from what actually ships.
pub mod audio;
mod audio_test;
mod auth;
mod backend;
mod bubble_window;
mod commands;
mod documents;
// Public so `src/bin/hw_probe.rs` can reference `PerformanceConfig` without
// a re-export chain.
pub mod hardware;
mod history;
mod interview_mode;
mod main_window;
mod notes_mode;
mod overlay_window;
mod personal;
mod state;
mod tls_init;
// Public alongside `audio` so `src/bin/pipeline_test.rs` can drive the real
// recording pipeline headlessly instead of a reimplementation of it.
pub mod stt;
pub mod transcript;
mod windows_capture_protection;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tls_init::ensure_installed();

    tauri::Builder::default()
        // Must be the very first plugin registered (Tauri requirement). A
        // second launch of the app (double-clicking the exe/shortcut again,
        // including while the first launch is still mid-startup and its
        // window isn't visible yet) is redirected here instead of spawning a
        // second, fully separate process — the new invocation exits
        // immediately and this callback just brings the existing app to the
        // front instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let overlay_visible = app
                .get_webview_window(interview_mode::OVERLAY_WINDOW_LABEL)
                .is_some_and(|w| w.is_visible().unwrap_or(false));
            if overlay_visible {
                if let Some(window) = app.get_webview_window(interview_mode::OVERLAY_WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // Reassert exclusion on the redirect path too — this is
                    // the one way the overlay gets re-shown outside
                    // `show_overlay_window`/its watchdog, so it shouldn't
                    // rely solely on the watchdog's next tick (up to 3s
                    // away) to notice if affinity had silently dropped.
                    windows_capture_protection::reconcile(&window, interview_mode::OVERLAY_WINDOW_LABEL, true);
                }
                return;
            }
            // The main window is hidden (not just unminimized) while the
            // floating bubble is up (see `bubble_window`) — restoring
            // through it rather than a plain main.show() also hides the
            // bubble, instead of leaving both on screen at once.
            let bubble_visible = app
                .get_webview_window(bubble_window::BUBBLE_WINDOW_LABEL)
                .is_some_and(|w| w.is_visible().unwrap_or(false));
            if bubble_visible {
                let _ = bubble_window::restore_from_bubble(app);
                return;
            }
            if let Some(window) = app.get_webview_window(main_window::MAIN_WINDOW_LABEL) {
                // Same reasoning as `overlay_window::close_overlay_window`'s
                // fix: reassert before showing a main window that's been
                // hidden (and therefore unchecked by the watchdog) for an
                // unknown amount of time.
                windows_capture_protection::reconcile(&window, main_window::MAIN_WINDOW_LABEL, true);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // `env_logger` alone (the previous setup) writes to a stderr handle
        // that simply doesn't exist in a release build — `main.rs` marks
        // release builds `windows_subsystem = "windows"` (no console
        // attached), so every `log::info!`/`log::warn!` call, including the
        // screen-capture-exclusion diagnostics in `overlay_window.rs` and
        // `windows_capture_protection.rs`, was silently discarded in
        // production. It only ever "worked" when run via `cargo tauri dev`,
        // which keeps the console subsystem and a real attached console.
        // Logging to a file (in addition to stdout, so `cargo tauri dev`
        // keeps showing logs in the terminal) means a packaged build's
        // actual capture-exclusion failures are inspectable after the fact
        // instead of invisible by construction.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Only react on key-down, not key-up, so holding the
                    // combination doesn't repeatedly toggle the overlay.
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Err(err) = interview_mode::toggle_overlay_window(app) {
                            log::warn!("failed to toggle Interview Mode overlay via hotkey: {err}");
                        }
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .manage(history::HistoryStore::default())
        .setup(|app| {
            // Hardware detection + performance mode load first, synchronously
            // — cheap (a few sysinfo/DXGI/IOCTL calls, no network/process
            // spawn).
            let performance_state = hardware::init(&app.handle().clone());
            app.manage(performance_state);

            main_window::apply_light_titlebar(&app.handle().clone());

            // Exclude the main window from screen captures/screen-share too,
            // not just the Interview Mode overlay (see
            // `windows_capture_protection` for what this does and does not
            // cover — the window stays normally visible locally, it's only
            // omitted from what capture pipelines record/stream). Applied
            // BEFORE `position_top_center`'s show()/set_focus(): setting
            // display affinity on this transparent, undecorated window
            // while it's already shown was observed to knock DWM into
            // minimizing it (its rect ends up at the classic off-screen
            // iconic placement) — doing it first, while the window is still
            // hidden (tauri.conf.json's `"visible": false`), avoids that.
            // Best-effort: an older Windows build without the API just
            // leaves the window normally capturable.
            if let Some(main_window) = app.get_webview_window(main_window::MAIN_WINDOW_LABEL) {
                windows_capture_protection::reconcile(&main_window, main_window::MAIN_WINDOW_LABEL, true);
            }

            main_window::position_top_center(&app.handle().clone());

            // Self-healing capture exclusion: `SetWindowDisplayAffinity` has
            // been observed to silently revert (monitor/DPI change, GPU
            // driver reset, wake from sleep) with no event this process can
            // hook, so both windows periodically reassert it while visible
            // rather than relying on the one-time call above/at overlay-open
            // time. See `overlay_window::spawn_capture_protection_watchdog`.
            overlay_window::spawn_unconditional_capture_protection_watchdog(
                app.handle().clone(),
                main_window::MAIN_WINDOW_LABEL,
            );
            overlay_window::spawn_unconditional_capture_protection_watchdog(
                app.handle().clone(),
                bubble_window::BUBBLE_WINDOW_LABEL,
            );
            interview_mode::spawn_capture_protection_watchdog(app.handle().clone());

            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // Ctrl+Shift+Space: show/hide the Interview Mode overlay (spec
            // section 19/21). Registration failure (e.g. the combination is
            // already claimed by another application) is logged, not fatal —
            // the overlay remains reachable from the main window's button.
            if let Err(err) = app.global_shortcut().register("Ctrl+Shift+Space") {
                log::warn!("failed to register Ctrl+Shift+Space global hotkey: {err}");
            }

            // Recovers transcripts a crashed/killed run left behind, then keeps
            // retrying any that haven't reached the server yet.
            history::spawn_background_tasks(app.handle().clone());

            bubble_window::ensure_bubble_window(&app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_output_devices,
            commands::list_input_devices,
            commands::start_system_audio_capture,
            commands::pause_recording,
            commands::resume_recording,
            commands::stop_audio_capture,
            audio_test::prepare_audio_test_phrase,
            audio_test::play_audio_test_phrase,
            audio_test::stop_audio_test_phrase,
            audio_test::close_orphaned_audio_test_session,
            commands::get_current_session,
            commands::get_recording_state,
            commands::start_new_interview,
            commands::clear_transcript,
            commands::export_transcript_txt,
            commands::export_transcript_json,
            commands::check_backend_connection,
            commands::analyze_interview,
            commands::analyze_setup_context,
            documents::upload_document,
            documents::get_document_text,
            documents::list_documents,
            documents::delete_document,
            commands::quit_app,
            commands::signal_window_content_ready,
            commands::minimize_to_bubble,
            commands::restore_from_bubble,
            commands::drag_bubble_window,
            interview_mode::commands::show_interview_overlay,
            interview_mode::commands::hide_interview_overlay,
            interview_mode::commands::toggle_interview_overlay,
            interview_mode::commands::open_dashboard,
            interview_mode::commands::ask_interview_question,
            interview_mode::commands::analyze_screen_question,
            interview_mode::commands::set_overlay_always_on_top,
            interview_mode::commands::set_overlay_capture_exclusion,
            interview_mode::commands::resize_interview_overlay,
            interview_mode::commands::start_backend_session,
            interview_mode::commands::end_backend_session,
            history::list_interview_history,
            history::save_interview_session,
            history::resync_pending_interview_transcripts,
            notes_mode::store::list_notes,
            notes_mode::store::get_note,
            notes_mode::store::create_note,
            notes_mode::store::update_note,
            notes_mode::store::delete_note,
            notes_mode::store::search_notes,
            notes_mode::ai::summarize_note,
            notes_mode::ai::ask_about_notes,
            hardware::commands::get_performance_mode,
            main_window::set_popover_content_height,
            auth::commands::request_login_otp,
            auth::commands::verify_login_otp,
            auth::commands::login_with_google,
            auth::commands::logout,
            auth::commands::get_auth_session,
            auth::commands::get_entitlement,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
