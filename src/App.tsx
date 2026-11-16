import { useEffect, useState } from "react";

import {
  CHAIN_ID,
  EXPECTED_ADDRESS,
  EXPECTED_EVM_ADDRESS,
  FEST_ME_URL,
  SWAP,
  checkKemKey,
  clearKemKeypair,
  connectEvmWallet,
  connectQorex,
  deployPqcChecker,
  evmExplorerAddressUrl,
  evmExplorerTxUrl,
  explorerTxUrl,
  fetchFusdMicro,
  generateKemKeypair,
  isQorexInstalled,
  loadKemKeypair,
  openEvmWindow,
  recoverKemKeypairFromSecret,
  registerKemKey,
  repickEvmAccount,
  saveKemKeypair,
  sendSwap,
  toHex,
  verifyPqcChecker,
  type BroadcastResult,
  type DeployResult,
  type KemKeypair,
  type PqcCheckResult,
} from "./qore.js";
import type { WalletClient } from "viem";

type Step =
  | { kind: "idle" }
  | { kind: "busy"; note: string }
  | { kind: "ok"; text: string; txHash?: string }
  | { kind: "err"; text: string };

function Status({ step }: { step: Step }) {
  if (step.kind === "idle") return null;
  if (step.kind === "busy") {
    return <div className="status">⏳ {step.note}</div>;
  }
  if (step.kind === "ok") {
    return (
      <div className="status ok">
        ✅ {step.text}
        {step.txHash ? (
          <>
            {"\n"}
            Tx:{" "}
            <a
              href={explorerTxUrl(step.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              {step.txHash}
            </a>
          </>
        ) : null}
      </div>
    );
  }
  return <div className="status err">❌ {step.text}</div>;
}

function formatResult(res: BroadcastResult): string {
  return (
    `Broadcast done — code ${res.code} (0 = success)` +
    (res.height > 0 ? `, block ${res.height}` : "") +
    `, shield: ${res.shield}.`
  );
}

export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [connectStep, setConnectStep] = useState<Step>({ kind: "idle" });

  const [swapStep, setSwapStep] = useState<Step>({ kind: "idle" });

  const [kem, setKem] = useState<KemKeypair | null>(null);
  const [kemRestored, setKemRestored] = useState(false);
  const [kemSaved, setKemSaved] = useState(false);
  const [kemStep, setKemStep] = useState<Step>({ kind: "idle" });
  const [kemCheck, setKemCheck] = useState<Step>({ kind: "idle" });

  const [evmWallet, setEvmWallet] = useState<WalletClient | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [evmAccounts, setEvmAccounts] = useState<string[] | null>(null);
  const [evmStep, setEvmStep] = useState<Step>({ kind: "idle" });
  const [repickStep, setRepickStep] = useState<Step>({ kind: "idle" });
  const [deployStep, setDeployStep] = useState<Step>({ kind: "idle" });
  const [deployed, setDeployed] = useState<DeployResult | null>(null);
  const [verifyStep, setVerifyStep] = useState<Step>({ kind: "idle" });
  const [windowStep, setWindowStep] = useState<Step>({ kind: "idle" });

  const connected = address !== null;
  const isMainWallet = address === EXPECTED_ADDRESS;
  const evmConnected = evmAddress !== null;
  const evmIsMainWallet =
    evmAddress?.toLowerCase() === EXPECTED_EVM_ADDRESS.toLowerCase();

  // Restore a keypair saved in this browser (same public key as the secret
  // file already downloaded), so a retry re-registers the same key.
  useEffect(() => {
    const saved = loadKemKeypair();
    if (saved) {
      setKem(saved);
      setKemRestored(true);
    }
  }, []);

  async function onConnect() {
    setConnectStep({ kind: "busy", note: "Asking QoreX to connect…" });
    try {
      const addr = await connectQorex();
      setAddress(addr);
      if (addr === EXPECTED_ADDRESS) {
        setConnectStep({
          kind: "ok",
          text: `Connected — this is the MAIN wallet. Badge progress counts here.`,
        });
      } else {
        setConnectStep({
          kind: "err",
          text:
            `Connected as ${addr} — that is NOT the main wallet ` +
            `(${EXPECTED_ADDRESS}). Switch to the main wallet in QoreX and reconnect; ` +
            `the buttons below stay disabled until then.`,
        });
      }
    } catch (e) {
      setConnectStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onSwap() {
    if (!address) return;
    // No balance pre-read: the testnet REST API blocks browser reads (no
    // CORS headers), and a read must never stand between you and the swap.
    // The swap goes straight to QoreX approval.
    setSwapStep({
      kind: "busy",
      note: "Waiting for your approval in QoreX… (approve the swap, nothing else)",
    });
    try {
      const res = await sendSwap(address);
      if (res.code !== 0) {
        setSwapStep({
          kind: "err",
          text: `QoreX returned code ${res.code} — the swap did not succeed. Tx: ${res.txHash}`,
        });
        return;
      }
      setSwapStep({
        kind: "ok",
        text:
          `${formatResult(res)} Swapped 1 QOR → ~0.081 fUSD in pool 2 ` +
          `(native AMM). Now click Check on the "First swap in a pool" card at ${FEST_ME_URL}.`,
        txHash: res.txHash,
      });
    } catch (e) {
      setSwapStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onVerifySwap() {
    if (!address) return;
    setSwapStep({ kind: "busy", note: "Reading your fUSD balance…" });
    const after = await fetchFusdMicro(address);
    if (after === null) {
      setSwapStep({
        kind: "err",
        text:
          "Balance unavailable — the testnet REST API sends no CORS headers, so this page cannot read balances directly. " +
          "Check the tx on the explorer link above instead — your fUSD balance there should be ~0.081 higher.",
      });
      return;
    }
    setSwapStep({
      kind: "ok",
      text: `fUSD balance now: ${(Number(after) / 1_000_000).toFixed(6)} fUSD.`,
    });
  }

  function onGenerateKem() {
    try {
      const kp = generateKemKeypair();
      // Persist immediately: a reload/retry must re-register this SAME key,
      // the one the secret file you download belongs to.
      saveKemKeypair(kp);
      setKem(kp);
      setKemRestored(false);
      setKemSaved(false);
      setKemStep({ kind: "idle" });
      setKemCheck({ kind: "idle" });
    } catch (e) {
      setKemStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onRestoreKemFile(file: File) {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const kp = recoverKemKeypairFromSecret(buf);
      saveKemKeypair(kp);
      setKem(kp);
      setKemRestored(true);
      setKemSaved(false);
      setKemStep({
        kind: "ok",
        text:
          `Restored the keypair from your downloaded secret file — same public key ` +
          `(fingerprint ${toHex(kp.publicKey.slice(0, 16))}…). ` +
          `Registering it now will publish the key your saved secret file unlocks.`,
      });
      setKemCheck({ kind: "idle" });
    } catch (e) {
      setKemStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function onForgetKem() {
    clearKemKeypair();
    setKem(null);
    setKemRestored(false);
    setKemSaved(false);
    setKemStep({ kind: "idle" });
    setKemCheck({ kind: "idle" });
  }

  function onDownloadSecret() {
    if (!kem) return;
    const blob = new Blob([kem.secretKey.buffer as ArrayBuffer], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qoreseal-secret-key-qor1ntpfg.bin";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function onRegisterKem() {
    if (!address || !kem) return;
    setKemStep({
      kind: "busy",
      note: "Waiting for your approval in QoreX… (approve the key registration, nothing else)",
    });
    try {
      const res = await registerKemKey(address, kem.publicKey);
      if (res.code !== 0) {
        setKemStep({
          kind: "err",
          text: `QoreX returned code ${res.code} — the registration did not succeed. Tx: ${res.txHash}`,
        });
        return;
      }
      setKemStep({
        kind: "ok",
        text:
          `${formatResult(res)} Your ML-KEM-1024 public key (1,568 bytes) is now ` +
          `published on chain. Now click Check on the "First QoreSeal key" card at ${FEST_ME_URL}.`,
        txHash: res.txHash,
      });
    } catch (e) {
      setKemStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onCheckKem() {
    if (!address) return;
    setKemCheck({ kind: "busy", note: "Reading the on-chain KEM registry…" });
    const res = await checkKemKey(address);
    if (res.unavailable) {
      setKemCheck({
        kind: "err",
        text:
          "Registry read unavailable — the testnet REST API sends no CORS headers, so this page cannot read the registry directly. " +
          "Use the Check button on My Space instead — it reads the chain server-side.",
      });
      return;
    }
    setKemCheck(
      res.found
        ? {
            kind: "ok",
            text: `KEM key FOUND on chain (algorithm ${res.algorithm ?? "?"}). Badge 2 is ready to Check.`,
          }
        : {
            kind: "err",
            text: "No KEM key found for this address yet — register it first.",
          },
    );
  }

  // --- Badge 3: deploy PqcKeyStatusChecker from this page -----------------
  //
  // The Remix route is blocked: QoreX exposes only "Account 16" to Remix.
  // This page deploys through the QoreX EVM provider instead (EIP-6963) —
  // the same wallet the swap already proved reaches the main account.

  async function onConnectEvm() {
    setEvmStep({ kind: "busy", note: "Asking QoreX to connect this site…" });
    try {
      const {
        walletClient,
        address: evmAddr,
        accounts,
      } = await connectEvmWallet();
      setEvmWallet(walletClient);
      setEvmAddress(evmAddr);
      setEvmAccounts(accounts);
      setEvmStep({
        kind: "ok",
        text: `Connected — the main wallet (${evmAddr}) is in use. The deploy button is now enabled.`,
      });
    } catch (e) {
      setEvmWallet(null);
      setEvmAddress(null);
      setEvmAccounts(null);
      setEvmStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Force QoreX to forget this site's EVM permission and ask again, so
  // Toni can pick the main wallet in QoreX's account picker. Both calls'
  // exact outcomes are shown below — a revoke QoreX does not support is
  // reported, not hidden. If the picker returns the main wallet, the page
  // connects it straight away and enables the deploy.
  async function onRepickEvm() {
    setEvmWallet(null);
    setEvmAddress(null);
    setEvmAccounts(null);
    setDeployStep({ kind: "idle" });
    setRepickStep({
      kind: "busy",
      note: "Revoking this site's EVM permission in QoreX, then asking it to pick an account… (watch for the QoreX picker — pick the MAIN wallet)",
    });
    try {
      const res = await repickEvmAccount();
      const revokeText = res.revoke.ok
        ? `revoke: OK (${JSON.stringify(res.revoke.result ?? null)})`
        : `revoke: FAILED — ${res.revoke.error ?? "unknown error"}`;
      const requestText = res.request.ok
        ? `request: OK — accounts now: ${(res.request.accounts ?? []).join(", ") || "(none)"}`
        : `request: FAILED — ${res.request.error ?? "unknown error"}`;
      const pickedMain = (res.request.accounts ?? []).some(
        (a) => a.toLowerCase() === EXPECTED_EVM_ADDRESS.toLowerCase(),
      );
      if (pickedMain) {
        try {
          const {
            walletClient,
            address: evmAddr,
            accounts,
          } = await connectEvmWallet();
          setEvmWallet(walletClient);
          setEvmAddress(evmAddr);
          setEvmAccounts(accounts);
          setEvmStep({
            kind: "ok",
            text: `Connected — the main wallet (${evmAddr}) is in use. The deploy button is now enabled.`,
          });
          setRepickStep({
            kind: "ok",
            text: `${revokeText} | ${requestText} — main wallet picked, deploy is now enabled.`,
          });
        } catch (e) {
          setRepickStep({
            kind: "err",
            text: `${revokeText} | ${requestText} — then connect failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          });
        }
        return;
      }
      setRepickStep({
        kind: "err",
        text:
          `${revokeText} | ${requestText}` +
          (res.revoke.ok
            ? " — the main wallet still was not picked. Try the picker again, or disconnect this site in QoreX's connected-sites settings and reconnect."
            : " — QoreX did not revoke the permission (see the error above). Disconnect this site in QoreX's connected-sites settings by hand, then click '1. Connect EVM wallet (QoreX)' again."),
      });
    } catch (e) {
      setRepickStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onDeploy() {
    if (!evmWallet) return;
    setDeployStep({
      kind: "busy",
      note: "Waiting for your approval in QoreX… (approve the contract deployment, nothing else)",
    });
    try {
      const res = await deployPqcChecker(evmWallet);
      setDeployed(res);
      setDeployStep({
        kind: "ok",
        text:
          `Contract deployed to ${res.contractAddress}. Copy the deployment ` +
          `tx hash below, paste it into the "First contract with a PQC check" ` +
          `field on My Space, then click Check there.`,
        txHash: res.txHash,
      });
    } catch (e) {
      setDeployStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onVerifyContract() {
    if (!deployed) return;
    setVerifyStep({
      kind: "busy",
      note: "Reading lastRegistered / lastAlgorithmId from the contract…",
    });
    try {
      const res: PqcCheckResult = await verifyPqcChecker(
        deployed.contractAddress,
      );
      const ok =
        res.lastRegistered &&
        res.lastAlgorithmId === 1 &&
        res.statusOfRegistered &&
        res.statusOfAlgorithmId === 1;
      setVerifyStep(
        ok
          ? {
              kind: "ok",
              text:
                `Verified on chain: lastRegistered = true, lastAlgorithmId = 1 ` +
                `(ML-DSA-87), statusOf(main wallet) = registered, algorithm 1. ` +
                `The deployment tx hash above is ready to paste into My Space.`,
            }
          : {
              kind: "err",
              text:
                `Unexpected values: lastRegistered = ${res.lastRegistered}, ` +
                `lastAlgorithmId = ${res.lastAlgorithmId}, ` +
                `statusOf(main wallet) = registered ${res.statusOfRegistered}, ` +
                `algorithm ${res.statusOfAlgorithmId}. Expected true / 1 / true / 1.`,
            },
      );
    } catch (e) {
      setVerifyStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function onOpenWindow() {
    if (!address) return;
    setWindowStep({
      kind: "busy",
      note: "Waiting for your approval in QoreX… (approve opening the EVM window, nothing else)",
    });
    try {
      const res = await openEvmWindow(address);
      if (res.code !== 0) {
        setWindowStep({
          kind: "err",
          text: `QoreX returned code ${res.code} — the window did not open. Tx: ${res.txHash}`,
        });
        return;
      }
      setWindowStep({
        kind: "ok",
        text:
          `${formatResult(res)} EVM window open (600 blocks, up to 5 EVM txs). ` +
          `Now retry the deploy above.`,
        txHash: res.txHash,
      });
    } catch (e) {
      setWindowStep({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="wrap">
      <h1>🛡️ Ship Weeks Helper</h1>
      <p className="muted">
        QoreChain Developer Fest — testnet <b>{CHAIN_ID}</b>. All three
        remaining Ship Weeks badges, done from your own QoreX wallet.{" "}
        <b>Badge 1 "First hybrid transaction" is already earned</b> — this
        page covers the swap, the QoreSeal key, and the PQC contract deploy.
      </p>
      <p className="muted small">
        Nothing here ever asks for a seed, mnemonic or private key. Every
        transaction is built in this page and signed by <b>you</b> in QoreX.
        The page uploads nothing anywhere — the only key it keeps is the
        QoreSeal keypair it generates, saved in this browser only (badge 2).
      </p>

      <div className="card">
        <h2>Connect QoreX</h2>
        {!isQorexInstalled() ? (
          <p>
            ❌ QoreX is not detected in this browser. Install the QoreX
            extension, switch it to <b>Testnet</b>, open this page again.
          </p>
        ) : (
          <>
            <button onClick={onConnect} disabled={connected && isMainWallet}>
              {connected ? "Connected" : "Connect QoreX"}
            </button>
            {address ? (
              <p className="mono">
                {address}
                {isMainWallet ? " — ✅ main wallet" : " — ⚠️ NOT the main wallet"}
              </p>
            ) : null}
          </>
        )}
        <Status step={connectStep} />
        <p className="muted small">
          Expected main wallet:{" "}
          <span className="mono">{EXPECTED_ADDRESS}</span>
        </p>
      </div>

      <div className="card">
        <h2>
          Badge 1 — First swap in a pool{" "}
          <span className="badge-done">native AMM</span>
        </h2>
        <p>
          Swap <b>1 QOR → fUSD</b> in the native AMM (pool 2, fUSD ↔ QOR — the
          deepest pool). You get back ~<b>0.081 fUSD</b>. Gas only, roughly
          0.01–0.05 QOR.
        </p>
        <dl className="kv">
          <dt>Pool</dt>
          <dd>2 (fUSD ↔ QOR)</dd>
          <dt>Token in</dt>
          <dd>1,000,000 uqor (1 QOR)</dd>
          <dt>Token out</dt>
          <dd>fUSD ({SWAP.denomOut})</dd>
          <dt>Min out</dt>
          <dd>80,000 micro-fUSD (~0.08 fUSD, ~1.3% slippage)</dd>
        </dl>
        <p className="muted small">
          ⚠️ The dashboard Trade page does <b>not</b> count — it swaps on the
          EVM QoreSwap contract, a different system. This button uses the
          native AMM message (MsgSwapExactIn).
        </p>
        <button onClick={onSwap} disabled={!connected || !isMainWallet}>
          Swap 1 QOR → fUSD (pool 2)
        </button>
        <button
          className="secondary"
          onClick={onVerifySwap}
          disabled={!connected || !isMainWallet}
        >
          Verify fUSD balance
        </button>
        <Status step={swapStep} />
        <p className="muted small">
          After the swap: open{" "}
          <a href={FEST_ME_URL} target="_blank" rel="noreferrer">
            My Space
          </a>{" "}
          and click <b>Check</b> on the "First swap in a pool" card.
        </p>
      </div>

      <div className="card">
        <h2>Badge 2 — First QoreSeal key</h2>
        <p>
          Publish one <b>ML-KEM-1024</b> public key (1,568 bytes) in the
          on-chain KEM registry, so others can send you QoreSeal messages.
          The keypair is generated <b>in this browser</b> — never on a server.
        </p>

        <div className="warnbox">
          ⚠️ <b>Save the secret key before you register.</b> The secret key
          (3,168 bytes) is the <b>only</b> way to decrypt messages sent to
          this key. If you lose it, the published key is useless (you can
          re-register a fresh one, but old messages stay locked). The keypair
          is also saved in <b>this browser only</b> (localStorage, never
          uploaded) so a reload or retry keeps the <b>same</b> public key —
          use "Forget saved keypair" below to wipe it from this browser.
        </div>

        <button onClick={onGenerateKem}>1. Generate keypair in browser</button>
        <p className="muted small">
          Already generated a keypair and downloaded its secret file before?
          Pick that file to restore the <b>same</b> public key instead of
          generating a fresh one:{" "}
          <input
            type="file"
            accept=".bin"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onRestoreKemFile(f);
              e.target.value = "";
            }}
          />
        </p>
        {kem ? (
          <>
            {kemRestored ? (
              <p className="muted">
                ♻️ Restored a keypair saved in this browser — fingerprint{" "}
                <span className="mono">{toHex(kem.publicKey.slice(0, 16))}…</span>.
                This is the same public key as the secret file you already
                downloaded; registering it publishes the key that file unlocks.
              </p>
            ) : null}
            <dl className="kv">
              <dt>Public key</dt>
              <dd>
                {kem.publicKey.length} bytes — fingerprint{" "}
                <span className="mono">{toHex(kem.publicKey.slice(0, 16))}…</span>
              </dd>
              <dt>Secret key</dt>
              <dd>{kem.secretKey.length} bytes — download it now, then tick the box</dd>
            </dl>
            <button className="secondary" onClick={onDownloadSecret}>
              ⬇ Download secret key (.bin)
            </button>
            <button className="secondary" onClick={onForgetKem}>
              Forget saved keypair (wipe from this browser)
            </button>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={kemSaved}
                  onChange={(e) => setKemSaved(e.target.checked)}
                />
                I saved the secret-key file somewhere safe
              </label>
            </p>
            <button
              onClick={onRegisterKem}
              disabled={!connected || !isMainWallet || !kemSaved}
            >
              2. Register public key on chain
            </button>
            <button
              className="secondary"
              onClick={onCheckKem}
              disabled={!connected || !isMainWallet}
            >
              Check registry (found?)
            </button>
          </>
        ) : null}
        <Status step={kemStep} />
        <Status step={kemCheck} />
        <p className="muted small">
          After registration: open{" "}
          <a href={FEST_ME_URL} target="_blank" rel="noreferrer">
            My Space
          </a>{" "}
          and click <b>Check</b> on the "First QoreSeal key" card.
        </p>
      </div>

      <div className="card">
        <h2>Badge 3 — Deploy PQC contract</h2>
        <p>
          Deploy <b>PqcKeyStatusChecker</b> (compiled here with solc 0.8.20
          from{" "}
          <a
            href="https://github.com/agusher21/ship-weeks-helper/blob/main/contracts/PqcKeyStatusChecker.sol"
            target="_blank"
            rel="noreferrer"
          >
            contracts/PqcKeyStatusChecker.sol
          </a>
          ) straight from this page, through QoreX. Its constructor calls
          the PQC key-status precompile (<span className="mono">0x0A02</span>)
          with your address, so the deployment tx itself exercises the
          precompile. Cost ~0.02–0.05 QOR gas.
        </p>
        <p className="muted small">
          Why here and not Remix: QoreX exposes only "Account 16" (0 QOR) to
          Remix and cannot switch to the main wallet there. This page talks
          to the QoreX EVM provider directly and <b>lists every account</b>{" "}
          QoreX exposes to this site — if the main wallet is among them, the
          page uses it even when QoreX lists it second. If only Account 16
          shows up, use <b>"Re-pick EVM account"</b> below: it revokes this
          site's permission in QoreX and forces its account picker, so you
          can pick the <b>main wallet</b>. The deploy stays disabled until
          the main wallet (
          <span className="mono">{EXPECTED_EVM_ADDRESS}</span>) is connected.
        </p>

        <button
          onClick={onConnectEvm}
          disabled={evmConnected && evmIsMainWallet}
        >
          1. Connect EVM wallet (QoreX)
        </button>
        <button className="secondary" onClick={onRepickEvm}>
          Re-pick EVM account
        </button>
        {evmAddress ? (
          <p className="mono">
            {evmAddress}
            {evmIsMainWallet
              ? " — ✅ main wallet"
              : " — ⚠️ NOT the main wallet"}
          </p>
        ) : null}
        {evmAccounts ? (
          <p className="mono small">
            QoreX exposed {evmAccounts.length} account(s) to this site:{" "}
            {evmAccounts
              .map((a) =>
                a.toLowerCase() === EXPECTED_EVM_ADDRESS.toLowerCase()
                  ? `${a} ✅ main`
                  : a,
              )
              .join(" · ")}
          </p>
        ) : null}
        <Status step={evmStep} />
        <Status step={repickStep} />

        <button
          onClick={onDeploy}
          disabled={!evmConnected || !evmIsMainWallet}
        >
          2. Deploy PqcKeyStatusChecker
        </button>
        <Status step={deployStep} />
        {deployed ? (
          <dl className="kv">
            <dt>Contract</dt>
            <dd>
              <a
                href={evmExplorerAddressUrl(deployed.contractAddress)}
                target="_blank"
                rel="noreferrer"
              >
                {deployed.contractAddress}
              </a>
            </dd>
            <dt>Deploy tx</dt>
            <dd>
              <a
                href={evmExplorerTxUrl(deployed.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                {deployed.txHash}
              </a>
            </dd>
          </dl>
        ) : null}
        <button
          className="secondary"
          onClick={onVerifyContract}
          disabled={!deployed}
        >
          Verify on chain (lastRegistered / lastAlgorithmId)
        </button>
        <Status step={verifyStep} />

        <p className="muted small">
          After the deploy + verify: open{" "}
          <a href={FEST_ME_URL} target="_blank" rel="noreferrer">
            My Space
          </a>
          , paste the <b>deployment tx hash</b> above into the "First
          contract with a PQC check" field, then click <b>Check</b>.
        </p>

        <p className="muted small">
          Only if the deploy fails with an EVM-window error: open the window
          first (one native tx, approved in QoreX — needs the main wallet
          connected at the top of this page), then retry the deploy.
        </p>
        <button
          className="secondary"
          onClick={onOpenWindow}
          disabled={!connected || !isMainWallet}
        >
          Open EVM window (only if deploy fails)
        </button>
        <Status step={windowStep} />

        <p className="muted small">
          If QoreX says the EVM method is not supported, your QoreX build
          cannot send EVM transactions from a website yet — the fallback is
          the Remix route (same contract file, Solidity 0.8.20, constructor
          argument{" "}
          <span className="mono">{EXPECTED_EVM_ADDRESS}</span>), once QoreX
          exposes the main wallet to Remix.
        </p>
      </div>

      <p className="muted small">
        Testnet only — no real money anywhere. Source:{" "}
        <a
          href="https://github.com/agusher21/ship-weeks-helper"
          target="_blank"
          rel="noreferrer"
        >
          github.com/agusher21/ship-weeks-helper
        </a>
        .
      </p>
    </div>
  );
}
