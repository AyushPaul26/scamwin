import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("publisher build packages exactly the reviewed source closure without environment credentials", async () => {
  const fakeKey = "test-only-credential-never-package-this";
  const publisherRoot = new URL("../publisher/", import.meta.url);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("scripts/build.mjs", publisherRoot))], { cwd: publisherRoot, encoding: "utf8", env: { SCAMWIN_PUBLISHER_PRIVATE_KEY: fakeKey, DATABASE_URL: fakeKey } });
  assert.equal(run.status, 0, run.stderr);
  const expected = ["contracts.ts", "input.ts", "publication.ts", "registry-abi.ts", "registry-normalization.ts", "registry.ts", "repository-core.ts", "store.ts"];
  assert.deepEqual((await readdir(new URL("lib/", publisherRoot))).sort(), expected);
  for (const file of expected) {
    const generated = await readFile(new URL(`lib/${file}`, publisherRoot), "utf8");
    const sourceImports = generated.replace(/(["'])(\.{1,2}\/[^"']+)\.js\1/g, "$1$2$1");
    assert.equal(sourceImports, await readFile(new URL(`../lib/scamwin/${file}`, publisherRoot), "utf8"));
    assert.equal(generated.includes(fakeKey), false);
  }
  assert.equal(`${run.stdout}${run.stderr}`.includes(fakeKey), false);
});
