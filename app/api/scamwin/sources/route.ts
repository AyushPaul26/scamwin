import {sourceRead} from '@/lib/scamwin/connectors/source-server';
export async function POST(request:Request){return sourceRead(request);}
