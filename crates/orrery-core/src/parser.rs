//! Turns one JSONL transcript line into zero or more [`Event`]s.
//!
//! The transcript format is owned by Claude Code and is not a public contract,
//! so this parser is deliberately lenient: unknown record types and unknown
//! fields are ignored, and a malformed line yields no events rather than an
//! error. Everything here is pure and covered by tests against real-shaped
//! fixtures in `tests/fixtures`.

use serde_json::Value;

use crate::model::{Event, Usage};

/// Where a line came from. Lines from a subagent transcript carry the agent id
/// so the UI can attribute tool calls to the right bot.
#[derive(Debug, Clone)]
pub struct LineContext {
    pub session_id: String,
    pub agent_id: Option<String>,
    pub transcript_path: String,
}

/// Mutable parser state that spans lines (dedupe keys, seen metadata).
#[derive(Debug, Default)]
pub struct ParserState {
    meta_sent: bool,
    /// API message ids whose usage has already been emitted; Claude Code writes
    /// one line per content block and repeats the usage on each.
    usage_seen: std::collections::HashSet<String>,
}

/// Maximum characters kept from a prompt / assistant text / agent prompt.
const TEXT_PREVIEW: usize = 2000;

/// Parse a single line. Never panics on bad input.
pub fn parse_line(ctx: &LineContext, state: &mut ParserState, line: &str) -> Vec<Event> {
    let line = line.trim();
    if line.is_empty() {
        return Vec::new();
    }
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let mut out = Vec::new();

    if !state.meta_sent {
        if let Some(cwd) = v.get("cwd").and_then(Value::as_str) {
            state.meta_sent = true;
            out.push(Event::SessionMeta {
                session_id: ctx.session_id.clone(),
                transcript_path: ctx.transcript_path.clone(),
                cwd: Some(cwd.to_string()),
                git_branch: str_field(&v, "gitBranch"),
                version: str_field(&v, "version"),
            });
        }
    }

    match v.get("type").and_then(Value::as_str) {
        Some("ai-title") => {
            if let Some(title) = v.get("aiTitle").and_then(Value::as_str) {
                out.push(Event::SessionTitle {
                    session_id: ctx.session_id.clone(),
                    title: title.to_string(),
                });
            }
        }
        Some("user") => parse_user(ctx, &v, &mut out),
        Some("assistant") => parse_assistant(ctx, state, &v, &mut out),
        _ => {}
    }
    out
}

fn parse_user(ctx: &LineContext, v: &Value, out: &mut Vec<Event>) {
    let ts = str_field(v, "timestamp").unwrap_or_default();
    let Some(message) = v.get("message") else {
        return;
    };
    let content = message.get("content");

    // Tool results: one block per finished tool call.
    if let Some(blocks) = content.and_then(Value::as_array) {
        let mut had_result = false;
        for block in blocks {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            had_result = true;
            let tool_use_id = str_field(block, "tool_use_id").unwrap_or_default();
            let ok = !block
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let output_chars = match block.get("content") {
                Some(Value::String(s)) => s.chars().count(),
                Some(Value::Array(parts)) => parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .map(|s| s.chars().count())
                    .sum(),
                _ => 0,
            };
            out.push(Event::ToolEnd {
                session_id: ctx.session_id.clone(),
                agent_id: ctx.agent_id.clone(),
                ts: ts.clone(),
                tool_use_id: tool_use_id.clone(),
                ok,
                output_chars,
            });
            // The Agent tool's structured result lives beside the message.
            if let Some(result) = v
                .get("toolUseResult")
                .filter(|r| r.get("agentId").is_some())
            {
                out.push(Event::AgentResult {
                    session_id: ctx.session_id.clone(),
                    parent_agent_id: ctx.agent_id.clone(),
                    ts: ts.clone(),
                    tool_use_id,
                    agent_id: str_field(result, "agentId"),
                    status: str_field(result, "status"),
                });
            }
        }
        if had_result {
            return;
        }
    }

    // Everything else on a user line is a prompt, unless Claude Code marked it
    // as injected context (`isMeta`) or it came from a subagent (its "prompt" is
    // the parent's instruction, already shown as the spawn description).
    if v.get("isMeta").and_then(Value::as_bool).unwrap_or(false) || ctx.agent_id.is_some() {
        return;
    }
    let text = match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let text = text.trim();
    if text.is_empty() || text.starts_with("<system-reminder>") {
        return;
    }
    out.push(Event::Prompt {
        session_id: ctx.session_id.clone(),
        ts,
        text: truncate(text, TEXT_PREVIEW),
    });
}

fn parse_assistant(ctx: &LineContext, state: &mut ParserState, v: &Value, out: &mut Vec<Event>) {
    let ts = str_field(v, "timestamp").unwrap_or_default();
    let Some(message) = v.get("message") else {
        return;
    };
    let model = str_field(message, "model");

    if let Some(blocks) = message.get("content").and_then(Value::as_array) {
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if !text.is_empty() {
                        out.push(Event::AssistantText {
                            session_id: ctx.session_id.clone(),
                            agent_id: ctx.agent_id.clone(),
                            ts: ts.clone(),
                            text: truncate(text, TEXT_PREVIEW),
                            model: model.clone(),
                        });
                    }
                }
                Some("tool_use") => {
                    let tool = str_field(block, "name").unwrap_or_else(|| "unknown".into());
                    let tool_use_id = str_field(block, "id").unwrap_or_default();
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    if tool == "Agent" || tool == "Task" {
                        out.push(Event::AgentSpawn {
                            session_id: ctx.session_id.clone(),
                            parent_agent_id: ctx.agent_id.clone(),
                            ts: ts.clone(),
                            tool_use_id: tool_use_id.clone(),
                            agent_type: str_field(&input, "subagent_type")
                                .unwrap_or_else(|| "general-purpose".into()),
                            description: str_field(&input, "description").unwrap_or_default(),
                            prompt_preview: str_field(&input, "prompt")
                                .map(|p| truncate(&p, TEXT_PREVIEW))
                                .unwrap_or_default(),
                        });
                    }
                    out.push(Event::ToolStart {
                        session_id: ctx.session_id.clone(),
                        agent_id: ctx.agent_id.clone(),
                        ts: ts.clone(),
                        tool_use_id,
                        summary: summarize_input(&tool, &input),
                        tool,
                        input,
                    });
                }
                _ => {}
            }
        }
    }

    // Usage is repeated on every content-block line of the same API message.
    if let (Some(id), Some(usage)) = (str_field(message, "id"), message.get("usage")) {
        if state.usage_seen.insert(id) {
            out.push(Event::Usage {
                session_id: ctx.session_id.clone(),
                agent_id: ctx.agent_id.clone(),
                ts,
                model,
                usage: Usage {
                    input_tokens: u64_field(usage, "input_tokens"),
                    output_tokens: u64_field(usage, "output_tokens"),
                    cache_read_tokens: u64_field(usage, "cache_read_input_tokens"),
                    cache_write_tokens: u64_field(usage, "cache_creation_input_tokens"),
                },
            });
        }
    }
}

/// One-line, human-readable description of a tool call's input.
pub fn summarize_input(tool: &str, input: &Value) -> String {
    let pick = |keys: &[&str]| keys.iter().find_map(|k| str_field(input, k));
    let s = match tool {
        "Read" | "Edit" | "Write" | "NotebookEdit" => pick(&["file_path", "notebook_path"]),
        "Bash" | "PowerShell" => pick(&["description", "command"]),
        "Grep" => pick(&["pattern"]).map(|p| match str_field(input, "path") {
            Some(path) => format!("{p}  in {path}"),
            None => p,
        }),
        "Glob" => pick(&["pattern"]),
        "WebFetch" | "WebSearch" => pick(&["url", "query"]),
        "Agent" | "Task" => pick(&["description"]),
        "Skill" => pick(&["skill"]),
        "SendMessage" => pick(&["to"]),
        _ => input
            .as_object()
            .and_then(|o| o.values().find_map(|v| v.as_str().map(str::to_string))),
    };
    truncate(s.unwrap_or_default().trim(), 160)
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

fn u64_field(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut t: String = s.chars().take(max).collect();
    t.push('…');
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> LineContext {
        LineContext {
            session_id: "sess".into(),
            agent_id: None,
            transcript_path: "/x/sess.jsonl".into(),
        }
    }

    fn parse(line: &str) -> Vec<Event> {
        parse_line(&ctx(), &mut ParserState::default(), line)
    }

    #[test]
    fn ignores_garbage_and_unknown_types() {
        assert!(parse("not json").is_empty());
        assert!(parse("").is_empty());
        assert!(parse(r#"{"type":"queue-operation","operation":"enqueue"}"#).is_empty());
    }

    #[test]
    fn title_line() {
        let ev = parse(r#"{"type":"ai-title","aiTitle":"Fix retries","sessionId":"sess"}"#);
        assert_eq!(
            ev,
            vec![Event::SessionTitle {
                session_id: "sess".into(),
                title: "Fix retries".into()
            }]
        );
    }

    #[test]
    fn prompt_line_emits_meta_once_then_prompt() {
        let line = r#"{"type":"user","cwd":"/repo","gitBranch":"main","version":"2.1.278","timestamp":"2026-09-21T19:27:59.702Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}"#;
        let mut st = ParserState::default();
        let ev = parse_line(&ctx(), &mut st, line);
        assert!(
            matches!(&ev[0], Event::SessionMeta { cwd: Some(c), git_branch: Some(b), .. } if c == "/repo" && b == "main")
        );
        assert!(matches!(&ev[1], Event::Prompt { text, .. } if text == "hello"));
        // second line: meta not repeated
        let ev2 = parse_line(&ctx(), &mut st, line);
        assert_eq!(ev2.len(), 1);
    }

    #[test]
    fn string_content_prompt_and_meta_skip() {
        let ev = parse(r#"{"type":"user","message":{"role":"user","content":"do it"}}"#);
        assert!(matches!(&ev[0], Event::Prompt { text, .. } if text == "do it"));
        let ev = parse(
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"injected"}}"#,
        );
        assert!(ev.is_empty());
    }

    #[test]
    fn tool_use_and_result() {
        let start = r#"{"type":"assistant","timestamp":"t1","message":{"id":"msg_1","model":"claude-opus-5","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"src/a.ts"}}],"usage":{"input_tokens":2,"output_tokens":10,"cache_read_input_tokens":5,"cache_creation_input_tokens":7}}}"#;
        let ev = parse(start);
        assert!(
            matches!(&ev[0], Event::ToolStart { tool, summary, tool_use_id, .. } if tool == "Read" && summary == "src/a.ts" && tool_use_id == "toolu_1")
        );
        assert!(
            matches!(&ev[1], Event::Usage { usage, model: Some(m), .. } if usage.output_tokens == 10 && usage.cache_read_tokens == 5 && m == "claude-opus-5")
        );

        let end = r#"{"type":"user","timestamp":"t2","message":{"role":"user","content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"abc","is_error":false}]},"toolUseResult":{"stdout":"abc"}}"#;
        let ev = parse(end);
        assert_eq!(ev.len(), 1);
        assert!(
            matches!(&ev[0], Event::ToolEnd { ok: true, output_chars: 3, tool_use_id, .. } if tool_use_id == "toolu_1")
        );
    }

    #[test]
    fn usage_deduped_across_blocks_of_same_message() {
        let mut st = ParserState::default();
        let a = r#"{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"hi"}],"usage":{"output_tokens":1}}}"#;
        let b = r#"{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"tool_use","id":"t","name":"Bash","input":{"command":"ls"}}],"usage":{"output_tokens":1}}}"#;
        let ev_a = parse_line(&ctx(), &mut st, a);
        let ev_b = parse_line(&ctx(), &mut st, b);
        assert_eq!(
            ev_a.iter()
                .filter(|e| matches!(e, Event::Usage { .. }))
                .count(),
            1
        );
        assert_eq!(
            ev_b.iter()
                .filter(|e| matches!(e, Event::Usage { .. }))
                .count(),
            0
        );
    }

    #[test]
    fn agent_spawn_and_result() {
        let spawn = r#"{"type":"assistant","timestamp":"t","message":{"id":"m","role":"assistant","content":[{"type":"tool_use","id":"toolu_a","name":"Agent","input":{"subagent_type":"Explore","description":"Map parser","prompt":"Find the parser"}}]}}"#;
        let ev = parse(spawn);
        assert!(
            matches!(&ev[0], Event::AgentSpawn { agent_type, description, .. } if agent_type == "Explore" && description == "Map parser")
        );
        assert!(matches!(&ev[1], Event::ToolStart { tool, .. } if tool == "Agent"));

        let result = r#"{"type":"user","timestamp":"t","message":{"role":"user","content":[{"tool_use_id":"toolu_a","type":"tool_result","content":[{"type":"text","text":"done"}]}]},"toolUseResult":{"agentId":"agent-42","status":"completed"}}"#;
        let ev = parse(result);
        assert!(matches!(
            &ev[0],
            Event::ToolEnd {
                output_chars: 4,
                ..
            }
        ));
        assert!(
            matches!(&ev[1], Event::AgentResult { agent_id: Some(id), status: Some(s), .. } if id == "agent-42" && s == "completed")
        );
    }

    #[test]
    fn subagent_lines_carry_agent_id_and_skip_prompt() {
        let c = LineContext {
            session_id: "sess".into(),
            agent_id: Some("agent-1".into()),
            transcript_path: "p".into(),
        };
        let mut st = ParserState::default();
        let prompt =
            r#"{"type":"user","message":{"role":"user","content":"instruction from parent"}}"#;
        assert!(parse_line(&c, &mut st, prompt).is_empty());
        let tool = r#"{"type":"assistant","message":{"id":"m","role":"assistant","content":[{"type":"tool_use","id":"t","name":"Grep","input":{"pattern":"foo","path":"src"}}]}}"#;
        let ev = parse_line(&c, &mut st, tool);
        assert!(
            matches!(&ev[0], Event::ToolStart { agent_id: Some(a), summary, .. } if a == "agent-1" && summary == "foo  in src")
        );
    }

    #[test]
    fn summaries_per_tool() {
        let j = |s: &str| serde_json::from_str::<Value>(s).unwrap();
        assert_eq!(
            summarize_input("Bash", &j(r#"{"command":"ls","description":"List"}"#)),
            "List"
        );
        assert_eq!(
            summarize_input("WebFetch", &j(r#"{"url":"https://a"}"#)),
            "https://a"
        );
        assert_eq!(summarize_input("Mystery", &j(r#"{"n":1,"s":"x"}"#)), "x");
        assert_eq!(summarize_input("Read", &Value::Null), "");
    }
}
