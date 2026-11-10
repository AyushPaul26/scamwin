import { requireScamwinUser, apiFailure } from '@/lib/scamwin/server';
import { officialCatalog } from '@/lib/scamwin/official-source-catalog';
import { createOfficialNextStepHandler } from '@/lib/scamwin/official-next-step-server';

export const GET = createOfficialNextStepHandler({
  authenticate: requireScamwinUser,
  apiFailure,
  catalog: officialCatalog,
  env: process.env,
  now: () => new Date(),
});
