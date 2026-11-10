import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ConnectionRef,ConnectionSettings,SavedConnection} from './contracts';
import type {ActivationBaseline} from './oauth-contracts';
import {PostgresConnectorStore,ConnectorStoreError,type ConnectorDatabase,type ConnectorSql} from './store';
import {privateIdentifier,sealConnectorSecret,openConnectorSecret,type ConnectorKeyring} from './crypto';
export const driveFileId=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const driveResourceKey=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const openState=z.object({action:z.literal('open'),ids:z.array(driveFileId).max(50).optional(),userId:z.string().min(1).max(512).optional(),exportIds:z.array(driveFileId).max(50).optional(),resourceKeys:z.record(driveFileId,driveResourceKey).optional()}).strict();
export function parseDriveOpenState(value:string){if(Buffer.byteLength(value)>16384)throw new ConnectorStoreError('drive_selection_invalid');try{const parsed=openState.parse(JSON.parse(value)),all=[...(parsed.ids??[]),...(parsed.exportIds??[])];if(!all.length||all.length>50||new Set(all).size!==all.length||Object.keys(parsed.resourceKeys??{}).some(id=>!all.includes(id)))throw new Error();return {...parsed,ids:all};}catch{throw new ConnectorStoreError('drive_selection_invalid');}}
export type DriveResource={handle:string;fileId:string;label:string;mimeType:string;resourceKey?:string};
export class DriveStore{
 constructor(readonly database:ConnectorDatabase,private readonly keyring:ConnectorKeyring,readonly now:()=>Date=()=>new Date()){}
 private at(){return this.now().toISOString();}
 private bind(c:ConnectionRef,id:string){return {ownerId:c.ownerId,connectionId:`${c.id}:drive:${id}`,epoch:c.epoch,purpose:'identifier' as const};}
 private seal(c:ConnectionRef,r:DriveResource){return sealConnectorSecret(JSON.stringify(r),this.bind(c,r.handle),this.keyring);}
 private open(c:ConnectionRef,row:Record<string,unknown>):DriveResource{return JSON.parse(openConnectorSecret(String(row.encrypted_value),this.bind(c,String(row.handle)),this.keyring));}
 private async current(db:ConnectorSql,c:ConnectionRef,lock=false){if(c.provider!=='drive')throw new ConnectorStoreError('connection_unavailable');const row=(await db.query(`SELECT * FROM connector_connections WHERE id=$1 AND owner_id=$2 AND epoch=$3 AND provider='drive' AND status<>'disconnected'${lock?' FOR UPDATE':''}`,[c.id,c.ownerId,c.epoch])).rows[0];if(!row)throw new ConnectorStoreError('connection_unavailable');return row;}
 async saveResource(c:ConnectionRef,value:Omit<DriveResource,'handle'>){driveFileId.parse(value.fileId);if(value.resourceKey!==undefined)driveResourceKey.parse(value.resourceKey);if(!value.label||value.label.length>200||value.mimeType.length>150)throw new ConnectorStoreError('drive_selection_invalid');return this.database.transaction(async db=>{
  await this.current(db,c,true);const key=privateIdentifier(value.fileId,this.bind({...c,epoch:1},'resource-key'),this.keyring),old=(await db.query('SELECT * FROM connector_drive_resources WHERE connection_id=$1 AND resource_key=$2',[c.id,key])).rows[0];
  if(!old&&Number((await db.query('SELECT count(*) AS n FROM connector_drive_resources WHERE connection_id=$1',[c.id])).rows[0].n)>=50)throw new ConnectorStoreError('drive_selection_limit');
  const r={...value,handle:old?String(old.handle):randomUUID()};await db.query('INSERT INTO connector_drive_resources(handle,connection_id,owner_id,epoch,resource_key,encrypted_value,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(handle) DO UPDATE SET epoch=excluded.epoch,encrypted_value=excluded.encrypted_value,expires_at=excluded.expires_at',[r.handle,c.id,c.ownerId,c.epoch,key,this.seal(c,r),new Date(this.now().getTime()+30*86400000).toISOString()]);return r;
 });}
 async resources(c:ConnectionRef,selectedOnly=true){const current=await this.current(this.database,c),scope=Array.isArray(current.scope)?current.scope:JSON.parse(String(current.scope));const rows=(await this.database.query('SELECT * FROM connector_drive_resources WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND expires_at>$4 ORDER BY handle LIMIT 50',[c.id,c.ownerId,c.epoch,this.at()])).rows;return rows.filter(r=>!selectedOnly||scope.includes(r.handle)).map(r=>this.open(c,r));}
 async configure(c:SavedConnection,settings:ConnectionSettings,baseline?:ActivationBaseline){return this.database.transaction(async db=>{
  await this.current(db,c,true);const rows=(await db.query('SELECT * FROM connector_drive_resources WHERE connection_id=$1 AND owner_id=$2 AND epoch=$3 AND expires_at>$4',[c.id,c.ownerId,c.epoch,this.at()])).rows;
  if(settings.scope.some(h=>!rows.some(r=>r.handle===h))&&!(settings.mode==='manual'&&settings.scope.length===1&&settings.scope[0]==='unselected'))throw new ConnectorStoreError('drive_selection_required');
  const scoped:ConnectorDatabase={query:db.query.bind(db),transaction:fn=>fn(db)},next=await new PostgresConnectorStore(scoped,{keyring:this.keyring,now:this.now}).configureConnection(c,settings,baseline);
  for(const row of rows){const r=this.open(c,row);await db.query('UPDATE connector_drive_resources SET epoch=$1,encrypted_value=$2 WHERE handle=$3',[next.epoch,this.seal(next,r),r.handle]);}return next;
 });}
}
