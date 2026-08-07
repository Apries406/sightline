import type { WindowInfo } from "../backends/macosHelper";
import { CliError } from "./errors";

export type Target =
  | { kind: "app"; app: string; title?: string; index?: number }
  | { kind: "bundle"; bundleId: string; title?: string; index?: number }
  | { kind: "pid"; pid: number; title?: string; index?: number }
  | { kind: "window"; id: number }
  | { kind: "rect"; rect: string }
  | { kind: "screen"; screen: "all" | "main" }
  | { kind: "display"; display: number }
  | { kind: "lynx-headless"; url: string; out?: string };

function splitSpec(spec: string): { head: string; params: Map<string, string> } {
  if (spec.startsWith("rect:")) {
    return { head: spec, params: new Map() };
  }
  if (spec.startsWith("lynx:headless,")) {
    return splitLynxSpec(spec);
  }
  const parts = spec.split(",").map((part) => part.trim()).filter(Boolean);
  const head = parts.shift();
  if (!head) throw new CliError("empty target");
  const params = new Map<string, string>();
  for (const part of parts) {
    const index = part.indexOf(":");
    if (index === -1) throw new CliError(`invalid target parameter: ${part}`);
    params.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return { head, params };
}

function splitLynxSpec(spec: string): { head: string; params: Map<string, string> } {
  const prefix = "lynx:headless,";
  const params = new Map<string, string>();
  let rest = spec.slice(prefix.length);
  while (rest.length > 0) {
    const nextUrl = rest.startsWith("url:") ? "url" : undefined;
    const nextOut = rest.startsWith("out:") ? "out" : undefined;
    const key = nextUrl ?? nextOut;
    if (!key) throw new CliError(`invalid lynx target parameter near: ${rest}`);
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

export function parseTarget(spec: string): Target {
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
      if (!value) throw new CliError("app target requires a name");
      return { kind, app: value, title, index };
    case "bundle":
      if (!value) throw new CliError("bundle target requires a bundle id");
      return { kind, bundleId: value, title, index };
    case "pid": {
      const pid = Number(value);
      if (!Number.isInteger(pid) || pid <= 0) throw new CliError("pid target requires a positive integer");
      return { kind, pid, title, index };
    }
    case "window": {
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0) throw new CliError("window target requires a positive integer");
      return { kind, id };
    }
    case "rect":
      if (!/^-?\d+,-?\d+,\d+,\d+$/.test(value)) throw new CliError("rect target must be rect:x,y,w,h");
      return { kind, rect: value };
    case "screen":
      if (value !== "all" && value !== "main") throw new CliError("screen target must be screen:all or screen:main");
      return { kind, screen: value };
    case "display": {
      const display = Number(value);
      if (!Number.isInteger(display) || display <= 0) throw new CliError("display target requires a positive integer");
      return { kind, display };
    }
    case "lynx":
      if (value === "headless") {
        const url = params.get("url");
        if (!url) throw new CliError("lynx:headless requires url:<bundle-url>");
        return { kind: "lynx-headless", url, out: params.get("out") };
      }
      throw new CliError(`unsupported lynx target: ${value}`);
    default:
      throw new CliError(`unsupported target kind: ${kind}`);
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function textMatches(pattern: string, value: string): boolean {
  if (pattern.includes("*")) return wildcardMatch(pattern, value);
  return normalize(value).includes(normalize(pattern));
}

export function resolveWindowTarget(target: Target, windows: WindowInfo[]): WindowInfo {
  if (target.kind === "window") {
    const found = windows.find((window) => window.id === target.id);
    if (!found) throw new CliError(`window not found: ${target.id}`);
    return found;
  }

  if (target.kind !== "app" && target.kind !== "bundle" && target.kind !== "pid") {
    throw new CliError(`target is not a window target: ${target.kind}`);
  }

  const candidates = windows
    .filter((window) => window.layer === 0)
    .filter((window) => window.alpha > 0)
    .filter((window) => {
      if (target.kind === "app") return textMatches(target.app, window.ownerName);
      if (target.kind === "bundle") return window.bundleId === target.bundleId;
      return window.pid === target.pid;
    })
    .filter((window) => {
      if (!target.title) return true;
      return textMatches(target.title, window.title);
    })
    .sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height));

  if (candidates.length === 0) {
    throw new CliError(`no visible window matched target`);
  }

  return candidates[target.index ?? 0] ?? (() => {
    throw new CliError(`target index out of range; matched ${candidates.length} windows`);
  })();
}
