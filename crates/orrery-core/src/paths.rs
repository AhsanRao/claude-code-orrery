//! Locating and classifying files under the Claude Code home directory.

use std::path::{Path, PathBuf};

/// Resolve the Claude Code home directory.
///
/// Honors `CLAUDE_CONFIG_DIR` (the same override Claude Code itself uses) and
/// falls back to `~/.claude`.
pub fn claude_home() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
}

/// What a path under `~/.claude` represents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileKind {
    /// `sessions/<pid>.json` — one file per running process.
    Registry,
    /// `projects/<project>/<session>.jsonl` — main-thread transcript.
    MainTranscript {
        session_id: String,
        project_dir: String,
    },
    /// `projects/<project>/<session>/subagents/agent-<id>.jsonl`.
    AgentTranscript {
        session_id: String,
        project_dir: String,
        agent_id: String,
    },
}

/// Classify a path relative to `home`. Returns `None` for anything Orrery
/// does not care about (memory files, tool-result spills, orphaned copies...).
pub fn classify(home: &Path, path: &Path) -> Option<FileKind> {
    let rel = path.strip_prefix(home).ok()?;
    let mut parts = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned());
    let top = parts.next()?;
    match top.as_str() {
        "sessions" => {
            let name = parts.next()?;
            if parts.next().is_some() || !name.ends_with(".json") {
                return None;
            }
            Some(FileKind::Registry)
        }
        "projects" => {
            let project_dir = parts.next()?;
            let third = parts.next()?;
            match parts.next() {
                // projects/<project>/<session>.jsonl
                None => {
                    let session_id = third.strip_suffix(".jsonl")?;
                    if session_id.contains(".orphaned-") || session_id.contains(".superseded") {
                        return None;
                    }
                    Some(FileKind::MainTranscript {
                        session_id: session_id.to_string(),
                        project_dir,
                    })
                }
                // projects/<project>/<session>/subagents/agent-<id>.jsonl
                Some(sub) if sub == "subagents" => {
                    let file = parts.next()?;
                    if parts.next().is_some() {
                        return None;
                    }
                    let agent_id = file.strip_suffix(".jsonl")?;
                    Some(FileKind::AgentTranscript {
                        session_id: third,
                        project_dir,
                        agent_id: agent_id.to_string(),
                    })
                }
                _ => None,
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/u/.claude")
    }

    #[test]
    fn classifies_registry_files() {
        assert_eq!(
            classify(&home(), &home().join("sessions/123.json")),
            Some(FileKind::Registry)
        );
        assert_eq!(classify(&home(), &home().join("sessions/123.key")), None);
    }

    #[test]
    fn classifies_main_transcripts() {
        let p = home().join("projects/-Users-u-repo/abc-123.jsonl");
        assert_eq!(
            classify(&home(), &p),
            Some(FileKind::MainTranscript {
                session_id: "abc-123".into(),
                project_dir: "-Users-u-repo".into()
            })
        );
        let orphan = home().join("projects/-Users-u-repo/abc.orphaned-1-x.jsonl");
        assert_eq!(classify(&home(), &orphan), None);
    }

    #[test]
    fn classifies_agent_transcripts() {
        let p = home().join("projects/-p/sess/subagents/agent-42.jsonl");
        assert_eq!(
            classify(&home(), &p),
            Some(FileKind::AgentTranscript {
                session_id: "sess".into(),
                project_dir: "-p".into(),
                agent_id: "agent-42".into()
            })
        );
        assert_eq!(
            classify(&home(), &home().join("projects/-p/sess/tool-results/x.txt")),
            None
        );
        assert_eq!(
            classify(&home(), &home().join("projects/-p/memory/MEMORY.md")),
            None
        );
    }

    #[test]
    fn ignores_paths_outside_home() {
        assert_eq!(classify(&home(), Path::new("/etc/passwd")), None);
    }
}
