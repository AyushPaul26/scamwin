import type {ConnectorSql} from './store';
import {ConnectorStoreError} from './store';
import {ownerSchema} from './contracts';

export async function readOwnerGeneration(db:ConnectorSql,owner:string):Promise<number>{
 ownerSchema.parse(owner);
 await db.query('INSERT INTO connector_owner_generations(owner_id,generation) VALUES($1,0) ON CONFLICT DO NOTHING',[owner]);
 return Number((await db.query('SELECT generation FROM connector_owner_generations WHERE owner_id=$1',[owner])).rows[0].generation);
}
/** Must run inside the caller's write transaction, before taking connection locks. */
export async function assertOwnerGeneration(db:ConnectorSql,owner:string,expected:number):Promise<void>{
 ownerSchema.parse(owner);
 await db.query('INSERT INTO connector_owner_generations(owner_id,generation) VALUES($1,0) ON CONFLICT DO NOTHING',[owner]);
 const row=(await db.query('SELECT generation FROM connector_owner_generations WHERE owner_id=$1 FOR UPDATE',[owner])).rows[0];
 if(!row||!Number.isSafeInteger(expected)||Number(row.generation)!==expected)throw new ConnectorStoreError('owner_data_erased');
}
/** Caller retains the owner lock until local disconnection/erasure commits. */
export async function advanceOwnerGeneration(db:ConnectorSql,owner:string):Promise<number>{
 await readOwnerGeneration(db,owner);
 return Number((await db.query('UPDATE connector_owner_generations SET generation=generation+1 WHERE owner_id=$1 RETURNING generation',[owner])).rows[0].generation);
}
