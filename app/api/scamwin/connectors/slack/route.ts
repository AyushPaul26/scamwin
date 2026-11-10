import '@/lib/scamwin/connectors/integration-server';
import {slackServices} from '@/lib/scamwin/connectors/slack-server';
import {slackWebhook} from '@/lib/scamwin/connectors/slack-webhook';
export async function POST(request:Request){try{const services=slackServices();return slackWebhook(request,{secret:services.signingSecret,appId:services.appId,handle:v=>services.webhook.handle(v)});}catch{return Response.json({ok:false},{status:503,headers:{'Cache-Control':'no-store'}});}}
