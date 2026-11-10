import {teamsWebhook} from '@/lib/scamwin/connectors/teams-webhook';
import {teamsServices} from '@/lib/scamwin/connectors/teams-server';
export async function POST(request:Request){
 // Callback reachability challenges do not construct database/auth services.
 return teamsWebhook(request,{enabled:()=>true,handle:value=>teamsServices().receive(value)});
}
