import {getTableConfig,type PgTable} from 'drizzle-orm/pg-core';
import * as telegram from '../../db/scamwin-telegram-schema';
import * as slack from '../../db/scamwin-slack-schema';
import * as teams from '../../db/scamwin-teams-schema';
import * as discord from '../../db/scamwin-discord-schema';
import * as drive from '../../db/scamwin-drive-schema';
import * as extension from '../../db/scamwin-extension-schema';
import type {ConnectorSql} from './store';
import {expireTelegramLinks} from './telegram-store';
export const supplementalTables:PgTable[]=[...Object.values(telegram),...Object.values(slack),...Object.values(teams),...Object.values(discord),...Object.values(drive),...Object.values(extension)];
/** Fixed schema names only; no caller-controlled identifiers. Cascades remove child rows. */
export async function purgeSupplementalData(db:ConnectorSql,now=new Date()){
 await expireTelegramLinks(db,now);
 for(const table of supplementalTables){const c=getTableConfig(table);
  if(c.name==='connector_telegram_links'){
   // Preserve any live link beyond this bounded expiry pass until a later pass can fence it.
   await db.query("DELETE FROM connector_telegram_links l WHERE l.expires_at<=$1 AND NOT EXISTS(SELECT 1 FROM connector_connections c WHERE c.id=l.connection_id AND c.owner_id=l.owner_id AND c.epoch=l.epoch AND c.provider='telegram' AND c.status<>'disconnected')",[now.toISOString()]);
   continue;
  }
  if(c.name==='connector_slack_installations'){
   await db.query("DELETE FROM connector_slack_installations s WHERE s.expires_at<=$1 AND NOT EXISTS(SELECT 1 FROM connector_connections c WHERE c.id=s.connection_id AND c.owner_id=s.owner_id AND c.provider='slack' AND c.status<>'disconnected' AND c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL)",[now.toISOString()]);
   continue;
  }
  if(c.name==='connector_slack_resources'){
   await db.query("DELETE FROM connector_slack_resources r WHERE r.expires_at<=$1 AND NOT EXISTS(SELECT 1 FROM connector_connections c WHERE c.id=r.connection_id AND c.owner_id=r.owner_id AND c.provider='slack' AND c.status<>'disconnected' AND c.encrypted_grant IS NOT NULL AND c.encrypted_identity IS NOT NULL AND c.scope ? r.id)",[now.toISOString()]);
   continue;
  }
  if(c.columns.some(v=>v.name==='expires_at'))await db.query(`DELETE FROM "${c.name}" WHERE expires_at<=$1`,[now.toISOString()]);
  if(c.columns.some(v=>v.name==='content_expires_at')&&c.columns.some(v=>v.name==='encrypted_value'))await db.query(`UPDATE "${c.name}" SET encrypted_value=NULL WHERE content_expires_at<=$1`,[now.toISOString()]);
 }
}
export async function eraseSupplementalData(db:ConnectorSql,owner:string){
 await db.query('DELETE FROM connector_telegram_pending_connections WHERE user_key IN (SELECT user_key FROM connector_telegram_links WHERE owner_id=$1)',[owner]);
 for(const table of supplementalTables){const c=getTableConfig(table);
  if(c.columns.some(v=>v.name==='owner_id'))await db.query(`DELETE FROM "${c.name}" WHERE owner_id=$1`,[owner]);
  else if(c.columns.some(v=>v.name==='connection_id'))await db.query(`DELETE FROM "${c.name}" WHERE connection_id IN (SELECT id FROM connector_connections WHERE owner_id=$1)`,[owner]);
 }
}
export async function eraseSupplementalConnection(db:ConnectorSql,owner:string,id:string){
 await db.query('DELETE FROM connector_telegram_pending_connections WHERE user_key IN (SELECT user_key FROM connector_telegram_links WHERE owner_id=$1 AND connection_id=$2)',[owner,id]);
 for(const table of supplementalTables){const c=getTableConfig(table);if(c.columns.some(v=>v.name==='connection_id'))await db.query(`DELETE FROM "${c.name}" WHERE connection_id=$2 AND EXISTS (SELECT 1 FROM connector_connections WHERE id=$2 AND owner_id=$1 AND status='disconnected')`,[owner,id]);}
}
