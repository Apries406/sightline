import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CliError } from "../lib/errors";

export interface ScreenCaptureOptions {
  target: "all" | "main" | { display: number } | { rect: string } | { windowId: number };
  output: string;
  format: string;
  delay?: number;
  cursor?: boolean;
  clipboard?: boolean;
  quiet?: boolean;
}

export function captureScreen(options: ScreenCaptureOptions): void {
  mkdirSync(dirname(options.output), { recursive: true });
  const args = ["-t", options.format];
  if (options.quiet !== false) args.push("-x");
  if (options.cursor) args.push("-C");
  if (options.delay !== undefined) args.push("-T", String(options.delay));
  if (options.target === "main") args.push("-m");
  if (typeof options.target === "object" && "display" in options.target) args.push(`-D${options.target.display}`);
  if (typeof options.target === "object" && "rect" in options.target) args.push(`-R${options.target.rect}`);
  if (typeof options.target === "object" && "windowId" in options.target) args.push(`-l${options.target.windowId}`);
  if (options.clipboard) args.push("-c");
  args.push(options.output);

  const result = spawnSync("/usr/sbin/screencapture", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new CliError(`failed to run screencapture: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new CliError(result.stderr.trim() || `screencapture exited ${result.status}`);
  }
}
