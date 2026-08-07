#!/usr/bin/env bun
// @bun

// src/cli.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, statSync } from "fs";
import { dirname as dirname3, extname, resolve as resolve2 } from "path";

// src/backends/lynxHeadless.ts
import { existsSync } from "fs";
import { spawnSync } from "child_process";

// src/lib/errors.ts
class CliError extends Error {
  code;
  constructor(message, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}
function assertValue(value, message) {
  if (value === undefined || value === null || value === "") {
    throw new CliError(message);
  }
  return value;
}

// src/backends/lynxHeadless.ts
var smokeScript = "/Users/bytedance/.agents/skills/lynx-devtool/scripts/headless-smoke.mjs";
function captureLynxHeadless(url, output) {
  if (!existsSync(smokeScript)) {
    throw new CliError(`lynx headless smoke script not found: ${smokeScript}`);
  }
  const result = spawnSync("node", [smokeScript, "--url", url, "--out", output], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000
  });
  if (result.error) {
    throw new CliError(`failed to run lynx headless capture: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new CliError(result.stderr.trim() || result.stdout.trim() || `lynx capture exited ${result.status}`);
  }
  let raw = result.stdout.trim();
  try {
    raw = JSON.parse(result.stdout);
  } catch {}
  return { backend: "lynx-headless", url, path: output, raw };
}

// src/backends/macosHelper.ts
import { existsSync as existsSync2 } from "fs";
import { spawnSync as spawnSync2 } from "child_process";

// src/lib/paths.ts
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
var thisFile = fileURLToPath(import.meta.url);
var projectRoot = process.env.SIGHTLINE_ROOT ? resolve(process.env.SIGHTLINE_ROOT) : process.env.MSHOT_AGENT_ROOT ? resolve(process.env.MSHOT_AGENT_ROOT) : resolve(dirname(thisFile), "../..");
var helperPath = join(projectRoot, "native/macos-helper/.build/mshot-macos-helper");
function defaultOutputPath(format) {
  const stamp = new Date().toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  return join(process.env.HOME ?? ".", "Pictures/Screenshots", `sightline-${stamp}.${format}`);
}

// src/backends/macosHelper.ts
function ensureHelper() {
  if (!existsSync2(helperPath)) {
    throw new CliError(`macOS helper is not built. Run: bun run build:helper
missing: ${helperPath}`);
  }
}
function runHelper(args) {
  ensureHelper();
  const result = spawnSync2(helperPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    throw new CliError(`failed to run helper: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = result.stderr.trim() || result.stdout.trim() || `helper exited ${result.status}`;
    throw new CliError(err);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new CliError(`helper returned invalid JSON: ${result.stdout}`);
  }
}
function listDisplays() {
  return runHelper(["list-displays"]);
}
function listWindows() {
  return runHelper(["list-windows"]);
}
function permissions() {
  return runHelper(["permissions"]);
}

// src/backends/screencapture.ts
import { spawnSync as spawnSync3 } from "child_process";
import { mkdirSync } from "fs";
import { dirname as dirname2 } from "path";
function captureScreen(options) {
  mkdirSync(dirname2(options.output), { recursive: true });
  const args = ["-t", options.format];
  if (options.quiet !== false)
    args.push("-x");
  if (options.cursor)
    args.push("-C");
  if (options.delay !== undefined)
    args.push("-T", String(options.delay));
  if (options.target === "main")
    args.push("-m");
  if (typeof options.target === "object" && "display" in options.target)
    args.push(`-D${options.target.display}`);
  if (typeof options.target === "object" && "rect" in options.target)
    args.push(`-R${options.target.rect}`);
  if (typeof options.target === "object" && "windowId" in options.target)
    args.push(`-l${options.target.windowId}`);
  if (options.clipboard)
    args.push("-c");
  args.push(options.output);
  const result = spawnSync3("/usr/sbin/screencapture", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    throw new CliError(`failed to run screencapture: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new CliError(result.stderr.trim() || `screencapture exited ${result.status}`);
  }
}

// src/lib/imageInfo.ts
import { readFileSync } from "fs";
function readPngInfo(path) {
  const buf = readFileSync(path);
  if (buf.length >= 24 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20)
    };
  }
  return {};
}

// src/lib/json.ts
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
}

// src/lib/target.ts
function splitSpec(spec) {
  if (spec.startsWith("rect:")) {
    return { head: spec, params: new Map };
  }
  if (spec.startsWith("lynx:headless,")) {
    return splitLynxSpec(spec);
  }
  const parts = spec.split(",").map((part) => part.trim()).filter(Boolean);
  const head = parts.shift();
  if (!head)
    throw new CliError("empty target");
  const params = new Map;
  for (const part of parts) {
    const index = part.indexOf(":");
    if (index === -1)
      throw new CliError(`invalid target parameter: ${part}`);
    params.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return { head, params };
}
function splitLynxSpec(spec) {
  const prefix = "lynx:headless,";
  const params = new Map;
  let rest = spec.slice(prefix.length);
  while (rest.length > 0) {
    const nextUrl = rest.startsWith("url:") ? "url" : undefined;
    const nextOut = rest.startsWith("out:") ? "out" : undefined;
    const key = nextUrl ?? nextOut;
    if (!key)
      throw new CliError(`invalid lynx target parameter near: ${rest}`);
    rest = rest.slice(key.length + 1);
    const nextKey = rest.search(/,(url|out):/);
    if (nextKey === -1) {
      params.set(key, rest);
      rest = "";
    } else {
      params.set(key, rest.slice(0, nextKey));
      rest = rest.slice(nextKey + 1);
    }
  }
  return { head: "lynx:headless", params };
}
function parseTarget(spec) {
  const { head, params } = splitSpec(spec);
  const colon = head.indexOf(":");
  if (colon === -1) {
    throw new CliError(`target must use kind:value syntax: ${spec}`);
  }
  const kind = head.slice(0, colon);
  const value = head.slice(colon + 1);
  const title = params.get("title");
  const indexText = params.get("index");
  const index = indexText === undefined ? undefined : Number(indexText);
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    throw new CliError("target index must be a non-negative integer");
  }
  switch (kind) {
    case "app":
      if (!value)
        throw new CliError("app target requires a name");
      return { kind, app: value, title, index };
    case "bundle":
      if (!value)
        throw new CliError("bundle target requires a bundle id");
      return { kind, bundleId: value, title, index };
    case "pid": {
      const pid = Number(value);
      if (!Number.isInteger(pid) || pid <= 0)
        throw new CliError("pid target requires a positive integer");
      return { kind, pid, title, index };
    }
    case "window": {
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0)
        throw new CliError("window target requires a positive integer");
      return { kind, id };
    }
    case "rect":
      if (!/^-?\d+,-?\d+,\d+,\d+$/.test(value))
        throw new CliError("rect target must be rect:x,y,w,h");
      return { kind, rect: value };
    case "screen":
      if (value !== "all" && value !== "main")
        throw new CliError("screen target must be screen:all or screen:main");
      return { kind, screen: value };
    case "display": {
      const display = Number(value);
      if (!Number.isInteger(display) || display <= 0)
        throw new CliError("display target requires a positive integer");
      return { kind, display };
    }
    case "lynx":
      if (value === "headless") {
        const url = params.get("url");
        if (!url)
          throw new CliError("lynx:headless requires url:<bundle-url>");
        return { kind: "lynx-headless", url, out: params.get("out") };
      }
      throw new CliError(`unsupported lynx target: ${value}`);
    default:
      throw new CliError(`unsupported target kind: ${kind}`);
  }
}
function normalize(value) {
  return value.trim().toLowerCase();
}
function wildcardMatch(pattern, value) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}
function textMatches(pattern, value) {
  if (pattern.includes("*"))
    return wildcardMatch(pattern, value);
  return normalize(value).includes(normalize(pattern));
}
function resolveWindowTarget(target, windows) {
  if (target.kind === "window") {
    const found = windows.find((window) => window.id === target.id);
    if (!found)
      throw new CliError(`window not found: ${target.id}`);
    return found;
  }
  if (target.kind !== "app" && target.kind !== "bundle" && target.kind !== "pid") {
    throw new CliError(`target is not a window target: ${target.kind}`);
  }
  const candidates = windows.filter((window) => window.layer === 0).filter((window) => window.alpha > 0).filter((window) => {
    if (target.kind === "app")
      return textMatches(target.app, window.ownerName);
    if (target.kind === "bundle")
      return window.bundleId === target.bundleId;
    return window.pid === target.pid;
  }).filter((window) => {
    if (!target.title)
      return true;
    return textMatches(target.title, window.title);
  }).sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  if (candidates.length === 0) {
    throw new CliError(`no visible window matched target`);
  }
  return candidates[target.index ?? 0] ?? (() => {
    throw new CliError(`target index out of range; matched ${candidates.length} windows`);
  })();
}

// src/cli.ts
var VERSION = "0.1.0";
function usage() {
  return `Sightline ${VERSION}

Agent-first macOS screenshot CLI.

Usage:
  sightline list displays [--json]
  sightline list windows [--json]
  sightline locate --target <target> [--json]
  sightline capture --target <target> [options]
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
  --delay <seconds>         Delay for screen/display captures.
  --cursor                  Include cursor for screen/display captures.
  --also-clipboard          Also copy saved image to clipboard.
  --json                    Print structured JSON.

Examples:
  sightline capture --target 'app:Google Chrome' --json
  sightline capture --target 'bundle:com.google.Chrome,title:*DevTools*'
  sightline locate --target 'app:Lynx'
  sightline capture --target 'rect:100,100,800,500' -o /tmp/area.png
  sightline capture --target 'lynx:headless,url:http://127.0.0.1:3000/template.js'
`;
}
function parseArgs(argv) {
  const [command, ...rawRest] = argv;
  const flags = new Map;
  const rest = [];
  for (let i = 0;i < rawRest.length; i += 1) {
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
        if (next === undefined)
          throw new CliError(`${arg} requires a value`);
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
function flagString(flags, key) {
  const value = flags.get(key);
  if (value === undefined || value === true || value === false)
    return;
  return value;
}
function flagBool(flags, key) {
  return flags.get(key) === true;
}
function targetFromFlags(flags) {
  return parseTarget(assertValue(flagString(flags, "target"), "--target is required"));
}
function outputPath(flags, format) {
  return resolve2(flagString(flags, "output") ?? defaultOutputPath(format));
}
function inferFormat(flags) {
  const explicit = flagString(flags, "format");
  if (explicit)
    return explicit;
  const output = flagString(flags, "output");
  if (!output)
    return "png";
  const ext = extname(output).replace(".", "").toLowerCase();
  return ext || "png";
}
function maybeCopyToClipboard(path, enabled) {
  if (!enabled)
    return;
  const kind = /\.(jpe?g)$/i.test(path) ? "JPEG picture" : "\xABclass PNGf\xBB";
  const escapedPath = path.replaceAll("\\", "\\\\").replaceAll('"', "\\\"");
  const proc = Bun.spawnSync(["osascript", "-e", `set the clipboard to (read (POSIX file "${escapedPath}") as ${kind})`], {
    stdout: "pipe",
    stderr: "pipe"
  });
  if (proc.exitCode !== 0) {
    throw new CliError(`failed to copy image to clipboard: ${proc.stderr.toString().trim()}`);
  }
}
function describeWindow(window) {
  return {
    id: window.id,
    app: window.ownerName,
    bundleId: window.bundleId,
    pid: window.pid,
    title: window.title,
    bounds: window.bounds,
    layer: window.layer
  };
}
function handleList(rest, json) {
  const subject = rest[0];
  if (subject === "displays") {
    const displays = listDisplays();
    if (json)
      return printJson({ ok: true, displays });
    for (const display of displays) {
      process.stdout.write(`${display.main ? "*" : " "} display:${display.id} ${display.bounds.width}x${display.bounds.height}+${display.bounds.x}+${display.bounds.y} scale=${display.scale}
`);
    }
    return;
  }
  if (subject === "windows") {
    const windows = listWindows();
    if (json)
      return printJson({ ok: true, windows });
    for (const window of windows) {
      process.stdout.write(`window:${window.id} app="${window.ownerName}" title="${window.title}" pid=${window.pid} bounds=${window.bounds.x},${window.bounds.y},${window.bounds.width},${window.bounds.height}
`);
    }
    return;
  }
  throw new CliError("list requires subject: displays or windows");
}
function handleLocate(flags, json) {
  const target = targetFromFlags(flags);
  if (target.kind === "rect") {
    const payload2 = { ok: true, target, backend: "macos-rect", rect: target.rect };
    if (json)
      printJson(payload2);
    else
      process.stdout.write(`${target.rect}
`);
    return;
  }
  if (target.kind === "screen" || target.kind === "display" || target.kind === "lynx-headless") {
    const payload2 = { ok: true, target, backend: target.kind };
    if (json)
      printJson(payload2);
    else
      process.stdout.write(`${JSON.stringify(payload2)}
`);
    return;
  }
  const window = resolveWindowTarget(target, listWindows());
  const payload = { ok: true, target, backend: "macos-window", window: describeWindow(window) };
  if (json)
    printJson(payload);
  else
    process.stdout.write(`window:${window.id} ${window.ownerName} ${window.bounds.x},${window.bounds.y},${window.bounds.width},${window.bounds.height}
`);
}
function statImage(path) {
  return { path, bytes: statSync(path).size, ...readPngInfo(path) };
}
function handleCapture(flags, json) {
  const target = targetFromFlags(flags);
  const format = inferFormat(flags);
  const output = outputPath(flags, format);
  const delayText = flagString(flags, "delay");
  const delay = delayText === undefined ? undefined : Number(delayText);
  if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
    throw new CliError("--delay must be a non-negative number");
  }
  mkdirSync2(dirname3(output), { recursive: true });
  let capture;
  let backend = "";
  let windowPayload;
  let extra = {};
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
      cursor: flagBool(flags, "cursor")
    });
    capture = { ok: true, path: output, width: 0, height: 0 };
  } else if (target.kind === "display") {
    backend = "macos-screencapture";
    captureScreen({
      target: { display: target.display },
      output,
      format,
      delay,
      cursor: flagBool(flags, "cursor")
    });
    capture = { ok: true, path: output, width: 0, height: 0 };
  } else if (target.kind === "lynx-headless") {
    backend = "lynx-headless";
    const lynx = captureLynxHeadless(target.url, output);
    extra = { lynx: lynx.raw };
    capture = { ok: true, path: lynx.path, width: 0, height: 0 };
  } else {
    backend = "macos-window";
    const window = resolveWindowTarget(target, listWindows());
    windowPayload = describeWindow(window);
    captureScreen({ target: { windowId: window.id }, output, format });
    capture = { ok: true, path: output, width: 0, height: 0 };
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
    ...extra
  };
  if (json)
    printJson(payload);
  else
    process.stdout.write(`${output}
`);
}
function handleDoctor(json) {
  const status = permissions();
  const checks = {
    helperBuilt: existsSync3(helperPath),
    helperPath,
    screenRecordingLikelyGranted: status.screenRecordingLikelyGranted,
    accessibilityTrusted: status.accessibilityTrusted,
    screencaptureAvailable: existsSync3("/usr/sbin/screencapture")
  };
  if (json) {
    printJson({ ok: true, checks });
    return;
  }
  for (const [key, value] of Object.entries(checks)) {
    process.stdout.write(`${key}: ${value}
`);
  }
}
async function main() {
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
    process.stdout.write(`${VERSION}
`);
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
    case "doctor":
      handleDoctor(json);
      return;
    default:
      throw new CliError(`unknown command: ${parsed.command}`);
  }
}
main().catch((error) => {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}
`);
    process.exit(error.code);
  }
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}
`);
  process.exit(1);
});
