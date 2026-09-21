# Design

Orrery is an instrument, not a dashboard template. Every visual decision comes from the subject: a night-time observatory watching small bodies orbit a sun.

## Name and mark

An **orrery** is a mechanical model of the solar system — planets on arms, driven around a central sun. That is exactly the picture Orrery draws: the main thread in the middle, agents in orbit, tool calls as the ticking of the mechanism.

The mark is a coral sun with three bodies (mint, blue, violet) on two thin orbit rings. Source: `design/brand/orrery-icon.svg` (app icon, 1024², rounded 22%) and `design/brand/orrery-logo.svg` (32² chrome mark). Regenerate platform icons with `pnpm icons`.

## Color

Dark-first. The ground is a deep petrol black, not neutral grey, so the mint/coral accents feel lit rather than printed. Light theme mirrors every token; components never use raw hex.

| Token                                 | Dark                              | Light                             | Role                               |
| ------------------------------------- | --------------------------------- | --------------------------------- | ---------------------------------- |
| `--bg`                                | `#0B1315`                         | `#EEF3F2`                         | window ground                      |
| `--panel` / `--panel-2` / `--panel-3` | `#10191C` / `#152225` / `#1B2B2F` | `#FFFFFF` / `#E9F0EF` / `#DDE7E5` | surfaces, ascending                |
| `--line` / `--line-2`                 | `#1F3034` / `#2A3E43`             | `#D3DDDB` / `#BFCDCA`             | hairlines, orbits                  |
| `--text` / `--muted` / `--faint`      | `#D9E4E2` / `#7E9295` / `#4E6064` | `#14201F` / `#5B6D6F` / `#93A3A5` | type                               |
| `--accent`                            | `#F0704F`                         | `#D85A3A`                         | the sun: main thread, spawn, edits |
| `--active`                            | `#38D1B0`                         | `#149C82`                         | something is happening             |
| `--wait`                              | `#F2B84B`                         | `#B37A12`                         | needs you                          |
| `--err`                               | `#EE5D6E`                         | `#C93F50`                         | failure                            |

Tool families share hues so a bar, a badge and a feed icon for the same tool always match: read = mint, search = blue, edit = coral, shell = amber, web = violet.

Agent types: Explore = mint, Plan = blue, general-purpose = coral, reviewer = violet; custom agents hash into the same four.

Contrast: body text ≥ 4.5:1 on every surface in both themes; muted text is reserved for secondary labels ≥ 12 px.

## Type

- **Bricolage Grotesque** — app name, section titles, inspector headline. Characterful, tight tracking (`-0.015em` at 19 px).
- **IBM Plex Sans** — UI text at 13 px / 1.45.
- **IBM Plex Mono** — everything that is data: paths, ids, durations, counters (`tabular-nums`).

Loaded from Google Fonts with system fallbacks; the app is legible with fallbacks alone.

## Layout

Three panes on a 12 px gutter: sessions (276 px) · constellation over timeline · inspector (320 px). Collapses to two, then one column. Density follows an 8 px scale (dashboard density). Touch targets ≥ 44 px on primary controls; keyboard focus has a two-ring outline.

## Motion

Principles borrowed from Apple's fluid-interface talks (see `.claude/skills/apple-design`):

- **Respond on pointer-down.** Session cards scale to 0.985 on press, not on release.
- **Critically damped by default.** Enter/exit use a 0.2/0.8/0.2/1 curve with no overshoot. Bounce is reserved for physical events: the spawn burst and the result particle flying home.
- **Ambient life is cheap and continuous.** Blink (4.2 s), bob (1.6 s), antenna glow (1.1 s) and edge dash run on the compositor via `transform`/`opacity`; no layout work.
- **Meaning first.** Every animation encodes state: a badge scanning = Grep, scribbling = Edit, blinking cursor = Bash, spinning globe = WebFetch, bouncing dots = thinking. A particle outward = the agent is working for main; inward = its result returned.
- **Reduced motion** replaces everything above with static state and short cross-fades. Reduced transparency makes the toast material solid. High contrast thickens panel borders.

## The bot

A 30×26 rounded head with an antenna. Expressions are CSS classes on the parent: `live` (eyes glance, antenna glows, bobbing), `done` (closed happy eyes, blush), `sleep` (flat eyes, floating `z`), `waiting` (wide eyes, amber `?` and a wobbling bell). The main thread's bot is 15% larger with coral trim.

## Copy

Labels name what people recognise: "main thread", "Result returned", "Waiting for your permission", never internal terms like `toolUseResult`. Empty states say what will happen next ("Start a Claude Code session … it will appear here within a second").
