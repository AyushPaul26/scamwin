import { connectorDispatch } from '@/lib/scamwin/connectors/runtime-server';
export const maxDuration=300;
export async function POST(request:Request){return connectorDispatch('drain',request);}
