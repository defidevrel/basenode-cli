import { access } from "node:fs/promises";
import { join } from "node:path";
import { runDockerCompose } from "./compose-launch.js";
import { gitPullFfOnly } from "./node-repo.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function assertNodeProject(nodeDir: string): Promise<void> {
  const compose = join(nodeDir, "docker-compose.yml");
  if (!(await fileExists(compose))) {
    throw new Error(`Expected base/node at ${nodeDir} (missing docker-compose.yml).`);
  }
}

export function composePs(nodeDir: string): number {
  return runDockerCompose(nodeDir, ["ps"]);
}

export function composeDown(nodeDir: string): number {
  return runDockerCompose(nodeDir, ["down"]);
}

export function composeLogs(nodeDir: string, follow: boolean): number {
  return runDockerCompose(nodeDir, follow ? ["logs", "-f"] : ["logs", "--tail", "200"]);
}

export function composePull(nodeDir: string): number {
  return runDockerCompose(nodeDir, ["pull"]);
}

/** `git pull --ff-only` when `.git` exists, then `docker compose pull`. */
export async function upgradeNodeRepo(nodeDir: string): Promise<0 | 1> {
  await assertNodeProject(nodeDir);
  const gitDir = join(nodeDir, ".git");
  if (await fileExists(gitDir)) {
    console.log(`git pull --ff-only (${nodeDir})\n`);
    try {
      gitPullFfOnly(nodeDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`git pull failed: ${msg}`);
      return 1;
    }
  } else {
    console.warn(`Warning: no .git directory — skipping git pull. Update files manually if needed.`);
  }

  console.log("\ndocker compose pull\n");
  const c = composePull(nodeDir);
  if (c !== 0) return 1;

  console.log("\nUpgrade downloaded. Apply with:");
  console.log(`  cd ${nodeDir} && docker compose up -d`);
  console.log("");
  console.log(`Azul / migration reference: https://docs.base.org/base-chain/node-operators/base-v1-upgrade`);
  return 0;
}
