//! Reading the directories that say which sessions exist right now:
//! `~/.claude/sessions` (one file per running process) and `~/.claude/jobs`
//! (one directory per background session started with `claude --bg`).
//!
//! Both are small — a handful of tiny files — so they are read whole.

use std::path::Path;

use serde::Deserialize;

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

/// `jobs/<id>/state.json`, the background-session state written by the
/// supervisor behind `claude --bg` and `claude agents`.
///
/// Only the fields Orrery displays are named; everything else is ignored. The
/// official read path is `claude agents --json`, but shelling out on every
/// change would cost a process spawn per event, so the file is read directly.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobState {
    #[serde(alias = "id")]
    session_id: Option<String>,
    cwd: Option<String>,
    name: Option<String>,
    /// `working`, `blocked`, `done`, `failed`, `stopped`.
    state: Option<String>,
    /// `busy`, `waiting`, `idle` — present only while the process is alive.
    status: Option<String>,
    created_at: Option<u64>,
    updated_at: Option<u64>,
}

/// Map a job's `state`/`status` pair onto the vocabulary of `sessions/*.json`.
fn job_status(job: &JobState) -> Option<&'static str> {
    match (job.state.as_deref(), job.status.as_deref()) {
        (Some("done") | Some("failed") | Some("stopped"), _) => None,
        (_, Some("waiting")) | (Some("blocked"), _) => Some("waiting"),
        (_, Some("idle")) => Some("idle"),
        _ => Some("busy"),
    }
}

/// Read every `jobs/<id>/state.json` into a [`LiveSession`].
///
/// Finished jobs are dropped: their transcript is still on disk, so they show
/// up as history rather than as something running.
pub fn read_jobs(dir: &Path) -> Vec<LiveSession> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut jobs: Vec<LiveSession> = entries
        .filter_map(Result::ok)
        .filter_map(|e| std::fs::read_to_string(e.path().join("state.json")).ok())
        .filter_map(|s| serde_json::from_str::<JobState>(&s).ok())
        .filter_map(|job| {
            let status = job_status(&job)?;
            Some(LiveSession {
                session_id: job.session_id?,
                cwd: job.cwd,
                name: job.name,
                status: Some(status.to_string()),
                kind: Some("background".into()),
                entrypoint: Some("claude-bg".into()),
                started_at: job.created_at,
                updated_at: job.updated_at,
                ..LiveSession::default()
            })
        })
        .filter(|s| !s.session_id.is_empty())
        .collect();
    jobs.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    jobs
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
        assert!(read_jobs(Path::new("/nope/jobs")).is_empty());
    }

    #[test]
    fn reads_running_jobs_and_drops_finished_ones() {
        let dir = tempfile::tempdir().unwrap();
        for (id, body) in [
            (
                "a",
                r#"{"sessionId":"job-a","cwd":"/x","state":"working","status":"busy","updatedAt":5}"#,
            ),
            (
                "b",
                r#"{"sessionId":"job-b","state":"blocked","updatedAt":9,"name":"perf pass"}"#,
            ),
            (
                "c",
                r#"{"sessionId":"job-c","state":"done","updatedAt":99}"#,
            ),
            ("d", r#"{"broken":true}"#),
        ] {
            std::fs::create_dir_all(dir.path().join(id)).unwrap();
            std::fs::write(dir.path().join(id).join("state.json"), body).unwrap();
        }
        let jobs = read_jobs(dir.path());
        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0].session_id, "job-b");
        assert_eq!(jobs[0].status.as_deref(), Some("waiting"));
        assert_eq!(jobs[0].kind.as_deref(), Some("background"));
        assert_eq!(jobs[1].status.as_deref(), Some("busy"));
    }
}
