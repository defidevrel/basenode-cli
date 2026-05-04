/** JSON-RPC helper for execution-layer `net_peerCount`. */

export async function getNetPeerCount(executionRpcUrl: string): Promise<{
  count: number | null;
  detail: string;
}> {
  const url = executionRpcUrl.replace(/\/?$/, "");
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "net_peerCount",
      params: [],
      id: 1,
    });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ac.signal,
    });
    clearTimeout(t);
    const text = await r.text();
    if (!r.ok) return { count: null, detail: `HTTP ${r.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text) as { result?: string; error?: { message?: string } };
    if (j.error?.message) return { count: null, detail: j.error.message };
    const hex = j.result;
    if (!hex || typeof hex !== "string" || !hex.startsWith("0x")) {
      return { count: null, detail: "unexpected net_peerCount payload" };
    }
    const count = Number.parseInt(hex, 16);
    if (Number.isNaN(count)) return { count: null, detail: "could not parse peer count" };
    return { count, detail: `${count} execution peers` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { count: null, detail: msg };
  }
}
