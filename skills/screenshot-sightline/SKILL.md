---
name: screenshot-sightline
description: Capture screenshots and screen recordings on macOS with the Sightline CLI, including target-based window discovery and JSON evidence. Use when the user asks to screenshot, record screen, capture screen/window/app, inspect visual state, get Chrome/Lynx/DevTool screenshots or recordings, or needs agent-readable visual evidence.
---

# Screenshot Sightline

Use `sightline` as the default CLI for macOS screenshots and short screen recordings. It is installed globally from `@apries/sightline` and is designed for agents: locate a target, capture or record it, and return JSON with window identity, bounds, and output path. PNG app/window screenshots and no-audio app/window recordings default to the native ScreenCaptureKit backend, which does not require the target app to be topmost.

## Quick Start

```bash
sightline --help
sightline doctor --json
sightline list windows --json
sightline locate --target 'app:Google Chrome' --json
sightline capture --target 'app:Google Chrome' -o /tmp/chrome.png --json
sightline capture --target 'app:Google Chrome' --backend screencapture -o /tmp/chrome-legacy.png --json
sightline record --target 'app:Google Chrome' --duration 5 -o /tmp/chrome.mov --json
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

## Standard Workflows

### Capture An App

1. Run `sightline locate --target 'app:<App Name>' --json` to confirm the matched window.
2. If multiple windows exist, use `title:<pattern>` or `index:<n>`.
3. Run `sightline capture --target 'app:<App Name>' -o <path>.png --json`.
4. Report the image path and the JSON window bounds to the user.

### Record A Target

1. Run `sightline locate --target '<target>' --json` when targeting an app/window to confirm the matched bounds.
2. Run `sightline record --target '<target>' --duration <seconds> -o <path>.mov --json`.
3. Use `--audio` for default microphone input and `--clicks` to show clicks when needed.
4. Report `recording.path`, `recording.bytes`, and any matched `window.bounds`.

### Capture Chrome

```bash
sightline capture --target 'app:Google Chrome' -o /tmp/chrome.png --json
sightline capture --target 'bundle:com.google.Chrome,title:*DevTools*' -o /tmp/devtools.png --json
sightline record --target 'app:Google Chrome' --duration 5 -o /tmp/chrome.mov --json
```

### Capture Lynx / DevTool Windows

```bash
sightline locate --target 'bundle:com.lynx.Desktop.LynxDesktop' --json
sightline capture --target 'bundle:com.lynx.Desktop.LynxDesktop' -o /tmp/lynxdesktop.png --json
sightline capture --target 'app:HybridDevtool' -o /tmp/hybriddevtool.png --json
sightline record --target 'app:HybridDevtool' --duration 5 -o /tmp/hybriddevtool.mov --json
```

For Lynx headless bundle screenshots, prefer:

```bash
sightline capture --target 'lynx:headless,url:http://127.0.0.1:3000/template.js' -o /tmp/lynx.png --json
```

## Notes

- `sightline doctor --json` checks helper build status, Screen Recording likelihood, Accessibility trust, and `screencapture` availability.
- Window listing and capture require macOS Screen Recording permission for the terminal app.
- Use `--backend screencapture` only when you explicitly need the legacy macOS `screencapture` behavior. The default native backend currently applies to PNG app/window captures and no-audio app/window recordings; non-PNG window captures, audio recordings, click-overlay recordings, rect recordings, screen recordings, and display recordings use `screencapture`.
- Prefer `--duration` for all recordings so commands finish without manual intervention.
- If the command works in a normal shell but not inside a restricted sandbox, rerun outside the sandbox or report the permission boundary.
- Prefer `--json` for agent workflows so downstream steps can parse `window.id`, `window.bounds`, `image.path`, `image.width`, and `image.height`.
