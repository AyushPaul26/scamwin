export function GET() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Fictional refund offer | Scamwin training fixture</title>
</head>
<body>
  <header><p><strong>Scamwin fictional training fixture. No real refund or payment.</strong></p></header>
  <main>
    <h1>Fictional Demo Refunds offer</h1>
    <p>This invented offer claims: Your refund of ₹2,499 is ready. Receive your refund at no cost.</p>
    <p>Follow the owned checkpoint page to inspect how a promised refund can lead to an outgoing fee request. This example does not represent a real organization.</p>
    <p><a data-scamwin-checkpoint href="/lab/refund-checkpoint">Review the fictional refund checkpoint</a></p>
    <p>No information is collected and there is no refund to claim.</p>
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
