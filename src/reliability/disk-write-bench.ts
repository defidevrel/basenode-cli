import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_BYTES = 64 * 1024 * 1024; // 64 MiB

/** Sequential write throughput test into `dir` (temporary file, then deleted). */
export async function diskWriteBenchMiBps(dir: string): Promise<{
  mibPerSec: number | null;
  detail: string;
}> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { mibPerSec: null, detail: `cannot access data dir (${msg})` };
  }

  const path = join(dir, `.basenode-writebench-${process.pid}.tmp`);
  try {
    const buf = Buffer.alloc(DEFAULT_BYTES, 0xce);
    const t0 = performance.now();
    await writeFile(path, buf);
    const dt = (performance.now() - t0) / 1000;
    const mib = DEFAULT_BYTES / (1024 * 1024);
    const mibPerSec = dt > 0 ? mib / dt : null;
    await rm(path, { force: true });
    if (mibPerSec === null) return { mibPerSec: null, detail: "benchmark timer failure" };
    return {
      mibPerSec,
      detail: `wrote ~${mib.toFixed(0)} MiB in ${dt.toFixed(2)}s (~${mibPerSec.toFixed(1)} MiB/s)`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await rm(path, { force: true });
    } catch {
      /* ignore */
    }
    return { mibPerSec: null, detail: msg };
  }
}
