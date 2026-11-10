import type {ScamwinStore} from '../contracts';
import {PostgresConnectorStore,type ConnectorDatabase} from './store';
import type {ConnectorKeyring} from './crypto';
import {advanceOwnerGeneration} from './privacy-fence';
import {eraseSupplementalData} from './supplemental-data';
import {PrivateNotificationStore} from './notification-store';
import {CONNECTOR_ADMISSION_WINDOW_MS} from './limits';
import {ownerSchema} from './contracts';

export class ConnectorPrivacyService{
 constructor(private db:ConnectorDatabase,private keyring:ConnectorKeyring,private main:Pick<ScamwinStore,'lookupCheckAdmission'|'requestCancel'|'deleteCheck'>){}
 async erase(owner:string){
  ownerSchema.parse(owner);
  await this.db.transaction(async sql=>{
   await advanceOwnerGeneration(sql,owner);
   const scoped:ConnectorDatabase={query:sql.query.bind(sql),transaction:fn=>fn(sql)},core=new PostgresConnectorStore(scoped,{keyring:this.keyring});
   const connections=(await sql.query('SELECT id,epoch FROM connector_connections WHERE owner_id=$1 ORDER BY id FOR UPDATE',[owner])).rows;
   for(const c of connections)await core.revokeConnection(owner,String(c.id),Number(c.epoch));
   // Capture unresolved admission keys as well as known children before deleting connector data.
   await sql.query(`INSERT INTO connector_erasure_checks(id,check_id,owner_id,admission_key,admission_deadline_at,created_at)
    SELECT id,check_id,owner_id,admission_key,COALESCE(admission_attempted_at,created_at)+($2::int * interval '1 millisecond'),$3 FROM connector_jobs WHERE owner_id=$1 AND (check_id IS NOT NULL OR admission_attempted_at IS NOT NULL) ON CONFLICT(id) DO NOTHING`,[owner,CONNECTOR_ADMISSION_WINDOW_MS,new Date().toISOString()]);
   await eraseSupplementalData(sql,owner);
   await new PrivateNotificationStore(scoped).deleteAccount(owner);
   await sql.query('DELETE FROM connector_oauth_flows WHERE owner_id=$1',[owner]);
   await sql.query('DELETE FROM connector_activity WHERE owner_id=$1',[owner]);
   await sql.query('DELETE FROM connector_connections WHERE owner_id=$1',[owner]);
  });
  return this.cleanup(owner);
 }
 async cleanup(owner?:string,deadlineAt=Infinity){
  // Main private checks expire after 30 days; cleanup references are bounded to 90 days.
  await this.db.query("DELETE FROM connector_erasure_checks WHERE created_at < now()-interval '90 days'");
  const rows=(await this.db.query('SELECT * FROM connector_erasure_checks WHERE ($1::text IS NULL OR owner_id=$1) ORDER BY created_at,id LIMIT 10',[owner??null])).rows;
  for(const row of rows){if(Date.now()>=deadlineAt)break;try{
   const subject=String(row.owner_id);let id=row.check_id?String(row.check_id):null;
   if(!id){const result=await this.main.lookupCheckAdmission(subject,String(row.admission_key),new Date(String(row.admission_deadline_at)).toISOString());if(result.status==='pending')continue;if(result.status==='existing'||result.status==='terminal_unavailable')id=result.checkId;}
   if(id){await this.main.requestCancel(subject,id);await this.main.deleteCheck(subject,id);}
   await this.db.query('DELETE FROM connector_erasure_checks WHERE id=$1 AND owner_id=$2',[row.id,subject]);
  }catch{/* Preserve the durable reference for an owner retry or independent scheduler wakeup. */}}
  const pending=Number((await this.db.query('SELECT count(*) AS count FROM connector_erasure_checks WHERE ($1::text IS NULL OR owner_id=$1)',[owner??null])).rows[0].count);
  return {erased:true as const,cleanupPending:pending>0};
 }
}
