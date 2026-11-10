import {z} from 'zod';
import type {ScamwinStore} from '../contracts';
import type {ConnectorStore,Activity,BoundedPage} from './contracts';
import type {ConnectorDatabase} from './store';
import {ConnectorStoreError} from './store';
import {listInput} from './ui';
export type UnifiedActivity=Omit<Activity,'kind'> & {kind:Activity['kind']|'manual';checkHref?:string};
/** Main history is read by owner on demand; no duplicate check dataset or retained inputs. */
export class ConnectorActivityService{
 constructor(private db:ConnectorDatabase,private connector:ConnectorStore,private main:ScamwinStore){}
 async list(owner:string,input:unknown):Promise<BoundedPage<UnifiedActivity>>{
  const p=listInput.parse(input);if(p.filter!=='manual')return this.connector.listActivity(owner,{...p,limit:20});
  let page=1,offset=0;if(p.before)try{const c=z.object({page:z.number().int().min(1).max(1000),offset:z.number().int().min(0).max(19)}).strict().parse(JSON.parse(Buffer.from(p.before,'base64url').toString('utf8')));page=c.page;offset=c.offset;}catch{throw new ConnectorStoreError('invalid_cursor');}
  const items:UnifiedActivity[]=[];for(let scanned=0;scanned<25;scanned++,page++,offset=0){
   const history=await this.main.listChecks(owner,{page,query:p.query});
   const admissions=new Set((await this.db.query('SELECT admission_key FROM connector_jobs WHERE owner_id=$1 AND admission_key=ANY($2::text[])',[owner,history.checks.map(c=>c.submissionKey)])).rows.map(r=>String(r.admission_key)));
   for(let i=offset;i<history.checks.length;i++){const check=history.checks[i];if(admissions.has(check.submissionKey))continue;items.push({id:check.id,connectionId:'',epoch:0,kind:'manual',reason:check.state,count:1,createdAt:check.createdAt,expiresAt:check.expiresAt,checkHref:`/checks/${encodeURIComponent(check.id)}`});if(items.length===20){const more=i+1<history.checks.length||page*history.pageSize<history.total;return {items,nextCursor:more?Buffer.from(JSON.stringify(i+1<history.checks.length?{page,offset:i+1}:{page:page+1,offset:0})).toString('base64url'):null};}}
   if(page*history.pageSize>=history.total)return {items,nextCursor:null};
  }
  return {items,nextCursor:Buffer.from(JSON.stringify({page,offset:0})).toString('base64url')};
 }
}
