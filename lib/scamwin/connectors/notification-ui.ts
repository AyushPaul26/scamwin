import type {BoundedPage,TargetManifest} from './contracts';
export type PrivateAlert={id:string;connectionId:string;epoch:number;revisionId:string|null;itemId:string|null;kind:'result'|'coverage'|'connection'|'quota';reason:string;counts:TargetManifest['counts'];revision:number;seenAt:string|null;createdAt:string;expiresAt:string};
export type PrivateAlertPage=BoundedPage<PrivateAlert> & {allResults:boolean;unreadCount:number};
export type PrivateOutcomeInput=Omit<PrivateAlert,'id'|'revision'|'seenAt'|'createdAt'|'expiresAt'> & {material:string;noticeId?:string};
