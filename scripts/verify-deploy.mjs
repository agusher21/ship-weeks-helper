// Ad-hoc verification for the badge-3 deploy card (not part of the app).
// Run from ~/workspace/ship-weeks-helper: node scripts/verify-deploy.mjs
// Checks the generated artifact, the deploy payload viem would send, the
// EVM-window fallback message, and that the built bundle contains the card.
import { readdirSync, readFileSync } from "node:fs";
import { encodeDeployData } from "viem";
import { openEvmWindowMsg } from "@qorechain/sdk";

const EXPECTED_EVM = "0x9ac294544131ac1709c3bbf8e680041475f04f61";
const root = new URL("..", import.meta.url).pathname;

// --- 1. Generated contract artifact ---------------------------------------
const ts = readFileSync(`${root}/src/contract.ts`, "utf8");
const abiJson = ts.match(/export const CONTRACT_ABI: Abi = (\[[\s\S]*?\]);/)[1];
const abi = JSON.parse(abiJson);
const bytecode = ts.match(/export const CONTRACT_BYTECODE: Hex = "(0x[0-9a-f]+)";/)[1];
console.log("ABI entries:", abi.length, "| fns:", abi.filter((e) => e.type === "function").map((e) => e.name).join(","));
console.log("bytecode bytes:", bytecode.length / 2 - 1);
// solc embeds the precompile address as its numeric value 0xa02 (PUSH2),
// not as the 40-hex-char literal — the staticcall target is identical.
console.log("bytecode calls precompile (PUSH2 0x0a02):", bytecode.includes("610a02"));

// --- 2. Deploy payload construction (what deployContract sends) -----------
const data = encodeDeployData({ abi, bytecode, args: [EXPECTED_EVM] });
console.log("deploy data starts with bytecode:", data.startsWith(bytecode));
console.log("deploy data ends with ABI-encoded ctor arg:", data.endsWith(EXPECTED_EVM.slice(2).toLowerCase().padStart(64, "0")));
console.log("deploy data length (hex chars):", data.length);

// --- 3. EVM window message (fallback button) -------------------------------
const winMsg = openEvmWindowMsg({ sender: "qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0", blocks: 600, maxTxs: 5, maxValue: "1000000" });
console.log("window msg typeUrl:", winMsg.typeUrl, "| value is object (encoded later by broadcastOne):", typeof winMsg.value === "object");

// --- 4. Built bundle contains the new card ---------------------------------
const bundleFile = readdirSync(`${root}/docs/assets`).find((f) =>
  /^index-.*\.js$/.test(f),
);
if (!bundleFile) throw new Error("No built index-*.js bundle found in docs/assets");
const bundle = readFileSync(`${root}/docs/assets/${bundleFile}`, "utf8");
console.log("bundle:", bundleFile, `(${(bundle.length / 1024).toFixed(0)} KB)`);
for (const s of ["Deploy PqcKeyStatusChecker", "Connect EVM wallet (QoreX)", "Open EVM window (only if deploy fails)", "Verify on chain (lastRegistered / lastAlgorithmId)", "0x9ac294544131ac1709c3bbf8e680041475f04f61"]) {
  console.log(`bundle contains ${JSON.stringify(s)}:`, bundle.includes(s));
}
console.log("bundle contains bytecode fragment:", bundle.includes(bytecode.slice(0, 80)));
console.log("ALL CHECKS DONE");
