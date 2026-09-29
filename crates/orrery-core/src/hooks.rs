//! Precision mode: optional Claude Code hooks that report exact agent ids.
//!
//! Everything else in Orrery is passive. This module is the one place that
//! writes to `~/.claude/settings.json`, and only when the user explicitly
//! installs precision mode after seeing the exact change (see
//! `docs/PRECISION_MODE.md`).
//!
//! The hook itself is a one-liner that appends its stdin to a file Orrery
//! owns — no server, no port, no daemon. Hooks are registered with
//! `async: true`, so Claude Code never waits for them:
//!
//! ```text
//! { cat; echo; } >> "<sink>" 2>/dev/null
//! ```
//!
//! Orrery tails that file exactly like a transcript.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::model::Event;

/// Hook events Orrery asks for. Each one tells us something the transcript
/// cannot: exact agent identity, or that a turn ended.
pub const HOOK_EVENTS: [&str; 4] = ["SubagentStart", "SubagentStop", "Stop", "Notification"];

/// Marker used to recognise (and later remove) hooks Orrery installed.
const MARKER: &str = "orrery-hook-sink";

/// Where the hook appends its payloads. Lives in Orrery's own data directory,
/// never under `~/.claude`.
pub fn default_sink(data_dir: &Path) -> PathBuf {
    data_dir.join(format!("{MARKER}.jsonl"))
}

/// The shell one-liner registered as the hook command.
pub fn hook_command(sink: &Path) -> String {
    // `cat` copies the hook's JSON payload; `echo` terminates the line.
    // stderr is dropped so a missing directory can never surface in Claude.
    format!(
        "{{ cat; echo; }} >> {} 2>/dev/null",
        shell_quote(&sink.to_string_lossy())
    )
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Parse one line the hook appended. Unknown events and malformed lines are
/// ignored, exactly like transcript lines.
pub fn parse_payload(line: &str) -> Option<Event> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let event = v.get("hook_event_name")?.as_str()?.to_string();
    if !HOOK_EVENTS.contains(&event.as_str()) {
        return None;
    }
    let str_field = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    Some(Event::Hook {
        session_id: str_field("session_id")?,
        // Hooks report the bare id; transcripts are named `agent-<id>`.
        agent_id: str_field("agent_id").map(|id| {
            if id.starts_with("agent-") {
                id
            } else {
                format!("agent-{id}")
            }
        }),
        agent_type: str_field("agent_type"),
        cwd: str_field("cwd"),
        message: str_field("notification_text").or_else(|| str_field("last_assistant_message")),
        event,
    })
}

/// What precision mode looks like right now.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// True when every event in [`HOOK_EVENTS`] has an Orrery hook installed.
    pub installed: bool,
    /// Events that are installed (may be a subset after a partial edit).
    pub events: Vec<String>,
    pub settings_path: String,
    pub sink_path: String,
    /// The command currently installed, if any.
    pub command: Option<String>,
    /// False on platforms where the shell one-liner does not apply.
    pub supported: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum HookError {
    #[error("could not read {0}: {1}")]
    Read(PathBuf, String),
    #[error("{0} is not valid JSON: {1}")]
    Parse(PathBuf, String),
    #[error("could not write {0}: {1}")]
    Write(PathBuf, String),
    #[error("precision mode is not supported on this platform yet")]
    Unsupported,
}

fn read_settings(path: &Path) -> Result<Map<String, Value>, HookError> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(HookError::Read(path.to_path_buf(), e.to_string())),
    };
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    serde_json::from_str::<Value>(&text)
        .map_err(|e| HookError::Parse(path.to_path_buf(), e.to_string()))?
        .as_object()
        .cloned()
        .ok_or_else(|| HookError::Parse(path.to_path_buf(), "top level is not an object".into()))
}

/// True on platforms where the POSIX shell one-liner works.
pub fn supported() -> bool {
    cfg!(unix)
}

/// Inspect `settings.json` without changing it.
pub fn status(settings: &Path, sink: &Path) -> Result<Status, HookError> {
    let root = read_settings(settings)?;
    let mut events = Vec::new();
    let mut command = None;
    for event in HOOK_EVENTS {
        if let Some(cmd) = installed_command(&root, event) {
            events.push(event.to_string());
            command.get_or_insert(cmd);
        }
    }
    Ok(Status {
        installed: events.len() == HOOK_EVENTS.len(),
        events,
        settings_path: settings.to_string_lossy().into_owned(),
        sink_path: sink.to_string_lossy().into_owned(),
        command,
        supported: supported(),
    })
}

/// The Orrery command registered for `event`, if any.
fn installed_command(root: &Map<String, Value>, event: &str) -> Option<String> {
    root.get("hooks")?
        .get(event)?
        .as_array()?
        .iter()
        .flat_map(|matcher| {
            matcher
                .get("hooks")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        })
        .find_map(|h| {
            let cmd = h.get("command")?.as_str()?;
            cmd.contains(MARKER).then(|| cmd.to_string())
        })
}

/// Produce the settings file Orrery would write, without writing it.
///
/// Returns `(before, after)` as pretty JSON so the UI can show a real diff.
pub fn preview(settings: &Path, sink: &Path, install: bool) -> Result<(String, String), HookError> {
    let root = read_settings(settings)?;
    let before = to_pretty(&root);
    let after = to_pretty(&apply(root, sink, install));
    Ok((before, after))
}

fn to_pretty(root: &Map<String, Value>) -> String {
    serde_json::to_string_pretty(&Value::Object(root.clone())).unwrap_or_default()
}

/// Add or remove Orrery's hooks, leaving every other key untouched.
fn apply(mut root: Map<String, Value>, sink: &Path, install: bool) -> Map<String, Value> {
    let command = hook_command(sink);
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    for event in HOOK_EVENTS {
        // Drop any previous Orrery entry first: re-installing must not duplicate.
        let mut matchers: Vec<Value> = hooks
            .get(event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(strip_orrery)
            .collect();

        if install {
            matchers.push(json!({
                "hooks": [{ "type": "command", "command": command, "async": true }]
            }));
        }

        if matchers.is_empty() {
            hooks.remove(event);
        } else {
            hooks.insert(event.to_string(), Value::Array(matchers));
        }
    }

    if hooks.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(hooks));
    }
    root
}

/// Remove Orrery handlers from one matcher entry; `None` if nothing is left.
fn strip_orrery(matcher: Value) -> Option<Value> {
    let mut obj = matcher.as_object()?.clone();
    let kept: Vec<Value> = obj
        .get("hooks")?
        .as_array()?
        .iter()
        .filter(|h| {
            !h.get("command")
                .and_then(Value::as_str)
                .is_some_and(|c| c.contains(MARKER))
        })
        .cloned()
        .collect();
    if kept.is_empty() {
        return None;
    }
    obj.insert("hooks".into(), Value::Array(kept));
    Some(Value::Object(obj))
}

/// Write the change. Keeps a `.orrery-backup` copy of the previous file.
///
/// The caller is responsible for having shown the user [`preview`] first.
pub fn set_installed(settings: &Path, sink: &Path, install: bool) -> Result<Status, HookError> {
    if install && !supported() {
        return Err(HookError::Unsupported);
    }
    let root = read_settings(settings)?;
    if settings.exists() {
        let backup = settings.with_extension("json.orrery-backup");
        let _ = std::fs::copy(settings, backup);
    }
    if let Some(parent) = settings.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| HookError::Write(parent.into(), e.to_string()))?;
    }
    let next = apply(root, sink, install);
    let mut text = to_pretty(&next);
    text.push('\n');
    std::fs::write(settings, text)
        .map_err(|e| HookError::Write(settings.to_path_buf(), e.to_string()))?;
    if install {
        if let Some(parent) = sink.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    status(settings, sink)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sink() -> PathBuf {
        PathBuf::from("/data/orrery-hook-sink.jsonl")
    }

    #[test]
    fn parses_hook_payloads_and_normalises_agent_ids() {
        let start = r#"{"hook_event_name":"SubagentStart","session_id":"s1","agent_id":"42ab","agent_type":"Explore","cwd":"/repo"}"#;
        assert_eq!(
            parse_payload(start),
            Some(Event::Hook {
                event: "SubagentStart".into(),
                session_id: "s1".into(),
                agent_id: Some("agent-42ab".into()),
                agent_type: Some("Explore".into()),
                cwd: Some("/repo".into()),
                message: None,
            })
        );
        let notify = r#"{"hook_event_name":"Notification","session_id":"s1","notification_text":"needs permission"}"#;
        assert!(
            matches!(parse_payload(notify), Some(Event::Hook { message: Some(m), .. }) if m == "needs permission")
        );
        assert!(parse_payload(r#"{"hook_event_name":"PreToolUse","session_id":"s"}"#).is_none());
        assert!(parse_payload("not json").is_none());
        assert!(
            parse_payload(r#"{"hook_event_name":"Stop"}"#).is_none(),
            "session id is required"
        );
    }

    #[test]
    fn command_is_async_safe_and_quoted() {
        let cmd = hook_command(Path::new("/tmp/it's here/sink.jsonl"));
        assert_eq!(
            cmd,
            r"{ cat; echo; } >> '/tmp/it'\''s here/sink.jsonl' 2>/dev/null"
        );
    }

    #[test]
    fn install_preserves_unrelated_settings_and_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"mine.sh"}]}]}}"#,
        )
        .unwrap();

        let st = set_installed(&settings, &sink(), true).unwrap();
        assert!(st.installed);
        assert_eq!(st.events.len(), HOOK_EVENTS.len());

        let root: Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(root["model"], "opus");
        let stop = root["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "the user's own Stop hook survives");
        assert_eq!(stop[0]["hooks"][0]["command"], "mine.sh");
        assert_eq!(stop[1]["hooks"][0]["async"], true);
        assert!(settings.with_extension("json.orrery-backup").exists());
    }

    #[test]
    fn reinstall_does_not_duplicate_and_uninstall_restores() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        std::fs::write(&settings, r#"{"model":"opus"}"#).unwrap();

        set_installed(&settings, &sink(), true).unwrap();
        set_installed(&settings, &sink(), true).unwrap();
        let root: Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(root["hooks"]["Stop"].as_array().unwrap().len(), 1);

        let st = set_installed(&settings, &sink(), false).unwrap();
        assert!(!st.installed);
        let root: Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert!(
            root.get("hooks").is_none(),
            "no empty hooks object left behind"
        );
        assert_eq!(root["model"], "opus");
    }

    #[test]
    fn preview_shows_the_change_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        std::fs::write(&settings, "{}").unwrap();
        let (before, after) = preview(&settings, &sink(), true).unwrap();
        assert_eq!(before, "{}");
        assert!(after.contains("SubagentStart"));
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{}");
    }

    #[test]
    fn missing_or_empty_settings_file_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        assert!(!status(&settings, &sink()).unwrap().installed);
        std::fs::write(&settings, "   ").unwrap();
        assert!(set_installed(&settings, &sink(), true).unwrap().installed);
    }

    #[test]
    fn invalid_settings_file_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        std::fs::write(&settings, "{ not json").unwrap();
        assert!(matches!(
            set_installed(&settings, &sink(), true),
            Err(HookError::Parse(..))
        ));
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{ not json");
    }
}
