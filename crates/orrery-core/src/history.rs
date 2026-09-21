//! On-demand reads of whole transcripts: listing what exists and replaying a
//! session's full history. These are one-shot reads, not tailing.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::model::{Event, TranscriptSummary};
use crate::parser::{parse_line, LineContext, ParserState};
use crate::paths::{classify, FileKind};
use crate::tailer::FileTail;

/// List every main-thread transcript under `home/projects`, newest first.
pub fn list_transcripts(home: &Path) -> Vec<TranscriptSummary> {
    let mut out = Vec::new();
    let Ok(projects) = std::fs::read_dir(home.join("projects")) else {
        return out;
    };
    for project in projects.filter_map(Result::ok) {
        let Ok(files) = std::fs::read_dir(project.path()) else {
            continue;
        };
        for file in files.filter_map(Result::ok) {
            let path = file.path();
            let Some(FileKind::MainTranscript {
                session_id,
                project_dir,
            }) = classify(home, &path)
            else {
                continue;
            };
            let Ok(meta) = file.metadata() else { continue };
            let modified_at = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(TranscriptSummary {
                session_id,
                project_dir,
                title: tail_title(&path),
                transcript_path: path.to_string_lossy().into_owned(),
                modified_at,
                size_bytes: meta.len(),
            });
        }
    }
    out.sort_by_key(|t| std::cmp::Reverse(t.modified_at));
    out
}

/// Read the last `ai-title` record from the tail of a transcript, cheaply.
/// Claude Code rewrites the title line often, so the newest is near the end.
fn tail_title(path: &Path) -> Option<String> {
    let mut tail = FileTail::from_start_bounded(path, 64 * 1024).ok()?;
    let lines = tail.read_new_lines().ok()?;
    lines.iter().rev().find_map(|line| {
        let v: serde_json::Value = serde_json::from_str(line).ok()?;
        (v.get("type")?.as_str()? == "ai-title")
            .then(|| v.get("aiTitle")?.as_str().map(String::from))?
    })
}

/// Find the main transcript for `session_id`, if it exists.
pub fn find_transcript(home: &Path, session_id: &str) -> Option<PathBuf> {
    let projects = std::fs::read_dir(home.join("projects")).ok()?;
    for project in projects.filter_map(Result::ok) {
        let candidate = project.path().join(format!("{session_id}.jsonl"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Replay a session's main transcript and every subagent transcript beside it.
///
/// `max_bytes` bounds how much of the *main* transcript is read (from the end);
/// subagent transcripts are small and always read fully.
pub fn load_history(home: &Path, session_id: &str, max_bytes: u64) -> std::io::Result<Vec<Event>> {
    let Some(main_path) = find_transcript(home, session_id) else {
        return Ok(Vec::new());
    };
    let mut events = replay_file(&main_path, session_id, None, max_bytes)?;

    let agents_dir = main_path.with_extension("").join("subagents");
    if let Ok(entries) = std::fs::read_dir(&agents_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Some(FileKind::AgentTranscript { agent_id, .. }) = classify(home, &path) else {
                continue;
            };
            events.push(Event::AgentTranscript {
                session_id: session_id.to_string(),
                agent_id: agent_id.clone(),
                transcript_path: path.to_string_lossy().into_owned(),
            });
            events.extend(replay_file(&path, session_id, Some(agent_id), u64::MAX)?);
        }
    }
    Ok(events)
}

fn replay_file(
    path: &Path,
    session_id: &str,
    agent_id: Option<String>,
    max_bytes: u64,
) -> std::io::Result<Vec<Event>> {
    let ctx = LineContext {
        session_id: session_id.to_string(),
        agent_id,
        transcript_path: path.to_string_lossy().into_owned(),
    };
    let mut state = ParserState::default();
    let mut tail = FileTail::from_start_bounded(path, max_bytes)?;
    Ok(tail
        .read_new_lines()?
        .iter()
        .flat_map(|line| parse_line(&ctx, &mut state, line))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_and_replays_a_session_with_agents() {
        let home = tempfile::tempdir().unwrap();
        let proj = home.path().join("projects/-repo");
        std::fs::create_dir_all(proj.join("sess-1/subagents")).unwrap();
        std::fs::write(
            proj.join("sess-1.jsonl"),
            r#"{"type":"ai-title","aiTitle":"T"}
{"type":"user","cwd":"/repo","message":{"role":"user","content":"hi"}}
"#,
        )
        .unwrap();
        std::fs::write(
            proj.join("sess-1/subagents/agent-9.jsonl"),
            r#"{"type":"assistant","message":{"id":"m","role":"assistant","content":[{"type":"tool_use","id":"t","name":"Read","input":{"file_path":"a"}}]}}
"#,
        )
        .unwrap();
        std::fs::write(proj.join("sess-1.orphaned-1-x.jsonl"), "").unwrap();

        let list = list_transcripts(home.path());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].session_id, "sess-1");
        assert_eq!(list[0].title.as_deref(), Some("T"));

        let events = load_history(home.path(), "sess-1", u64::MAX).unwrap();
        assert!(matches!(events[0], Event::SessionTitle { .. }));
        assert!(events.iter().any(
            |e| matches!(e, Event::AgentTranscript { agent_id, .. } if agent_id == "agent-9")
        ));
        assert!(events
            .iter()
            .any(|e| matches!(e, Event::ToolStart { agent_id: Some(a), .. } if a == "agent-9")));
        assert!(load_history(home.path(), "nope", u64::MAX)
            .unwrap()
            .is_empty());
    }
}
