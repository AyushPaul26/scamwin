import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRecipientId } from '../lib/chat-recipient';
test('removing the selected member keeps a one-bot group usable and empty group disabled',()=>{
 assert.equal(resolveRecipientId([{id:'retained'}],'removed'),'retained');
 assert.equal(resolveRecipientId([],'removed'),'');
 assert.equal(resolveRecipientId([{id:'first'},{id:'chosen'}],'chosen'),'chosen');
});
