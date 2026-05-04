import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_BLUE = "\x1b[38;2;0;82;255m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function resolveBannerFile(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "banner.txt");
}

/** Basenode welcome banner (Base blue + dim subtitle). Respects `BASENODE_NO_BANNER=1`. */
export function printWelcomeBanner(): void {
  if (!process.stdout.isTTY) return;
  if (process.env.BASENODE_NO_BANNER === "1") return;

  let raw: string;
  try {
    raw = readFileSync(resolveBannerFile(), "utf8");
  } catch {
    console.log(
      `${BASE_BLUE}Basenode${RESET} ${DIM}— Base node operator CLI · by defidevrel${RESET}\n`
    );
    return;
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
}
