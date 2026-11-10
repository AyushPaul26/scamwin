import type {Risk} from '../contracts';
import type {BoundedPage,SourceItem,TargetManifest,ProviderId,ConnectionMode} from './contracts';
export type SourceCard=SourceItem & {counts:TargetManifest['counts']|null;coverage:TargetManifest['coverage']|null};
export type SourcePage=BoundedPage<SourceCard> & {connection:{id:string;epoch:number;provider:ProviderId;mode:ConnectionMode;status:string;scopeLabels:string[]};enabled:boolean};
export type SourceDetail={item:SourceItem;provider:ProviderId;selectionReason:string|null;risk:Risk;coverage:TargetManifest['coverage'];counts:TargetManifest['counts'];gaps:{reason:string;count:number}[];targets:{id:string;kind:string;state:string;reason:string|null;checkHref:string|null;risk:Risk|null;generation:number|null;dueAt:string|null;jobState:string|null}[];context:{text:string;urls:string[];attachmentNames:string[];expiresAt:string}|null};
