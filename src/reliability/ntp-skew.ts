import { spawnSync } from "node:child_process";
import { createSocket } from "node:dgram";
const SECONDS_FROM_1900_TO_1970 = 2208988800;

function writeNtpTime(buf: Buffer, offset: number, unixMs: number): void {
  const sec = Math.floor(unixMs / 1000) + SECONDS_FROM_1900_TO_1970;
  const frac = Math.floor(((unixMs % 1000) / 1000) * 2 ** 32);
  buf.writeUInt32BE(sec >>> 0, offset);
  buf.writeUInt32BE(frac >>> 0, offset + 4);
}

function readNtpTimeMs(buf: Buffer, offset: number): number {
  const sec = buf.readUInt32BE(offset) - SECONDS_FROM_1900_TO_1970;
  const frac = buf.readUInt32BE(offset + 4);
  return sec * 1000 + (frac / 2 ** 32) * 1000;
}

/**
 * RFC5905-style offset estimate using SNTP request/response (UDP/123).
 * Falls back to OS helpers (`sntp`, `chronyc`) when UDP is blocked.
 */
export async function measureNtpSkewMs(): Promise<{
  skewMs: number | null;
  detail: string;
  source: "udp" | "sntp" | "chronyc" | "none";
}> {
  const udp = await measureSkewUdp();
  if (udp.skewMs !== null && Number.isFinite(udp.skewMs)) {
    return { skewMs: Math.abs(udp.skewMs), detail: udp.detail, source: "udp" };
  }

  const sntp = trySntpCli();
  if (sntp.skewMs !== null) return { ...sntp, source: "sntp" };

  const chrony = tryChronyc();
  if (chrony.skewMs !== null) return { ...chrony, source: "chronyc" };

  return {
    skewMs: null,
    detail:
      "could not measure clock skew (UDP 123 blocked and no `sntp`/`chronyc` output). Install NTP tooling or allow outbound NTP.",
    source: "none",
  };
}

async function measureSkewUdp(): Promise<{ skewMs: number | null; detail: string }> {
  const host = "pool.ntp.org";
  const port = 123;

  const packet = Buffer.alloc(48);
  packet[0] = 0x1b; // version 4, mode client
  const t1 = Date.now();
  writeNtpTime(packet, 40, t1);

  try {
    const socket = createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      socket.send(packet, 0, packet.length, port, host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const msg = await new Promise<Buffer>((resolve, reject) => {
      const to = setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(new Error("timeout"));
      }, 3500);
      socket.once("message", (buf: Buffer) => {
        clearTimeout(to);
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        resolve(buf);
      });
      socket.once("error", (err) => {
        clearTimeout(to);
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        reject(err);
      });
    });

    if (msg.length < 48) return { skewMs: null, detail: "short NTP response" };

    const t4 = Date.now();
    const t1Rx = readNtpTimeMs(msg, 24);
    const t2 = readNtpTimeMs(msg, 32);
    const t3 = readNtpTimeMs(msg, 40);

    const offsetMs = (t2 - t1Rx + (t3 - t4)) / 2;
    if (!Number.isFinite(offsetMs)) {
      return { skewMs: null, detail: "invalid NTP timestamp math" };
    }
    return {
      skewMs: offsetMs,
      detail: `UDP SNTP offset ~${offsetMs.toFixed(0)} ms (pool.ntp.org)`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { skewMs: null, detail: `UDP NTP failed (${msg})` };
  }
}

function trySntpCli(): { skewMs: number | null; detail: string } {
  const r = spawnSync("sntp", ["-t", "4", "pool.ntp.org"], {
    encoding: "utf8",
    timeout: 6000,
  });
  const blob = `${r.stdout}\n${r.stderr}`;
  const m =
    /([+-]?\d+(?:\.\d+)?)\s*(?:ms|msec|milliseconds)/i.exec(blob) ||
    /offset\s+([+-]?\d+(?:\.\d+)?)/i.exec(blob);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isNaN(ms)) {
      return { skewMs: Math.abs(ms), detail: `sntp reports ~${ms.toFixed(0)} ms offset` };
    }
  }
  if (r.status === 0 && /adjust/i.test(blob)) {
    return { skewMs: 0, detail: "sntp completed (could not parse offset; assuming OK)" };
  }
  return { skewMs: null, detail: "sntp not available or unparsable" };
}

function tryChronyc(): { skewMs: number | null; detail: string } {
  const r = spawnSync("chronyc", ["tracking"], { encoding: "utf8", timeout: 4000 });
  if (r.status !== 0) return { skewMs: null, detail: "chronyc not available" };
  const m = /System time\s*:\s*([+-]?\d+(?:\.\d+)?)\s*(seconds|ms|milliseconds)/i.exec(
    `${r.stdout}\n${r.stderr}`
  );
  if (!m) {
    const abs = /RMS offset\s*:\s*([+-]?\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/i.exec(r.stdout);
    if (abs) {
      return { skewMs: Math.abs(Number(abs[1])), detail: `chronyc RMS offset ~${abs[1]} ms` };
    }
    return { skewMs: null, detail: "chronyc output unparsable" };
  }
  const val = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = unit.startsWith("sec") ? val * 1000 : val;
  return { skewMs: Math.abs(ms), detail: `chronyc system offset ~${ms.toFixed(0)} ms` };
}
