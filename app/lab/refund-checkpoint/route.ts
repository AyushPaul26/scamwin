export function GET() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Fictional refund fee checkpoint | Scamwin training fixture</title>
</head>
<body>
  <header><p><strong>Scamwin fictional training fixture. No real refund or payment.</strong></p></header>
  <main>
    <h1>Fictional Demo Refunds checkpoint</h1>
    <p>This invented offer claims: Your refund of ₹2,499 is ready. Receive your refund at no cost.</p>
    <h2>Fictional advance fee request</h2>
    <p>The checkpoint instead asks for a processing fee of ₹499 before the refund is released. This is an outgoing payment request, despite the promise of receiving money.</p>
    <p>The synthetic recipient is <code>scamwin-fictional-recipient@example.invalid</code>. It is a deliberately invalid training value, not a real payment recipient.</p>
    <p><a data-scamwin-checkpoint inert aria-disabled="true" tabindex="-1" href="upi://pay?pa=scamwin-fictional-recipient%40example.invalid&amp;pn=Fictional%20Demo&amp;am=499&amp;cu=INR">Fictional request: pay ₹499 processing fee (disabled)</a></p>
    <p>The payment-shaped link is inert and cannot be activated. Scamwin can inspect its metadata without opening a payment application. No payment, credentials, or other information can be submitted here.</p>
    <p><a href="/lab/refund-offer">Read the fictional refund offer</a></p>
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
