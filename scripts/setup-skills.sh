#!/usr/bin/env bash
# Vendors the skills and installs the plugins listed in .claude/skills.json,
# all at project scope. Safe to re-run. Requires: git, python3, claude (CLI).
#
#   ./scripts/setup-skills.sh          install / refresh everything
#   ./scripts/setup-skills.sh --check  report only, change nothing
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/.claude/skills.json"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need git; need python3

# --- skills -----------------------------------------------------------------
python3 - "$MANIFEST" <<'PY' | while IFS=$'\t' read -r name repo path ref dest; do
import json, sys
for s in json.load(open(sys.argv[1]))["skills"]:
    print("\t".join([s["name"], s["repo"], s["path"], s.get("ref", "main"), s["dest"]]))
PY
  target="$ROOT/$dest"
  if [[ $CHECK -eq 1 ]]; then
    if [[ -f "$target/SKILL.md" ]]; then echo "ok       skill $name"; else echo "MISSING  skill $name ($dest)"; fi
    continue
  fi
  echo "syncing  skill $name  ←  $repo/$path@$ref"
  tmp="$(mktemp -d)"
  git clone --quiet --depth 1 --branch "$ref" --filter=blob:none --sparse "https://github.com/$repo.git" "$tmp"
  git -C "$tmp" sparse-checkout set "$path" --quiet
  rm -rf "$target"
  mkdir -p "$(dirname "$target")"
  cp -R "$tmp/$path" "$target"
  rm -rf "$tmp"
done

# --- plugins ----------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  echo "note: 'claude' CLI not found; skipping plugin install" >&2
  exit 0
fi

python3 - "$MANIFEST" <<'PY' | while IFS=$'\t' read -r kind name repo; do
import json, sys
m = json.load(open(sys.argv[1]))
for mp in m.get("marketplaces", []):
    print("\t".join(["marketplace", mp["name"], mp["repo"]]))
for p in m.get("plugins", []):
    print("\t".join(["plugin", p["name"] + "@" + p["marketplace"], ""]))
PY
  if [[ "$kind" == "marketplace" ]]; then
    if [[ $CHECK -eq 1 ]]; then continue; fi
    claude plugin marketplace add "$repo" >/dev/null 2>&1 || true
  else
    if [[ $CHECK -eq 1 ]]; then
      if grep -q "\"$name\"" "$ROOT/.claude/settings.json" 2>/dev/null; then echo "ok       plugin $name"; else echo "MISSING  plugin $name"; fi
      continue
    fi
    echo "installing plugin $name (project scope)"
    (cd "$ROOT" && claude plugin install "$name" --scope project >/dev/null) || echo "warn: could not install $name" >&2
  fi
done

echo "done."
