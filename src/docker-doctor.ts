import { spawnSync } from "node:child_process";

export type StepOk = { ok: true; summary: string };
export type StepFail = { ok: false; summary: string; hint: string };
export type Step = StepOk | StepFail;

export type DoctorResult = {
  dockerCli: Step;
  compose: Step;
  daemon: Step;
};

const HINT_INSTALL =
  "Install Docker: https://docs.docker.com/get-docker/ — use Docker Desktop on macOS/Windows, or your distro’s docker.io / Docker CE packages on Linux.";
const HINT_COMPOSE =
  "Install Docker Compose v2 (bundled with Docker Desktop) or the compose plugin: https://docs.docker.com/compose/install/linux/";
const HINT_DAEMON =
  "Start the Docker daemon: open Docker Desktop, or on Linux run `sudo systemctl start docker` (systemd).";

function fail(summary: string, hint: string): StepFail {
  return { ok: false, summary, hint };
}

function ok(summary: string): StepOk {
  return { ok: true, summary };
}

type SpawnOut = {
  status: number | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
};

function spawn(
  command: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv }
): SpawnOut {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  const err = r.error as NodeJS.ErrnoException | undefined;
  return {
    status: r.status,
    stdout: String(r.stdout ?? "").trim(),
    stderr: String(r.stderr ?? "").trim(),
    notFound: err?.code === "ENOENT",
  };
}

function dockerClientVersion(): Step {
  // `docker --version` works without a running daemon; `docker version` may require the API.
  const short = spawn("docker", ["--version"]);
  if (short.notFound) {
    return fail("docker CLI not found in PATH", HINT_INSTALL);
  }
  if (short.status === 0 && short.stdout) {
    const oneLine = short.stdout.replace(/\s+/g, " ").trim();
    return ok(oneLine.replace(/^Docker version\s*/i, "client "));
  }
  return fail(
    `docker --version failed (exit ${short.status}): ${short.stderr || short.stdout || "no output"}`,
    HINT_INSTALL
  );
}

function dockerComposeStep(): Step {
  const plugin = spawn("docker", ["compose", "version", "--short"]);
  if (plugin.status === 0 && plugin.stdout) {
    return ok(`docker compose v${plugin.stdout} (plugin)`);
  }

  const legacy = spawn("docker-compose", ["version", "--short"]);
  if (legacy.notFound) {
    const detail = (plugin.stderr || plugin.stdout || "").replace(/\s+/g, " ").trim();
    return fail(
      detail
        ? `neither working \`docker compose\` nor \`docker-compose\`: ${detail.slice(0, 160)}`
        : "neither `docker compose` nor `docker-compose` is available",
      HINT_COMPOSE
    );
  }
  if (legacy.status === 0 && legacy.stdout) {
    return ok(`docker-compose ${legacy.stdout} (standalone)`);
  }
  return fail(
    `docker-compose failed (exit ${legacy.status}): ${(legacy.stderr || legacy.stdout).replace(/\s+/g, " ").trim().slice(0, 160)}`,
    HINT_COMPOSE
  );
}

function daemonStep(): Step {
  const meta = spawn("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (meta.notFound) {
    return fail("docker CLI not found (cannot check daemon)", HINT_INSTALL);
  }
  if (meta.status === 0 && meta.stdout) {
    return ok(`reachable (server ${meta.stdout})`);
  }
  const blob = (meta.stderr || meta.stdout).toLowerCase();
  const hint = /cannot connect|failed to connect|connection refused|dial unix|docker\.sock|is the docker daemon running|the path is correct and if the daemon|docker desktop|podman/.test(
    blob
  )
    ? HINT_DAEMON
    : HINT_INSTALL;
  const clip = (meta.stderr || meta.stdout).replace(/\s+/g, " ").trim().slice(0, 240);
  return fail(clip ? `not reachable: ${clip}` : "not reachable", hint);
}

/** Run all checks (invokes `docker` / `docker-compose` on PATH). */
export function runDoctor(): DoctorResult {
  const dockerCli = dockerClientVersion();
  if (!dockerCli.ok) {
    return {
      dockerCli,
      compose: fail("skipped (fix Docker CLI first)", HINT_COMPOSE),
      daemon: fail("skipped (fix Docker CLI first)", HINT_DAEMON),
    };
  }
  const compose = dockerComposeStep();
  const daemon = daemonStep();
  return { dockerCli, compose, daemon };
}

export function doctorExitCode(result: DoctorResult): 0 | 1 {
  return result.dockerCli.ok && result.compose.ok && result.daemon.ok ? 0 : 1;
}
