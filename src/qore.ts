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
