import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const publisherRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = resolve(publisherRoot, "../lib/scamwin");
const generatedRoot = resolve(publisherRoot, "lib");
const files = ["publication.ts", "registry.ts", "registry-abi.ts", "registry-normalization.ts", "repository-core.ts", "store.ts", "input.ts", "contracts.ts", "live-view-contracts.ts", "progress.ts", "daily-check-allowance.ts"];
await mkdir(generatedRoot, { recursive: true });
// Only these reviewed pure Node modules are packaged. Never copy env files or app routes.
for (const file of files) {
  const source = await readFile(resolve(sourceRoot, file), "utf8");
  // Node ESM requires emitted .js extensions, including dynamic and erased type imports.
  const nativeEsm = source.replace(/((?:from\s*|import\s*\()\s*["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, path, quote) => {
    if (!files.includes(`${path.replace(/^\.\//, "")}.ts`)) throw new Error("Publisher dependency is outside the reviewed closure.");
    return `${prefix}${path}.js${quote}`;
  });
  await writeFile(resolve(generatedRoot, file), nativeEsm);
}
const unexpected = (await readdir(generatedRoot)).filter((file) => !files.includes(file));
if (unexpected.length) throw new Error("Publisher generated directory contains unexpected files; remove them before building.");
console.log(`Prepared ${files.length} publisher modules; no environment files copied.`);
