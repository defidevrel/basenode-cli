import assert from "node:assert/strict";
import { test } from "node:test";
import { doctorExitCode } from "../dist/docker-doctor.js";

const ok = (summary) => ({ ok: true, summary });
const no = (summary, hint) => ({ ok: false, summary, hint });

test("doctorExitCode returns 0 when all steps pass", () => {
  assert.equal(
    doctorExitCode({
      dockerCli: ok("client"),
      compose: ok("compose"),
      daemon: ok("daemon"),
    }),
    0
  );
});

test("doctorExitCode returns 1 when Docker CLI fails", () => {
  assert.equal(
    doctorExitCode({
      dockerCli: no("missing", "hint"),
      compose: ok("compose"),
      daemon: ok("daemon"),
    }),
    1
  );
});

test("doctorExitCode returns 1 when compose fails", () => {
  assert.equal(
    doctorExitCode({
      dockerCli: ok("client"),
      compose: no("missing", "hint"),
      daemon: ok("daemon"),
    }),
    1
  );
});

test("doctorExitCode returns 1 when daemon fails", () => {
  assert.equal(
    doctorExitCode({
      dockerCli: ok("client"),
      compose: ok("compose"),
      daemon: no("down", "hint"),
    }),
    1
  );
});
