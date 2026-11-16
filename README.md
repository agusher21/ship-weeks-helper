# Ship Weeks Helper — QoreChain Testnet

Minimal helper page for the **QoreChain Developer Fest "Ship Weeks"** badges,
for Toni's MAIN QoreX wallet (`qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0`)
on testnet **qorechain-diana**.

Live page: **https://agusher21.github.io/ship-weeks-helper/**

## What it does

| Card | Action | On-chain effect |
|---|---|---|
| Badge 1 — First swap in a pool | **Swap 1 QOR → fUSD (pool 2)** | `MsgSwapExactIn`, pool `"2"`, 1,000,000 uqor → fUSD `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`, minOut `80000` (~0.081 fUSD out). Native AMM — the dashboard Trade page does NOT count (EVM QoreSwap). |
| Badge 2 — First QoreSeal key | **Generate keypair in browser** → download secret key → **Register public key** | `MsgRegisterKEMKey`, ML-KEM-1024 public key (1,568 bytes). The 3,168-byte secret key is generated in the browser and offered as a download. It is saved in **this browser only** (localStorage, never uploaded) so a reload/retry re-registers the same public key; "Forget saved keypair" wipes it. If the page was reloaded and the keypair is gone, pick the downloaded `.bin` file to restore the same public key from it (the public key is embedded in the secret key, FIPS 203 layout, integrity-checked). |
| Badge 3 — First contract with a PQC check | **Connect EVM wallet (QoreX)** → **Deploy PqcKeyStatusChecker** → **Verify on chain** | Deploys `contracts/PqcKeyStatusChecker.sol` (compiled with solc 0.8.20, ABI + bytecode embedded in `src/contract.ts`) via the QoreX EVM provider + `@qorechain/evm` `deployContract`, constructor arg `0x9ac294544131ac1709c3bbf8e680041475f04f61`. Shows the deployed contract address + deployment tx hash; Verify reads `lastRegistered` (expect `true`) and `lastAlgorithmId` (expect `1`). If the deploy fails with an EVM-window error, **Open EVM window** sends `MsgOpenEVMWindow` (600 blocks, 5 txs, max 1 QOR) through the native lane, then retry the deploy. |

## Fix 2026-11-16 — "o.value is not iterable"

First live run failed on both actions before any QoreX prompt: the SDK
composers return message `value` as a plain JS object, but QoreX
`signAndBroadcast` requires protobuf-encoded bytes. `broadcastOne()` now
encodes every message with `qorechainRegistry().encode()` first and refuses
to send an unencoded value. All REST reads (balance, KEM registry) are now
best-effort and non-blocking: a failed read shows "unavailable" and never
blocks a transaction or displays a number it did not actually read.

## Badge 3 note — why deploy from this page, not Remix

Remix is blocked: QoreX exposes only "Account 16" (`0x4bb...94dC5`, 0 QOR)
to Remix and cannot switch to the main wallet there. This page deploys
through the QoreX EVM provider (`window.qorex.evm`, EIP-6963) instead —
and it does **not** trust `accounts[0]`: QoreX silently reconnects
Account 16 as the first account on every connect, with no picker, and
disconnecting the site in QoreX's settings did not change it. So the
page enumerates **every** account QoreX exposes (`eth_requestAccounts` +
`eth_accounts`) and builds its own viem wallet client bound to the main
wallet even when it is listed second — and still refuses to deploy from
any other account. If only Account 16 is exposed, the **"Re-pick EVM
account"** button calls EIP-2255 `wallet_revokePermissions`
(`{ eth_accounts: {} }`) and then `eth_requestAccounts` to force QoreX's
account picker; if QoreX does not support the revoke, its exact error is
shown and the fallback is disconnecting the site in QoreX's
connected-sites settings by hand.

Two honest caveats, both surfaced in the page as errors:
- `qorex-types` 0.1.0 documents `eth_sendTransaction` as "not yet
  supported" in QoreX 0.3.x ("planned for a future QoreX release"). If
  Toni's build still refuses it, the deploy fails with QoreX's exact
  message and the Remix route (same contract file, Solidity 0.8.20) is
  the fallback once QoreX exposes the main wallet to Remix.
- The EVM provider may expose a different account than the native lane.
  The page enumerates all exposed accounts and refuses unless the main
  wallet (`0x9ac294544131ac1709c3bbf8e680041475f04f61`) is among them.

Badge 1 "First hybrid transaction" is already earned — not covered here.

## Signing

Badges 1–2: every transaction is built in the page and signed **by Toni
in QoreX** (`window.qorex.native` + `signAndBroadcast`; QoreX adds the
hybrid secp256k1 + ML-DSA-87 layer). Badge 3: the deployment is signed by
Toni in QoreX through the QoreX EVM provider (`window.qorex.evm`) via a
viem wallet client built directly on the provider (bound to the main
wallet account, see the Badge 3 note) + `@qorechain/evm`
`deployContract`; the EVM-window fallback, if used, goes through the
native `signAndBroadcast` lane like badges 1–2. The page holds no wallet
keys, seeds or mnemonics and never attempts a transaction on its own. The
only key it keeps is the QoreSeal keypair it generates (badge 2, this
browser only). If the connected wallet is not the main wallet above, the
action buttons stay disabled.

After each on-chain step, click **Check** on the matching Ship Weeks card at
https://build.qorechain.io/me.

## Verification

- Swap: tx hash on https://explore.qore.network; fUSD balance +~0.081.
- KEM: `GET https://api-testnet.qore.host/qorechain/pqc/v1/kem/qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0` → `found: true`.
  (Note: the testnet REST API sends no CORS headers, so the in-page
  verification reads may be blocked in the browser — the My Space Check
  button reads the chain server-side and is the authority.)
- Contract: deployment tx confirmed; `statusOf(0x9ac2…)` / `lastRegistered`
  reads `true`.

## Develop

```bash
npm install
npm run dev      # http://localhost:5174
node scripts/compile-contract.mjs   # recompile the badge-3 contract (solc 0.8.20) -> src/contract.ts
node scripts/verify-deploy.mjs      # verify artifact + deploy payload + built bundle
npm run build    # output in docs/ (GitHub Pages source, branch main)
```

Built with Vite + React + TypeScript, `@qorechain/sdk` 0.14.0,
`@qorechain/evm` 0.14.0, `viem` 2.x, `@qorechain/pqc` 0.2.3,
`@qorechain/qorex-types` 0.1.0. Research and exact parameters:
`../ship-weeks/RESEARCH.md`.

## License

MIT
