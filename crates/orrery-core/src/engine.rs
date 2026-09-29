//! The long-running watcher: subscribes to filesystem notifications under
//! `~/.claude`, tails the files that matter and pushes [`Event`]s to a sink.
//!
//! One background thread, no async runtime. Notifications are coalesced for a
//! few milliseconds so a burst of writes becomes one read per file.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::hooks::parse_payload;
use crate::model::{Event, LiveSession};
use crate::parser::{parse_line, LineContext, ParserState};
use crate::paths::{classify, FileKind};
use crate::registry::{read_jobs, read_registry};
use crate::tailer::FileTail;

/// Receives batches of events. Called from the engine thread.
pub type EventSink = Arc<dyn Fn(Vec<Event>) + Send + Sync>;

/// Engine tuning. `Default` is right for almost everyone.
#[derive(Debug, Clone)]
pub struct Config {
    /// Usually `~/.claude`; see [`crate::paths::claude_home`].
    pub claude_home: PathBuf,
    /// How much of a live session's transcript to replay on startup.
    pub max_history_bytes: u64,
    /// How long to wait for more notifications before reading files.
    pub debounce: Duration,
    /// Fallback sweep (registry + followed files) when no notifications arrive.
    pub registry_poll: Duration,
    /// Precision mode: file the installed hooks append to. `None` disables it.
    pub hook_sink: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            claude_home: crate::paths::claude_home(),
            max_history_bytes: 32 * 1024 * 1024,
            debounce: Duration::from_millis(16),
            registry_poll: Duration::from_secs(1),
            hook_sink: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("failed to start filesystem watcher: {0}")]
    Watcher(#[from] notify::Error),
    #[error("Claude Code directory not found at {0}")]
    MissingHome(PathBuf),
}

/// Handle to the background watcher. Dropping it stops the thread.
pub struct Engine {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Engine {
    /// Start watching. Emits an initial registry snapshot and replays live
    /// sessions' recent history before switching to tailing.
    pub fn start(config: Config, sink: EventSink) -> Result<Self, EngineError> {
        if !config.claude_home.is_dir() {
            return Err(EngineError::MissingHome(config.claude_home));
        }
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let handle = std::thread::Builder::new()
            .name("orrery-engine".into())
            .spawn(move || {
                if let Err(e) = run(config, sink.clone(), stop_flag) {
                    sink(vec![Event::Diagnostic {
                        level: "error".into(),
                        message: e.to_string(),
                    }]);
                }
            })
            .expect("spawn engine thread");
        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Open the hook sink, truncating whatever a previous run left behind.
fn rt_hook_tail(config: &Config) -> Option<FileTail> {
    let path = config.hook_sink.clone()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, b"");
    FileTail::from_end(&path).ok()
}

/// A transcript we are following.
struct Followed {
    tail: FileTail,
    ctx: LineContext,
    state: ParserState,
}

struct Runtime {
    config: Config,
    sink: EventSink,
    hook_tail: Option<FileTail>,
    followed: HashMap<PathBuf, Followed>,
    live: HashSet<String>,
    last_registry: Vec<LiveSession>,
}

fn run(mut config: Config, sink: EventSink, stop: Arc<AtomicBool>) -> Result<(), EngineError> {
    // FSEvents on macOS reports resolved paths (`/private/var/...`), so compare
    // against the canonical home or every notification would be misclassified.
    if let Ok(canonical) = std::fs::canonicalize(&config.claude_home) {
        config.claude_home = canonical;
    }
    let home = config.claude_home.clone();
    let sessions_dir = home.join("sessions");
    let jobs_dir = home.join("jobs");
    let projects_dir = home.join("projects");

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        notify::Config::default(),
    )?;
    // Both directories are created lazily by Claude Code; watch what exists.
    for dir in [&sessions_dir, &jobs_dir, &projects_dir] {
        if dir.is_dir() {
            watcher.watch(dir, RecursiveMode::Recursive)?;
        }
    }
    // The hook sink lives outside the Claude home, so it needs its own watch.
    if let Some(parent) = config.hook_sink.as_ref().and_then(|p| p.parent()) {
        if parent.is_dir() {
            let _ = watcher.watch(parent, RecursiveMode::NonRecursive);
        }
    }

    // Precision mode, when installed: start from an empty file so a previous
    // run's payloads are not replayed. Orrery owns this file.
    let hook_tail = rt_hook_tail(&config);
    let mut rt = Runtime {
        config,
        sink,
        hook_tail,
        followed: HashMap::new(),
        live: HashSet::new(),
        last_registry: Vec::new(),
    };
    rt.emit(vec![Event::Diagnostic {
        level: "info".into(),
        message: format!("watching {}", home.display()),
    }]);
    rt.refresh_registry(true);
    rt.discover_existing(&projects_dir);

    let mut pending: HashSet<PathBuf> = HashSet::new();
    let mut last_poll = Instant::now();
    while !stop.load(Ordering::SeqCst) {
        match rx.recv_timeout(rt.config.registry_poll) {
            Ok(Ok(event)) => {
                pending.extend(event.paths);
                // Coalesce the burst that usually follows one logical write.
                let deadline = Instant::now() + rt.config.debounce;
                while let Ok(Ok(more)) =
                    rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                {
                    pending.extend(more.paths);
                }
            }
            Ok(Err(e)) => rt.emit(vec![Event::Diagnostic {
                level: "warn".into(),
                message: format!("watcher: {e}"),
            }]),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if !pending.is_empty() {
            rt.process(&home, std::mem::take(&mut pending));
        }
        rt.drain_hooks();
        // Safety net: notifications can be dropped under load, so sweep
        // everything we follow on a slow timer. Stat-only when nothing changed.
        if last_poll.elapsed() >= rt.config.registry_poll {
            rt.refresh_registry(false);
            rt.sweep(&home);
            rt.drain_hooks();
            last_poll = Instant::now();
        }
    }
    Ok(())
}

impl Runtime {
    fn emit(&self, events: Vec<Event>) {
        if !events.is_empty() {
            (self.sink)(events);
        }
    }

    /// Re-read the live-session directories; emit only when something changed.
    fn refresh_registry(&mut self, force: bool) {
        let mut sessions = read_registry(&self.config.claude_home.join("sessions"));
        // Background jobs the foreground registry doesn't know about.
        let known: HashSet<&str> = sessions.iter().map(|s| s.session_id.as_str()).collect();
        let extra: Vec<_> = read_jobs(&self.config.claude_home.join("jobs"))
            .into_iter()
            .filter(|j| !known.contains(j.session_id.as_str()))
            .collect();
        sessions.extend(extra);
        if force || sessions != self.last_registry {
            self.live = sessions.iter().map(|s| s.session_id.clone()).collect();
            self.last_registry = sessions.clone();
            self.emit(vec![Event::SessionRegistry { sessions }]);
        }
    }

    /// On startup, attach to transcripts already on disk. Live sessions get
    /// bounded history; everything else is followed from its end so a resumed
    /// session shows up the moment it writes again.
    fn discover_existing(&mut self, projects_dir: &Path) {
        let home = self.config.claude_home.clone();
        let Ok(projects) = std::fs::read_dir(projects_dir) else {
            return;
        };
        let mut paths = Vec::new();
        for project in projects.filter_map(Result::ok) {
            let Ok(files) = std::fs::read_dir(project.path()) else {
                continue;
            };
            for file in files.filter_map(Result::ok) {
                let path = file.path();
                if let Some(FileKind::MainTranscript { .. }) = classify(&home, &path) {
                    paths.push(path);
                }
            }
            // Subagent transcripts live one level down, per session.
            let Ok(dirs) = std::fs::read_dir(project.path()) else {
                continue;
            };
            for dir in dirs.filter_map(Result::ok) {
                let sub = dir.path().join("subagents");
                let Ok(agents) = std::fs::read_dir(&sub) else {
                    continue;
                };
                paths.extend(agents.filter_map(Result::ok).map(|e| e.path()));
            }
        }
        for path in paths {
            self.follow(&home, &path, false);
        }
    }

    /// Read anything the installed hooks appended since the last check.
    fn drain_hooks(&mut self) {
        let Some(tail) = self.hook_tail.as_mut() else {
            return;
        };
        let Ok(lines) = tail.read_new_lines() else {
            return;
        };
        let events: Vec<Event> = lines.iter().filter_map(|l| parse_payload(l)).collect();
        self.emit(events);
    }

    /// Drain every followed file. Cheap: one `stat` per file unless it grew.
    fn sweep(&mut self, home: &Path) {
        let paths: Vec<PathBuf> = self.followed.keys().cloned().collect();
        for path in paths {
            self.follow(home, &path, false);
        }
    }

    fn process(&mut self, home: &Path, paths: HashSet<PathBuf>) {
        let mut registry_changed = false;
        for path in paths {
            match classify(home, &path) {
                Some(FileKind::Registry) => registry_changed = true,
                Some(FileKind::MainTranscript { .. }) | Some(FileKind::AgentTranscript { .. }) => {
                    self.follow(home, &path, true);
                }
                None => {}
            }
        }
        if registry_changed {
            self.refresh_registry(false);
        }
    }

    /// Ensure `path` is tailed, then drain any new lines into events.
    fn follow(&mut self, home: &Path, path: &Path, created_now: bool) {
        if !self.followed.contains_key(path) {
            let Some(kind) = classify(home, path) else {
                return;
            };
            let (session_id, agent_id) = match kind {
                FileKind::MainTranscript { session_id, .. } => (session_id, None),
                FileKind::AgentTranscript {
                    session_id,
                    agent_id,
                    ..
                } => (session_id, Some(agent_id)),
                FileKind::Registry => return,
            };
            if !path.is_file() {
                return;
            }
            // Replay history for sessions that are alive or that just appeared;
            // dormant transcripts are followed from the end to keep startup cheap.
            let replay = created_now || self.live.contains(&session_id);
            let tail = if replay {
                FileTail::from_start_bounded(path, self.config.max_history_bytes)
            } else {
                FileTail::from_end(path)
            };
            let Ok(tail) = tail else { return };
            if let Some(agent_id) = &agent_id {
                self.emit(vec![Event::AgentTranscript {
                    session_id: session_id.clone(),
                    agent_id: agent_id.clone(),
                    transcript_path: path.to_string_lossy().into_owned(),
                }]);
            }
            self.followed.insert(
                path.to_path_buf(),
                Followed {
                    tail,
                    ctx: LineContext {
                        session_id,
                        agent_id,
                        transcript_path: path.to_string_lossy().into_owned(),
                    },
                    state: ParserState::default(),
                },
            );
        }

        let Some(f) = self.followed.get_mut(path) else {
            return;
        };
        let lines = match f.tail.read_new_lines() {
            Ok(lines) => lines,
            Err(e) => {
                let msg = format!("read {}: {e}", path.display());
                self.emit(vec![Event::Diagnostic {
                    level: "warn".into(),
                    message: msg,
                }]);
                return;
            }
        };
        let events: Vec<Event> = lines
            .iter()
            .flat_map(|l| parse_line(&f.ctx, &mut f.state, l))
            .collect();
        self.emit(events);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// End-to-end: start the engine on a fake home, append to a transcript,
    /// and expect parsed events to arrive through the sink.
    #[test]
    fn tails_a_live_session_end_to_end() {
        let home = tempfile::tempdir().unwrap();
        let sessions = home.path().join("sessions");
        let proj = home.path().join("projects/-repo");
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            sessions.join("1.json"),
            r#"{"pid":1,"sessionId":"s1","status":"busy"}"#,
        )
        .unwrap();
        let transcript = proj.join("s1.jsonl");
        std::fs::write(&transcript, "{\"type\":\"ai-title\",\"aiTitle\":\"Old\"}\n").unwrap();

        let received: Arc<Mutex<Vec<Event>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_store = Arc::clone(&received);
        let sink: EventSink = Arc::new(move |evs| sink_store.lock().unwrap().extend(evs));
        let config = Config {
            claude_home: home.path().to_path_buf(),
            registry_poll: Duration::from_millis(200),
            ..Config::default()
        };
        let mut engine = Engine::start(config, sink).unwrap();

        // Let the watcher settle, then append a tool call.
        std::thread::sleep(Duration::from_millis(400));
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&transcript)
                .unwrap();
            writeln!(f, r#"{{"type":"assistant","message":{{"id":"m","role":"assistant","content":[{{"type":"tool_use","id":"t1","name":"Read","input":{{"file_path":"x"}}}}]}}}}"#).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let got = received.lock().unwrap();
            let has_tool = got
                .iter()
                .any(|e| matches!(e, Event::ToolStart { tool, .. } if tool == "Read"));
            let has_title = got
                .iter()
                .any(|e| matches!(e, Event::SessionTitle { title, .. } if title == "Old"));
            let has_registry = got
                .iter()
                .any(|e| matches!(e, Event::SessionRegistry { sessions } if sessions.len() == 1));
            if has_tool && has_title && has_registry {
                break;
            }
            drop(got);
            assert!(
                Instant::now() < deadline,
                "events did not arrive: {:?}",
                received.lock().unwrap()
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        engine.stop();
    }

    /// Precision mode: a line appended to the sink becomes a `Hook` event.
    #[test]
    fn reads_hook_payloads_from_the_sink() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("sessions")).unwrap();
        std::fs::create_dir_all(home.path().join("projects")).unwrap();
        let sink = home.path().join("hooks.jsonl");

        let received: Arc<Mutex<Vec<Event>>> = Arc::new(Mutex::new(Vec::new()));
        let store = Arc::clone(&received);
        let mut engine = Engine::start(
            Config {
                claude_home: home.path().to_path_buf(),
                hook_sink: Some(sink.clone()),
                registry_poll: Duration::from_millis(150),
                ..Config::default()
            },
            Arc::new(move |evs| store.lock().unwrap().extend(evs)),
        )
        .unwrap();

        std::thread::sleep(Duration::from_millis(300));
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&sink)
                .unwrap();
            writeln!(f, r#"{{"hook_event_name":"SubagentStart","session_id":"s1","agent_id":"7","agent_type":"Plan"}}"#).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let got = received.lock().unwrap();
            if got
                .iter()
                .any(|e| matches!(e, Event::Hook { agent_id: Some(a), .. } if a == "agent-7"))
            {
                break;
            }
            drop(got);
            assert!(Instant::now() < deadline, "hook event never arrived");
            std::thread::sleep(Duration::from_millis(50));
        }
        engine.stop();
    }

    #[test]
    fn missing_home_is_an_error() {
        let config = Config {
            claude_home: PathBuf::from("/nope/.claude"),
            ..Config::default()
        };
        let sink: EventSink = Arc::new(|_| {});
        assert!(matches!(
            Engine::start(config, sink),
            Err(EngineError::MissingHome(_))
        ));
    }
}
