import {activityRead} from '@/lib/scamwin/connectors/activity-server';
export async function POST(request:Request){return activityRead(request);}
