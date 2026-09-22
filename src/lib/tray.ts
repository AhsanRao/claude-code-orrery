/**
 * Menu-bar summary. The UI already counts what is happening, so it hands the
 * finished string to the shell rather than duplicating the logic in Rust.
 */

let last = "";

export async function setTrayTitle(text: string): Promise<void> {
  if (text === last || !("__TAURI_INTERNALS__" in window)) return;
  last = text;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_tray_title", { text });
  } catch {
    /* no tray on this platform, or the window is closing */
  }
}

/** `2 waiting` beats `3 busy` beats `4 agents`; nothing when all is quiet. */
export function traySummary(counts: { waiting: number; busy: number; agents: number }): string {
  if (counts.waiting > 0) return `${counts.waiting} waiting`;
  if (counts.agents > 0) return `${counts.agents} agent${counts.agents === 1 ? "" : "s"}`;
  if (counts.busy > 0) return `${counts.busy} busy`;
  return "";
}
