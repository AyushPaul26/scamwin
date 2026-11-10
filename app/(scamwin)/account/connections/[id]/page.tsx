import {SourceInbox} from '@/components/scamwin/source-inbox';
export const metadata={title:'Source inbox · Scamwin'};
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <SourceInbox key={id} id={id}/>;}
