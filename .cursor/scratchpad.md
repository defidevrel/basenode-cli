# basenode (CLI) — scratchpad

## Background and Motivation

Build a **cross-platform Node.js CLI** that runs a **full setup wizard** for a **Base chain node** using the **Reth** execution client only, with **mainnet and Sepolia** support and **Flashblocks** enabled by default (200ms preconfirmations via `RETH_FB_WEBSOCKET_URL`).

Official operator path today is: clone [github.com/base/node](https://github.com/base/node), configure `.env.mainnet` / `.env.sepolia` with **Ethereum L1** (not Base) `OP_NODE_L1_ETH_RPC` and `OP_NODE_L1_BEACON`, wire `env_file` in `docker-compose.yml`, then run **Docker Compose** with `NODE_TYPE=base`, `CLIENT=reth`, and the network-specific Flashblocks WebSocket. See [Run a Base node](https://docs.base.org/base-chain/node-operators/run-a-base-node) and [Flashblocks for node providers](https://docs.base.org/base-chain/flashblocks/node-providers).

The CLI should lower friction: check/install prerequisites where possible, collect L1 endpoints and options, write config, and launch or print exact commands.

## Key Challenges and Analysis

1. **Dependencies**: Base documents **Docker** + **Docker Compose** as the supported path for Reth nodes. The wizard should verify Docker is installed and the daemon is running; optionally guide installation (platform-specific links or `brew`/`winget` hints — avoid brittle silent installs).
2. **L1 requirements**: Operators must supply **Ethereum mainnet or Sepolia** execution + beacon URLs; the wizard must validate non-empty input and warn about sync time and provider quotas.
3. **Repository source of truth**: Prefer **shallow clone** or **pinning a release tag** of `base/node` into a user-chosen directory to avoid drift; document upgrade path (`git pull` / new tag).
4. **Compose/env wiring**: Official flow uses uncommenting `env_file` for `.env.mainnet` vs `.env.sepolia` in `docker-compose.yml`. The CLI can patch or generate a small override file / documented edits — keep diffs minimal and reversible.
5. **Flashblocks**: Set `NODE_TYPE=base`, `CLIENT=reth`, and `RETH_FB_WEBSOCKET_URL` to `wss://mainnet.flashblocks.base.org/ws` or `wss://sepolia.flashblocks.base.org/ws` per network.
6. **Cross-platform**: **macOS and Linux** are straightforward; **Windows** needs Docker Desktop paths, line endings, and `docker compose` invocation — test WSL2 vs native Docker explicitly if targeting Windows.
7. **Optional advanced flags** (later tasks): `RETH_HISTORICAL_PROOFS`, snapshot restore — out of scope for minimal wizard unless requested.
8. **Non-goals (v1)**: Running Reth without Docker; supporting clients other than Reth.

## High-level Task Breakdown

Each task has **success criteria** the Executor can verify before moving on (per workflow: one board item at a time, then user confirmation).

| # | Task | Success criteria |
| --- | --- | --- |
| 1 | **Scaffold Node.js package** — `package.json`, `bin` entry, TypeScript or plain ESM, `basenode` / `npx` command runs `--help`. | `node` / `npm` runs CLI; help text lists commands. |
| 2 | **Wizard command** — interactive prompts: install directory, network (mainnet \| sepolia), L1 execution RPC, L1 beacon URL, confirm ports 30303/9222, enable Flashblocks (default on). | Dry-run mode writes no secrets; inputs validated. |
| 3 | **Prereq checks** — `docker` and `docker compose` (or `docker-compose`) available; daemon up (`docker info`). Clear errors with fix hints. | **Done:** `basenode doctor` — `docker --version` (no daemon), compose plugin or legacy, `docker info` for daemon; exit 0/1. |
| 4 | **Fetch base/node** — clone or update pinned path; ensure `docker-compose.yml` and `.env.*` samples exist. | **Done:** `basenode setup` clones shallow by default (`--git-url`), `--pull` ff-only, `--no-clone` to require an existing checkout. |
| 5 | **Configure env** — write chosen `.env.mainnet` / `.env.sepolia` keys; set `OP_NODE_L1_*`; ensure correct `env_file` lines active (scripted edit with backup). | Diff matches intended network; backup `.bak` on change. |
| 6 | **Launch** — run `docker compose up` (detached option) with `NODE_TYPE=base`, `CLIENT=reth`, `RETH_FB_WEBSOCKET_URL` for selected network; document logs. | **Done:** `--launch` runs `docker compose up -d` (or `--foreground`), after `basenode doctor`-equivalent checks; prints RPC + pending curl hints. |
| 7 | **Tests** — unit tests for URL validation, env generation, compose patching (mock fs). | **Done:** `test/env-edit.test.mjs`, `test/wizard-flags.test.mjs` (+ existing doctor tests); `npm test` passes. |

## Project Status Board

- [x] Scaffold CLI package and `--help`
- [x] Implement prereq checks (Docker)
- [x] Implement wizard + env/compose configuration
- [x] Implement clone/update + launch
- [x] Add tests for core logic

## Current Status / Progress Tracking

- **Executor (2026-05-04)**: Task 1 done — TypeScript CLI at `src/cli.ts`, `commander` with `setup` (default) and `doctor`, version from `package.json`.
- **Executor (2026-05-04)**: **Docker prereqs** done (board item + table row 3) — `src/docker-doctor.ts`, `basenode doctor`, `npm test` includes `test/docker-doctor.test.mjs`. **Please run** `npm run build && node dist/cli.js doctor` with Docker Desktop/daemon **started** for three `[ok]` lines; with daemon stopped, expect CLI + compose ok and daemon `[no]` with start hint.
- **Executor (2026-05-04)**: **Wizard + env/compose configuration** — `src/setup.ts` implements `basenode setup` with prompts or flags (`--dry-run`, `--node-dir`, `--network`, `--l1-rpc`, `--l1-beacon`, `--host-data-dir`, `--no-flashblocks`). Writes/patches `.env.mainnet`/`.env.sepolia` + creates/patches repo-root `.env` for compose defaults (`CLIENT=reth`, `NODE_TYPE=base`, `NETWORK_ENV`, `HOST_DATA_DIR`, optional `RETH_FB_WEBSOCKET_URL`). Backups `.env.*` before mutations.
- **Executor (2026-05-04)**: **Clone/update + launch** — `src/node-repo.ts` (`ensureBaseNodeRepo`), `src/compose-launch.ts` (`docker compose up`), wired into `basenode setup` via `--git-url`, `--pull`, `--no-clone`, `--launch`, `--foreground`. Non-interactive setup when **all** of `--node-dir`, `--network`, `--l1-rpc`, `--l1-beacon`, `--host-data-dir` are set (avoids stdin hangs). Dry-run into a missing directory prints clone plan and **skips `.env*` edits** until the repo exists.
- **Executor (2026-05-04)**: **Unit tests** — `src/env-edit.ts` + `src/wizard-flags.ts` extracted for `setEnvVarLine` / `uncommentOrSet` / `isProbablyUrl` / `resolveWizardAnswersFromFlags`. **13** `node:test` cases total.
- **Executor (2026-05-04)**: **Azul / day‑2 ops** — `setup` writes `USE_BASE_CONSENSUS=true` (base-consensus per [Base Azul upgrade](https://docs.base.org/base-chain/node-operators/base-v1-upgrade)); `--launch` runs **`basenode preflight --strict`** unless `--skip-preflight`. New commands: **`preflight`** (`src/preflight.ts`), **`status`**, **`stop`**, **`logs`**, **`upgrade`** (`src/ops.ts`). Preflight: Docker, compose `.env`, `USE_BASE_CONSENSUS`, L1 `eth_chainId` probe, disk headroom (warn/fail thresholds), P2P ports (warn if busy).
- **Executor (shipped)**: `README.md`, `LICENSE` (MIT), `.github/workflows/ci.yml` (Node 20/22), `package.json` **`name: basenode`** (npm); **`bin`: `basenode`**.
- **Planner**: Optional: publish to npm, consensus RPC (`7545`) checks, README badges after first CI run.
- **Executor (2026-05-04)**: **Welcome banner** — `assets/banner.txt` (“Basenode” block ASCII + Base-blue ANSI via `src/banner.ts`). **`npm install`** runs `postinstall-welcome.mjs` (skipped when `CI=true`, `SKIP_BASENODE_WELCOME=1`, or `BASENODE_NO_BANNER=1`; non-TTY skipped). **`basenode setup`** (including default `basenode`) prints the same banner before the wizard. Published tarball includes `assets/` + `scripts/postinstall-welcome.mjs`.

## Executor's Feedback or Assistance Requests

- `docker version` can fail when the **daemon** is down (client talks to API on some installs). **Doctor** uses `docker --version` for the CLI line so a stopped daemon is not misreported as “Docker not installed.”
- `package.json` **name** may be `basenode` in the working tree; **bin** remains `basenode`.
- **Wizard scope note**: Upstream `docker-compose.yml` defaults `NETWORK_ENV` via `.env`; `basenode setup` writes a repo-root `.env` so operators don’t need to manually export vars for Flashblocks / client selection.

## Lessons

- Read the file before you try to edit it.
- Include debugging-friendly output (paths, compose project name, Docker version).
- Run `npm audit` if vulnerabilities appear during install.
- Use **`docker --version`** to detect the Docker CLI when the daemon may be stopped; use **`docker info`** for daemon reachability.
- **Azul:** consensus requires **`USE_BASE_CONSENSUS=true`** and staying current with **`base/node`**; execution moves to **base-reth-node** via upstream compose — see [Base Azul upgrade](https://docs.base.org/base-chain/node-operators/base-v1-upgrade).

---

**Note:** In this repo’s workflow, **Executor** implements tasks from the board; final “project complete” is confirmed by the **Planner** after review. Say **Planner** to refine this plan only, or **Executor** to start with scaffolding (task 1).
