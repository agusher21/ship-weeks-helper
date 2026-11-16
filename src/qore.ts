// Ship Weeks Helper — QoreChain helpers.
// Chain: qorechain-diana testnet. Every transaction is signed by Toni in his
// QoreX wallet via signAndBroadcast; QoreX adds the hybrid secp256k1 +
// ML-DSA-87 layer and broadcasts. This page holds no keys, seeds or mnemonics.
// Pattern reused from the Quantum Tip Jar (~/workspace/qorechain/tip-jar/):
// window.qorex.native (Keplr-pattern provider) + qorexSignAndBroadcast.
// Sources: @qorechain/sdk 0.14.0, @qorechain/pqc 0.2.3, docs.qorechain.io.

import { fetchKemKey, msg, validateKemPublicKey } from "@qorechain/sdk";
import { mlkem } from "@qorechain/pqc";
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

async function broadcastOne(
  messages: Array<{ typeUrl: string; value: Uint8Array }>,
  memo: string,
): Promise<BroadcastResult> {
  const res = await qorexSignAndBroadcast({
    chainId: CHAIN_ID,
    messages,
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
  /** 3,168 bytes — SECRET. Never leaves this browser; Toni must save it. */
  secretKey: Uint8Array;
}

/**
 * Generate an ML-KEM-1024 keypair IN THIS BROWSER.
 * `mlkem` is the mlkem1024 default of @qorechain/pqc.
 * The secret key is returned only in memory — this function never stores,
 * uploads or logs it anywhere.
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

/** Read-back: is a KEM key published for this address? */
export async function checkKemKey(
  address: string,
): Promise<{ found: boolean; algorithm?: number }> {
  const res = await fetchKemKey({ rest: REST_URL, address });
  return {
    found: res.found,
    algorithm: res.key ? (res.key.algorithmId as number | undefined) : undefined,
  };
}

/** Read-back: fUSD balance (micro-fUSD, 6 decimals) for this address. */
export async function fetchFusdMicro(address: string): Promise<string> {
  const res = await fetch(
    `${REST_URL}/cosmos/bank/v1beta1/balances/${address}?pagination.limit=100`,
  );
  if (!res.ok) {
    throw new Error(`Balance read failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    balances?: Array<{ denom: string; amount: string }>;
  };
  const row = data.balances?.find((b) => b.denom === FUSD_DENOM);
  return row?.amount ?? "0";
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
