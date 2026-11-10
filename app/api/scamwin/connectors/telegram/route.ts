import {telegramWebhook} from '@/lib/scamwin/connectors/telegram-webhook';
import {telegramServices} from '@/lib/scamwin/connectors/telegram-server';

export const maxDuration=55;
export async function POST(request:Request){
 return telegramWebhook(request,{secret:process.env.SCAMWIN_TELEGRAM_WEBHOOK_SECRET,handle:value=>telegramServices().service.handleUpdate(value)});
}
