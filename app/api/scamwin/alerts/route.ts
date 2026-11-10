import {privateAlertsRead} from '@/lib/scamwin/connectors/notification-server';
export async function POST(request:Request){return privateAlertsRead(request);}
