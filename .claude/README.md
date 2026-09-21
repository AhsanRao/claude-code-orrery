# Claude Code setup for this repo

Everything here is **project-scoped**: it applies when you open this repository with Claude Code and nowhere else.

## What's included

| Item                                      | Kind             | Purpose                                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skills/apple-design/`                    | skill (vendored) | Apple's fluid-interface and typography principles, translated for the web. Used for motion, feedback and materials. Source: [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/main/skills/apple-design). |
| `skills/ui-ux-pro-max/`                   | skill (vendored) | Searchable UI/UX intelligence (styles, palettes, type pairings, UX guidelines, accessibility checklist). Source: [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).        |
| `ponytail@ponytail`                       | plugin           | "Lazy senior dev" mode: smallest solution that works, YAGNI, stdlib first. Enabled in `settings.json`.                                                                                                                   |
| `frontend-design@claude-plugins-official` | plugin           | Anthropic's frontend design skill for distinctive, production-grade UI. Enabled in `settings.json`.                                                                                                                      |
| `skills.json`                             | manifest         | Machine-readable list of the above so the setup script can (re)install them.                                                                                                                                             |

Vendored skills are committed so a fresh clone works offline; `scripts/setup-skills.sh` refreshes them and installs the plugins.

## Install / refresh

```sh
./scripts/setup-skills.sh          # vendors skills listed in skills.json, installs plugins at project scope
./scripts/setup-skills.sh --check  # only report what is missing / outdated
```

Plugins are installed with `claude plugin install <name>@<marketplace> --scope project`, which records them in `.claude/settings.json` (committed) rather than your user settings.

## Using them

- `/apple-design` — review or build gesture/motion-heavy UI.
- The `ui-ux-pro-max` skill triggers on UI/UX work; run its search tool for palettes and guidelines:
  ```sh
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "focus ring keyboard" --domain ux
  ```
- `/ponytail` commands (`/ponytail-review`, `/ponytail-audit`) come from the plugin.

## Licensing

Vendored skills keep their upstream licenses (see each skill's directory or upstream repository). They are development aids and are not part of the Orrery binary.
