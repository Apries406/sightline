import { readFileSync } from "node:fs";

export interface ImageInfo {
  width?: number;
  height?: number;
}

export function readPngInfo(path: string): ImageInfo {
  const buf = readFileSync(path);
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  return {};
}
