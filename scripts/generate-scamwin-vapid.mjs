import { generateVAPIDKeys } from 'web-push';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writePrivateEnvironmentFile } from './generate-scamwin-connector-secrets.mjs';

export async function generateVapidConfiguration(output) {
  const keys = generateVAPIDKeys();
  // An empty contact deliberately cannot pass push readiness.
  await writePrivateEnvironmentFile(output, `SCAMWIN_WEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nSCAMWIN_WEB_PUSH_PRIVATE_KEY=${keys.privateKey}\nSCAMWIN_WEB_PUSH_SUBJECT=\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('explicit_new_file_required');
    await generateVapidConfiguration(process.argv[2]);
    console.log('New VAPID configuration saved privately. Add a real operator contact before enabling push.');
  } catch {
    console.error('No keys printed. Supply one new ignored .env-prefixed file inside this repository; existing files are never replaced.');
    process.exitCode = 1;
  }
}
