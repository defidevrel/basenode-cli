# basenode

npm package **`basenode`** — operator-focused CLI around **[base/node](https://github.com/base/node)** — interactive setup, **Azul-oriented** preflight (Docker, `USE_BASE_CONSENSUS`, L1 RPC, disk, NTP skew, write throughput, execution peers), day‑2 `docker compose` helpers, and optional **webhook monitoring**.

Official references: [Run a Base node](https://docs.base.org/base-chain/node-operators/run-a-base-node), [Base Azul upgrade](https://docs.base.org/base-chain/node-operators/base-v1-upgrade).

## Requirements

- **Node.js ≥ 20**
- **Docker** + **Docker Compose v2**, daemon running
- **Git** (for clone / upgrade)
- Hardware/network expectations per Base docs (disk, bandwidth, open ports **30303**, **9222**)

## Install (from this repo)

```bash
git clone https://github.com/defidevrel/basenode-cli.git
cd basenode-cli
npm ci
npm run build
```

Run the CLI without a global install:

```bash
npm run basenode -- --help
# or
node dist/cli.js --help
npx . --help
```

Optional global command:

```bash
npm link   # then: basenode --help
```

## Quick start

1. **Doctor** — Docker / Compose / daemon:

   ```bash
   npm run basenode -- doctor
   ```

2. **Setup** — clone/configure `base/node`, write `.env` + network envs (`USE_BASE_CONSENSUS=true`, Reth, Flashblocks when enabled):

   ```bash
   npm run basenode -- setup
   ```

   Non-interactive example (use your **real** paths — not `/path/to/...`):

   ```bash
   npm run basenode -- setup \
     --node-dir "$HOME/base-node" \
     --network mainnet \
     --l1-rpc "https://YOUR_ETH_L1_EXECUTION_RPC" \
     --l1-beacon "https://YOUR_ETH_L1_BEACON" \
     --host-data-dir "$HOME/base-node-data/mainnet" \
     --launch
   ```

3. **Preflight** — strict checks before/after upgrades:

   ```bash
   npm run basenode -- preflight --node-dir "$HOME/base-node" --strict
   ```

   Flags: `--skip-ntp`, `--skip-disk-bench`, `--skip-peers`, `--execution-rpc http://127.0.0.1:8545`.

## Commands

| Command | Purpose |
| --- | --- |
| `setup` | Wizard + patch `.env.mainnet` / `.env.sepolia` + repo `.env`; optional `--launch` |
| `preflight` | Docker + repo/Azul env + L1 probe + disk + ports + NTP + disk write bench + `net_peerCount` |
| `doctor` | Docker toolchain checks only |
| `status` | `docker compose ps` |
| `stop` | `docker compose down` |
| `logs` | `docker compose logs` (`-f` to follow) |
| `upgrade` | `git pull --ff-only` + `docker compose pull` |
| `monitor` | Poll EL RPC; POST **Discord** webhook or generic JSON URL on state change |

## Monitor / alerts

```bash
npm run basenode -- monitor \
  --node-dir "$HOME/base-node" \
  --webhook "https://discord.com/api/webhooks/..." \
  --execution-rpc http://127.0.0.1:8545 \
  --interval 60
```

`--once` runs a single poll and exits.

## Development

```bash
npm test    # build + node:test
npm audit
```

## License

MIT — see [LICENSE](./LICENSE).
