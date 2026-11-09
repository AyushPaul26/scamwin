# Scamwin registry V1

> **Isolated publisher amendment, 9 November:** the optional publisher can now run in a second Vercel project rooted at `publisher/`. The signing key is permitted only in that dedicated project's Production secrets, never the main website, shared team variables, Preview or investigations. The main website receives an origin-only `SCAMWIN_PUBLISHER_BASE_URL`, shared dispatch secret and public registry settings. This supersedes the earlier platform-wide Vercel signing ban and Trigger-only publisher instructions. See [publisher setup](../publisher/README.md). The registry and publisher activation were deployed to Base Sepolia with explicit owner approval and free test ETH; actual warning publication still needs its hosted test.

Permissioned, publicly readable exact-host warnings. Base Sepolia **testnet only** for remote transactions. No token, consumer wallet, mainnet funds, payable methods, proxy, or arbitrary calls.

From the repository root:

```powershell
npm --prefix web3 ci
npm --prefix web3 test
npm --prefix web3 run typecheck
npm --prefix web3 run test:normalization
npm --prefix web3 run export:abi
```

Node 24 is required. Tooling is isolated in this package and lockfile. Hardhat 3.21.2, viem 2.57.16, OpenZeppelin 5.6.1 and local npm solc 0.8.30 are pinned. The compiler uses optimizer 200, viaIR and Cancun; no compiler download is needed after `npm ci`.

## Protocol

- Owner uses OpenZeppelin `Ownable2Step`; recipients must accept ownership. Owner sets publishers/guardians. A guardian can pause issuance, suspend publishers and retract, but its role grants no issuance or re-enablement rights.
- Publisher activation epochs increase on disabled → enabled. Repeating enabled → enabled is idempotent. Old epoch records remain readable and permanently inactive.
- `publish(hostname, category, ttlSeconds, expectedRevision, operationId)` issues or updates the current issuer/epoch/host record. `retract(publisher, indicator, expectedRevision, reasonCode, operationId)` corrects the current epoch. Original publisher, guardian or owner may retract, including while suspended/paused.
- Revisions start at one and increment on update/retraction. Nonzero operation IDs are caller-scoped and retained across epochs and methods. Replay and stale revisions revert atomically.
- TTL is inclusive 3,600–2,592,000 seconds. Relay TTL is seven days. Expiry follows chain time and needs no transaction. Renewal requires another review outside the contract.
- Category and reason codes are bounded to 1–8. App categories: phishing 1, payment 2, impersonation 3, malware 4, investment 5, recruitment 6, refund 7, other 8. App correction uses reason 1. Reason meanings should be agreed by readers before adding additional UI choices.
- Canonicalization uses lowercase IDNA ASCII, drops one terminal DNS dot, preserves subdomains and `www`, and rejects URL components and common private/reserved suffixes. The contract enforces lowercase ASCII DNS grammar. Neither layer proves DNS resolution, ownership, global routability or validity of a warning. Reviews must establish domain-wide scope before publication.
- Indicator: `keccak256(abi.encode(uint16(1), uint8(1), hostname))`. `example.com` → `0x1b675ce2f38ca4f8b5b9d102255153525e41c8cb2e44c37928a9dd75098294ab`. Not packed encoding and not a privacy mechanism.

Versioned events expose publisher, epoch, indicator, revision, timestamps and operation; publication also exposes the reviewed canonical hostname/category, correction exposes actor/reason. No private case/message/evidence ID or content is passed to the contract.

## Independent reader

```powershell
npm --prefix web3 run read -- <registry-address> <publisher-address> example.com
```

Optional server environment: `BASE_SEPOLIA_RPC_URL` (default free public `https://sepolia.base.org`), `REGISTRY_DEPLOYMENT_BLOCK`. It checks chain ID, bytecode/version and current publisher epoch; reads one block snapshot and verifies its hash again. Output includes chain time, block hash and `included` finality for latest reads. It uses only RPC/ABI, with no Scamwin API, account, database or signing key. An unknown/missing warning is not a safety verdict.

## Deployment preparation

Nothing deploys when a module is imported, built or tested. After explicit release authorization and secure test-only key provisioning, set `REGISTRY_CHAIN_ID=84532`, `REGISTRY_OWNER_ADDRESS`, `REGISTRY_DEPLOYER_PRIVATE_KEY` and optionally `BASE_SEPOLIA_RPC_URL`; then deliberately invoke:

```powershell
npm --prefix web3 run deploy:base-sepolia -- --execute-base-sepolia
```

The script validates the RPC chain, estimates fees, caps estimated test ETH cost, prints the transaction hash immediately after broadcast, then writes secret-free deployment metadata. A receipt is recorded as included. It does not automatically retry uncertain broadcasts, enable publishers, obtain funds or buy anything. Reconcile a printed hash before trying again. Deployment metadata is generated into ignored `deployments/` files; retain a reviewed copy for an actual release.

## Application relay

App read config: `SCAMWIN_REGISTRY_ADDRESS`, `SCAMWIN_REGISTRY_PUBLISHER`, `SCAMWIN_REGISTRY_CHAIN_ID=84532`, optional `BASE_SEPOLIA_RPC_URL`. Put `SCAMWIN_PUBLISHER_PRIVATE_KEY` exclusively in the separate publisher Trigger project; Vercel and the ordinary analysis project must never receive it. Vercel dispatches publisher jobs using `SCAMWIN_PUBLISHER_TRIGGER_SECRET_KEY`, which is a scoped Trigger credential rather than a wallet key. Keep owner/guardian credentials separate from the relay. Public availability never exposes RPC credentials or keys.

`lookupRegistry` reads only the configured trusted issuer, directly and on demand. The latest block must be at most 60 seconds old. Local reviewed rows never become current chain facts. `relayWarning`/`relayRetraction` use the store's durable consent/signing lease and atomic fee reservations. Signed bytes/hash/nonce are persisted before broadcast and reused unchanged after uncertainty. Both L1 data and operator fees are estimated; oracle failure disables signing. Caps are estimated 0.001 test ETH/transaction, 0.005 reserved test ETH/day and 25 transactions/day. Estimates cannot guarantee a future protocol fee; there is no paid funding or automatic replacement.

Call relay reconciliation again while `retry` is true. A finalized/reverted outcome and a canonical receipt block are checked separately. New signing is blocked behind an unresolved signed operation, including beyond lease expiry. Before re-enabling a suspended publisher, operators must reconcile outstanding signed/pending transactions; a transaction's original reviewed epoch is rechecked before relay replay. No secrets are logged and no real funds are supported.

Primary sources: [Hardhat viem/Node tests](https://hardhat.org/docs/guides/testing/using-viem), [custom compiler](https://hardhat.org/docs/cookbook/custom-solidity-compiler), [OpenZeppelin access control](https://docs.openzeppelin.com/contracts/5.x/access-control), [Base network details](https://docs.base.org/get-started/connect-to-base). Installed viem OP Stack source was inspected for L1/operator fee APIs.
