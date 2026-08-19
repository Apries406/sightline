---
name: screenshot-sightline
description: 使用 Sightline CLI 在 macOS 上截图和录屏，支持按 app/window/rect/screen/display 定位目标并返回 JSON 证据。Use when 用户要求截图、截屏、录屏、捕获窗口或应用、查看界面视觉状态、获取 Chrome/Lynx/DevTool 截图或录屏，或需要 agent 可解析的视觉证据。
---

# Screenshot Sightline

默认使用 `sightline` 处理 macOS 截图和短录屏。它来自 `@apries/sightline`，面向 agent 工作流：先定位目标，再截图或录屏，并用 JSON 返回窗口身份、bounds 和输出路径。

PNG 的 app/window 截图，以及不带音频的 app/window 录屏，默认走原生 ScreenCaptureKit 后端，不要求目标 app 位于最上层。

## 快速开始

```bash
sightline --help
sightline doctor --json
sightline list windows --json
sightline locate --target 'app:Google Chrome' --json
sightline capture --target 'app:Google Chrome' -o /tmp/chrome.png --json
sightline capture --target 'app:Google Chrome' --backend screencapture -o /tmp/chrome-legacy.png --json
sightline record --target 'app:Google Chrome' --duration 5 -o /tmp/chrome.mov --json
```

## Target 语法

- `app:<name>[,title:<pattern>][,index:<n>]`
- `bundle:<bundle-id>[,title:<pattern>][,index:<n>]`
- `pid:<pid>[,title:<pattern>][,index:<n>]`
- `window:<window-id>`
- `rect:<x,y,w,h>`
- `screen:all`
- `screen:main`
- `display:<n>`
- `lynx:headless,url:<template-js-url>`

`title:` 支持 `*` 通配符。不带通配符时，按大小写不敏感的子串匹配。

## 标准流程

### 截取应用窗口

1. 先运行 `sightline locate --target 'app:<App Name>' --json`，确认匹配到的窗口。
2. 如果有多个窗口，用 `title:<pattern>` 或 `index:<n>` 收窄。
3. 运行 `sightline capture --target 'app:<App Name>' -o <path>.png --json`。
4. 向用户报告图片路径和 JSON 里的 `window.bounds`。

### 录制目标

1. 录 app/window 前先运行 `sightline locate --target '<target>' --json`，确认目标窗口。
2. 运行 `sightline record --target '<target>' --duration <seconds> -o <path>.mov --json`。
3. 需要麦克风时加 `--audio`；需要点击高亮时加 `--clicks`。
4. 向用户报告 `recording.path`、`recording.bytes` 和匹配到的 `window.bounds`。

### Chrome 示例

```bash
sightline capture --target 'app:Google Chrome' -o /tmp/chrome.png --json
sightline capture --target 'bundle:com.google.Chrome,title:*DevTools*' -o /tmp/devtools.png --json
sightline record --target 'app:Google Chrome' --duration 5 -o /tmp/chrome.mov --json
```

### Lynx / DevTool 示例

```bash
sightline locate --target 'bundle:com.lynx.Desktop.LynxDesktop' --json
sightline capture --target 'bundle:com.lynx.Desktop.LynxDesktop' -o /tmp/lynxdesktop.png --json
sightline capture --target 'app:HybridDevtool' -o /tmp/hybriddevtool.png --json
sightline record --target 'app:HybridDevtool' --duration 5 -o /tmp/hybriddevtool.mov --json
```

Lynx headless bundle 截图优先使用：

```bash
sightline capture --target 'lynx:headless,url:http://127.0.0.1:3000/template.js' -o /tmp/lynx.png --json
```

## 注意事项

- `sightline doctor --json` 会检查 helper 构建状态、Screen Recording 权限信号、Accessibility 信任状态和 `screencapture` 可用性。
- 窗口枚举、截图和录屏需要当前终端 app 具备 macOS Screen Recording 权限。
- 只有明确需要旧版 macOS `screencapture` 行为时才加 `--backend screencapture`。默认 native 后端适用于 PNG app/window 截图和无音频 app/window 录屏；非 PNG 窗口截图、带音频录屏、点击高亮录屏、rect/screen/display 录屏会走 `screencapture`。
- 录屏必须优先带 `--duration`，避免命令等待人工停止。
- 如果普通 shell 可用但受限 sandbox 不可用，切到非 sandbox 环境重试，或向用户说明权限边界。
- agent 工作流优先加 `--json`，便于解析 `window.id`、`window.bounds`、`image.path`、`image.width`、`image.height`、`recording.path`。
