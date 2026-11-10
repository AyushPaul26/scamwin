import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Shared by the two generators: ignored, repository-local, new files only. */
export async function writePrivateEnvironmentFile(output, contents) {
  if (typeof output !== 'string' || !output || !/^\.env(?:[A-Za-z0-9_.-]*)$/.test(basename(output))) throw new Error('unsafe_private_output');
  const root = await realpath(repository), parent = await realpath(dirname(resolve(output)));
  const target = resolve(parent, basename(output)), local = relative(root, target);
  if (!local || local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(local)) throw new Error('unsafe_private_output');
  const ignored = spawnSync('git', ['check-ignore', '--', local], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (ignored.status !== 0) throw new Error('unsafe_private_output');
  await writeFile(target, contents, { flag: 'wx', mode: 0o600 });
}

export async function generateConnectorSecrets(output) {
  const names = ['SCAMWIN_CONNECTOR_ENCRYPTION_KEY', 'SCAMWIN_CONNECTOR_IDENTIFIER_KEY', 'SCAMWIN_CONNECTOR_DISPATCH_SECRET'];
  const keys = new Set();
  while (keys.size < names.length) keys.add(randomBytes(32).toString('hex'));
  const lines = names.map((name, index) => `${name}=${[...keys][index]}`);
  for (const name of ['SCAMWIN_CONNECTORS_ENABLED', 'SCAMWIN_CONNECTOR_RUNTIME_ENABLED', 'SCAMWIN_CONNECTOR_AUTOMATION_ENABLED', 'SCAMWIN_PRIVATE_PUSH_ENABLED', 'SCAMWIN_ALTERNATIVES_ENABLED', ...['GMAIL', 'OUTLOOK', 'TELEGRAM', 'SLACK', 'TEAMS', 'DISCORD', 'DRIVE', 'EXTENSION'].map(provider => `SCAMWIN_CONNECTOR_${provider}_ENABLED`)]) lines.push(`${name}=false`);
  await writePrivateEnvironmentFile(output, `${lines.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('explicit_new_file_required');
    await generateConnectorSecrets(process.argv[2]);
    console.log('New connector secrets saved privately. All capability gates remain disabled.');
  } catch {
    console.error('No secrets printed. Supply one new ignored .env-prefixed file inside this repository; existing files are never replaced.');
    process.exitCode = 1;
  }
}
