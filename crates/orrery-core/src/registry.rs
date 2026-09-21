//! Reading `~/.claude/sessions`, the directory of currently running sessions.
//!
//! Claude Code writes one small JSON file per live process and deletes it on
//! exit. Reading the whole directory is cheap (a handful of files) and is the
//! only reliable way to know which sessions are alive right now.

use std::path::Path;

use crate::model::LiveSession;

/// Read every `*.json` file in `dir` into a [`LiveSession`].
///
/// Files that fail to parse are skipped: a session may be mid-write, or a
/// newer Claude Code may have changed the format.
pub fn read_registry(dir: &Path) -> Vec<LiveSession> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut sessions: Vec<LiveSession> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|s| serde_json::from_str::<LiveSession>(&s).ok())
        .filter(|s| !s.session_id.is_empty())
        .collect();
    sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    sessions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_sorts_live_sessions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("1.json"),
            r#"{"pid":1,"sessionId":"a","cwd":"/x","status":"idle","updatedAt":10,"unknownField":true}"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("2.json"),
            r#"{"pid":2,"sessionId":"b","status":"busy","updatedAt":20,"name":"repo-1"}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("2.key"), "secret").unwrap();
        std::fs::write(dir.path().join("broken.json"), "{").unwrap();

        let s = read_registry(dir.path());
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].session_id, "b");
        assert_eq!(s[0].name.as_deref(), Some("repo-1"));
        assert_eq!(s[1].cwd.as_deref(), Some("/x"));
    }

    #[test]
    fn missing_dir_is_empty() {
        assert!(read_registry(Path::new("/nope/sessions")).is_empty());
    }
}
