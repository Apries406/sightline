import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { helperPath } from "../lib/paths";
import { CliError } from "../lib/errors";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  main: boolean;
  bounds: Bounds;
  scale: number;
}

export interface WindowInfo {
  id: number;
  ownerName: string;
  bundleId?: string;
  pid: number;
  title: string;
  layer: number;
  bounds: Bounds;
  onScreen: boolean;
  alpha: number;
}

export interface CaptureResult {
  ok: boolean;
  path: string;
  width: number;
  height: number;
}

export interface RecordResult {
  ok: boolean;
  path: string;
  width: number;
  height: number;
  duration: number;
}

export interface PermissionStatus {
  screenRecordingLikelyGranted: boolean;
  accessibilityTrusted: boolean;
}

function ensureHelper(): void {
  if (!existsSync(helperPath)) {
    throw new CliError(
      `macOS helper is not built. Run: bun run build:helper\nmissing: ${helperPath}`,
    );
  }
}

function runHelper<T>(args: string[]): T {
  ensureHelper();
  const result = spawnSync(helperPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new CliError(`failed to run helper: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = result.stderr.trim() || result.stdout.trim() || `helper exited ${result.status}`;
    throw new CliError(err);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new CliError(`helper returned invalid JSON: ${result.stdout}`);
  }
}

export function listDisplays(): DisplayInfo[] {
  return runHelper<DisplayInfo[]>(["list-displays"]);
}

export function listWindows(): WindowInfo[] {
  return runHelper<WindowInfo[]>(["list-windows"]);
}

export function captureWindowNative(id: number, output: string): CaptureResult {
  return runHelper<CaptureResult>(["capture-window-native", "--id", String(id), "--output", output]);
}

export function recordWindowNative(id: number, duration: number, output: string): RecordResult {
  return runHelper<RecordResult>([
    "record-window-native",
    "--id",
    String(id),
    "--duration",
    String(duration),
    "--output",
    output,
  ]);
}

export function permissions(): PermissionStatus {
  return runHelper<PermissionStatus>(["permissions"]);
}
