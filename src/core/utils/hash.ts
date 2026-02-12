import { createHash } from "node:crypto";

export const stableHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);
