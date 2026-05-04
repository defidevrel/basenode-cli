import { mkdirSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { printLaunchHints, runDockerCompose } from "./compose-launch.js";
import { doctorExitCode, runDoctor } from "./docker-doctor.js";
import { runPreflight } from "./preflight.js";
import { ensureNonEmpty, isProbablyUrl, setEnvVarLine, uncommentOrSet } from "./env-edit.js";
import { ensureBaseNodeRepo } from "./node-repo.js";
import {
  resolveWizardAnswersFromFlags,
  type WizardAnswers,
  type Network,
} from "./wizard-flags.js";

type SetupOptions = {
  dryRun: boolean;
  nodeDir?: string;
  network?: string;
  l1ExecutionRpc?: string;
  l1Beacon?: string;
  flashblocks?: boolean;
  hostDataDir?: string;
  gitUrl: string;
  noClone: boolean;
  pull: boolean;
  launch: boolean;
  foreground: boolean;
  /** When false (default), `--launch` runs `basenode preflight --strict` first. */
  skipPreflight: boolean;
};

const FLASHBLOCKS_WS: Record<Network, string> = {
  mainnet: "wss://mainnet.flashblocks.base.org/ws",
  sepolia: "wss://sepolia.flashblocks.base.org/ws",
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultNodeDirFromRepo(): string {
  // default to a sibling folder when running from dist/
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return resolve(root, "..", "base-node");
}

function defaultDataDir(network: Network): string {
  return resolve(homedir(), "base-node-data", network);
}

async function promptWizard(opts: SetupOptions): Promise<WizardAnswers> {
  const fromFlags = resolveWizardAnswersFromFlags(opts);
  if (fromFlags) return fromFlags;

  const rl = createInterface({ input, output });
  try {
    const nodeDirDefault = opts.nodeDir ? resolve(opts.nodeDir) : defaultNodeDirFromRepo();
    const nodeDir =
      opts.nodeDir ??
      resolve(
        (await rl.question(`Path to existing base/node checkout [${nodeDirDefault}]: `)).trim() ||
          nodeDirDefault
      );

    const networkRaw =
      (opts.network?.trim() ||
        (await rl.question("Network (mainnet/sepolia) [mainnet]: ")).trim() ||
        "mainnet") as string;
    const network = (networkRaw === "sepolia" ? "sepolia" : "mainnet") as Network;

    const l1ExecutionRpc = ensureNonEmpty(
      "L1 execution RPC URL (Ethereum, not Base)",
      opts.l1ExecutionRpc ?? (await rl.question("L1 execution RPC URL (Ethereum, not Base): "))
    );
    if (!isProbablyUrl(l1ExecutionRpc)) throw new Error("L1 execution RPC URL does not look like a URL");

    const l1Beacon = ensureNonEmpty(
      "L1 beacon URL (Ethereum consensus)",
      opts.l1Beacon ?? (await rl.question("L1 beacon URL (Ethereum consensus): "))
    );
    if (!isProbablyUrl(l1Beacon)) throw new Error("L1 beacon URL does not look like a URL");

    const enableFlashblocks =
      typeof opts.flashblocks === "boolean"
        ? opts.flashblocks
        : (() => {
            const flashDefault = "Y";
            return rl
              .question(`Enable Flashblocks? [${flashDefault}/n]: `)
              .then((s) => (s.trim() ? !/^n/i.test(s.trim()) : true));
          })();
    const fb = await Promise.resolve(enableFlashblocks);

    const dataDefault = defaultDataDir(network);
    const hostDataDir = resolve(
      opts.hostDataDir ??
        (((await rl.question(`Host data dir [${dataDefault}]: `)).trim() || dataDefault) as string)
    );

    return { nodeDir: resolve(nodeDir), network, l1ExecutionRpc, l1Beacon, enableFlashblocks: fb, hostDataDir };
  } finally {
    rl.close();
  }
}

function backupPath(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${path}.bak.${stamp}`;
}

async function writeTextFile(path: string, contents: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function configureEnvFiles(answers: WizardAnswers, dryRun: boolean): Promise<string[]> {
  const actions: string[] = [];
  const envFile = join(answers.nodeDir, answers.network === "mainnet" ? ".env.mainnet" : ".env.sepolia");
  const envExists = await fileExists(envFile);
  if (!envExists) throw new Error(`Expected env file not found: ${envFile}`);

  const original = await readFile(envFile, "utf8");
  let next = original;
  let changed = false;

  for (const key of ["OP_NODE_L1_ETH_RPC", "BASE_NODE_L1_ETH_RPC"]) {
    const r = setEnvVarLine(next, key, answers.l1ExecutionRpc);
    next = r.next;
    changed ||= r.changed;
  }
  for (const key of ["OP_NODE_L1_BEACON", "BASE_NODE_L1_BEACON"]) {
    const r = setEnvVarLine(next, key, answers.l1Beacon);
    next = r.next;
    changed ||= r.changed;
  }

  if (answers.enableFlashblocks) {
    const ws = FLASHBLOCKS_WS[answers.network];
    const r = uncommentOrSet(next, "RETH_FB_WEBSOCKET_URL", ws);
    next = r.next;
    changed ||= r.changed;
  }

  if (changed) {
    actions.push(`Update ${envFile}`);
    actions.push(`  - set OP_NODE_L1_ETH_RPC, BASE_NODE_L1_ETH_RPC`);
    actions.push(`  - set OP_NODE_L1_BEACON, BASE_NODE_L1_BEACON`);
    if (answers.enableFlashblocks) actions.push(`  - set RETH_FB_WEBSOCKET_URL (${FLASHBLOCKS_WS[answers.network]})`);
    if (!dryRun) {
      const bak = backupPath(envFile);
      await writeFile(bak, original, "utf8");
      await writeFile(envFile, next, "utf8");
    }
  } else {
    actions.push(`No changes needed in ${envFile}`);
  }

  // Compose also reads a local `.env` in the working directory. We create one to keep the launch simple.
  const composeDotEnv = join(answers.nodeDir, ".env");
  const composeEnvOriginal = (await fileExists(composeDotEnv)) ? await readFile(composeDotEnv, "utf8") : "";
  let composeNext = composeEnvOriginal || "";
  let composeChanged = false;
  for (const [k, v] of [
    ["CLIENT", "reth"],
    ["NODE_TYPE", "base"],
    ["USE_BASE_CONSENSUS", "true"],
    ["NETWORK_ENV", answers.network === "mainnet" ? ".env.mainnet" : ".env.sepolia"],
    ["HOST_DATA_DIR", answers.hostDataDir],
  ] as const) {
    const r = setEnvVarLine(composeNext, k, v);
    composeNext = r.next;
    composeChanged ||= r.changed;
  }
  if (answers.enableFlashblocks) {
    const r = setEnvVarLine(composeNext, "RETH_FB_WEBSOCKET_URL", FLASHBLOCKS_WS[answers.network]);
    composeNext = r.next;
    composeChanged ||= r.changed;
  }

  if (composeChanged) {
    actions.push(`Update ${composeDotEnv} (docker compose defaults + Azul base-consensus)`);
    if (!dryRun) {
      if (composeEnvOriginal) {
        const bak = backupPath(composeDotEnv);
        await writeFile(bak, composeEnvOriginal, "utf8");
      }
      await writeTextFile(composeDotEnv, composeNext.trimEnd() + "\n");
    }
  } else {
    actions.push(`No changes needed in ${composeDotEnv}`);
  }

  return actions;
}

async function verifyBaseNodeDir(nodeDir: string): Promise<void> {
  const compose = join(nodeDir, "docker-compose.yml");
  if (!(await fileExists(compose))) {
    throw new Error(
      `base/node not found at ${nodeDir} (missing docker-compose.yml). Fix --node-dir, or remove --no-clone to allow cloning https://github.com/base/node.`
    );
  }
}

export async function runSetup(opts: SetupOptions): Promise<0 | 1> {
  try {
    console.log("basenode setup — configuration wizard\n");
    const answers = await promptWizard(opts);

    const repoLines = await ensureBaseNodeRepo({
      nodeDir: answers.nodeDir,
      gitUrl: opts.gitUrl,
      dryRun: opts.dryRun,
      allowClone: !opts.noClone,
      pull: opts.pull,
    });
    if (repoLines.length) {
      console.log("");
      for (const line of repoLines) console.log(line);
    }

    const composeFile = join(answers.nodeDir, "docker-compose.yml");
    const hasCompose = await fileExists(composeFile);
    if (!hasCompose && opts.dryRun && !opts.noClone) {
      console.log("");
      console.log(
        "(Dry-run: `docker-compose.yml` not on disk yet — clone runs when you omit `--dry-run`.)"
      );
    } else {
      await verifyBaseNodeDir(answers.nodeDir);
    }

    console.log("\nPlan:");
    console.log(`  - node dir: ${answers.nodeDir}`);
    console.log(`  - network: ${answers.network}`);
    console.log(`  - flashblocks: ${answers.enableFlashblocks ? "enabled" : "disabled"}`);
    console.log(`  - host data dir: ${answers.hostDataDir}`);
    console.log("");

    if (opts.dryRun && !hasCompose) {
      console.log("");
      console.log(
        "Dry-run: skipping `.env*` edits until the repo exists locally (run without `--dry-run` to clone)."
      );
      if (opts.launch) {
        console.log("Dry-run: would run `docker compose up` after configuration.");
      }
      return 0;
    }

    const actions = await configureEnvFiles(answers, opts.dryRun);
    for (const a of actions) console.log(a);

    console.log("");
    if (opts.dryRun) {
      console.log("Dry-run complete (no files written).");
      if (opts.launch) {
        console.log(
          "Dry-run: would start the stack with `docker compose up -d` (omit `--foreground`)."
        );
      }
      return 0;
    }
    console.log("Config written.");

    if (opts.launch) {
      if (!opts.skipPreflight) {
        console.log("");
        const pf = await runPreflight({ nodeDir: answers.nodeDir, strict: true });
        if (pf !== 0) {
          console.error("");
          console.error("Preflight failed — fix issues above or re-run with `--skip-preflight` (not recommended).");
          return 1;
        }
      } else {
        console.log("");
        console.warn("Skipping preflight (`--skip-preflight`). Ensure Docker + Azul settings are correct.");
        const doctor = runDoctor();
        if (doctorExitCode(doctor) !== 0) {
          console.error("");
          console.error("Docker prerequisite checks failed. Fix the issues above or run `basenode doctor`.");
          return 1;
        }
      }

      const composeArgs = opts.foreground ? (["up"] as const) : (["up", "-d"] as const);
      console.log("");
      console.log(`Starting stack: docker compose ${composeArgs.join(" ")}`);
      console.log(`  cwd: ${answers.nodeDir}`);
      const code = runDockerCompose(answers.nodeDir, [...composeArgs]);
      if (code !== 0) return 1;
      printLaunchHints(answers.nodeDir);
      return 0;
    }

    console.log("");
    console.log("Next: run `docker compose up -d` from the node directory, or re-run with `--launch`.");
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`basenode setup failed: ${msg}`);
    return 1;
  }
}

