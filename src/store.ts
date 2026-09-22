/**
 * App state. One zustand store holding the reduced model plus UI selection.
 * Components subscribe to slices; the bridge pushes event batches in.
 */

import { create } from "zustand";
import { getBridge } from "./lib/bridge";
import { initialState, reduce } from "./lib/reducer";
import { MAIN, type OrreryState, type TranscriptSummary } from "./lib/types";
import { agentColor } from "./lib/tools";
import { loadPrices, savePrices, type Price } from "./lib/cost";
import { notifyWaiting } from "./lib/notify";
import { setTrayTitle, traySummary } from "./lib/tray";
import { runningAgents } from "./lib/reducer";

export interface Toast {
  id: number;
  color: string;
  icon: string;
  title: string;
  message: string;
}

interface UiState {
  model: OrreryState;
  mode: "tauri" | "demo" | "connecting";
  claudeHome: string;
  selectedSession: string | null;
  selectedAgent: string;
  toasts: Toast[];
  /** Milliseconds; `Date.now()` sampled on a slow tick for elapsed labels. */
  now: number;
  /** Past transcripts on disk (not yet loaded into `model`). */
  history: TranscriptSummary[];
  loadingHistory: string | null;
  toastsEnabled: boolean;
  /** Free-text filter over the session rail. */
  query: string;
  /** USD per million tokens, by model family. */
  prices: Record<string, Price>;
}

interface Actions {
  apply(events: Parameters<typeof reduce>[1]): void;
  selectSession(id: string): void;
  selectAgent(id: string): void;
  pushToast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
  connect(): Promise<void>;
  openHistory(sessionId: string): Promise<void>;
  setToastsEnabled(on: boolean): void;
  setQuery(q: string): void;
  setPrice(model: string, price: Price): void;
}

const TOASTS_KEY = "orrery.toasts";
const readToastsPref = (): boolean => {
  try {
    return localStorage.getItem(TOASTS_KEY) !== "off";
  } catch {
    return true;
  }
};

let toastSeq = 0;

export const useStore = create<UiState & Actions>((set, get) => ({
  model: initialState(),
  mode: "connecting",
  claudeHome: "",
  selectedSession: null,
  selectedAgent: MAIN,
  toasts: [],
  now: Date.now(),
  history: [],
  loadingHistory: null,
  toastsEnabled: readToastsPref(),
  query: "",
  prices: loadPrices(),

  apply(events) {
    const prev = get().model;
    const next = reduce(prev, events);
    if (next === prev) return;
    // Toast only fresh facts: history replay would otherwise flood the screen.
    if (prev.registryLoaded) {
      const fresh = Date.now() - 5000;
      for (const ev of events) {
        if (ev.kind === "agent-spawn" && Date.parse(ev.ts) > fresh) {
          get().pushToast({
            color: agentColor(ev.agentType),
            icon: "spark",
            title: "Agent spawned",
            message: `${ev.agentType} · ${ev.description}`,
          });
        } else if (ev.kind === "agent-result" && Date.parse(ev.ts) > fresh) {
          const a = ev.agentId ? next.sessions[ev.sessionId]?.agents[ev.agentId] : undefined;
          get().pushToast({
            color: "var(--accent)",
            icon: "flag",
            title: ev.status === "failed" ? "Agent failed" : "Result returned",
            message: a ? `${a.type} · ${a.toolCount} tools` : (ev.status ?? ""),
          });
        } else if (
          ev.kind === "tool-start" &&
          (ev.tool === "Edit" || ev.tool === "Write") &&
          Date.parse(ev.ts) > fresh
        ) {
          const who = ev.agentId
            ? (next.sessions[ev.sessionId]?.agents[ev.agentId]?.type ?? "agent")
            : "main";
          get().pushToast({
            color: "var(--t-edit)",
            icon: "pencil",
            title: `${who} edits`,
            message: ev.summary,
          });
        }
      }
    }
    // Auto-select the first session that shows up so the page is never empty.
    let { selectedSession, selectedAgent } = get();
    if (!selectedSession || !next.sessions[selectedSession]) {
      const busy = Object.values(next.sessions).find((s) => s.status === "busy");
      selectedSession = busy?.id ?? Object.keys(next.sessions)[0] ?? null;
      selectedAgent = MAIN;
    }
    // Tell the OS when a session starts needing the user; nothing else nags.
    for (const s of Object.values(next.sessions)) {
      if (s.status === "waiting" && prev.sessions[s.id]?.status !== "waiting") {
        void notifyWaiting(s.title ?? s.cwd ?? s.id, s.agents[MAIN]?.current?.summary);
      }
    }
    const live = Object.values(next.sessions).filter((s) => s.live);
    void setTrayTitle(
      traySummary({
        waiting: live.filter((s) => s.status === "waiting").length,
        busy: live.filter((s) => s.status === "busy").length,
        agents: live.reduce((n, s) => n + runningAgents(s).length, 0),
      }),
    );
    set({ model: next, selectedSession, selectedAgent });
  },
  selectSession(id) {
    set({ selectedSession: id, selectedAgent: MAIN });
  },
  selectAgent(id) {
    set({ selectedAgent: id });
  },
  pushToast(t) {
    if (!get().toastsEnabled) return;
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    window.setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  async connect() {
    const bridge = await getBridge();
    const home = await bridge.claudeHome().catch(() => "");
    set({ mode: bridge.mode, claudeHome: home });
    bridge.subscribe((events) => get().apply(events));
    window.setInterval(() => set({ now: Date.now() }), 1000);
    const refreshHistory = async () =>
      set({ history: await bridge.listTranscripts().catch(() => []) });
    await refreshHistory();
    window.setInterval(refreshHistory, 30_000);
  },
  async openHistory(sessionId) {
    if (get().model.sessions[sessionId]) return get().selectSession(sessionId);
    set({ loadingHistory: sessionId });
    try {
      const bridge = await getBridge();
      get().apply(await bridge.loadHistory(sessionId));
      get().selectSession(sessionId);
    } finally {
      set({ loadingHistory: null });
    }
  },
  setQuery(q) {
    set({ query: q });
  },
  setPrice(model, price) {
    const prices = { ...get().prices, [model]: price };
    savePrices(prices);
    set({ prices });
  },
  setToastsEnabled(on) {
    try {
      localStorage.setItem(TOASTS_KEY, on ? "on" : "off");
    } catch {
      /* private mode: preference just won't persist */
    }
    set({ toastsEnabled: on, toasts: on ? get().toasts : [] });
  },
}));
