/** Harmless operator-owned fixture for verifying remote watch-only input containment. */
export function GET() {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Watch-only inspection test | Scamwin</title>
<style>body{font:18px system-ui;background:#141414;color:#f2f1f4;max-width:800px;padding:40px;margin:auto}input{font:inherit;padding:14px;border:1px solid #a6a5ad;background:#080808;color:#b8ccff;width:90%}p{line-height:1.7}a{color:#b8ccff}</style></head>
<body><main>
<p>Scamwin controlled test fixture · no real offer or payment</p><h1>A browser you can watch</h1>
<p>This field is an input canary. A watch-only viewer must not change its value, follow the link or resize this remote page.</p>
<label for="canary">Synthetic canary value</label><p><input id="canary" value="SCAMWIN-WATCH-ONLY" autocomplete="off"></p>
<p><a id="canary-link" href="#navigation-canary">Navigation canary</a></p>
<p><a inert aria-disabled="true" tabindex="-1" data-scamwin-checkpoint href="upi://pay?pa=scamwin-fictional-recipient%40example.invalid&amp;am=499&amp;cu=INR">Fictional processing fee: pay ₹499 (disabled)</a></p>
<p>No form can be submitted. No personal information, API credentials or real payment details belong here.</p>
</main></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    },
  });
}
