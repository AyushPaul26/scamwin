/** Explicit operator acceptance: one synthetic remote page, no app records or real offers.
 * node --env-file=.env.local --import tsx scripts/check-scamwin-live-embed.ts
 * Prints fixed flags/counts only. The screenshot contains only the synthetic stream canvas.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { adaptBrowserlessCdp, createWatchOnlyLiveView, closeWatchOnlyLiveView, isApprovedLiveViewUrl, subscribeWatchOnlyLiveView, type BrowserlessCdp, type WatchOnlyLiveView } from '../lib/scamwin/live-view-provider';

async function main() {
  const deadline = Date.now() + 60_000;
  const remaining = () => Math.max(1, deadline - Date.now());
  const bounded = <T>(operation: () => Promise<T>, ms = remaining()): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('acceptance_timeout')), ms);
    Promise.resolve().then(operation).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(Error('acceptance_operation_failed')); });
  });
  let remote: Browser | undefined, local: Browser | undefined, cdp: BrowserlessCdp | undefined, view: WatchOnlyLiveView | undefined;
  let unsubscribe: (() => void) | undefined;
  let phase = 'configure', failureCode: string | undefined;
  let supported = false, frameReceived = false, iframeRestricted = false, inputBlocked = false, navigationBlocked = false, viewportPreserved = false, closeAcknowledged = false;
  let connectedCount = 0, appliedLifetimeMs = 0;
  try {
    const providerOrigin = process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io';
    if (!process.env.BROWSERLESS_TOKEN || !isApprovedLiveViewUrl(`${providerOrigin.replace(/\/$/, '')}/live/?i=validation`, providerOrigin)) throw Error('acceptance_configuration');
    phase = 'launch_local';
    local = await bounded(() => chromium.launch({ channel: 'chrome', headless: true, timeout: Math.min(15_000, remaining()) }));
    const localPage = await bounded(() => local!.newPage({ viewport: { width: 1280, height: 900 } }));
    localPage.setDefaultTimeout(5000);
    const endpoint = new URL(providerOrigin);
    endpoint.protocol = 'wss:'; endpoint.pathname = '/chromium'; endpoint.searchParams.set('token', process.env.BROWSERLESS_TOKEN); endpoint.searchParams.set('timeout', String(remaining()));
    phase = 'connect_remote';
    remote = await bounded(() => chromium.connectOverCDP(endpoint.href, { timeout: Math.min(20_000, remaining()) }));
    const context = await bounded(() => remote!.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block', acceptDownloads: false, permissions: [] }));
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const remotePage = await bounded(() => context.newPage());
    remotePage.setDefaultTimeout(5000);
    await bounded(() => remotePage.setContent('<!doctype html><html><head><title>Synthetic Scamwin viewer acceptance</title><style>body{margin:0;background:#101828;color:white;font:24px sans-serif}header{height:80px;background:#ea4b8b;padding:20px;box-sizing:border-box}main{padding:50px 100px}input{display:block;width:350px;height:46px;font:24px sans-serif;margin:20px 0}a{display:block;margin-top:40px;color:#92c4ff}</style></head><body><header>Synthetic stream acceptance — no real offer</header><main><h1>Watch-only controlled canary</h1><label>Editable test field<input id="canary" value="SAFE_ORIGINAL"></label><a id="navigation" href="#changed">Synthetic navigation canary</a><p>No account, payment or private information is present.</p></main></body></html>'));
    cdp = adaptBrowserlessCdp(await context.newCDPSession(remotePage));
    phase = 'mint';
    view = await createWatchOnlyLiveView(cdp, { providerOrigin, providerToken: process.env.BROWSERLESS_TOKEN, remainingMs: remaining() });
    supported = true; appliedLifetimeMs = view.timeoutMs;
    let connected!: () => void;
    const attached = new Promise<void>(resolve => { connected = resolve; });
    unsubscribe = subscribeWatchOnlyLiveView(cdp, view, { onConnected: () => { connectedCount++; connected(); } });
    phase = 'embed';
    await localPage.setContent('<!doctype html><html><head><style>html,body{margin:0;background:#080808}iframe{display:block;width:100%;max-width:1200px;height:800px;border:0;pointer-events:none}</style></head><body><iframe id="viewer" title="Watch-only synthetic Browserless inspection" tabindex="-1" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" allow="camera \'none\'; microphone \'none\'; geolocation \'none\'; clipboard-read \'none\'; clipboard-write \'none\'"></iframe></body></html>');
    const iframe = localPage.locator('#viewer');
    iframeRestricted = await iframe.evaluate(element => element.getAttribute('sandbox') === 'allow-scripts allow-same-origin' && element.getAttribute('tabindex') === '-1' && element.getAttribute('referrerpolicy') === 'no-referrer' && getComputedStyle(element).pointerEvents === 'none' && ['camera', 'microphone', 'geolocation', 'clipboard-read', 'clipboard-write'].every(name => element.getAttribute('allow')!.includes(`${name} 'none'`)));
    await iframe.evaluate((element, source) => { (element as HTMLIFrameElement).src = source; }, view.liveURL);
    await bounded(() => attached, Math.min(15_000, remaining()));
    const frame = localPage.frames().find(candidate => candidate.parentFrame());
    if (!frame) throw Error('acceptance_frame_missing');
    const canvas = frame.locator('canvas').first();
    phase = 'stream';
    await canvas.waitFor({ state: 'visible', timeout: Math.min(10_000, remaining()) });
    let streamImage: Buffer | undefined;
    while (remaining() > 1000 && !frameReceived) {
      streamImage = await bounded(() => canvas.screenshot({ timeout: Math.min(3000, remaining()) }));
      const { data, info } = await sharp(streamImage).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let pink = 0, dark = 0;
      for (let offset = 0; offset < data.length; offset += info.channels) {
        if (Math.abs(data[offset] - 234) < 12 && Math.abs(data[offset + 1] - 75) < 12 && Math.abs(data[offset + 2] - 139) < 12) pink++;
        if (Math.abs(data[offset] - 16) < 10 && Math.abs(data[offset + 1] - 24) < 10 && Math.abs(data[offset + 2] - 40) < 10) dark++;
      }
      frameReceived = pink > 500 && dark > 5000;
      if (!frameReceived) await localPage.waitForTimeout(100);
    }
    if (!frameReceived) throw Error('acceptance_stream_missing');
    await mkdir(join(process.cwd(), '.trigger/live-ui'), { recursive: true });
    await canvas.screenshot({ path: join(process.cwd(), '.trigger/live-ui/provider-acceptance.png'), timeout: Math.min(3000, remaining()) });
    phase = 'input_probe';
    const inputBox = await remotePage.locator('#canary').boundingBox(), navigationBox = await remotePage.locator('#navigation').boundingBox(), canvasBox = await canvas.boundingBox();
    if (!inputBox || !navigationBox || !canvasBox) throw Error('acceptance_geometry_missing');
    const initialUrl = remotePage.url();
    // Remove only the local pointer shield to test the provider's authoritative rejection.
    await iframe.evaluate(element => { (element as HTMLIFrameElement).style.pointerEvents = 'auto'; });
    const clickRemote = async (box: { x: number; y: number; width: number; height: number }) => canvas.click({ force: true, position: { x: (box.x + box.width / 2) * canvasBox.width / 1200, y: (box.y + box.height / 2) * canvasBox.height / 800 }, timeout: Math.min(3000, remaining()) });
    await bounded(() => clickRemote(inputBox));
    await localPage.keyboard.press('Control+A'); await localPage.keyboard.type('ATTEMPTED_CHANGE');
    await bounded(() => clickRemote(navigationBox));
    phase = 'resize_probe';
    await localPage.setViewportSize({ width: 800, height: 700 });
    // This is an acceptance observation of viewer resize/input, not collector display padding.
    await localPage.waitForTimeout(300);
    inputBlocked = await remotePage.locator('#canary').inputValue() === 'SAFE_ORIGINAL';
    navigationBlocked = remotePage.url() === initialUrl;
    const viewport = await remotePage.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    viewportPreserved = viewport.width === 1200 && viewport.height === 800;
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    failureCode = /^(acceptance_[a-z_]+|live_view_[a-z_]+)$/.test(code) ? code : 'acceptance_operation_failed';
  } finally {
    unsubscribe?.();
    if (view && cdp) {
      try { await closeWatchOnlyLiveView(cdp, view.liveURLId); closeAcknowledged = true; }
      catch { failureCode = 'acceptance_close_unacknowledged'; }
    }
    await Promise.allSettled([remote, local].filter((browser): browser is Browser => !!browser).map(browser => bounded(() => browser.close(), 1500)));
  }
  const passed = supported && frameReceived && iframeRestricted && inputBlocked && navigationBlocked && viewportPreserved && closeAcknowledged && connectedCount > 0 && !failureCode;
  console.log(JSON.stringify({ passed, supported, frameReceived, iframeRestricted, inputBlocked, navigationBlocked, viewportPreserved, closeAcknowledged, connectedCount, appliedLifetimeMs, durationMs: 60_000 - remaining(), ...(failureCode ? { failureCode, failurePhase: phase } : {}) }));
  if (!passed) process.exitCode = 1;
}
void main();
