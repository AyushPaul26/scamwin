import {SourceInbox} from '@/components/scamwin/source-inbox';
export const metadata={title:'Imported item · Scamwin'};
export default async function Page({params}:{params:Promise<{id:string;itemId:string}>}){const {id,itemId}=await params;return <SourceInbox key={`${id}:${itemId}`} id={id} itemId={itemId}/>;}
