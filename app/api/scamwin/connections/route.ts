import {connectorRead} from '@/lib/scamwin/connectors/account-server';
export async function POST(request:Request){return connectorRead(request,'connections');}
