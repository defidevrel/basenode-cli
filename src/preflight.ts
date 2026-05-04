import { statfs } from "node:fs/promises";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { readDotEnvValue } from "./env-edit.js";
import { doctorExitCode, runDoctor } from "./docker-doctor.js";
import { diskWriteBenchMiBps } from "./reliability/disk-write-bench.js";
import { measureNtpSkewMs } from "./reliability/ntp-skew.js";
import { getNetPeerCount } from "./reliability/peers.js";

/** Base Azul migration / readiness (official operator docs). */
export const AZUL_UPGRADE_DOC =
  "https://docs.base.org/base-chain/node-operators/base-v1-upgrade";

const GiB = 1024 ** 3;
/** Rough guidance — tune for your deployment class (archive vs pruned). */
const FREE_GIB_WARN = 500;
const FREE_GIB_FAIL = 80;

/** Clock skew magnitude vs pool.ntp.org / chrony / sntp. */
const NTP_WARN_MS = 250;
const NTP_FAIL_MS = 1000;
/** Sequential write of a ~64 MiB temp file inside HOST_DATA_DIR. */
const DISK_WRITE_WARN_MIBPS = 40;
const DISK_WRITE_FAIL_MIBPS = 8;
/** Execution-layer `net_peerCount` via JSON-RPC (node must be up). */
const PEERS_WARN = 5;

export type PreflightOpts = {
  nodeDir?: string;
  /** Treat warnings as failures (exit 1). */
  strict: boolean;
  skipNtp?: boolean;
  skipDiskBench?: boolean;
  skipPeers?: boolean;
  /** Defaults to execution RPC mapped to localhost:8545. */
  executionRpc?: string;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function explainMissingCompose(nodeDir: string): Promise<void> {
  if (nodeDir.includes("/path/to")) {
    console.error(
      "         Hint: `/path/to/...` is a documentation placeholder. Pass the real directory that contains `docker-compose.yml` from your https://github.com/base/node clone."
    );
    console.error(
      `         Example: npm run basenode -- preflight --node-dir \"$HOME/base-node\"`
    );
    return;
  }
  if (!(await fileExists(nodeDir))) {
    console.error(`         Directory does not exist: ${nodeDir}`);
    console.error("         Clone: git clone https://github.com/base/node.git <dir>");
    return;
  }
  console.error(
    "        This folder exists but does not look like base/node (no docker-compose.yml at its root)."
  );
}

function fmtGiB(bytes: number): string {
  return `${(bytes / GiB).toFixed(1)} GiB`;
}

async function freeDiskBytesForPath(path: string): Promise<bigint> {
  const s = await statfs(path);
  return BigInt(s.bavail) * BigInt(s.bsize);
}

async function checkDisk(hostDataDir: string): Promise<{ ok: boolean; warn: boolean; text: string }> {
  if (!(await fileExists(hostDataDir))) {
    return {
      ok: true,
      warn: true,
      text: `data dir does not exist yet (${hostDataDir}) — created on first start`,
    };
  }
  const free = await freeDiskBytesForPath(hostDataDir);
  const freeGiB = Number(free) / GiB;
  if (freeGiB < FREE_GIB_FAIL) {
    return {
      ok: false,
      warn: false,
      text: `critically low free space (${fmtGiB(Number(free))} free; < ${FREE_GIB_FAIL} GiB)`,
    };
  }
  if (freeGiB < FREE_GIB_WARN) {
    return {
      ok: true,
      warn: true,
      text: `free space ${fmtGiB(Number(free))} (< ${FREE_GIB_WARN} GiB recommended for many mainnet setups)`,
    };
  }
  return { ok: true, warn: false, text: `free space ${fmtGiB(Number(free))}` };
}

function listenOnce(port: number): Promise<{ busy: boolean; detail: string }> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ busy: true, detail: `port ${port} in use (containers running or another host process)` });
        return;
      }
      resolve({ busy: false, detail: `port ${port}: ${err.message}` });
    });
    s.listen(port, "0.0.0.0", () => {
      s.close(() => resolve({ busy: false, detail: `port ${port} not bound on 0.0.0.0 (good for first boot)` }));
    });
  });
}

async function probeL1Rpc(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
      id: 1,
    });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12_000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    return { ok: true, detail: "responded to eth_chainId" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}

/**
 * Azul-oriented readiness checks on top of Docker.
 * With `--node-dir`, validates `.env`, consensus toggle, L1 reachability, disk headroom, and discovery ports.
 */
export async function runPreflight(opts: PreflightOpts): Promise<0 | 1> {
  console.log("basenode preflight — Docker + Azul readiness\n");

  const docker = runDoctor();
  const rows: Array<{ label: string; step: (typeof docker)["dockerCli"] }> = [
    { label: "Docker CLI", step: docker.dockerCli },
    { label: "Docker Compose", step: docker.compose },
    { label: "Docker daemon", step: docker.daemon },
  ];
  for (const { label, step } of rows) {
    if (step.ok) console.log(`  [ok]  ${label}: ${step.summary}`);
    else {
      console.error(`  [no]  ${label}: ${step.summary}`);
      console.error(`         ${step.hint}`);
    }
  }

  let code = doctorExitCode(docker);
  if (code !== 0) {
    console.error("\nFix Docker first (`basenode doctor`), then re-run preflight.");
    return 1;
  }

  console.log("");
  console.log(`Azul docs: ${AZUL_UPGRADE_DOC}`);
  console.log(
    "Stay current with base/node, use base-consensus (USE_BASE_CONSENSUS=true), and verify client versions before activation."
  );

  const nodeDir = opts.nodeDir?.trim();
  if (!nodeDir) {
    console.log("\nRe-run with `--node-dir <base/node>` for repo, L1, disk, and port checks.");
    return 0;
  }

  const composeYml = join(nodeDir, "docker-compose.yml");
  if (!(await fileExists(composeYml))) {
    console.error(`\n  [no]  missing docker-compose.yml under ${nodeDir}`);
    await explainMissingCompose(nodeDir);
    return 1;
  }

  const dotEnvPath = join(nodeDir, ".env");
  const dotEnvRaw = (await fileExists(dotEnvPath)) ? await readFile(dotEnvPath, "utf8") : "";
  const networkEnvName = readDotEnvValue(dotEnvRaw, "NETWORK_ENV") ?? ".env.mainnet";
  const networkEnvPath = join(nodeDir, networkEnvName.replace(/^\.\//, ""));
  const hostDataDirRaw = readDotEnvValue(dotEnvRaw, "HOST_DATA_DIR");
  const useBaseConsensus = readDotEnvValue(dotEnvRaw, "USE_BASE_CONSENSUS");
  const client = readDotEnvValue(dotEnvRaw, "CLIENT");
  const nodeType = readDotEnvValue(dotEnvRaw, "NODE_TYPE");

  console.log("");
  console.log(`Repo: ${nodeDir}`);

  if (client && client !== "reth") {
    console.error(`  [no]  CLIENT=${client} (expected reth for this tool’s supported path)`);
    code = 1;
  } else if (client) {
    console.log(`  [ok]  CLIENT=${client}`);
  } else {
    console.log(`  [warn] CLIENT not set in .env (expected reth)`);
    if (opts.strict) code = 1;
  }

  if (nodeType && nodeType !== "base") {
    console.error(`  [no]  NODE_TYPE=${nodeType} (expected base)`);
    code = 1;
  } else if (nodeType) {
    console.log(`  [ok]  NODE_TYPE=${nodeType}`);
  }

  if (useBaseConsensus === "true") {
    console.log(`  [ok]  USE_BASE_CONSENSUS=true`);
  } else {
    console.error(
      `  [no]  USE_BASE_CONSENSUS must be "true" for Azul (base-consensus). Edit ${dotEnvPath || join(nodeDir, ".env")}`
    );
    code = 1;
  }

  if (!(await fileExists(networkEnvPath))) {
    console.error(`  [no]  missing ${networkEnvPath} (NETWORK_ENV=${networkEnvName})`);
    code = 1;
  } else {
    const netRaw = await readFile(networkEnvPath, "utf8");
    const l1 =
      readDotEnvValue(netRaw, "BASE_NODE_L1_ETH_RPC")?.trim() ||
      readDotEnvValue(netRaw, "OP_NODE_L1_ETH_RPC")?.trim();
    if (!l1) {
      console.error(`  [no]  L1 execution RPC missing in ${networkEnvPath}`);
      code = 1;
    } else {
      const p = await probeL1Rpc(l1);
      if (p.ok) console.log(`  [ok]  L1 RPC ${l1} — ${p.detail}`);
      else {
        console.error(`  [no]  L1 RPC ${l1} — ${p.detail}`);
        code = 1;
      }
    }
  }

  const hostPath = hostDataDirRaw?.trim() ? hostDataDirRaw.trim() : join(nodeDir, "data");
  const disk = await checkDisk(hostPath);
  if (!disk.ok) {
    console.error(`  [no]  Disk: ${disk.text}`);
    code = 1;
  } else if (disk.warn) {
    console.log(`  [warn] Disk: ${disk.text}`);
    if (opts.strict) code = 1;
  } else {
    console.log(`  [ok]  Disk: ${disk.text}`);
  }

  for (const port of [30303, 9222] as const) {
    const lp = await listenOnce(port);
    if (lp.busy) {
      // Busy usually means the stack is already running — warn only.
      console.log(`  [warn] ${lp.detail}`);
    } else {
      console.log(`  [ok]  ${lp.detail}`);
    }
  }

  const execRpc = (opts.executionRpc ?? "http://127.0.0.1:8545").trim();

  console.log("");
  console.log("Reliability — clock / disk write / execution peers");

  if (!opts.skipNtp) {
    const ntp = await measureNtpSkewMs();
    if (ntp.skewMs === null) {
      console.log(`  [warn] NTP / clock skew: ${ntp.detail}`);
      if (opts.strict) code = 1;
    } else if (ntp.skewMs >= NTP_FAIL_MS) {
      console.error(
        `  [no]  Clock skew ~${ntp.skewMs.toFixed(0)} ms exceeds ${NTP_FAIL_MS} ms (${ntp.source}: ${ntp.detail})`
      );
      code = 1;
    } else if (ntp.skewMs >= NTP_WARN_MS) {
      console.log(
        `  [warn] Clock skew ~${ntp.skewMs.toFixed(0)} ms (target < ${NTP_WARN_MS} ms) — ${ntp.detail}`
      );
      if (opts.strict) code = 1;
    } else {
      console.log(`  [ok]  Clock skew ~${ntp.skewMs.toFixed(0)} ms (${ntp.source}: ${ntp.detail})`);
    }
  } else {
    console.log("  [skip] NTP / clock skew (--skip-ntp)");
  }

  if (!opts.skipDiskBench) {
    if (!(await fileExists(hostPath))) {
      console.log(`  [skip] Disk write benchmark (HOST_DATA_DIR not created yet): ${hostPath}`);
    } else {
      const bench = await diskWriteBenchMiBps(hostPath);
      if (bench.mibPerSec === null) {
        console.log(`  [warn] Disk write benchmark: ${bench.detail}`);
        if (opts.strict) code = 1;
      } else if (bench.mibPerSec < DISK_WRITE_FAIL_MIBPS) {
        console.error(
          `  [no]  Disk write ~${bench.mibPerSec.toFixed(1)} MiB/s (${bench.detail}) — very slow media (< ${DISK_WRITE_FAIL_MIBPS} MiB/s)`
        );
        code = 1;
      } else if (bench.mibPerSec < DISK_WRITE_WARN_MIBPS) {
        console.log(
          `  [warn] Disk write ~${bench.mibPerSec.toFixed(1)} MiB/s — aim for ≥ ${DISK_WRITE_WARN_MIBPS} MiB/s on NVMe`
        );
        if (opts.strict) code = 1;
      } else {
        console.log(`  [ok]  Disk write ${bench.detail}`);
      }
    }
  } else {
    console.log("  [skip] Disk write benchmark (--skip-disk-bench)");
  }

  if (!opts.skipPeers) {
    const peers = await getNetPeerCount(execRpc);
    if (peers.count === null) {
      console.log(`  [warn] Execution peers: ${peers.detail}`);
      console.log(`         (Expected if containers are stopped. RPC: ${execRpc})`);
      if (opts.strict) code = 1;
    } else if (peers.count < PEERS_WARN) {
      console.log(`  [warn] Execution peers: ${peers.count} (healthy setups often exceed ${PEERS_WARN})`);
      if (opts.strict) code = 1;
    } else {
      console.log(`  [ok]  Execution peers: ${peers.detail} (${execRpc})`);
    }
  } else {
    console.log("  [skip] Execution peer count (--skip-peers)");
  }

  console.log("");
  if (code === 0) console.log("Preflight: passed (no blocking failures).");
  else console.error("Preflight: failed — see [no] lines above.");

  return code === 0 ? 0 : 1;
}
