import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { AgentChat } from '@trigger.dev/sdk/chat';

// Isolated web-only fixture; no Daytona operations or real user rows are touched.
const id = randomUUID(), bot = randomUUID(), owner = `firecrawl-check|${randomUUID()}`;
const sql = neon(process.env.DATABASE_URL);
const client = new AgentChat({ agent: 'openmods-chat', id, clientData: { style: 'concise', recipientId: bot } });
try {
  await sql`INSERT INTO bots(id,user_id,name,avatar,job,instructions,sandbox_id) VALUES (${bot},${owner},'Web check','web-check','Researcher','Use readWebPage for web tasks. Do not use computer tools.',${'web-only-test-' + bot})`;
  await sql`INSERT INTO chats(id,user_id,kind) VALUES (${id},${owner},'direct')`;
  await sql`INSERT INTO chat_members(chat_id,bot_id) VALUES (${id},${bot})`;
  const result = await (await client.sendMessage('Read https://example.com and summarize what this page is for in one sentence. Cite the link.', { abortSignal: AbortSignal.timeout(120000) })).result();
  assert.ok(result.toolCalls.some(call => call.toolName === 'readWebPage'), 'Agent must use Firecrawl');
  const webCall = result.toolCalls.find(call => call.toolName === 'readWebPage');
  const page = result.toolResults.find(call => call.toolCallId === webCall.toolCallId);
  assert.ok(page && JSON.stringify(page).includes('Example Domain'), 'Tool must return actual page content');
  assert.match(result.text, /example|documentation|illustrative/i);
  assert.match(result.text, /https:\/\/example.com/);
  console.log('PASS real worker -> model -> Firecrawl -> cited answer');
  const followup = await (await client.sendMessage('What was the URL you just read? Answer only the URL, using our conversation.', { abortSignal: AbortSignal.timeout(60000) })).result();
  assert.match(followup.text, /https:\/\/example.com/);
  console.log('PASS follow-up retains web-reading conversation');
} catch (error) {
  console.error('FAIL Firecrawl live chat check:', error instanceof assert.AssertionError ? error.message : 'Provider or transport failure (details suppressed).');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  await sql`DELETE FROM chats WHERE id=${id} AND user_id=${owner}`;
  await sql`DELETE FROM bots WHERE id=${bot} AND user_id=${owner}`;
  await sql`DELETE FROM usage_entries WHERE user_id=${owner}`;
}
