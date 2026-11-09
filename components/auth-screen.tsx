import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getOptionalSession, isAuthConfigured } from '@/lib/auth0';
import { Shell, Notice } from '@/components/scamwin/core';

export function AuthScreen({ mode }: { mode: 'signin' | 'signup' }) {
  return <Shell marketing><Suspense fallback={<p role="status">Checking your session…</p>}><AuthContent mode={mode} /></Suspense></Shell>;
}
async function AuthContent({ mode }: { mode: 'signin' | 'signup' }) {
  const session = await getOptionalSession();
  if (session?.user.sub) redirect('/check');
  const configured = isAuthConfigured(), signup = mode === 'signup';
  return <section className="sw-main" style={{ maxWidth: 640, paddingTop: 80, paddingBottom: 100 }}>
    <p className="sw-eyebrow">Your private workspace</p><h1 style={{ fontSize: 'clamp(2.4rem,6vw,4rem)', letterSpacing: '-.05em', lineHeight: 1.05 }}>{signup ? 'Start with a clearer view.' : 'Welcome back.'}</h1>
    <p className="sw-description" style={{ marginTop: 24 }}>Save your checks, inspect the evidence, and ask questions before you act. Your private evidence stays separate from shared warnings.</p>
    <div style={{ marginTop: 32 }}>{configured ? <a className="sw-btn sw-btn-primary" href={`/auth/login?returnTo=/check${signup ? '&screen_hint=signup' : ''}`}>Continue securely with Auth0</a> : <Notice title="Sign-in setup is pending">Auth0 credentials have not been added yet. You can explore the read-only sample cases now.</Notice>}</div>
    <p style={{ marginTop: 24 }}><Link href="/demo" className="sw-small-link">Explore a sample check →</Link></p>
    {configured && <p style={{ marginTop: 24 }}><Link href={signup ? '/sign-in' : '/sign-up'} className="sw-small-link">{signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</Link></p>}
  </section>;
}
