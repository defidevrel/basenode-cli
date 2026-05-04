import { resolve as resolvePath } from "node:path";
import { ensureNonEmpty, isProbablyUrl } from "./env-edit.js";

export type Network = "mainnet" | "sepolia";

export type WizardAnswers = {
  nodeDir: string;
  network: Network;
  l1ExecutionRpc: string;
  l1Beacon: string;
  enableFlashblocks: boolean;
  hostDataDir: string;
};

/** Fields supplied via CLI flags for non-interactive setup. */
export type SetupWizardFlags = {
  nodeDir?: string;
  network?: string;
  l1ExecutionRpc?: string;
  l1Beacon?: string;
  flashblocks?: boolean;
  hostDataDir?: string;
};

/** When all required flags are present, returns answers and skips stdin prompts. */
export function resolveWizardAnswersFromFlags(opts: SetupWizardFlags): WizardAnswers | null {
  const nodeDir = opts.nodeDir?.trim();
  const networkRaw = opts.network?.trim();
  const l1Rpc = opts.l1ExecutionRpc?.trim();
  const l1Beacon = opts.l1Beacon?.trim();
  const hostDataDir = opts.hostDataDir?.trim();

  if (!nodeDir || !networkRaw || !l1Rpc || !l1Beacon || !hostDataDir) return null;

  const network = (networkRaw === "sepolia" ? "sepolia" : "mainnet") as Network;
  const l1ExecutionRpc = ensureNonEmpty("L1 execution RPC URL (Ethereum, not Base)", l1Rpc);
  const l1BeaconUrl = ensureNonEmpty("L1 beacon URL (Ethereum consensus)", l1Beacon);
  if (!isProbablyUrl(l1ExecutionRpc)) throw new Error("L1 execution RPC URL does not look like a URL");
  if (!isProbablyUrl(l1BeaconUrl)) throw new Error("L1 beacon URL does not look like a URL");

  const enableFlashblocks = opts.flashblocks !== false;

  return {
    nodeDir: resolvePath(nodeDir),
    network,
    l1ExecutionRpc,
    l1Beacon: l1BeaconUrl,
    enableFlashblocks,
    hostDataDir: resolvePath(hostDataDir),
  };
}
