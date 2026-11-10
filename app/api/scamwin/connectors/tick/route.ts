import { connectorDispatch } from '@/lib/scamwin/connectors/runtime-server';
export const maxDuration=55;
export async function POST(request:Request){return connectorDispatch('tick',request);}
