export function GET() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Fictional refund policy | Scamwin training fixture</title>
</head>
<body>
  <header><p><strong>Scamwin fictional training fixture. No real refund or payment.</strong></p></header>
  <main>
    <h1>Fictional Demo Refunds policy</h1>
    <p>This invented policy is an operator-owned reference for the Scamwin training example. Fictional Demo Refunds is not a real organization, and this page is not evidence about any real business.</p>
    <h2>Receiving a refund</h2>
    <p>Receiving a refund never requires an upfront fee. A request to send a processing payment contradicts this fictional policy.</p>
    <p>Fictional Demo Refunds never asks for a password or one-time code to release a refund.</p>
    <p>For a real offer, find the actual organization's website or contact independently and compare its instructions before acting.</p>
    <p><a href="/lab/refund-offer">Read the fictional offer</a></p>
  </main>
</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    },
  });
}
