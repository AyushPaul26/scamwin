import type {ConnectionRef,ConnectorGrant,SavedConnection} from './contracts';
import type {OAuthFlow,OAuthCallbackInput} from './oauth-protocol';
import type {VerifiedProviderIdentity} from './oidc';
import type {OAuthProvider} from './oauth-providers';

export interface ProtectedOAuthFlow {flow:OAuthFlow;resources:string[];reconnect:boolean;consentAt:number;ownerGeneration?:number}
export interface RefreshLease {ref:ConnectionRef;token:string;fence:number;expiresAt:string;grant:ConnectorGrant}
export interface ActivationBaseline {cursor:string;capturedAt:string}
export type ProviderIdentityProof=VerifiedProviderIdentity&{proofId:string};
/** Server-only capabilities. None of these values may cross a read API or action response. */
export interface OAuthPersistence {
 saveProtectedOAuthFlow(value:ProtectedOAuthFlow):Promise<void>;
 claimProtectedOAuthFlow(input:OAuthCallbackInput):Promise<{saved:ProtectedOAuthFlow;code?:string;denied?:string}|null>;
 attachOAuthGrant(saved:ProtectedOAuthFlow,identity:VerifiedProviderIdentity,grant:ConnectorGrant|null):Promise<SavedConnection>;
 readIdentityProof(ref:ConnectionRef):Promise<ProviderIdentityProof|null>;
 leaseGrantRefresh(ref:ConnectionRef):Promise<RefreshLease|null>;
 finishGrantRefresh(lease:RefreshLease,grant:ConnectorGrant):Promise<void>;
 releaseGrantRefresh(lease:RefreshLease):Promise<void>;
}
export type OAuthConnectionProvider=OAuthProvider;
