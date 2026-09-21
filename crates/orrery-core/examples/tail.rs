//! Headless debugging tool: print every event Orrery would see, as JSON lines.
//!
//! ```sh
//! cargo run -p orrery-core --example tail
//! ```
//!
//! Stop with Ctrl-C. The engine is dropped (and its thread joined) on exit.

use std::sync::Arc;

use orrery_core::{Config, Engine};

fn main() {
    let sink = Arc::new(|events: Vec<orrery_core::Event>| {
        for e in events {
            println!(
                "{}",
                serde_json::to_string(&e).expect("event is serializable")
            );
        }
    });
    let _engine = match Engine::start(Config::default(), sink) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("orrery: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("orrery: tailing, Ctrl-C to stop");
    loop {
        std::thread::park();
    }
}
