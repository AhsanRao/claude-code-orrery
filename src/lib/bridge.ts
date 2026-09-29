/**
 * The only module that knows whether we run inside Tauri or in a plain
 * browser. In a browser (`pnpm dev` without the shell) it falls back to the
 * demo simulator so the UI can be developed and reviewed without Claude Code.
 */

import type { HookStatus, LiveSession, OrreryEvent, TranscriptSummary } from "./types";
import { startDemo } from "./demo";

export type EventListener = (events: OrreryEvent[]) => void;

export interface Bridge {
  /** Whether events come from the real engine or the simulator. */
  readonly mode: "tauri" | "demo";
  subscribe(listener: EventListener): () => void;
  claudeHome(): Promise<string>;
  liveSessions(): Promise<LiveSession[]>;
  listTranscripts(): Promise<TranscriptSummary[]>;
  loadHistory(sessionId: string): Promise<OrreryEvent[]>;
  precisionStatus(): Promise<HookStatus>;
  precisionPreview(install: boolean): Promise<[string, string]>;
  precisionSet(install: boolean): Promise<HookStatus>;
}

/** Precision mode needs the desktop shell; the browser has no settings file. */
const NO_PRECISION: HookStatus = {
  installed: false,
  events: [],
  settingsPath: "~/.claude/settings.json",
  sinkPath: "",
  command: null,
  supported: false,
};

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBridge(): Promise<Bridge> {
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const CHANNEL = "orrery://events";
  return {
    mode: "tauri",
    subscribe(listener) {
      let active = true;
      const unlisten = listen<OrreryEvent[]>(CHANNEL, (e) => {
        if (active) listener(e.payload);
      });
      return () => {
        active = false;
        void unlisten.then((fn) => fn());
      };
    },
    claudeHome: () => invoke<string>("claude_home"),
    liveSessions: () => invoke<LiveSession[]>("live_sessions"),
    listTranscripts: () => invoke<TranscriptSummary[]>("list_transcripts"),
    loadHistory: (sessionId) => invoke<OrreryEvent[]>("load_history", { sessionId }),
    precisionStatus: () => invoke<HookStatus>("precision_status"),
    precisionPreview: (install) => invoke<[string, string]>("precision_preview", { install }),
    precisionSet: (install) => invoke<HookStatus>("precision_set", { install }),
  };
}

function demoBridge(): Bridge {
  const listeners = new Set<EventListener>();
  let stop: (() => void) | null = null;
  return {
    mode: "demo",
    subscribe(listener) {
      listeners.add(listener);
      stop ??= startDemo((events) => listeners.forEach((l) => l(events)));
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    },
    claudeHome: async () => "~/.claude",
    liveSessions: async () => [],
    listTranscripts: async () => [],
    loadHistory: async () => [],
    precisionStatus: async () => NO_PRECISION,
    precisionPreview: async () => ["{}", "{}"] as [string, string],
    precisionSet: async () => NO_PRECISION,
  };
}

let cached: Promise<Bridge> | null = null;

/** Resolve the bridge once; safe to call from many places. */
export const getBridge = (): Promise<Bridge> =>
  (cached ??= isTauri() ? tauriBridge() : Promise.resolve(demoBridge()));
