# Sightline

Agent-first macOS screenshot CLI built with Bun + TypeScript.

The goal is not a manual Snipaste clone. The product is a visual acquisition tool for agents: locate a target, report its geometry, capture it, and return machine-readable evidence.

## Install

```bash
npm install -g @apries/sightline --registry https://registry.npmjs.org/
sightline --help
```

## Agent Skill

The npm package includes an agent skill at:

```text
skills/screenshot-sightline/SKILL.md
```

Copy that folder into your agent's skill directory, for example `~/.agents/skills/` or `~/.claude/skills/`, to make agents use `sightline` by default for screenshots and short screen recordings.

## Features

- Locate visible macOS windows by app name, bundle id, pid, title pattern, window id, or index.
- Capture Chrome or other desktop apps without manual selection.
- Capture app/window targets through a native ScreenCaptureKit backend by default, so PNG window screenshots do not require the app to be topmost.
- Record screen, display, rectangle, or app/window targets to `.mov`. App/window recordings use a native ScreenCaptureKit backend by default when no audio/click overlay is requested.
- Capture fixed rectangles, full screen, main screen, and specific displays.
- Return structured JSON containing target, backend, window id, bounds, output path, and image metadata.
- Provide a Lynx headless backend entrypoint for `template.js` screenshots through the existing Lynx DevTool smoke script.
- Provide `doctor` checks for helper availability, Screen Recording likelihood, Accessibility trust, and `screencapture`.

## Examples

```bash
bun run build
bin/sightline list windows --json
bin/sightline locate --target 'app:Google Chrome' --json
bin/sightline capture --target 'app:Google Chrome' --json
bin/sightline capture --target 'app:Google Chrome' --backend screencapture --json
bin/sightline capture --target 'bundle:com.google.Chrome,title:*DevTools*' -o /tmp/devtools.png --json
bin/sightline capture --target 'rect:100,100,800,500' -o /tmp/area.png
bin/sightline capture --target 'screen:main' --delay 1
bin/sightline record --target 'app:Google Chrome' --duration 5 -o /tmp/chrome.mov --json
bin/sightline record --target 'app:Google Chrome' --backend screencapture --duration 5 -o /tmp/chrome-bounds.mov --json
bin/sightline record --target 'rect:100,100,800,500' --duration 3 -o /tmp/area.mov --json
bin/sightline capture --target 'lynx:headless,url:http://127.0.0.1:3000/template.js' --json
```

## Target Syntax

- `app:<name>[,title:<pattern>][,index:<n>]`
- `bundle:<bundle-id>[,title:<pattern>][,index:<n>]`
- `pid:<pid>[,title:<pattern>][,index:<n>]`
- `window:<window-id>`
- `rect:<x,y,w,h>`
- `screen:all`
- `screen:main`
- `display:<n>`
- `lynx:headless,url:<template-js-url>`

Title patterns support `*` wildcards. Without a wildcard, matching is case-insensitive substring matching.

## Architecture

- TypeScript CLI parses commands, target DSL, output options, and JSON protocol.
- Swift helper uses CoreGraphics/AppKit to list displays, list windows, inspect permission signals, and run native ScreenCaptureKit app/window capture and recording.
- `/usr/sbin/screencapture` remains the fallback and general-purpose backend for rectangle, full-screen, display, audio, and click-overlay recordings because macOS already handles those paths well.
- Lynx headless capture delegates to `/Users/bytedance/.agents/skills/lynx-devtool/scripts/headless-smoke.mjs` when available.

## Permissions

Window listing and window/rect capture require macOS Screen Recording permission for the terminal app running this CLI. `doctor --json` reports whether permission appears to be available, but macOS does not expose a perfect non-interactive permission probe.
