#!/usr/bin/env node
/**
 * Runs after `npm install`. Skipped in CI or when SKIP_BASENODE_WELCOME=1.
 * Does not require `npm run build` (reads assets + duplicates banner colors).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_BLUE = "\x1b[38;2;0;82;255m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bannerFile = join(root, "assets", "banner.txt");

if (process.env.CI === "true" || process.env.SKIP_BASENODE_WELCOME === "1") {
  process.exit(0);
}

if (!process.stdout.isTTY || process.env.BASENODE_NO_BANNER === "1") {
  process.exit(0);
}

if (!existsSync(bannerFile)) {
  process.exit(0);
}

let raw;
try {
  raw = readFileSync(bannerFile, "utf8");
} catch {
  process.exit(0);
}

for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (t.length === 0) {
    console.log("");
    continue;
  }
  if (line.includes("█")) {
    console.log(BASE_BLUE + line + RESET);
  } else {
    console.log(DIM + line + RESET);
  }
}
