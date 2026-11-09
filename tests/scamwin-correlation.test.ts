import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePrivateIndicators } from '../lib/scamwin/correlation';
import type { Observation } from '../lib/scamwin/contracts';
const observation = (kind:string,data:Observation['data']):Observation=>({id:kind,kind,data,checkId:'c',runId:'r',status:'observed',sourceKind:'live_page',sourceRef:'https://example.com',observedAt:new Date().toISOString(),collectorVersion:'test',policyVersion:'test'});
test('private correlation fingerprints are owner scoped and never index CDN or issuer overlaps',()=>{
  const facts=[observation('payment_action',{recipient:'refund@upi',direction:'outgoing'}),observation('tls',{issuer:'Shared issuer'}),observation('page',{cdn:'Shared CDN'})];
  const a=derivePrivateIndicators('owner-a','https://one.example.com',facts,'x'.repeat(64));
  const b=derivePrivateIndicators('owner-b','https://one.example.com',facts,'x'.repeat(64));
  assert.equal(a.length,2); assert.ok(a.every((item,i)=>item.fingerprint!==b[i].fingerprint));
  assert.ok(a.every(item=>!JSON.stringify(item).includes('refund@upi')));
  assert.throws(()=>derivePrivateIndicators('owner','https://example.com',facts,''));
});
test('only observed live recipients and HTTP form destinations become structured indicators',()=>{
  const fake={...observation('payment_action',{recipient:'guess@upi'}),sourceKind:'user_text' as const};
  const facts=[fake,observation('form_destinations',{destinations:['https://endpoint.example.com/collect?private=one','javascript:alert(1)']})];
  assert.deepEqual(derivePrivateIndicators('owner','',facts,'x'.repeat(64)).map(item=>item.kind),['endpoint']);
});
