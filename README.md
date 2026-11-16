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

## Fix 2026-11-16 — "o.value is not iterable"

First live run failed on both actions before any QoreX prompt: the SDK
composers return message `value` as a plain JS object, but QoreX
`signAndBroadcast` requires protobuf-encoded bytes. `broadcastOne()` now
encodes every message with `qorechainRegistry().encode()` first and refuses
to send an unencoded value. All REST reads (balance, KEM registry) are now
best-effort and non-blocking: a failed read shows "unavailable" and never
blocks a transaction or displays a number it did not actually read.
| Badge 3 — First contract with a PQC check | Instructions + contract file | Deploy `contracts/PqcKeyStatusChecker.sol` via Remix + QoreX (constructor arg `0x9ac294544131ac1709c3bbf8e680041475f04f61`), paste the deployment tx hash on My Space. |

Badge 1 "First hybrid transaction" is already earned — not covered here.

## Signing

Every transaction is built in the page and signed **by Toni in QoreX**
(`window.qorex.native` + `signAndBroadcast`; QoreX adds the hybrid
secp256k1 + ML-DSA-87 layer). The page holds no wallet keys, seeds or
mnemonics and never attempts a transaction on its own. The only key it
keeps is the QoreSeal keypair it generates (badge 2, this browser only).
If the connected wallet is not the main wallet above, both action buttons
stay disabled.

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
npm run build    # output in docs/ (GitHub Pages source, branch main)
```

Built with Vite + React + TypeScript, `@qorechain/sdk` 0.14.0,
`@qorechain/pqc` 0.2.3, `@qorechain/qorex-types` 0.1.0. Research and exact
parameters: `../ship-weeks/RESEARCH.md`.

## License

MIT
