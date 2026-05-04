import { spawnSync } from "node:child_process";

/** Run `docker compose ...args` in `cwd`. Returns process exit code. */
export function runDockerCompose(cwd: string, args: string[]): number {
  const r = spawnSync("docker", ["compose", ...args], {
    cwd,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    const r2 = spawnSync("docker-compose", args, {
      cwd,
      stdio: "inherit",
      encoding: "utf8",
    });
    if (r2.error && (r2.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "`docker compose` not found. Install Docker Compose v2 (Docker Desktop includes it)."
      );
    }
    return r2.status ?? 1;
  }
  return r.status ?? 1;
}

export function printLaunchHints(nodeDir: string): void {
  console.log("");
  console.log("Next:");
  console.log(
    `  - Azul / upgrades: https://docs.base.org/base-chain/node-operators/base-v1-upgrade`
  );
  console.log(`  - Logs: cd ${nodeDir} && docker compose logs -f`);
  console.log(
    `  - RPC check: curl -sS -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545`
  );
  console.log(
    `  - Flashblocks (pending): curl -sS -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["pending",false],"id":1}' http://127.0.0.1:8545`
  );
}
