import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWizardAnswersFromFlags } from "../dist/wizard-flags.js";

test("resolveWizardAnswersFromFlags returns null when incomplete", () => {
  assert.equal(resolveWizardAnswersFromFlags({}), null);
  assert.equal(
    resolveWizardAnswersFromFlags({
      nodeDir: "/tmp/a",
      network: "mainnet",
      l1ExecutionRpc: "https://x",
      l1Beacon: "https://y",
    }),
    null
  );
});

test("resolveWizardAnswersFromFlags resolves paths and network", () => {
  const r = resolveWizardAnswersFromFlags({
    nodeDir: "/tmp/base-node",
    network: "sepolia",
    l1ExecutionRpc: "https://eth.example",
    l1Beacon: "https://beacon.example",
    hostDataDir: "/var/base-data",
    flashblocks: false,
  });
  assert.ok(r);
  assert.equal(r.network, "sepolia");
  assert.equal(r.enableFlashblocks, false);
  assert.ok(r.nodeDir.endsWith("base-node"));
  assert.ok(r.hostDataDir.includes("base-data"));
});

test("resolveWizardAnswersFromFlags rejects bad urls", () => {
  assert.throws(
    () =>
      resolveWizardAnswersFromFlags({
        nodeDir: "/tmp/a",
        network: "mainnet",
        l1ExecutionRpc: "not-a-url",
        l1Beacon: "https://beacon.example",
        hostDataDir: "/tmp/d",
      }),
    /does not look like a URL/
  );
});
