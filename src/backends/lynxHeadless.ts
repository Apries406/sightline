import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { CliError } from "../lib/errors";

const smokeScript = "/Users/bytedance/.agents/skills/lynx-devtool/scripts/headless-smoke.mjs";

export interface LynxHeadlessResult {
  backend: "lynx-headless";
  url: string;
  path: string;
  raw: unknown;
}

export function captureLynxHeadless(url: string, output: string): LynxHeadlessResult {
  if (!existsSync(smokeScript)) {
    throw new CliError(`lynx headless smoke script not found: ${smokeScript}`);
  }
  const result = spawnSync("node", [smokeScript, "--url", url, "--out", output], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (result.error) {
    throw new CliError(`failed to run lynx headless capture: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new CliError(result.stderr.trim() || result.stdout.trim() || `lynx capture exited ${result.status}`);
  }
  let raw: unknown = result.stdout.trim();
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    // Preserve textual output from older smoke scripts.
  }
  return { backend: "lynx-headless", url, path: output, raw };
}
