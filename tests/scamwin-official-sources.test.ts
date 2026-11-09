import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialIdentity} from '../lib/scamwin/official-sources';
import type {OfferIntent} from '../lib/scamwin/contracts';
const intent:OfferIntent={promisedBenefit:null,claimedOrganization:'Fixture organization',intendedAction:null,requestedActions:[],extractedCandidates:[],uncertainties:[]},source={checkId:'c',runId:'r'};
test('official identity requires a current curated exact hostname, not a model-supplied destination',()=>{
  assert.equal(officialIdentity(intent,'https://example.com',source,{})[0].status,'not_checked');
  const ref={organization:'Fixture organization',hostname:'example.com',referenceUrl:'https://example.com/about',reviewedAt:new Date().toISOString()};
  const env={SCAMWIN_OFFICIAL_SOURCES_JSON:JSON.stringify([ref])};
  assert.equal(officialIdentity(intent,'https://example.com/path',source,env)[0].data.verified,true);
  assert.equal(officialIdentity(intent,'https://example.com.other.org',source,env)[0].kind,'identity_mismatch');
  assert.equal(officialIdentity(intent,'https://example.com',source,{SCAMWIN_OFFICIAL_SOURCES_JSON:JSON.stringify([{...ref,reviewedAt:new Date(Date.now()-31*86400000).toISOString()}])})[0].status,'not_checked');
});
