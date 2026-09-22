/**
 * Native notifications, best effort.
 *
 * Only used for the one thing worth interrupting someone for: a session that
 * has stopped and is waiting on them. No-ops in the browser and whenever the
 * user has not granted permission.
 */

let granted: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  granted ??= (async () => {
    try {
      const { isPermissionGranted, requestPermission } =
        await import("@tauri-apps/plugin-notification");
      return (await isPermissionGranted()) || (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();
  return granted;
}

export async function notifyWaiting(session: string, detail?: string): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title: `${session} needs you`, body: detail ?? "Waiting for your answer" });
  } catch {
    /* notifications are a nicety; never break the UI over one */
  }
}
