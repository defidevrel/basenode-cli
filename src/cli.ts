#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { doctorExitCode, runDoctor } from "./docker-doctor.js";
import {
  assertNodeProject,
  composeDown,
  composeLogs,
  composePs,
  upgradeNodeRepo,
} from "./ops.js";
import { runMonitor } from "./monitor.js";
import { runPreflight } from "./preflight.js";
import { runSetup } from "./setup.js";

function readPackageVersion(): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const raw = readFileSync(join(root, "package.json"), "utf8");
  const manifest = JSON.parse(raw) as { version?: string };
  return manifest.version ?? "0.0.0";
}

function main(): void {
  const program = new Command();

  program
    .name("basenode")
    .description(
      "Base node operator CLI — setup, Azul-oriented preflight, and docker compose day-2 commands (wraps official base/node)."
    )
    .version(readPackageVersion(), "-V, --version", "output the version number");

  program
    .command("setup", { isDefault: true })
    .description(
      "Run the full setup wizard: check Docker, clone base/node, configure L1 + Flashblocks, launch"
    )
    .option("--dry-run", "print actions without writing files or starting containers", false)
    .option("--node-dir <path>", "path to an existing checkout of https://github.com/base/node")
    .option("--network <mainnet|sepolia>", "network to configure (mainnet or sepolia)")
    .option("--l1-rpc <url>", "Ethereum L1 execution RPC URL")
    .option("--l1-beacon <url>", "Ethereum L1 beacon (consensus) URL")
    .option("--no-flashblocks", "disable Flashblocks configuration")
    .option("--host-data-dir <path>", "host directory for chain data (HOST_DATA_DIR)")
    .option("--git-url <url>", "git URL to clone if needed", "https://github.com/base/node.git")
    .option("--no-clone", "do not clone; require an existing base/node checkout")
    .option("--pull", "run `git pull --ff-only` when the node dir is a git repo", false)
    .option("--launch", "after writing config, run `docker compose up`", false)
    .option("--foreground", "with `--launch`, run compose in the foreground (no `-d`)", false)
    .option(
      "--skip-preflight",
      "with `--launch`, skip `basenode preflight` (not recommended for production)",
      false
    )
    .action(
      async (opts: {
        dryRun: boolean;
        nodeDir?: string;
        network?: string;
        l1Rpc?: string;
        l1Beacon?: string;
        flashblocks: boolean;
        hostDataDir?: string;
        gitUrl: string;
        noClone: boolean;
        pull: boolean;
        launch: boolean;
        foreground: boolean;
        skipPreflight: boolean;
      }) => {
        process.exitCode = await runSetup({
          dryRun: opts.dryRun,
          nodeDir: opts.nodeDir,
          network: opts.network,
          l1ExecutionRpc: opts.l1Rpc,
          l1Beacon: opts.l1Beacon,
          flashblocks: opts.flashblocks,
          hostDataDir: opts.hostDataDir,
          gitUrl: opts.gitUrl,
          noClone: Boolean(opts.noClone),
          pull: Boolean(opts.pull),
          launch: Boolean(opts.launch),
          foreground: Boolean(opts.foreground),
          skipPreflight: Boolean(opts.skipPreflight),
        });
      }
    );

  program
    .command("preflight")
    .description(
      "Strict readiness checks for Docker + base/node (Azul / base-consensus, L1 RPC, disk, ports)"
    )
    .option("--node-dir <path>", "path to your base/node checkout")
    .option("--strict", "treat warnings as failures", false)
    .option("--skip-ntp", "skip clock skew / NTP checks", false)
    .option("--skip-disk-bench", "skip HOST_DATA_DIR write throughput test (~64 MiB)", false)
    .option("--skip-peers", "skip execution net_peerCount via local JSON-RPC", false)
    .option(
      "--execution-rpc <url>",
      "execution JSON-RPC URL for peer checks (default: http://127.0.0.1:8545)",
      "http://127.0.0.1:8545"
    )
    .action(
      async (opts: {
        nodeDir?: string;
        strict: boolean;
        skipNtp: boolean;
        skipDiskBench: boolean;
        skipPeers: boolean;
        executionRpc: string;
      }) => {
        process.exitCode = await runPreflight({
          nodeDir: opts.nodeDir,
          strict: Boolean(opts.strict),
          skipNtp: Boolean(opts.skipNtp),
          skipDiskBench: Boolean(opts.skipDiskBench),
          skipPeers: Boolean(opts.skipPeers),
          executionRpc: opts.executionRpc,
        });
      }
    );

  program
    .command("status")
    .description("Show docker compose service status for a base/node checkout")
    .requiredOption("--node-dir <path>", "path to your base/node checkout")
    .action(async (opts: { nodeDir: string }) => {
      try {
        await assertNodeProject(opts.nodeDir);
        process.exitCode = composePs(opts.nodeDir) === 0 ? 0 : 1;
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      }
    });

  program
    .command("stop")
    .description("Stop the stack (`docker compose down`)")
    .requiredOption("--node-dir <path>", "path to your base/node checkout")
    .action(async (opts: { nodeDir: string }) => {
      try {
        await assertNodeProject(opts.nodeDir);
        process.exitCode = composeDown(opts.nodeDir) === 0 ? 0 : 1;
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      }
    });

  program
    .command("logs")
    .description("Tail or fetch recent docker compose logs")
    .requiredOption("--node-dir <path>", "path to your base/node checkout")
    .option("-f, --follow", "follow logs", false)
    .action(async (opts: { nodeDir: string; follow: boolean }) => {
      try {
        await assertNodeProject(opts.nodeDir);
        process.exitCode = composeLogs(opts.nodeDir, Boolean(opts.follow)) === 0 ? 0 : 1;
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
      }
    });

  program
    .command("upgrade")
    .description("git pull base/node (ff-only) + docker compose pull — Azul prep")
    .requiredOption("--node-dir <path>", "path to your base/node checkout")
    .action(async (opts: { nodeDir: string }) => {
      process.exitCode = await upgradeNodeRepo(opts.nodeDir);
    });

  program
    .command("monitor")
    .description(
      "Poll execution RPC; POST to Discord webhook or generic URL when health / block / peers change"
    )
    .requiredOption("--node-dir <path>", "path to your base/node checkout (for messages only)")
    .requiredOption("--webhook <url>", "Discord webhook URL or HTTPS endpoint accepting JSON POST")
    .option("--interval <seconds>", "poll interval", "60")
    .option(
      "--execution-rpc <url>",
      "execution JSON-RPC URL (same host/port you expose EL RPC on)",
      "http://127.0.0.1:8545"
    )
    .option("--once", "run a single poll + exit", false)
    .action(
      async (opts: {
        nodeDir: string;
        webhook: string;
        interval: string;
        executionRpc: string;
        once: boolean;
      }) => {
        const sec = Number(opts.interval);
        const intervalSec = Number.isFinite(sec) && sec > 0 ? sec : 60;
        const code = await runMonitor({
          nodeDir: opts.nodeDir,
          webhookUrl: opts.webhook,
          intervalSec,
          executionRpc: opts.executionRpc,
          once: Boolean(opts.once),
        });
        if (typeof code === "number") process.exitCode = code;
      }
    );

  program
    .command("doctor")
    .description("Check Docker and host prerequisites for running a Base node")
    .action(() => {
      console.log("basenode doctor — checking Docker\n");
      const result = runDoctor();
      const lines: Array<{ label: string; step: (typeof result)["dockerCli"] }> = [
        { label: "Docker CLI", step: result.dockerCli },
        { label: "Docker Compose", step: result.compose },
        { label: "Docker daemon", step: result.daemon },
      ];
      for (const { label, step } of lines) {
        if (step.ok) {
          console.log(`  [ok]  ${label}: ${step.summary}`);
        } else {
          console.error(`  [no]  ${label}: ${step.summary}`);
          console.error(`         ${step.hint}`);
        }
      }
      console.log("");
      process.exitCode = doctorExitCode(result);
    });

  program.parse(process.argv);
}

main();
