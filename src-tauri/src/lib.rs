//! Tauri shell around `orrery-core`.
//!
//! Responsibilities are deliberately thin: start the engine, forward its
//! events to the webview as `orrery://events`, and expose a few read-only
//! commands for on-demand history. All logic lives in the core crate.

use std::sync::{Arc, Mutex};

use orrery_core::{Config, Engine, Event, LiveSession, TranscriptSummary};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

/// Name of the Tauri event that carries `Vec<Event>` batches.
pub const EVENT_CHANNEL: &str = "orrery://events";

/// Engine handle kept alive for the lifetime of the app.
struct EngineState(Mutex<Option<Engine>>);

/// Where Claude Code keeps its state, as seen by the engine.
#[tauri::command]
fn claude_home() -> String {
    orrery_core::paths::claude_home()
        .to_string_lossy()
        .into_owned()
}

/// Sessions that are running right now.
#[tauri::command]
fn live_sessions() -> Vec<LiveSession> {
    orrery_core::registry::read_registry(&orrery_core::paths::claude_home().join("sessions"))
}

/// Every transcript on disk, newest first (for the history picker).
#[tauri::command]
fn list_transcripts() -> Vec<TranscriptSummary> {
    orrery_core::list_transcripts(&orrery_core::paths::claude_home())
}

/// Replay one session (main thread + subagents) as events.
#[tauri::command]
fn load_history(session_id: String, max_bytes: Option<u64>) -> Result<Vec<Event>, String> {
    orrery_core::load_history(
        &orrery_core::paths::claude_home(),
        &session_id,
        max_bytes.unwrap_or(32 * 1024 * 1024),
    )
    .map_err(|e| e.to_string())
}

/// Set the menu-bar text beside the tray icon (macOS/Windows show it; on
/// Linux it lands in the tooltip). The UI owns the counting, so it owns the
/// string; an empty string clears it.
#[tauri::command]
fn set_tray_title(app: AppHandle, text: String) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("orrery") else {
        return Ok(());
    };
    let text = text.trim();
    tray.set_title(if text.is_empty() { None } else { Some(text) })
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(if text.is_empty() { "Orrery" } else { text }))
        .map_err(|e| e.to_string())
}

/// Bring the window back after it has been closed to the tray.
fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Start (or restart) the file watcher. Called once from `setup`; exposed as a
/// command so the UI can recover if the engine reports a fatal error.
#[tauri::command]
fn start_engine(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    let handle = app.clone();
    let sink = Arc::new(move |events: Vec<Event>| {
        // Emit failures only happen while the window is closing; nothing to do.
        let _ = handle.emit(EVENT_CHANNEL, &events);
    });
    let engine = Engine::start(Config::default(), sink).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(engine);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(EngineState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            claude_home,
            live_sessions,
            list_transcripts,
            load_history,
            start_engine,
            set_tray_title
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Orrery", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            TrayIconBuilder::with_id("orrery")
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .icon_as_template(true)
                .tooltip("Orrery")
                .menu(&Menu::with_items(app, &[&show, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let state: State<'_, EngineState> = app.state();
            if let Err(e) = start_engine(app.handle().clone(), state) {
                // Surface to the UI instead of crashing: the home dir may not exist yet.
                let _ = app.emit(
                    EVENT_CHANNEL,
                    vec![Event::Diagnostic {
                        level: "error".into(),
                        message: e,
                    }],
                );
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Orrery");
}
