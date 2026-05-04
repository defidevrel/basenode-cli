import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function gitPullFfOnly(nodeDir: string): void {
  runGit(["-C", nodeDir, "pull", "--ff-only"]);
}

function runGit(args: string[], cwd?: string): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      "`git` was not found on PATH. Install Git (https://git-scm.com/downloads) and retry."
    );
  }
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").trim().replace(/\s+/g, " ");
    throw new Error(`git ${args.join(" ")} failed (exit ${r.status}): ${msg || "no output"}`);
  }
}

/** Clone or update `https://github.com/base/node` at `nodeDir`. */
export async function ensureBaseNodeRepo(input: {
  nodeDir: string;
  gitUrl: string;
  dryRun: boolean;
  allowClone: boolean;
  pull: boolean;
}): Promise<string[]> {
  const lines: string[] = [];
  const compose = join(input.nodeDir, "docker-compose.yml");

  const dirExists = await fileExists(input.nodeDir);
  if (!dirExists) {
    if (!input.allowClone) {
      throw new Error(
        `Node directory does not exist: ${input.nodeDir}\n` +
          "Remove --no-clone to allow cloning base/node, or create the directory with a checkout."
      );
    }
    lines.push(`Clone base/node → ${input.nodeDir}`);
    lines.push(`  git clone --depth 1 ${input.gitUrl} ${input.nodeDir}`);
    if (input.dryRun) return lines;

    mkdirSync(dirname(input.nodeDir), { recursive: true });
    runGit(["clone", "--depth", "1", input.gitUrl, input.nodeDir]);
    lines.push("Clone complete.");
    return lines;
  }

  const hasCompose = await fileExists(compose);
  if (!hasCompose) {
    const entries = await readdir(input.nodeDir);
    const empty = entries.length === 0;
    if (empty && input.allowClone) {
      lines.push(`Directory exists but is empty; cloning into ${input.nodeDir}`);
      lines.push(`  git clone --depth 1 ${input.gitUrl} .`);
      if (input.dryRun) return lines;
      runGit(["clone", "--depth", "1", input.gitUrl, "."], input.nodeDir);
      lines.push("Clone complete.");
      return lines;
    }
    throw new Error(
      `Expected base/node at ${input.nodeDir}, but docker-compose.yml is missing.\n` +
        "Fix the path, clone manually, or remove --no-clone to allow cloning into an empty directory."
    );
  }

  if (input.pull) {
    const gitDir = join(input.nodeDir, ".git");
    if (!(await fileExists(gitDir))) {
      lines.push("Skipping git pull (not a git checkout; docker-compose.yml present).");
      return lines;
    }
    lines.push(`Update base/node (ff-only) → ${input.nodeDir}`);
    lines.push(`  git -C ${input.nodeDir} pull --ff-only`);
    if (input.dryRun) return lines;
    runGit(["-C", input.nodeDir, "pull", "--ff-only"]);
    lines.push("git pull complete.");
  }

  return lines;
}
