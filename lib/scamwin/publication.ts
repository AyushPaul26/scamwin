import { createPublicClient, decodeFunctionData, encodeFunctionData, getAddress, http, keccak256, parseTransaction, recoverTransactionAddress, toHex, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { publicActionsL2 } from "viem/op-stack";
import type { PublicationRecord, PublicationStatus, ScamwinStore } from "./contracts";
import { threatRegistryAbi } from "./registry-abi";
import { normalizeRegistryHostname, registryIndicatorId } from "./registry-normalization";
import { registryConfiguration, type RegistryEnvironment, type RegistryRpc } from "./registry";

type RelayTransaction = { account: Address; to: Address; data: Hex; value: bigint };
export type RelayRpc = Omit<RegistryRpc, "getBlock"> & Pick<PublicClient, "simulateContract"> & {
  getBlock(args: { blockTag: "latest" | "safe" | "finalized"; blockNumber?: never } | { blockNumber: bigint; blockTag?: never }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
  getTransactionCount(args: { address: Address; blockTag: "pending" }): Promise<number>;
  estimateGas(args: RelayTransaction): Promise<bigint>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  estimateL1Fee(args: RelayTransaction): Promise<bigint>;
  estimateOperatorFee(args: RelayTransaction & { gas: bigint }): Promise<bigint>;
  sendRawTransaction(args: { serializedTransaction: Hex }): Promise<Hex>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{ transactionHash: Hex; blockNumber: bigint; blockHash: Hex; status: "success" | "reverted" }>;
};
export type PublicationResult = { status: PublicationStatus | "unconfigured" | "uncertain" | "busy"; chainId: 84532; transactionHash?: Hex; retry: boolean; message: string };
type RelayOptions = { env?: RegistryEnvironment; store?: ScamwinStore; client?: RelayRpc; now?: Date };
const result = (status: PublicationResult["status"], message: string, retry: boolean, transactionHash?: Hex): PublicationResult => ({ status, chainId: 84532, message, retry, ...(transactionHash ? { transactionHash } : {}) });
const categories: Record<string, number> = { phishing: 1, payment: 2, impersonation: 3, malware: 4, investment: 5, recruitment: 6, refund: 7 };
const categoryCode = (category: string) => categories[category.toLowerCase()] ?? 8;

async function relay(id: string, kind: "publish" | "retract", options: RelayOptions): Promise<PublicationResult> {
  if (typeof window !== "undefined") throw new Error("Publisher is server-only");
  const env = options.env ?? process.env, config = registryConfiguration(env), key = env.SCAMWIN_PUBLISHER_PRIVATE_KEY;
  if (!config || !key || !/^0x[0-9a-f]{64}$/i.test(key)) return result("unconfigured", "Testnet publisher is not configured; no transaction was signed.", false);
  let store: ScamwinStore | undefined, publication: PublicationRecord | null = null;
  try {
    const account = privateKeyToAccount(key as Hex);
    if (getAddress(account.address) !== config.publisher) return result("unconfigured", "Publisher key does not match the configured trusted issuer.", false);
    const client = options.client ?? createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl, { timeout: 8000, retryCount: 0 }) }).extend(publicActionsL2()) as unknown as RelayRpc;
    if (await client.getChainId() !== 84532) throw new Error("RPC chain mismatch");
    store = options.store ?? (await import("./repository-core")).getScamwinStore();
    const warning = await store.getWarning(id);
    if (!warning) return result("unavailable", "Reviewed warning not found.", false);
    publication = await store.getPublication(id, warning.revision);
    if (!publication || publication.kind !== kind || publication.chainId !== 84532) return result("unavailable", "No matching reviewed publication operation.", false);
    if (publication.status === "finalized" || publication.status === "failed") return result(publication.status, "Recorded testnet transaction outcome.", false, publication.transactionHash as Hex | undefined);
    const hostname = normalizeRegistryHostname(warning.hostname), indicator = registryIndicatorId(hostname);
    const operationId = keccak256(toHex(publication.operationId));
    const context = { address: config.address, abi: threatRegistryAbi } as const;

    if (!publication.signedRawTransaction) {
      publication = await store.leasePublication(id, warning.revision, kind);
      if (!publication) return result("busy", "Another publisher operation is in progress or this review is no longer eligible.", true);
      const block = await client.getBlock({ blockTag: "latest" });
      const clock = options.now ?? new Date();
      const age = clock.getTime() / 1000 - Number(block.timestamp);
      if (block.number === null || block.hash === null || age < -15 || age > 60) throw new Error("Stale signing RPC");
      const [code, version, [enabled, epoch]] = await Promise.all([
        client.getBytecode({ address: config.address, blockNumber: block.number! }),
        client.readContract({ ...context, functionName: "VERSION" }),
        client.readContract({ ...context, functionName: "publisherConfig", args: [config.publisher] }),
      ]);
      if (!code || code === "0x" || version !== 1 || (kind === "publish" && !enabled)) throw new Error("Unsupported deployment or disabled publisher");
      const assertion = await client.readContract({ ...context, functionName: "getAssertion", args: [config.publisher, epoch, indicator] });
      const args = kind === "publish"
        ? { ...context, functionName: "publish" as const, args: [hostname, categoryCode(warning.category), 604800n, assertion.revision, operationId] as const, account: account.address }
        : { ...context, functionName: "retract" as const, args: [config.publisher, indicator, assertion.revision, 1, operationId] as const, account: account.address };
      if (args.functionName === "publish") await client.simulateContract(args);
      else await client.simulateContract(args);
      const data = encodeFunctionData(args);
      const request = { account: account.address, to: config.address, data, value: 0n };
      const [estimate, fees, l1Fee] = await Promise.all([client.estimateGas(request), client.estimateFeesPerGas(), client.estimateL1Fee(request)]);
      const gas = estimate * 120n / 100n;
      const operatorFee = await client.estimateOperatorFee({ ...request, gas });
      const reserved = gas * fees.maxFeePerGas + 2n * (l1Fee + operatorFee);
      if (reserved > 1_000_000_000_000_000n || !await store.reservePublicationFee(id, warning.revision, reserved.toString(), publication.leaseToken)) throw new Error("Testnet fee budget exhausted");
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const raw = await account.signTransaction({ type: "eip1559", chainId: 84532, to: config.address, data, value: 0n, nonce, gas, ...fees });
      const hash = keccak256(raw);
      const saved = await store.updatePublication(id, warning.revision, { status: "signed", signedRawTransaction: raw, transactionHash: hash, nonce, contractAddress: config.address, publisherAddress: config.publisher, leaseToken: publication.leaseToken, epoch: epoch.toString(), assertionRevision: assertion.revision });
      if (!saved) throw new Error("Signing lease or consent changed before persistence");
      publication = await store.getPublication(id, warning.revision);
      if (!publication?.signedRawTransaction || publication.transactionHash !== hash) throw new Error("Signed transaction not durably readable");
    }

    // Never allocate a new nonce for an operation that already has signed bytes.
    const raw = publication.signedRawTransaction as Hex, hash = keccak256(raw), parsed = parseTransaction(raw);
    if (parsed.type !== "eip1559" || publication.transactionHash !== hash || parsed.chainId !== 84532 || parsed.nonce !== publication.nonce || !parsed.to || getAddress(parsed.to) !== config.address || (parsed.value ?? 0n) !== 0n || getAddress(await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })) !== config.publisher) throw new Error("Persisted transaction is outside configured scope");
    const decoded = decodeFunctionData({ abi: threatRegistryAbi, data: parsed.data! });
    if (kind === "publish") {
      if (decoded.functionName !== "publish" || decoded.args[0] !== hostname || decoded.args[1] !== categoryCode(warning.category) || decoded.args[2] !== 604800n || decoded.args[3] !== publication.assertionRevision || decoded.args[4] !== operationId) throw new Error("Persisted publication differs from approved warning");
    } else if (decoded.functionName !== "retract" || getAddress(decoded.args[0]) !== config.publisher || decoded.args[1] !== indicator || decoded.args[2] !== publication.assertionRevision || decoded.args[3] !== 1 || decoded.args[4] !== operationId) throw new Error("Persisted correction differs from reviewed operation");

    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) {
      if (receipt.transactionHash !== hash || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new Error("Receipt is no longer on the observed chain");
      const tags = await Promise.allSettled([client.getBlock({ blockTag: "safe" }), client.getBlock({ blockTag: "finalized" })]);
      const safe = tags[0].status === "fulfilled" && tags[0].value.number !== null && tags[0].value.number >= receipt.blockNumber;
      const finalized = tags[1].status === "fulfilled" && tags[1].value.number !== null && tags[1].value.number >= receipt.blockNumber;
      const status = finalized ? receipt.status === "reverted" ? "failed" : "finalized" : safe ? "safe" : "included";
      await store.updatePublication(id, warning.revision, { status, leaseUntil: (options.now ?? new Date()).toISOString() });
      return result(status, receipt.status === "reverted" ? "Testnet transaction reverted; finality is checked independently." : "Testnet receipt and chain finality checked independently.", !finalized, hash);
    }
    const [, epoch] = await client.readContract({ ...context, functionName: "publisherConfig", args: [config.publisher] });
    if (epoch.toString() !== publication.epoch) throw new Error("Publisher activation epoch changed; reconcile without issuing a replacement");
    if (await client.sendRawTransaction({ serializedTransaction: raw }) !== hash) throw new Error("RPC returned another transaction hash");
    await store.updatePublication(id, warning.revision, { status: "submitted", leaseUntil: (options.now ?? new Date()).toISOString() });
    return result("submitted", "Testnet transaction submitted; inclusion and finality remain unconfirmed.", true, hash);
  } catch {
    if (publication?.signedRawTransaction) return result("uncertain", "Testnet broadcast or confirmation is uncertain. Reconcile this same signed transaction; no replacement nonce was created.", true, publication.transactionHash as Hex | undefined);
    if (store && publication) await store.updatePublication(id, publication.revision, { status: "unavailable", leaseUntil: (options.now ?? new Date()).toISOString() }).catch(() => null);
    return result("unavailable", "Testnet publication unavailable or fee budget exhausted; no transaction was broadcast.", true);
  }
}

export const relayWarning = (id: string, options: RelayOptions = {}) => relay(id, "publish", options);
export const relayRetraction = (id: string, options: RelayOptions = {}) => relay(id, "retract", options);
