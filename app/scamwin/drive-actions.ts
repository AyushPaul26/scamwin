'use server';
import {getOptionalSession} from '@/lib/auth0';
import {ConnectorStoreError} from '@/lib/scamwin/connectors/store';
import {connectorError} from '@/lib/scamwin/connectors/account-server';
import {driveServices} from '@/lib/scamwin/connectors/drive-server';
async function run<T>(work:(owner:string,service:ReturnType<typeof driveServices>['service'])=>Promise<T>){try{const session=await getOptionalSession();if(!session?.user.sub)throw new ConnectorStoreError('unauthenticated');return {ok:true as const,data:await work(session.user.sub,driveServices().service)};}catch(e){const code=e instanceof ConnectorStoreError?e.code:'';const messages:Record<string,string>={drive_selection_required:'Choose and save files opened from Drive before importing.',drive_automatic_pilot_required:'Automatic checking remains unavailable until the Drive recovery pilot is accepted.',drive_revision_changed:'This file changed while reading. Refresh and import its current version.',drive_identity_required:'Open the file with Scamwin from the connected Google account.',drive_selection_invalid:'Open selected files from the Drive Open with menu.'};return messages[code]?{ok:false as const,code,error:messages[code]}:connectorError(e);}}
export async function driveStatusAction(input:unknown){return run((o,s)=>s.status(o,input));}
export async function saveDriveSettingsAction(input:unknown){return run((o,s)=>s.configure(o,input));}
export async function importDriveFileAction(input:unknown){return run((o,s)=>s.importFile(o,input));}
