import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveViewClient, acceptLiveViewResponse, disclosureForRun, livePanelState, requestOwnedLiveView } from "../lib/scamwin/live-view-client";
import { LiveInspection, LiveInspectionView } from "../components/scamwin/live-inspection";
import { InvestigationProgress } from "../components/scamwin/investigation-progress";
import type { LiveViewResponse } from "../lib/scamwin/live-view-contracts";

const identity = { checkId: "check", runId: "run", generation: 1 };
const ready: LiveViewResponse = { state: "ready", sessionId: "session", runId: "run", generation: 1, viewerUrl: "https://production-sfo.browserless.io/live/?id=synthetic", issuedAt: "2026-11-10T12:00:00.000Z", expiresAt: "2026-11-10T12:00:30.000Z" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("live responses reject other runs, keep a session URL stable and never regress a terminal state", () => {
  assert.equal(acceptLiveViewResponse(identity, null, { ...ready, runId: "old" }), null);
  assert.equal(acceptLiveViewResponse(identity, ready, { ...ready, viewerUrl: "https://other.example/live/" }), ready);
  const live = { ...ready, state: "live" as const };
  assert.equal(acceptLiveViewResponse(identity, live, ready)?.state, "live");
  const ended = { state: "ended" as const, runId: "run", generation: 1 };
  assert.equal(acceptLiveViewResponse(identity, ended, ready), ended);
});
test("visibility changes never overlap requests and abandoned responses cannot publish", async () => {
  const pending = deferred<LiveViewResponse>(); let calls = 0, visible = true;
  const states: string[] = [], scheduled: { callback: () => void; delay: number }[] = [];
  const client = new LiveViewClient(identity, {
    request: async () => { calls++; return pending.promise; }, isVisible: () => visible,
    publish: snapshot => states.push(snapshot.response?.state ?? "starting"), now: () => Date.parse("2026-11-10T12:00:00Z"),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; }, cancel: () => {},
  });
  client.start(); client.visibilityChanged(); visible = false; client.visibilityChanged();
  assert.equal(calls, 1);
  pending.resolve(ready); await tick();
  assert.equal(scheduled.at(-1)?.delay, 10000);
  client.dispose(); scheduled.at(-1)?.callback(); await tick(); assert.equal(calls, 1);
  assert.deepEqual(states, ["ready"]);
  const late = deferred<LiveViewResponse>(); const ignored: string[] = [];
  const abandoned = new LiveViewClient(identity, { request: () => late.promise, isVisible: () => true, publish: s => ignored.push(s.response?.state ?? "starting") });
  abandoned.start(); abandoned.dispose(); late.resolve(ready); await tick(); assert.deepEqual(ignored, []);
});
test('preparation fetches only while visible and uses the short preparation interval', async () => {
  let visible = false, calls = 0;
  const scheduled: { callback: () => void; delay: number }[] = [];
  const client = new LiveViewClient(identity, {
    request: async () => { calls++; return { state: 'starting', runId: identity.runId, generation: identity.generation }; },
    isVisible: () => visible, publish: () => {},
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return callback; }, cancel: () => {},
  });
  client.start(); await tick(); assert.equal(calls, 0);
  scheduled.at(-1)!.callback(); await tick(); assert.equal(calls, 0);
  visible = true; client.visibilityChanged(); await tick();
  assert.equal(calls, 1); assert.equal(scheduled.at(-1)?.delay, 1000);
  client.dispose();
});
test("terminal responses stop polling, expiry strips the locator and reconnect reuses the current identity", async () => {
  let now = Date.parse("2026-11-10T12:00:00Z"), calls = 0;
  const queued: (() => void)[] = [], states: { state?: string; url?: string }[] = [];
  const client = new LiveViewClient(identity, { request: async requested => { assert.deepEqual(requested, identity); calls++; return ready; }, isVisible: () => true,
    publish: s => states.push({ state: s.response?.state, url: s.response && "viewerUrl" in s.response ? s.response.viewerUrl : undefined }), now: () => now,
    schedule: cb => { queued.push(cb); return cb; }, cancel: () => {},
  });
  client.start(); await tick(); client.reconnect(); await tick(); assert.equal(calls, 2);
  now += 31000; queued.at(-1)!(); await tick(); assert.equal(calls, 2); assert.deepEqual(states.at(-1), { state: "expired", url: undefined });
  client.dispose();
  const terminalTimers: number[] = [];
  const terminal = new LiveViewClient(identity, { request: async () => ({ state: "ended", runId: "run", generation: 1 }), isVisible: () => true, publish: () => {}, schedule: (_cb, delay) => { terminalTimers.push(delay); return delay; }, cancel: () => {} });
  terminal.start(); await tick(); terminal.reconnect(); assert.deepEqual(terminalTimers, []); terminal.dispose();
});
test("auto expansion preserves manual collapse and resets only for a new run", () => {
  const initial = disclosureForRun(null, "first", true);
  assert.equal(initial.open, true);
  assert.equal(disclosureForRun(initial, "first", false).open, true);
  assert.equal(disclosureForRun({ ...initial, open: false, chosen: true }, "first", true).open, false);
  assert.equal(disclosureForRun({ ...initial, open: false, chosen: true }, "next", true).open, true);
  assert.equal(livePanelState({ active: true, demo: true, response: ready, error: "" }), "unavailable");
  assert.equal(livePanelState({ active: false, response: ready, error: "" }), "ended");
});
test("waiting for a first viewer stops after the browser budget rather than polling indefinitely", async () => {
  let now=0, calls=0; const queue: (()=>void)[]=[], states: string[]=[];
  const client=new LiveViewClient(identity,{request:async()=>{calls++;return {state:"starting",runId:"run",generation:1};},isVisible:()=>true,now:()=>now,publish:s=>states.push(s.response?.state??"none"),schedule:cb=>{queue.push(cb);return cb;},cancel:()=>{}});
  client.start();await tick();now=60001;queue.at(-1)!();await tick();
  assert.equal(calls,1);assert.equal(states.at(-1),"unavailable");client.dispose();
});
test("owner requests use bounded identity headers and erase locators when authentication ends",async t=>{
  const requests: {url:string;init?:RequestInit}[]=[];
  t.mock.method(globalThis,"fetch",async(url:string,init?:RequestInit)=>{requests.push({url,init});return Response.json(ready);});
  const controller=new AbortController();assert.deepEqual(await requestOwnedLiveView(identity,controller.signal),ready);
  assert.equal(requests[0].url,"/api/scamwin/checks/check/live-view");assert.deepEqual(requests[0].init?.headers,{"X-Scamwin-Run-Id":"run","X-Scamwin-Generation":"1"});assert.equal(requests[0].init?.cache,"no-store");
  t.mock.restoreAll();t.mock.method(globalThis,"fetch",async()=>new Response(null,{status:401}));
  assert.deepEqual(await requestOwnedLiveView(identity,controller.signal),{state:"unavailable",runId:"run",generation:1});
  t.mock.restoreAll();t.mock.method(globalThis,"fetch",async()=>Response.json({...ready,viewerUrl:"javascript:alert(1)"}));
  await assert.rejects(requestOwnedLiveView(identity,controller.signal),/invalid_response/);
});
test("SSR viewer is watch-only, retains its hidden frame on collapse and tears it down at end", () => {
  const props = { ...identity, hostname: "offers.example", open: true, onToggle: () => {}, state: "ready" as const, response: ready };
  const html = renderToStaticMarkup(createElement(LiveInspectionView, props));
  assert.match(html, /sandbox="allow-scripts allow-same-origin"/); assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /tabIndex="-1"/i); assert.match(html, /camera &#x27;none&#x27;/); assert.match(html, /Connecting/);
  assert.doesNotMatch(html, /onload|allow-forms|allow-popups/);
  const collapsed = renderToStaticMarkup(createElement(LiveInspectionView, { ...props, open: false }));
  assert.match(collapsed, /<iframe/); assert.match(collapsed, /hidden=""/);
  const ended = renderToStaticMarkup(createElement(LiveInspectionView, { ...props, state: "ended", capture: { url: "/api/scamwin/artifacts/capture", observedAt: "2026-11-10T12:00:20Z" } }));
  assert.doesNotMatch(ended, /<iframe/); assert.match(ended, /Captured screenshot/); assert.match(ended, /<time/);
  assert.doesNotMatch(ended,/sw-live-placeholder/);
  const unavailable = renderToStaticMarkup(createElement(LiveInspectionView,{...props,state:"unavailable",onCancel:()=>{},capture:{url:"/api/scamwin/artifacts/capture",observedAt:"2026-11-10T12:00:20Z",expiresAt:"2020-01-01T00:00:00Z"}}));
  assert.match(unavailable,/Cancel check/);assert.doesNotMatch(unavailable,/<img/);
});
test("SSR auto-opens only an actual running browser and keeps demos and unavailable checks closed",()=>{
  const props={...identity,browserStage:{id:"browser",label:"Observing the website",status:"running" as const}};
  const active=renderToStaticMarkup(createElement(LiveInspection,props));
  assert.match(active,/aria-expanded="true"/);assert.match(active,/Preparing the website view/);assert.doesNotMatch(active,/<iframe/);
  const demo=renderToStaticMarkup(createElement(LiveInspection,{...props,demo:true}));
  assert.match(demo,/aria-expanded="false"/);assert.doesNotMatch(demo,/<iframe/);
  const unavailable=renderToStaticMarkup(createElement(LiveInspection,{...props,liveStatus:{state:"unavailable",runId:"run",generation:1}}));
  assert.match(unavailable,/aria-expanded="false"/);assert.doesNotMatch(unavailable,/<iframe/);
});
test("SSR progress keeps factual skipped/canceled states, timestamps and readable browser detail", () => {
  const html = renderToStaticMarkup(createElement(InvestigationProgress, { createdAt: "2026-11-10T12:00:00Z", stages: [
    { id: "browser", label: "Observing the website", status: "canceled", startedAt: "2026-11-10T12:00:01Z", finishedAt: "2026-11-10T12:00:04Z", detailCode: "capture" },
    { id: "trust", label: "Checking the connection", status: "skipped" },
  ] }));
  assert.match(html, /Canceled/); assert.match(html, /Skipped/); assert.match(html, /Capturing the page/); assert.match(html, /3s/);
  assert.doesNotMatch(html, /\d+%|aria-valuenow|>capture</);
});
