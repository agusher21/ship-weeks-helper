import { useEffect, useState } from "react";

import {
  CHAIN_ID,
  EXPECTED_ADDRESS,
  EXPECTED_EVM_ADDRESS,
  FEST_ME_URL,
  SWAP,
  checkKemKey,
  clearKemKeypair,
  connectQorex,
  explorerTxUrl,
  fetchFusdMicro,
  generateKemKeypair,
  isQorexInstalled,
  loadKemKeypair,
  recoverKemKeypairFromSecret,
  registerKemKey,
  saveKemKeypair,
  sendSwap,
  toHex,
  type BroadcastResult,
  type KemKeypair,
} from "./qore.js";

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

  const connected = address !== null;
  const isMainWallet = address === EXPECTED_ADDRESS;

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

  return (
    <div className="wrap">
      <h1>🛡️ Ship Weeks Helper</h1>
      <p className="muted">
        QoreChain Developer Fest — testnet <b>{CHAIN_ID}</b>. Badges 1 &amp; 2,
        done from your own QoreX wallet. <b>Badge 1 "First hybrid
        transaction" is already earned</b> — this page covers the remaining
        two on-chain steps plus the badge-3 contract.
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
        <h2>Badge 3 — First contract with a PQC check</h2>
        <p>
          Deploy a small Solidity contract that calls the PQC key-status
          precompile (<span className="mono">0x0A02</span>), then paste the
          deployment tx hash into the Ship Weeks field on My Space.
        </p>
        <ol>
          <li>
            Open{" "}
            <a
              href="https://remix.ethereum.org"
              target="_blank"
              rel="noreferrer"
            >
              Remix
            </a>{" "}
            → create{" "}
            <span className="mono">PqcKeyStatusChecker.sol</span> — copy the
            contract from{" "}
            <a
              href="https://github.com/agusher21/ship-weeks-helper/blob/main/contracts/PqcKeyStatusChecker.sol"
              target="_blank"
              rel="noreferrer"
            >
              contracts/PqcKeyStatusChecker.sol
            </a>{" "}
            in this repo → compile with Solidity 0.8.20.
          </li>
          <li>
            In QoreX, select the <b>qorechain-diana testnet</b> network (EVM
            chain 9800), main wallet{" "}
            <span className="mono">{EXPECTED_EVM_ADDRESS}</span> active.
          </li>
          <li>
            Remix → Deploy &amp; Run → Environment:{" "}
            <b>Injected Provider</b> (QoreX) → constructor argument:{" "}
            <span className="mono">{EXPECTED_EVM_ADDRESS}</span> → Deploy →
            approve in QoreX.
          </li>
          <li>
            Copy the <b>deployment transaction hash</b> → paste it into the
            "First contract with a PQC check" field on My Space →{" "}
            <b>Check</b>.
          </li>
        </ol>
        <p className="muted small">
          The constructor calls the precompile with your address, so{" "}
          <span className="mono">lastRegistered</span> reads{" "}
          <span className="mono">true</span> on chain. Cost ~0.02–0.05 QOR
          gas. If Remix says the EVM window is not open, QoreX normally opens
          it automatically as part of its EVM flow — retry the deploy once
          before anything else.
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
