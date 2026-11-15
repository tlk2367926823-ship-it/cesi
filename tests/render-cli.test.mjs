import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the documented Node renderer starts correctly inside the ESM project", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, ["scripts/render_xhs_v2.js", "--help"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /使用方法/);
  assert.match(result.stdout, /--style/);
});
