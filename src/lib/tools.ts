/**
 * How each Claude Code tool is drawn: a color family and an icon id from the
 * inline sprite in `components/Icons.tsx`.
 */

export type ToolFamily = "read" | "search" | "edit" | "shell" | "web" | "agent" | "think" | "other";

export interface ToolStyle {
  family: ToolFamily;
  icon: string;
}

const STYLES: Record<string, ToolStyle> = {
  Read: { family: "read", icon: "file" },
  NotebookEdit: { family: "edit", icon: "pencil" },
  Grep: { family: "search", icon: "search" },
  Glob: { family: "search", icon: "search" },
  Edit: { family: "edit", icon: "pencil" },
  Write: { family: "edit", icon: "pencil" },
  Bash: { family: "shell", icon: "terminal" },
  PowerShell: { family: "shell", icon: "terminal" },
  WebFetch: { family: "web", icon: "globe" },
  WebSearch: { family: "web", icon: "globe" },
  Agent: { family: "agent", icon: "spark" },
  Task: { family: "agent", icon: "spark" },
  SendMessage: { family: "agent", icon: "spark" },
  Skill: { family: "other", icon: "flag" },
};

export const toolStyle = (tool: string): ToolStyle =>
  STYLES[tool] ??
  (tool.startsWith("mcp__") ? { family: "web", icon: "plug" } : { family: "other", icon: "dots" });

/** Colors for agent types, keyed loosely so custom agents still get a color. */
export const agentColor = (type: string): string => {
  const t = type.toLowerCase();
  if (t === "main") return "var(--accent)";
  if (t.includes("explore")) return "var(--ty-explore)";
  if (t.includes("plan")) return "var(--ty-plan)";
  if (t.includes("review")) return "var(--ty-review)";
  if (t.includes("general")) return "var(--ty-gp)";
  // Stable hash → one of the remaining hues.
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ["var(--ty-explore)", "var(--ty-plan)", "var(--ty-review)", "var(--ty-gp)"][h % 4]!;
};
