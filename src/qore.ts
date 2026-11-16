// Ship Weeks Helper — QoreChain helpers.
// Chain: qorechain-diana testnet. Every transaction is signed by Toni in his
// QoreX wallet via signAndBroadcast; QoreX adds the hybrid secp256k1 +
// ML-DSA-87 layer and broadcasts. This page holds no keys, seeds or mnemonics.
// Pattern reused from the Quantum Tip Jar (~/workspace/qorechain/tip-jar/):
// window.qorex.native (Keplr-pattern provider) + qorexSignAndBroadcast.
// Sources: @qorechain/sdk 0.14.0, @qorechain/pqc 0.2.3, docs.qorechain.io.
//
// FIX 2026-11-16 (live failure "o.value is not iterable"):
// QoreX signAndBroadcast expects each message as { typeUrl, value } where
// value is PROTOBUF-ENCODED BYTES (string | Uint8Array | number[]). The SDK
// composers (msg.amm.swapExactIn, msg.pqc.registerKemKey) return value as a
// PLAIN JS OBJECT. Passing that object straight through made QoreX fail with
// "o.value is not iterable" before any approval prompt appeared — no tx was
// ever sent. broadcastOne() now encodes every message with
// qorechainRegistry().encode() first (verified in Node: swap -> 120 bytes,
// registerKemKey -> 1,617 bytes) and refuses to send anything unencoded.

import {
  fetchKemKey,
  msg,
  openEvmWindowMsg,
  qorechainRegistry,
  validateKemPublicKey,
} from "@qorechain/sdk";
import { mlkem } from "@qorechain/pqc";
import { sha3_256 } from "@noble/hashes/sha3.js";
import {
  getQorexNative,
  hasCapability,
  qorexSignAndBroadcast,
  type QorexNativeProvider,
} from "@qorechain/qorex-types";

export const CHAIN_ID = "qorechain-diana";
export const REST_URL = "https://api-testnet.qore.host";
export const EXPLORER_HOME = "https://explore.qore.network";
export const FEST_ME_URL = "https://build.qorechain.io/me";

/** Toni's MAIN QoreX wallet. Both badges must be earned from this address. */
export const EXPECTED_ADDRESS =
  "qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0";
export const EXPECTED_EVM_ADDRESS =
  "0x9ac294544131ac1709c3bbf8e680041475f04f61";

/** fUSD bank denom (ERC-20 mirrored token, 6 decimals). */
export const FUSD_DENOM =
  "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

/** Exact swap for badge 1 (verified against live pool 2, 16 Nov 2026):
 *  pool 2 (fUSD ↔ QOR) is the deepest native AMM pool; 1 QOR in yields
 *  ~81,089 micro-fUSD out (0.30% fee), so minOut 80,000 is ~1.3% slippage. */
export const SWAP = {
  poolId: "2",
  tokenIn: { denom: "uqor", amount: "1000000" }, // 1 QOR
  denomOut: FUSD_DENOM,
  minOut: "80000", // ~0.08 fUSD
} as const;

/** Protobuf registry for encoding SDK composer output before QoreX. */
const registry = qorechainRegistry();

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_HOME}/tx/${txHash}`;
}

export function isValidQorAddress(address: string): boolean {
  return /^qor1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/.test(address.trim());
}

// ---------------------------------------------------------------------------
// QoreX wallet
// ---------------------------------------------------------------------------

export function getNativeProvider(): QorexNativeProvider | null {
  return getQorexNative() ?? null;
}

export function isQorexInstalled(): boolean {
  return getNativeProvider() !== null;
}

export async function connectQorex(): Promise<string> {
  const native = getNativeProvider();
  if (!native) {
    throw new Error(
      "QoreX is not installed in this browser. Install the QoreX extension " +
        "(Chrome/Firefox) or open this page in the QoreX app's dApp browser, " +
        "switch it to Testnet, then try again.",
    );
  }
  if (!hasCapability(native, "signAndBroadcast")) {
    throw new Error(
      "This QoreX build does not expose signAndBroadcast. Update QoreX to the latest store version and try again.",
    );
  }
  // Throws "QoreX: unsupported chain" if the wallet is not on qorechain-diana.
  await native.enable(CHAIN_ID);
  const key = await native.getKey(CHAIN_ID);
  const address = (key as { bech32Address?: string }).bech32Address;
  if (!address || !isValidQorAddress(address)) {
    throw new Error("QoreX returned an unexpected address. Try reconnecting.");
  }
  return address;
}

export interface BroadcastResult {
  txHash: string;
  code: number;
  height: number;
  shield: string;
}

/** A message as returned by an SDK composer: value is a plain object. */
interface ComposerMessage {
  typeUrl: string;
  value: unknown;
}

async function broadcastOne(
  messages: ComposerMessage[],
  memo: string,
): Promise<BroadcastResult> {
  // Encode FIRST: QoreX wants protobuf bytes, the composers give plain
  // objects. Sending the plain object is exactly what failed live with
  // "o.value is not iterable". Never send an unencoded value.
  const encoded = messages.map((m) => {
    const value = registry.encode(
      m as { typeUrl: string; value: unknown },
    );
    if (!(value instanceof Uint8Array) || value.length === 0) {
      throw new Error(
        `Failed to protobuf-encode ${m.typeUrl} for QoreX — not sending anything.`,
      );
    }
    return { typeUrl: m.typeUrl, value };
  });
  const res = await qorexSignAndBroadcast({
    chainId: CHAIN_ID,
    messages: encoded,
    memo,
    gasLimit: 400000,
  });
  return {
    txHash: res.txHash,
    code: res.code ?? -1,
    height: res.height ?? -1,
    shield: res.shield ?? "unknown",
  };
}

// ---------------------------------------------------------------------------
// Badge 1 — first swap in a pool (native AMM, MsgSwapExactIn)
// ---------------------------------------------------------------------------

/** Build + broadcast the exact swap. QoreX prompts Toni to approve it. */
export async function sendSwap(sender: string): Promise<BroadcastResult> {
  const message = msg.amm.swapExactIn({
    sender,
    poolId: SWAP.poolId,
    tokenIn: { denom: SWAP.tokenIn.denom, amount: SWAP.tokenIn.amount },
    denomOut: SWAP.denomOut,
    minOut: SWAP.minOut,
  });
  return broadcastOne([message], "Ship Weeks: first AMM swap");
}

// ---------------------------------------------------------------------------
// Badge 2 — first QoreSeal key (ML-KEM-1024 key in the x/pqc registry)
// ---------------------------------------------------------------------------

export interface KemKeypair {
  /** 1,568 bytes — published on chain. */
  publicKey: Uint8Array;
  /** 3,168 bytes — SECRET. Lives only in this browser; Toni must save it. */
  secretKey: Uint8Array;
}

/**
 * Generate an ML-KEM-1024 keypair IN THIS BROWSER.
 * `mlkem` is the mlkem1024 default of @qorechain/pqc.
 * The secret key is returned only in memory — this function never stores,
 * uploads or logs it anywhere. Callers persist it via saveKemKeypair().
 */
export function generateKemKeypair(): KemKeypair {
  const { publicKey, secretKey } = mlkem.keygen();
  if (publicKey.length !== 1568) {
    throw new Error(`Unexpected KEM public key length: ${publicKey.length}`);
  }
  if (secretKey.length !== 3168) {
    throw new Error(`Unexpected KEM secret key length: ${secretKey.length}`);
  }
  // Same checks the chain runs before accepting the key.
  validateKemPublicKey(publicKey);
  return { publicKey, secretKey };
}

/** Register the KEM public key on chain (replaces any previous key). */
export async function registerKemKey(
  sender: string,
  publicKey: Uint8Array,
): Promise<BroadcastResult> {
  validateKemPublicKey(publicKey);
  const message = msg.pqc.registerKemKey({ sender, publicKey });
  return broadcastOne([message], "Ship Weeks: first QoreSeal key");
}

// --- Keypair persistence (localStorage, this browser only) -----------------
//
// The first live run generated a keypair in page memory only, so reloading
// the page would lose it and a retry would register a DIFFERENT public key
// than the secret-key file Toni already downloaded. Keypairs are now saved
// to localStorage the moment they are generated or restored, so a retry
// re-registers the SAME public key. Nothing is ever uploaded anywhere; use
// clearKemKeypair() ("Forget saved keypair") to wipe it from this browser.

const KEM_STORAGE_KEY = "ship-weeks-helper.kem-keypair.v1";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function saveKemKeypair(kp: KemKeypair): void {
  try {
    localStorage.setItem(
      KEM_STORAGE_KEY,
      JSON.stringify({
        publicKey: bytesToBase64(kp.publicKey),
        secretKey: bytesToBase64(kp.secretKey),
      }),
    );
  } catch {
    // Storage full or blocked: the in-memory keypair still works this session.
  }
}

export function loadKemKeypair(): KemKeypair | null {
  try {
    const raw = localStorage.getItem(KEM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { publicKey, secretKey } = parsed as {
      publicKey?: unknown;
      secretKey?: unknown;
    };
    if (typeof publicKey !== "string" || typeof secretKey !== "string") {
      return null;
    }
    const kp = {
      publicKey: base64ToBytes(publicKey),
      secretKey: base64ToBytes(secretKey),
    };
    if (kp.publicKey.length !== 1568 || kp.secretKey.length !== 3168) {
      return null;
    }
    validateKemPublicKey(kp.publicKey);
    return kp;
  } catch {
    return null;
  }
}

export function clearKemKeypair(): void {
  try {
    localStorage.removeItem(KEM_STORAGE_KEY);
  } catch {
    // Ignore — nothing to clear.
  }
}

/**
 * Recover the keypair from a downloaded secret-key file (.bin, 3,168 bytes).
 * FIPS 203 layout: dk = dkPKE (1,536 bytes) || ek (1,568) || H(ek) (32) ||
 * z (32) — so the public key is embedded in the secret key, and H(ek) lets
 * us verify the file is intact before trusting it. Use this when the page
 * was reloaded and the in-memory keypair is gone: it restores the SAME
 * public key the downloaded secret file belongs to.
 */
export function recoverKemKeypairFromSecret(
  secretKey: Uint8Array,
): KemKeypair {
  if (secretKey.length !== 3168) {
    throw new Error(
      `Secret-key file must be exactly 3,168 bytes, got ${secretKey.length}. ` +
        `Pick the qoreseal-secret-key-*.bin file you downloaded from this page.`,
    );
  }
  const publicKey = secretKey.slice(1536, 1536 + 1568);
  const hash = sha3_256(publicKey);
  const stored = secretKey.slice(3104, 3136);
  if (!hash.every((b, i) => b === stored[i])) {
    throw new Error(
      "Secret-key file failed its integrity check (H(public key) mismatch). " +
        "It is not a QoreSeal secret-key file from this page.",
    );
  }
  validateKemPublicKey(publicKey);
  return { publicKey, secretKey: secretKey.slice() };
}

/** Read-back: is a KEM key published for this address? Never throws. */
export async function checkKemKey(
  address: string,
): Promise<{ found: boolean; algorithm?: number; unavailable: boolean }> {
  try {
    const res = await fetchKemKey({ rest: REST_URL, address });
    return {
      found: res.found,
      algorithm: res.key
        ? (res.key.algorithmId as number | undefined)
        : undefined,
      unavailable: false,
    };
  } catch {
    // The testnet REST API sends no CORS headers, so browser reads fail.
    return { found: false, unavailable: true };
  }
}

/**
 * Read-back: fUSD balance (micro-fUSD, 6 decimals) for this address.
 * Returns null when the read is unavailable — the testnet REST API sends no
 * CORS headers, so in-browser reads fail. NEVER throws, and NEVER returns a
 * number the response did not actually contain: the shape is validated
 * before any amount is trusted.
 */
export async function fetchFusdMicro(address: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${REST_URL}/cosmos/bank/v1beta1/balances/${address}?pagination.limit=100`,
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return null;
    const balances = (data as { balances?: unknown }).balances;
    if (!Array.isArray(balances)) return null;
    const row = balances.find(
      (b): b is { denom: string; amount: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { denom?: unknown }).denom === FUSD_DENOM &&
        typeof (b as { amount?: unknown }).amount === "string",
    );
    return row?.amount ?? "0";
  } catch {
    return null;
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Badge 3 — first contract with a PQC check (EVM deploy, PqcKeyStatusChecker)
// ---------------------------------------------------------------------------
//
// The Remix route is BLOCKED: QoreX exposes only "Account 16"
// (0x4bb...94dC5, 0 QOR) to Remix, and Remix cannot switch to the main
// wallet. The helper page deploys instead, through the QoreX EVM provider
// (`window.qorex.evm`, EIP-6963) + @qorechain/evm's viem wrappers — the
// same wallet the swap already proved reaches the main account.
//
// Two honest caveats, both surfaced to the user as errors, never hidden:
//  - The QoreX EVM provider answers eth_accounts / eth_requestAccounts, but
//    qorex-types 0.1.0 documents eth_sendTransaction as "not yet supported"
//    in QoreX 0.3.x ("planned for a future QoreX release"). If Toni's build
//    still refuses it, the deploy fails here with QoreX's exact message and
//    the Remix route (or a newer QoreX) is the fallback.
//  - The EVM provider may expose a different account than the native lane
//    (Remix saw only "Account 16", and this page's first connect did too —
//    QoreX silently reconnects Account 16 with no picker). connectEvmWallet()
//    therefore ENUMERATES every account QoreX exposes (eth_requestAccounts
//    + eth_accounts) and builds a wallet client bound to the MAIN wallet
//    even when it is not accounts[0]; it still REFUSES unless the main
//    wallet is among them. "Re-pick EVM account" calls EIP-2255
//    wallet_revokePermissions + eth_requestAccounts to force QoreX's
//    picker; if QoreX does not support the revoke, its exact error is
//    shown and the fallback is disconnecting the site in QoreX's
//    connected-sites settings by hand.

import {
  createEvmClient,
  deployContract as evmDeployContract,
  readContract as evmReadContract,
  requestAccounts as evmRequestAccounts,
  type EvmClient,
} from "@qorechain/evm";
import {
  discoverQorexEip1193,
  findQorexEip1193,
  type QorexEip1193Provider,
} from "@qorechain/qorex-types";
import { createWalletClient, custom, defineChain } from "viem";
import type { Address, Hash, WalletClient } from "viem";
import { CONTRACT_ABI, CONTRACT_BYTECODE } from "./contract.js";

/** EVM JSON-RPC endpoint for qorechain-diana testnet. */
export const EVM_RPC_URL = "https://evm-testnet.qore.host";
/** EVM chain id for qorechain-diana testnet (0x2648). */
export const EVM_CHAIN_ID = 9800;
/** Block explorer for EVM transaction hashes. */
export const EVM_EXPLORER_HOME = "https://explore.qore.network";

export function evmExplorerTxUrl(txHash: string): string {
  return `${EVM_EXPLORER_HOME}/tx/${txHash}`;
}

export function evmExplorerAddressUrl(address: string): string {
  return `${EVM_EXPLORER_HOME}/address/${address}`;
}

/** Find the QoreX EVM provider (window.qorex.evm, via EIP-6963). */
export async function getQorexEvmProvider(): Promise<QorexEip1193Provider> {
  const sync = findQorexEip1193();
  if (sync) return sync;
  const found = await discoverQorexEip1193({ timeoutMs: 2000 });
  if (found) return found;
  const injected = (
    window as unknown as { qorex?: { evm?: unknown } }
  ).qorex?.evm;
  if (
    injected &&
    typeof injected === "object" &&
    typeof (injected as { request?: unknown }).request === "function"
  ) {
    return injected as QorexEip1193Provider;
  }
  throw new Error(
    "QoreX EVM provider not found in this browser. Open this page in the " +
      "browser with the QoreX extension (Testnet), then try again.",
  );
}

export interface EvmWallet {
  walletClient: WalletClient;
  address: Address;
  chainId: number;
  /** Every EVM account QoreX exposed to this site (requested + read-only). */
  accounts: Address[];
}

/**
 * Read the accounts QoreX currently exposes to this site WITHOUT prompting
 * (eth_accounts). Returns [] when nothing is exposed yet.
 */
export async function listEvmAccounts(
  provider: QorexEip1193Provider,
): Promise<Address[]> {
  const res = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(res)) return [];
  return res.filter(
    (a): a is Address => typeof a === "string" && a.startsWith("0x"),
  );
}

/**
 * Connect the QoreX EVM provider and return a viem wallet client BOUND TO
 * THE MAIN WALLET — even when QoreX lists it second (or later).
 *
 * Why this exists: getEvmWalletClient() in @qorechain/evm takes
 * accounts[0] only, and QoreX silently reconnects "Account 16"
 * (0x4bbc…94dC5) as accounts[0] on every connect, with no picker — so
 * this page enumerates every account QoreX exposes (eth_requestAccounts
 * + eth_accounts) and builds its own wallet client with `account` set to
 * the main wallet. deployContract sends from client.account, so the
 * deploy then uses the main wallet even when QoreX lists it second.
 *
 * REFUSES unless the main wallet is among the exposed accounts and the
 * chain is qorechain-diana (9800). Never deploys from the wrong account.
 */
export async function connectEvmWallet(): Promise<EvmWallet> {
  const provider = await getQorexEvmProvider();
  // eth_requestAccounts prompts the first time, then silently returns the
  // authorized set. eth_accounts is read-only, no prompt.
  const requested = await evmRequestAccounts(provider);
  const exposed = await listEvmAccounts(provider);
  const seen = new Set<string>();
  const accounts: Address[] = [];
  for (const a of [...requested, ...exposed]) {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      accounts.push(a);
    }
  }
  const chainId = Number(await provider.request({ method: "eth_chainId" }));
  if (chainId !== EVM_CHAIN_ID) {
    throw new Error(
      `Wrong EVM chain: connected to ${chainId}, need ${EVM_CHAIN_ID} ` +
        `(qorechain-diana testnet). Switch networks in QoreX and try again.`,
    );
  }
  const main = accounts.find(
    (a) => a.toLowerCase() === EXPECTED_EVM_ADDRESS.toLowerCase(),
  );
  if (!main) {
    throw new Error(
      `QoreX exposed ${accounts.length} EVM account(s) to this site: ` +
        `${accounts.length ? accounts.join(", ") : "(none)"}. The main wallet ` +
        `(${EXPECTED_EVM_ADDRESS}) is NOT among them — the deploy stays ` +
        `disabled. Use "Re-pick EVM account" below to force QoreX to show ` +
        `its account picker, pick the main wallet there, then connect again. ` +
        `If QoreX never shows a picker, disconnect this site in QoreX's ` +
        `connected-sites settings first, then try again.`,
    );
  }
  const chain = defineChain({
    id: EVM_CHAIN_ID,
    name: "QoreChain EVM",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });
  const walletClient = createWalletClient({
    account: main,
    chain,
    transport: custom(provider),
  });
  return { walletClient, address: main, chainId, accounts };
}

export interface RepickEvmResult {
  /** Outcome of wallet_revokePermissions (EIP-2255). */
  revoke: { ok: boolean; result?: unknown; error?: string };
  /** Outcome of the eth_requestAccounts that follows it. */
  request: { ok: boolean; accounts?: Address[]; error?: string };
}

/**
 * Force QoreX to forget this site's EVM permission and ask again.
 *
 * EIP-2255 wallet_revokePermissions({ eth_accounts: {} }) revokes the
 * site's account permission; the eth_requestAccounts that follows must
 * then show QoreX's account picker, so Toni can pick the main wallet.
 * QoreX may not implement wallet_revokePermissions at all — if it
 * refuses, the exact error is returned (not hidden), and the fallback is
 * disconnecting the site in QoreX's connected-sites settings by hand.
 * Never throws: both outcomes are reported so the page can show them.
 */
export async function repickEvmAccount(): Promise<RepickEvmResult> {
  const provider = await getQorexEvmProvider();
  const out: RepickEvmResult = {
    revoke: { ok: false },
    request: { ok: false },
  };
  try {
    const res = await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
    out.revoke = { ok: true, result: res ?? null };
  } catch (e) {
    out.revoke = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    const accounts = await evmRequestAccounts(provider);
    out.request = { ok: true, accounts };
  } catch (e) {
    out.request = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  return out;
}

let evmPublicClient: EvmClient | null = null;

/** Read-only EVM client for receipts + contract reads (no wallet needed). */
export async function getEvmPublicClient(): Promise<EvmClient> {
  if (!evmPublicClient) {
    evmPublicClient = await createEvmClient({
      rpcUrl: EVM_RPC_URL,
      chainId: EVM_CHAIN_ID,
    });
  }
  return evmPublicClient;
}

export interface DeployResult {
  txHash: Hash;
  contractAddress: Address;
}

/**
 * Deploy PqcKeyStatusChecker with constructor argument = the main wallet
 * address. QoreX prompts Toni to approve the deployment. Returns the
 * deployment tx hash + the deployed contract address (from the receipt).
 */
export async function deployPqcChecker(
  walletClient: WalletClient,
): Promise<DeployResult> {
  const txHash = await evmDeployContract(walletClient, {
    abi: CONTRACT_ABI,
    bytecode: CONTRACT_BYTECODE,
    args: [EXPECTED_EVM_ADDRESS],
  });
  const publicClient = await getEvmPublicClient();
  const receipt = await publicClient.publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
  });
  if (receipt.status !== "success") {
    throw new Error(
      `Deployment tx ${txHash} was mined but FAILED (status ${receipt.status}). ` +
        `No contract was deployed.`,
    );
  }
  if (!receipt.contractAddress) {
    throw new Error(
      `Deployment tx ${txHash} confirmed but the receipt carries no ` +
        `contract address.`,
    );
  }
  return { txHash, contractAddress: receipt.contractAddress };
}

export interface PqcCheckResult {
  contractAddress: Address;
  lastRegistered: boolean;
  lastAlgorithmId: number;
  statusOfRegistered: boolean;
  statusOfAlgorithmId: number;
}

/**
 * Read-only verification of a deployed PqcKeyStatusChecker: the values the
 * constructor stored (lastRegistered / lastAlgorithmId) and a fresh
 * statusOf(main wallet) read. Expects lastRegistered = true and
 * lastAlgorithmId = 1 (ML-DSA-87 / Dilithium-5).
 */
export async function verifyPqcChecker(
  contractAddress: Address,
): Promise<PqcCheckResult> {
  const client = await getEvmPublicClient();
  const [lastRegistered, lastAlgorithmId, statusOf] = await Promise.all([
    evmReadContract(client.publicClient, {
      address: contractAddress,
      abi: CONTRACT_ABI,
      functionName: "lastRegistered",
    }),
    evmReadContract(client.publicClient, {
      address: contractAddress,
      abi: CONTRACT_ABI,
      functionName: "lastAlgorithmId",
    }),
    evmReadContract(client.publicClient, {
      address: contractAddress,
      abi: CONTRACT_ABI,
      functionName: "statusOf",
      args: [EXPECTED_EVM_ADDRESS],
    }),
  ]);
  if (typeof lastRegistered !== "boolean") {
    throw new Error(
      `Unexpected lastRegistered read from ${contractAddress}: ${String(lastRegistered)}`,
    );
  }
  if (typeof lastAlgorithmId !== "number") {
    throw new Error(
      `Unexpected lastAlgorithmId read from ${contractAddress}: ${String(lastAlgorithmId)}`,
    );
  }
  if (!Array.isArray(statusOf) || statusOf.length < 2) {
    throw new Error(
      `Unexpected statusOf read from ${contractAddress}: ${String(statusOf)}`,
    );
  }
  return {
    contractAddress,
    lastRegistered,
    lastAlgorithmId,
    statusOfRegistered: statusOf[0] as boolean,
    statusOfAlgorithmId: statusOf[1] as number,
  };
}

/**
 * Open an EVM authorisation window via the NATIVE lane (one hybrid-signed
 * tx, approved in QoreX). Only needed if a deploy fails with a window
 * error — QoreX normally opens the window automatically as part of its
 * EVM flow. Window: 600 blocks, up to 5 EVM txs, max 1 QOR total spend
 * (deploy is value 0; its max fee is ~0.05 QOR). Note: broadcasting this
 * advances the account's EVM nonce.
 */
export async function openEvmWindow(
  sender: string,
): Promise<BroadcastResult> {
  const message = openEvmWindowMsg({
    sender,
    blocks: 600,
    maxTxs: 5,
    maxValue: "1000000", // 1 QOR in uqor
  });
  return broadcastOne([message], "Ship Weeks: open EVM window for badge 3");
}
