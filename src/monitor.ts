import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNetPeerCount } from "./reliability/peers.js";

export type MonitorOpts = {
  nodeDir: string;
  webhookUrl: string;
  intervalSec: number;
  executionRpc: string;
  once: boolean;
};

type Snapshot = {
  healthy: boolean;
  blockNumber: string | null;
  peers: number | null;
  detail: string;
};

async function ethBlockNumber(rpcUrl: string): Promise<{ hex: string | null; detail: string }> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1,
    });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(rpcUrl.replace(/\/?$/, ""), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ac.signal,
    });
    clearTimeout(t);
    const text = await r.text();
    if (!r.ok) return { hex: null, detail: `HTTP ${r.status}` };
    const j = JSON.parse(text) as { result?: string; error?: { message?: string } };
    if (j.error?.message) return { hex: null, detail: j.error.message };
    return { hex: j.result ?? null, detail: "ok" };
  } catch (e) {
    return { hex: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function snapshotHealth(executionRpc: string): Promise<Snapshot> {
  const block = await ethBlockNumber(executionRpc);
  const peers = await getNetPeerCount(executionRpc);
  const healthy = Boolean(block.hex) && peers.count !== null;
  const detail = [
    block.hex ? `block ${block.hex}` : `block: ${block.detail}`,
    peers.count !== null ? `${peers.detail}` : `peers: ${peers.detail}`,
  ].join("; ");
  return {
    healthy,
    blockNumber: block.hex,
    peers: peers.count,
    detail,
  };
}

function statePath(nodeDir: string): string {
  const h = createHash("sha256").update(nodeDir).digest("hex").slice(0, 16);
  return join(tmpdir(), `basenode-monitor-${h}.json`);
}

async function loadLast(path: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const j = JSON.parse(raw) as { fingerprint?: string };
    return j.fingerprint;
  } catch {
    return undefined;
  }
}

async function saveLast(path: string, fingerprint: string): Promise<void> {
  await writeFile(path, JSON.stringify({ fingerprint, savedAt: new Date().toISOString() }, null, 2), "utf8");
}

async function postDiscord(webhookUrl: string, content: string): Promise<boolean> {
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function postGenericWebhook(webhookUrl: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function formatMessage(nodeDir: string, snap: Snapshot): string {
  const status = snap.healthy ? "HEALTHY" : "DEGRADED";
  return [`[basenode] ${status}`, `dir: ${nodeDir}`, snap.detail].join("\n");
}

/**
 * Poll execution RPC; on state change POST Discord-compatible webhook (`?wait=true` supported by Discord)
 * or any URL accepting JSON `{ "content": "..." }` / full payload for generic hooks.
 */
export async function runMonitor(opts: MonitorOpts): Promise<number> {
  const path = statePath(opts.nodeDir);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const tick = async (): Promise<void> => {
    const snap = await snapshotHealth(opts.executionRpc);
    const fingerprint = JSON.stringify({
      h: snap.healthy,
      b: snap.blockNumber,
      p: snap.peers,
    });
    const prev = await loadLast(path);
    if (prev === fingerprint) {
      console.log(`[monitor] unchanged — ${snap.detail}`);
      return;
    }
    await saveLast(path, fingerprint);
    const msg = formatMessage(opts.nodeDir, snap);
    console.log(`[monitor] state change — ${msg.replace(/\n/g, " | ")}`);

    const discord = /discord(?:app)?\.com\/api\/webhooks\//i.test(opts.webhookUrl);
    const ok = discord
      ? await postDiscord(opts.webhookUrl, msg)
      : await postGenericWebhook(opts.webhookUrl, {
          source: "basenode",
          nodeDir: opts.nodeDir,
          ...snap,
          message: msg,
        });
    if (!ok) console.error("[monitor] webhook POST failed");
  };

  try {
    if (opts.once) {
      await tick();
      return 0;
    }
    console.log(
      `Monitoring ${opts.executionRpc} every ${opts.intervalSec}s (Ctrl+C to stop). State file: ${path}`
    );
    for (;;) {
      await tick();
      await sleep(Math.max(5, opts.intervalSec) * 1000);
    }
  } catch {
    return 1;
  }
}
