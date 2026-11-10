import {Suspense,type ReactNode} from 'react';
import {AccountNav} from '@/components/scamwin/account-nav';
export default function AccountLayout({children}:{children:ReactNode}){return <><Suspense><AccountNav/></Suspense>{children}</>;}
