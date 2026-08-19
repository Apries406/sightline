#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { captureLynxHeadless } from "./backends/lynxHeadless";
import {
  captureWindowNative,
  listDisplays,
  listWindows,
  permissions,
  recordWindowNative,
  type CaptureResult,
  type RecordResult,
  type WindowInfo,
} from "./backends/macosHelper";
import { captureScreen, recordScreen } from "./backends/screencapture";
import { CliError, assertValue } from "./lib/errors";
import { readPngInfo } from "./lib/imageInfo";
import { printJson } from "./lib/json";
import { defaultOutputPath, helperPath } from "./lib/paths";
import { parseTarget, resolveWindowTarget, type Target } from "./lib/target";

const VERSION = "0.4.0";

interface ParsedArgs {
  command?: string;
  rest: string[];
  flags: Map<string, string | boolean>;
}

function usage(): string {
  return `Sightline ${VERSION}

Agent-first macOS screenshot CLI.

Usage:
  sightline list displays [--json]
  sightline list windows [--json]
  sightline locate --target <target> [--json]
  sightline capture --target <target> [options]
  sightline record --target <target> [options]
  sightline doctor [--json]

Targets:
  app:<name>[,title:<pattern>][,index:<n>]
  bundle:<bundle-id>[,title:<pattern>][,index:<n>]
  pid:<pid>[,title:<pattern>][,index:<n>]
  window:<window-id>
  rect:<x,y,w,h>
  screen:all
  screen:main
  display:<n>
  lynx:headless,url:<template-js-url>

Capture options:
  -o, --output <file>       Output image path.
  -f, --format <format>     png, jpg, tiff. Default: png
  --backend <backend>       native or screencapture for PNG window captures. Default: native
  --delay <seconds>         Delay for screen/display captures.
  --cursor                  Include cursor for screen/display captures.
  --also-clipboard          Also copy saved image to clipboard.
  --json                    Print structured JSON.

Record options:
  -o, --output <file>       Output movie path. Default: ~/Movies/Sightline/*.mov
  --backend <backend>       native or screencapture for app/window recordings. Default: native
  --duration <seconds>      Stop automatically after N seconds.
  --audio                   Record default microphone input.
  --audio-device <id>       Record a specific audio device id.
  --clicks                  Show clicks in the recording.
  --json                    Print structured JSON.

Examples:
  sightline capture --target 'app:Google Chrome' --json
  sightline capture --target 'bundle:com.google.Chrome,title:*DevTools*'
  sightline record --target 'app:Google Chrome' --duration 5 --json
  sightline record --target 'rect:100,100,800,500' -o /tmp/demo.mov --json
  sightline locate --target 'app:Lynx'
  sightline capture --target 'rect:100,100,800,500' -o /tmp/area.png
  sightline capture --target 'lynx:headless,url:http://127.0.0.1:3000/template.js'
`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rawRest] = argv;
  const flags = new Map<string, string | boolean>();
  const rest: string[] = [];
  for (let i = 0; i < rawRest.length; i += 1) {
    const arg = rawRest[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const key = arg.slice(2);
      const next = rawRest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (arg === "-o" || arg === "-f") {
        const key = arg === "-o" ? "output" : "format";
        const next = rawRest[i + 1];
        if (next === undefined) throw new CliError(`${arg} requires a value`);
        flags.set(key, next);
        i += 1;
        continue;
      }
      throw new CliError(`unknown short flag: ${arg}`);
    }
    rest.push(arg);
  }
  return { command, rest, flags };
}

function flagString(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  if (value === undefined || value === true || value === false) return undefined;
  return value;
}

function flagBool(flags: Map<string, string | boolean>, key: string): boolean {
  return flags.get(key) === true;
}

function targetFromFlags(flags: Map<string, string | boolean>): Target {
  return parseTarget(assertValue(flagString(flags, "target"), "--target is required"));
}

function outputPath(flags: Map<string, string | boolean>, format: string): string {
  return resolve(flagString(flags, "output") ?? defaultOutputPath(format));
}

function defaultRecordPath(): string {
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return resolve(process.env.HOME ?? ".", "Movies/Sightline", `recording-${stamp}.mov`);
}

function recordOutputPath(flags: Map<string, string | boolean>): string {
  return resolve(flagString(flags, "output") ?? defaultRecordPath());
}

function inferFormat(flags: Map<string, string | boolean>): string {
  const explicit = flagString(flags, "format");
  if (explicit) return explicit;
  const output = flagString(flags, "output");
  if (!output) return "png";
  const ext = extname(output).replace(".", "").toLowerCase();
  return ext || "png";
}

function maybeCopyToClipboard(path: string, enabled: boolean): void {
  if (!enabled) return;
  const kind = /\.(jpe?g)$/i.test(path) ? "JPEG picture" : "«class PNGf»";
  const escapedPath = path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const proc = Bun.spawnSync(["osascript", "-e", `set the clipboard to (read (POSIX file "${escapedPath}") as ${kind})`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new CliError(`failed to copy image to clipboard: ${proc.stderr.toString().trim()}`);
  }
}

function describeWindow(window: WindowInfo): Record<string, unknown> {
  return {
    id: window.id,
    app: window.ownerName,
    bundleId: window.bundleId,
    pid: window.pid,
    title: window.title,
    bounds: window.bounds,
    layer: window.layer,
  };
}

function handleList(rest: string[], json: boolean): void {
  const subject = rest[0];
  if (subject === "displays") {
    const displays = listDisplays();
    if (json) return printJson({ ok: true, displays });
    for (const display of displays) {
      process.stdout.write(
        `${display.main ? "*" : " "} display:${display.id} ${display.bounds.width}x${display.bounds.height}+${display.bounds.x}+${display.bounds.y} scale=${display.scale}\n`,
      );
    }
    return;
  }
  if (subject === "windows") {
    const windows = listWindows();
    if (json) return printJson({ ok: true, windows });
    for (const window of windows) {
      process.stdout.write(
        `window:${window.id} app="${window.ownerName}" title="${window.title}" pid=${window.pid} bounds=${window.bounds.x},${window.bounds.y},${window.bounds.width},${window.bounds.height}\n`,
      );
    }
    return;
  }
  throw new CliError("list requires subject: displays or windows");
}

function handleLocate(flags: Map<string, string | boolean>, json: boolean): void {
  const target = targetFromFlags(flags);
  if (target.kind === "rect") {
    const payload = { ok: true, target, backend: "macos-rect", rect: target.rect };
    if (json) printJson(payload);
    else process.stdout.write(`${target.rect}\n`);
    return;
  }
  if (target.kind === "screen" || target.kind === "display" || target.kind === "lynx-headless") {
    const payload = { ok: true, target, backend: target.kind };
    if (json) printJson(payload);
    else process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const window = resolveWindowTarget(target, listWindows());
  const payload = { ok: true, target, backend: "macos-window", window: describeWindow(window) };
  if (json) printJson(payload);
  else process.stdout.write(`window:${window.id} ${window.ownerName} ${window.bounds.x},${window.bounds.y},${window.bounds.width},${window.bounds.height}\n`);
}

function statImage(path: string): { path: string; bytes: number; width?: number; height?: number } {
  return { path, bytes: statSync(path).size, ...readPngInfo(path) };
}

function statFile(path: string): { path: string; bytes: number } {
  return { path, bytes: statSync(path).size };
}

function handleCapture(flags: Map<string, string | boolean>, json: boolean): void {
  const target = targetFromFlags(flags);
  const format = inferFormat(flags);
  const output = outputPath(flags, format);
  const delayText = flagString(flags, "delay");
  const delay = delayText === undefined ? undefined : Number(delayText);
  if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
    throw new CliError("--delay must be a non-negative number");
  }

  mkdirSync(dirname(output), { recursive: true });

  let capture: CaptureResult | undefined;
  let backend = "";
  let windowPayload: Record<string, unknown> | undefined;
  let extra: Record<string, unknown> = {};
  const requestedBackend = flagString(flags, "backend") ?? "native";
  if (requestedBackend !== "native" && requestedBackend !== "screencapture") {
    throw new CliError("--backend must be native or screencapture");
  }

  if (target.kind === "rect") {
    backend = "macos-rect";
    captureScreen({ target: { rect: target.rect }, output, format });
    capture = { ok: true, path: output, width: 0, height: 0 };
  } else if (target.kind === "screen") {
    backend = "macos-screencapture";
    captureScreen({
      target: target.screen,
      output,
      format,
      delay,
      cursor: flagBool(flags, "cursor"),
    });
    capture = { ok: true, path: output, width: 0, height: 0 };
  } else if (target.kind === "display") {
    backend = "macos-screencapture";
    captureScreen({
      target: { display: target.display },
      output,
      format,
      delay,
      cursor: flagBool(flags, "cursor"),
    });
    capture = { ok: true, path: output, width: 0, height: 0 };
  } else if (target.kind === "lynx-headless") {
    backend = "lynx-headless";
    const lynx = captureLynxHeadless(target.url, output);
    extra = { lynx: lynx.raw };
    capture = { ok: true, path: lynx.path, width: 0, height: 0 };
  } else {
    const window = resolveWindowTarget(target, listWindows());
    windowPayload = describeWindow(window);
    if (requestedBackend === "screencapture" || format !== "png") {
      backend = "macos-window-screencapture";
      captureScreen({ target: { windowId: window.id }, output, format });
      capture = { ok: true, path: output, width: 0, height: 0 };
    } else {
      backend = "macos-window-native";
      try {
        capture = captureWindowNative(window.id, output);
      } catch (error) {
        backend = "macos-window-screencapture";
        extra = {
          ...extra,
          nativeFallback: {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        };
        captureScreen({ target: { windowId: window.id }, output, format });
        capture = { ok: true, path: output, width: 0, height: 0 };
      }
    }
  }

  if (flagBool(flags, "also-clipboard")) {
    maybeCopyToClipboard(output, true);
  }

  const payload = {
    ok: true,
    target,
    backend,
    window: windowPayload,
    image: { ...capture, ...statImage(output) },
    ...extra,
  };
  if (json) printJson(payload);
  else process.stdout.write(`${output}\n`);
}

function handleRecord(flags: Map<string, string | boolean>, json: boolean): void {
  const target = targetFromFlags(flags);
  if (target.kind === "lynx-headless") {
    throw new CliError("record does not support lynx:headless; use capture for headless screenshots");
  }

  const output = recordOutputPath(flags);
  const durationText = flagString(flags, "duration");
  const duration = durationText === undefined ? undefined : Number(durationText);
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    throw new CliError("--duration must be a positive number");
  }
  if (duration === undefined) {
    throw new CliError("--duration is required for record so the command can finish without manual intervention");
  }

  const requestedBackend = flagString(flags, "backend") ?? "native";
  if (requestedBackend !== "native" && requestedBackend !== "screencapture") {
    throw new CliError("--backend must be native or screencapture");
  }

  mkdirSync(dirname(output), { recursive: true });

  let backend = "macos-record";
  let windowPayload: Record<string, unknown> | undefined;
  let recordTarget: "all" | "main" | { display: number } | { rect: string };
  let nativeRecord: RecordResult | undefined;
  const needsLegacyRecording = flagBool(flags, "audio") || flagString(flags, "audio-device") !== undefined || flagBool(flags, "clicks");

  if (target.kind === "rect") {
    recordTarget = { rect: target.rect };
  } else if (target.kind === "screen") {
    recordTarget = target.screen;
  } else if (target.kind === "display") {
    recordTarget = { display: target.display };
  } else {
    const window = resolveWindowTarget(target, listWindows());
    windowPayload = describeWindow(window);
    if (requestedBackend === "native" && !needsLegacyRecording) {
      backend = "macos-window-native-record";
      nativeRecord = recordWindowNative(window.id, duration, output);
      recordTarget = "all";
    } else {
      const { x, y, width, height } = window.bounds;
      recordTarget = { rect: `${x},${y},${width},${height}` };
      backend = "macos-window-record";
    }
  }

  if (!nativeRecord) {
    recordScreen({
      target: recordTarget,
      output,
      duration,
      audio: flagBool(flags, "audio"),
      audioDeviceId: flagString(flags, "audio-device"),
      clicks: flagBool(flags, "clicks"),
    });
  }

  const payload = {
    ok: true,
    target,
    backend,
    window: windowPayload,
    recording: {
      ok: true,
      ...nativeRecord,
      ...statFile(output),
      duration,
      audio: flagBool(flags, "audio") || flagString(flags, "audio-device") !== undefined,
      clicks: flagBool(flags, "clicks"),
    },
  };
  if (json) printJson(payload);
  else process.stdout.write(`${output}\n`);
}

function handleDoctor(json: boolean): void {
  const status = permissions();
  const checks = {
    helperBuilt: existsSync(helperPath),
    helperPath,
    screenRecordingLikelyGranted: status.screenRecordingLikelyGranted,
    accessibilityTrusted: status.accessibilityTrusted,
    screencaptureAvailable: existsSync("/usr/sbin/screencapture"),
  };
  if (json) {
    printJson({ ok: true, checks });
    return;
  }
  for (const [key, value] of Object.entries(checks)) {
    process.stdout.write(`${key}: ${value}\n`);
  }
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    process.stdout.write(usage());
    return;
  }
  const parsed = parseArgs(argv);
  const json = flagBool(parsed.flags, "json");

  if (!parsed.command || flagBool(parsed.flags, "help")) {
    process.stdout.write(usage());
    return;
  }
  if (parsed.command === "--version" || parsed.command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  switch (parsed.command) {
    case "list":
      handleList(parsed.rest, json);
      return;
    case "locate":
      handleLocate(parsed.flags, json);
      return;
    case "capture":
      handleCapture(parsed.flags, json);
      return;
    case "record":
      handleRecord(parsed.flags, json);
      return;
    case "doctor":
      handleDoctor(json);
      return;
    default:
      throw new CliError(`unknown command: ${parsed.command}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.code);
  }
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
