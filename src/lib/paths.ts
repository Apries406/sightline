import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
export const projectRoot = process.env.SIGHTLINE_ROOT
  ? resolve(process.env.SIGHTLINE_ROOT)
  : resolve(dirname(thisFile), "../..");
export const helperPath = join(projectRoot, "native/macos-helper/.build/sightline-macos-helper");

export function defaultOutputPath(format: string): string {
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return join(process.env.HOME ?? ".", "Pictures/Screenshots", `sightline-${stamp}.${format}`);
}
