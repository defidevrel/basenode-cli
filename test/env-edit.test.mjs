import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureNonEmpty,
  isProbablyUrl,
  readDotEnvValue,
  setEnvVarLine,
  uncommentOrSet,
} from "../dist/env-edit.js";

test("isProbablyUrl accepts http(s) and ws(s)", () => {
  assert.equal(isProbablyUrl("https://example.com"), true);
  assert.equal(isProbablyUrl("http://127.0.0.1:8545"), true);
  assert.equal(isProbablyUrl("wss://beacon.example.com"), true);
  assert.equal(isProbablyUrl("not a url"), false);
  assert.equal(isProbablyUrl("ftp://x"), false);
});

test("ensureNonEmpty trims and throws on empty", () => {
  assert.equal(ensureNonEmpty("x", "  a  "), "a");
  assert.throws(() => ensureNonEmpty("x", "   "), /required/);
});

test("setEnvVarLine updates first match and reports change", () => {
  const src = "A=1\nOP_NODE_L1_ETH_RPC= \nB=2";
  const r = setEnvVarLine(src, "OP_NODE_L1_ETH_RPC", "https://rpc.example");
  assert.equal(r.changed, true);
  assert.match(r.next, /OP_NODE_L1_ETH_RPC=https:\/\/rpc\.example/);
  assert.deepEqual(r.next.split("\n"), ["A=1", "OP_NODE_L1_ETH_RPC=https://rpc.example", "B=2"]);
});

test("setEnvVarLine appends when key missing", () => {
  const r = setEnvVarLine("X=1\n", "Y", "2");
  assert.equal(r.changed, true);
  assert.ok(r.next.endsWith("Y=2\n") || r.next.endsWith("Y=2"));
});

test("uncommentOrSet replaces commented flashblocks line", () => {
  const src = "# RETH_FB_WEBSOCKET_URL=wss://old\nX=1\n";
  const r = uncommentOrSet(src, "RETH_FB_WEBSOCKET_URL", "wss://new");
  assert.equal(r.changed, true);
  assert.ok(!r.next.includes("# RETH_FB_WEBSOCKET_URL="));
  assert.match(r.next, /^RETH_FB_WEBSOCKET_URL=wss:\/\/new$/m);
});

test("readDotEnvValue ignores comments and reads quoted values", () => {
  const src = `# x\nFOO=bar\nBAR="quoted"\n`;
  assert.equal(readDotEnvValue(src, "FOO"), "bar");
  assert.equal(readDotEnvValue(src, "BAR"), "quoted");
  assert.equal(readDotEnvValue(src, "MISSING"), undefined);
});
