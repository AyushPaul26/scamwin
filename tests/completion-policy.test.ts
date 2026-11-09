import assert from 'node:assert/strict';
import test from 'node:test';
import { groupFormSchema, parseGroupForm } from '../lib/group-form-schema';
import { estimateModelCost, utcMonthStart, sampleSlot } from '../lib/usage-policy';
import { scrubEvent } from '../lib/telemetry-policy';
import { privacyOptions } from '../lib/sentry-options';
test('group forms trim names and reject empty, duplicate, foreign-shaped and file fields', () => {
  assert.deepEqual(groupFormSchema.parse({name:' Team ', botIds:['a','b']}), {name:'Team',botIds:['a','b']});
  for (const value of [{name:' ',botIds:['a','b']},{name:'x'.repeat(51),botIds:['a','b']},{name:'x',botIds:['a']},{name:'x',botIds:['a','a']}]) assert.equal(groupFormSchema.safeParse(value).success,false);
  const form=new FormData(); form.append('name','team'); form.append('name','forged');form.append('botIds','a');form.append('botIds','b');assert.equal(parseGroupForm(form).success,false);
  form.delete('name');form.set('name',new Blob(['file'])); assert.equal(parseGroupForm(form).success,false);
});
test('usage uses only explicit model prices and UTC boundaries', () => {
  const rates=JSON.stringify({known:{input:2,cachedInput:1,output:8}});
  assert.equal(estimateModelCost('unknown',{inputTokens:100,outputTokens:20},rates),null);
  assert.equal(estimateModelCost('known',{inputTokens:100},rates),null);
  assert.equal(estimateModelCost('known',{inputTokens:100,outputTokens:20,cachedTokens:30},rates)?.costMicros,330);
  assert.equal(utcMonthStart(new Date('2026-11-01T00:00:00Z')).toISOString(),'2026-11-01T00:00:00.000Z');
  assert.equal(sampleSlot(new Date('2026-11-01T00:04:59Z')),sampleSlot(new Date('2026-11-01T00:00:00Z')));
});
test('telemetry removes secret markers from errors, logs, breadcrumbs and spans', () => {
  const marker='SECRET_TEST_MARKER';
  const safe=scrubEvent({message:marker,request:{url:marker},user:{id:marker},extra:{prompt:marker},breadcrumbs:[{message:marker}],exception:{values:[{type:'Error',value:marker,stacktrace:{frames:[{filename:'app.js?'+marker,vars:{secret:marker},context_line:marker}]}}]}});
  assert.ok(!JSON.stringify(safe).includes(marker));
  assert.equal(privacyOptions.beforeBreadcrumb(),null); assert.equal(privacyOptions.beforeSendLog(),null);
  const span=privacyOptions.beforeSendSpan({trace_id:'trace',span_id:'span',name:marker,start_timestamp:1,status:'ok',is_segment:false,attributes:{prompt:marker},links:[]});
  assert.ok(!JSON.stringify(span).includes(marker));
});
