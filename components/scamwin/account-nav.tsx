'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {accountLinks} from '@/lib/scamwin/connectors/ui';
export function AccountNav(){const path=usePathname();return <nav className="sw-account-nav" aria-label="Account navigation">{accountLinks.map(l=><Link key={l.href} href={l.href} aria-current={path===l.href?'page':undefined}>{l.label}</Link>)}</nav>;}
