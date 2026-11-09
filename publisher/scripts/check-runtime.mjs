import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, resolve, sep } from "node:path";

const root = new URL("../", import.meta.url);
const output = new URL(`.runtime-check-${process.pid}/`, root);
const publisherPath = resolve(fileURLToPath(root));
const outputPath = resolve(fileURLToPath(output));
if (!outputPath.startsWith(publisherPath + sep) || !/^\.runtime-check-\d+$/.test(basename(outputPath))) {
  throw new Error("Runtime verification output must stay inside the publisher package.");
}
await mkdir(output, { recursive: true });
try {
  const compiled = spawnSync(process.execPath, [fileURLToPath(new URL("node_modules/typescript/bin/tsc", root)), "--project", fileURLToPath(new URL("tsconfig.json", root)), "--noEmit", "false", "--outDir", fileURLToPath(output)], { cwd: root, encoding: "utf8" });
  if (compiled.status !== 0) throw new Error(compiled.stdout || compiled.stderr);
  const source = `const {default: api} = await import(${JSON.stringify(new URL("api/relay.js", output).href)}); const response = await api.fetch(new Request("https://publisher.test/api/relay")); if (response.status !== 401) throw Error("unauthenticated runtime did not return 401"); await import(${JSON.stringify(new URL("lib/repository-core.js", output).href)}); await import(${JSON.stringify(new URL("lib/publication.js", output).href)}); console.log("Emitted Node ESM imports resolve; unauthenticated request returns 401.");`;
  const checked = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: root, encoding: "utf8", env: { CRON_SECRET: "c".repeat(64), SCAMWIN_PUBLISHER_DISPATCH_SECRET: "d".repeat(64) } });
  if (checked.status !== 0) throw new Error(checked.stderr);
  process.stdout.write(checked.stdout);
} finally {
  await rm(output, { recursive: true, force: true });
}
