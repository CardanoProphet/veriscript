/**
 * One-shot VeriScript deployment.
 *
 * Flow:
 * 1. Select an anchor UTxO from the deployer wallet (or use the supplied one)
 * 2. Write the anchor into contracts/aiken.toml
 * 3. Build the selected blueprint variant through contracts/Makefile + nix
 * 4. Deploy all reference scripts to the AlwaysFalse address
 * 5. Mint the protocol parameters + admin tokens using the reserved anchor input
 * 6. Persist the deployment data for frontend/backend consumption
 *
 * Example:
 *   ./deploy-protocol \
 *     --deployer-seed "word1 word2 ..." \
 *     --network preprod \
 *     --blockfrost-api-key <key>
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { Buffer } from "buffer";
import { bech32 } from "bech32";
import {
  MeshWallet,
  MeshTxBuilder,
  BlockfrostProvider,
  applyCborEncoding,
  resolveNativeScriptHash,
  resolveScriptHash,
  type NativeScript,
  type Output,
  type Protocol,
  type UTxO,
} from "@meshsdk/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(REPO_ROOT, "contracts");
const AIKEN_TOML_PATH = path.join(CONTRACTS_DIR, "aiken.toml");
const DEPLOYMENTS_DIR = path.join(REPO_ROOT, "deployments");
const DEPLOYMENT_MANIFEST_PATH = path.join(DEPLOYMENTS_DIR, "protocol-deployment.json");
const FRONTEND_GENERATED_PATH = path.join(REPO_ROOT, "frontend/src/generated/protocolDeployment.ts");
const BACKEND_GENERATED_PATH = path.join(REPO_ROOT, "backend/src/generated/protocolDeployment.ts");

const REF_SCRIPT_SETTLE_MS = 10_000;
const ANCHOR_FEE_BUFFER_LOVELACE = 5_000_000n;
const MIN_COLLATERAL_LOVELACE = 5_000_000n;
const MIN_PREFERRED_ANCHOR_LOVELACE = 25_000_000n;
const TX_CONFIRMATION_POLL_MS = 5_000;
const TX_CONFIRMATION_TIMEOUT_MS = 180_000;

const PROTOCOL_PARAMETERS_TOKEN_HEX = textToHex("ProtocolParameters");
const ADMIN_TOKEN_HEX = textToHex("Admin");

type NetworkName = "preprod" | "mainnet";
type BlueprintStyle = "silent" | "verbose";
type ScriptName =
  | "attestation_validator"
  | "protocol_parameters"
  | "signature_token_policy"
  | "signer_metadata_validator"
  | "signer_token_policy";

type Amount = { unit: string; quantity: string }[];

interface CliOptions {
  blockfrostApiKey: string;
  deployerSeed: string;
  network: NetworkName;
  style: BlueprintStyle;
  blueprintPath?: string;
  anchorTxHash?: string;
  anchorTxIx?: number;
  skipBuild: boolean;
  buildOnly: boolean;
  resumePhase2: boolean;
}

interface Validator {
  title: string;
  compiledCode: string;
  hash: string;
}

interface Blueprint {
  validators: Validator[];
}

interface AnchorSelection {
  txHash: string;
  txIx: number;
  amount: Amount;
  address: string;
  lovelace: bigint;
  autoSelected: boolean;
}

interface PreparedBlueprint {
  hashes: Record<ScriptName, string>;
  cbors: Record<ScriptName, string>;
  addresses: {
    attestation_validator: string;
    protocol_parameters: string;
    signer_metadata_validator: string;
  };
}

interface ReferenceScriptDeployment {
  txHash: string;
  txIx: number;
  hash: string;
  cbor: string;
}

interface ProtocolParametersDeployment {
  txHash: string;
  txIx: number;
  hash: string;
  cbor: string;
  address: string;
}

interface OutRef {
  txHash: string;
  txIx: number;
}

interface ReferenceScriptBatch {
  names: ScriptName[];
  unsignedTx: string;
  size: number;
  selectedInputs: OutRef[];
}

interface NetworkDeploymentState {
  network: NetworkName;
  style: BlueprintStyle;
  updatedAt: string;
  blueprintPath: string;
  anchor: {
    txHash: string;
    txIx: number;
  };
  hashes: Record<ScriptName, string>;
  addresses: {
    attestation_validator: string;
    protocol_parameters: string;
    signer_metadata_validator: string;
  };
  cbors: Record<ScriptName, string>;
  referenceScripts: Record<ScriptName, ReferenceScriptDeployment>;
  protocolParameters: ProtocolParametersDeployment;
}

type DeploymentManifest = Record<NetworkName, NetworkDeploymentState>;

const SCRIPT_SPECS: ReadonlyArray<{
  name: ScriptName;
  titleFragment: string;
}> = [
  { name: "attestation_validator", titleFragment: "attestation_validator.attestation_validator.spend" },
  { name: "signature_token_policy", titleFragment: "signature_token_policy.signature_token_policy.mint" },
  { name: "signer_metadata_validator", titleFragment: "signer_metadata_validator.signer_metadata_validator.spend" },
  { name: "signer_token_policy", titleFragment: "signer_token_policy.signer_token_policy.mint" },
];

const PROTOCOL_PARAMETERS_SPEC = {
  name: "protocol_parameters" as const,
  titleFragment: "protocol_parameters.protocol_parameters.mint",
};

const ALWAYS_FALSE: NativeScript = { type: "before", slot: "1" };

function textToHex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function fail(message: string): never {
  throw new Error(message);
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) fail(`Missing required value: ${name}`);
  return value;
}

function parseNetwork(value: string | undefined): NetworkName {
  if (!value || value === "preprod") return "preprod";
  if (value === "mainnet") return "mainnet";
  fail(`Invalid network: ${value}`);
}

function parseStyle(value: string | undefined): BlueprintStyle {
  if (!value) return "verbose";
  if (value === "verbose" || value === "silent") return value;
  fail(`Invalid blueprint style: ${value}`);
}

function parseOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`Invalid ${name}: ${value}`);
  return parsed;
}

function printHelp(): void {
  console.log(`Usage:
  ./deploy-protocol --deployer-seed "<mnemonic>" --network preprod --blockfrost-api-key <key>

Options:
  --deployer-seed <mnemonic>      Deployer seed phrase
  --network <preprod|mainnet>    Target Cardano network
  --blockfrost-api-key <key>     Blockfrost project key
  --style <verbose|silent>       Blueprint tracing style (default: verbose)
  --blueprint-path <path>        Use an existing blueprint file instead of the default contracts target
  --anchor-tx-hash <hash>        Override automatic anchor UTxO selection
  --anchor-tx-ix <ix>            Override automatic anchor UTxO selection
  --skip-build                   Reuse the existing blueprint instead of rebuilding through nix
  --build-only                   Stop after build + deployment manifest sync
  --resume-phase2                Reuse recorded phase-1 reference scripts and submit only phase 2
  --help                         Show this message

Environment fallbacks:
  DEPLOYER_SEED, CARDANO_NETWORK, BLOCKFROST_API_KEY, BLUEPRINT_STYLE,
  BLUEPRINT_PATH, ANCHOR_TX_HASH, ANCHOR_TX_IX`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    if (token === "--help") {
      printHelp();
      process.exit(0);
    }
    if (token === "--skip-build" || token === "--build-only" || token === "--resume-phase2") {
      flags.add(token);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) fail(`Missing value for ${token}`);
    args.set(token, next);
    index += 1;
  }

  const styleFromEnv =
    process.env.BLUEPRINT_STYLE ??
    (process.env.VERBOSE === undefined
      ? undefined
      : process.env.VERBOSE === "false"
      ? "silent"
      : "verbose");

  return {
    blockfrostApiKey: requireValue(
      args.get("--blockfrost-api-key") ?? process.env.BLOCKFROST_API_KEY,
      "blockfrost api key"
    ),
    deployerSeed: requireValue(
      args.get("--deployer-seed") ?? process.env.DEPLOYER_SEED,
      "deployer seed"
    ),
    network: parseNetwork(args.get("--network") ?? process.env.CARDANO_NETWORK),
    style: parseStyle(args.get("--style") ?? styleFromEnv),
    blueprintPath: args.get("--blueprint-path") ?? process.env.BLUEPRINT_PATH,
    anchorTxHash: args.get("--anchor-tx-hash") ?? process.env.ANCHOR_TX_HASH,
    anchorTxIx: parseOptionalInteger(args.get("--anchor-tx-ix") ?? process.env.ANCHOR_TX_IX, "anchor tx ix"),
    skipBuild: flags.has("--skip-build"),
    buildOnly: flags.has("--build-only"),
    resumePhase2: flags.has("--resume-phase2"),
  };
}

function networkId(network: NetworkName): 0 | 1 {
  return network === "mainnet" ? 1 : 0;
}

function networkToAikenEnv(network: NetworkName): "default" | "preprod" {
  return network === "mainnet" ? "default" : "preprod";
}

function resolveBuildTarget(network: NetworkName, style: BlueprintStyle): string {
  const prefix = network === "mainnet" ? "mainnet" : "preprod";
  return `${prefix}-${style}.json`;
}

function resolveDefaultBlueprintPath(network: NetworkName, style: BlueprintStyle): string {
  return path.join(CONTRACTS_DIR, resolveBuildTarget(network, style));
}

function createProvider(apiKey: string): BlockfrostProvider {
  return new BlockfrostProvider(apiKey);
}

function createWallet(provider: BlockfrostProvider, seed: string, network: NetworkName): MeshWallet {
  return new MeshWallet({
    networkId: networkId(network),
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: seed.trim().split(/\s+/),
    },
  });
}

function createTxBuilder(provider: BlockfrostProvider): MeshTxBuilder {
  return new MeshTxBuilder({ fetcher: provider, submitter: provider });
}

function createConfiguredTxBuilder(
  provider: BlockfrostProvider,
  protocolParams: Pick<Protocol, "coinsPerUtxoSize" | "minFeeRefScriptCostPerByte" | "maxTxSize">
): MeshTxBuilder {
  return createTxBuilder(provider).protocolParams(protocolParams);
}

function loadBlueprint(blueprintPath: string): Blueprint {
  if (!fs.existsSync(blueprintPath)) fail(`Blueprint not found: ${blueprintPath}`);
  return JSON.parse(fs.readFileSync(blueprintPath, "utf8")) as Blueprint;
}

function findValidator(blueprint: Blueprint, fragment: string): Validator {
  const validator = blueprint.validators.find((entry) => entry.title.includes(fragment));
  if (!validator) fail(`Validator not found for fragment: ${fragment}`);
  return validator;
}

function scriptHashToEnterpriseAddress(scriptHash: string, network: NetworkName): string {
  const header = network === "mainnet" ? 0x71 : 0x70;
  const addressBytes = Buffer.concat([Buffer.from([header]), Buffer.from(scriptHash, "hex")]);
  const prefix = network === "mainnet" ? "addr" : "addr_test";
  return bech32.encode(prefix, bech32.toWords(addressBytes), 200);
}

function getAlwaysFalseAddress(network: NetworkName): string {
  return scriptHashToEnterpriseAddress(resolveNativeScriptHash(ALWAYS_FALSE), network);
}

function encodeBlueprintScript(validator: Validator): string {
  const scriptCbor = applyCborEncoding(validator.compiledCode);
  const resolvedHash = resolveScriptHash(scriptCbor, "V3");
  if (resolvedHash !== validator.hash) {
    fail(
      `Encoded script hash mismatch for ${validator.title}: expected ${validator.hash}, got ${resolvedHash}`
    );
  }
  return scriptCbor;
}

function prepareBlueprint(network: NetworkName, blueprintPath: string): PreparedBlueprint {
  const blueprint = loadBlueprint(blueprintPath);

  const hashes = blankStringScriptRecord();
  const cbors = blankStringScriptRecord();

  for (const spec of SCRIPT_SPECS) {
    const validator = findValidator(blueprint, spec.titleFragment);
    hashes[spec.name] = validator.hash;
    cbors[spec.name] = encodeBlueprintScript(validator);
  }

  const protocolParametersValidator = findValidator(blueprint, PROTOCOL_PARAMETERS_SPEC.titleFragment);
  hashes.protocol_parameters = protocolParametersValidator.hash;
  cbors.protocol_parameters = encodeBlueprintScript(protocolParametersValidator);

  return {
    hashes,
    cbors,
    addresses: {
      attestation_validator: scriptHashToEnterpriseAddress(hashes.attestation_validator, network),
      protocol_parameters: scriptHashToEnterpriseAddress(hashes.protocol_parameters, network),
      signer_metadata_validator: scriptHashToEnterpriseAddress(hashes.signer_metadata_validator, network),
    },
  };
}

function blankStringScriptRecord(): Record<ScriptName, string> {
  return {
    attestation_validator: "",
    protocol_parameters: "",
    signature_token_policy: "",
    signer_metadata_validator: "",
    signer_token_policy: "",
  };
}

function blankReferenceScriptRecord(): Record<ScriptName, ReferenceScriptDeployment> {
  return {
    attestation_validator: { txHash: "", txIx: 0, hash: "", cbor: "" },
    protocol_parameters: { txHash: "", txIx: 0, hash: "", cbor: "" },
    signature_token_policy: { txHash: "", txIx: 0, hash: "", cbor: "" },
    signer_metadata_validator: { txHash: "", txIx: 0, hash: "", cbor: "" },
    signer_token_policy: { txHash: "", txIx: 0, hash: "", cbor: "" },
  };
}

function blankProtocolParametersDeployment(): ProtocolParametersDeployment {
  return {
    txHash: "",
    txIx: 0,
    hash: "",
    cbor: "",
    address: "",
  };
}

function getLovelace(amount: Amount): bigint {
  const lovelace = amount.find((asset) => asset.unit === "lovelace" || asset.unit === "");
  return BigInt(lovelace?.quantity ?? "0");
}

function isPureLovelace(amount: Amount): boolean {
  return amount.every((asset) => asset.unit === "lovelace" || asset.unit === "");
}

function isPureLovelaceUtxo(utxo: UTxO): boolean {
  return isPureLovelace(utxo.output.amount);
}

function sameOutRef(left: { txHash: string; txIx: number }, right: { txHash: string; txIx: number }): boolean {
  return left.txHash === right.txHash && left.txIx === right.txIx;
}

function outRefKey(outRef: { txHash: string; txIx: number }): string {
  return `${outRef.txHash}#${outRef.txIx}`;
}

function utxoOutRef(utxo: UTxO): OutRef {
  return {
    txHash: utxo.input.txHash,
    txIx: utxo.input.outputIndex,
  };
}

function chooseAnchorCandidate(utxos: UTxO[]): AnchorSelection {
  if (utxos.length === 0) fail("No wallet UTxOs available for anchor selection");

  const ranked = [...utxos]
    .map((utxo) => ({
      utxo,
      lovelace: getLovelace(utxo.output.amount),
      pureLovelace: isPureLovelace(utxo.output.amount),
    }))
    .sort((left, right) => {
      const leftEnough = left.lovelace >= MIN_PREFERRED_ANCHOR_LOVELACE ? 1 : 0;
      const rightEnough = right.lovelace >= MIN_PREFERRED_ANCHOR_LOVELACE ? 1 : 0;
      if (leftEnough !== rightEnough) return rightEnough - leftEnough;
      if (left.pureLovelace !== right.pureLovelace) return left.pureLovelace ? -1 : 1;
      if (leftEnough === 1 && rightEnough === 1) return left.lovelace < right.lovelace ? -1 : 1;
      if (left.lovelace === right.lovelace) return 0;
      return left.lovelace > right.lovelace ? -1 : 1;
    });

  const selected = ranked[0];
  return {
    txHash: selected.utxo.input.txHash,
    txIx: selected.utxo.input.outputIndex,
    amount: selected.utxo.output.amount,
    address: selected.utxo.output.address,
    lovelace: selected.lovelace,
    autoSelected: true,
  };
}

async function resolveAnchorSelection(
  wallet: MeshWallet,
  provider: BlockfrostProvider,
  anchorTxHash: string | undefined,
  anchorTxIx: number | undefined
): Promise<AnchorSelection> {
  if (anchorTxHash !== undefined || anchorTxIx !== undefined) {
    if (!anchorTxHash || anchorTxIx === undefined) {
      fail("Both --anchor-tx-hash and --anchor-tx-ix are required when overriding the anchor");
    }

    const utxos = await provider.fetchUTxOs(anchorTxHash);
    const anchorUtxo = utxos.find(
      (utxo) => utxo.input.txHash === anchorTxHash && utxo.input.outputIndex === anchorTxIx
    );
    if (!anchorUtxo) fail(`Anchor UTxO not found: ${anchorTxHash}#${anchorTxIx}`);

    return {
      txHash: anchorUtxo.input.txHash,
      txIx: anchorUtxo.input.outputIndex,
      amount: anchorUtxo.output.amount,
      address: anchorUtxo.output.address,
      lovelace: getLovelace(anchorUtxo.output.amount),
      autoSelected: false,
    };
  }

  const walletUtxos = await fetchWalletUtxos(wallet, provider);
  return chooseAnchorCandidate(walletUtxos);
}

function calculateMinLovelace(builder: MeshTxBuilder, output: Output): bigint {
  return builder.calculateMinLovelaceForOutput(output);
}

function protocolParametersDatum(hashes: Record<ScriptName, string>) {
  return {
    alternative: 0,
    fields: [
      hashes.signer_token_policy,
      hashes.signer_metadata_validator,
      hashes.signature_token_policy,
      hashes.attestation_validator,
    ],
  };
}

function buildManifestState(
  network: NetworkName,
  style: BlueprintStyle,
  blueprintPath: string,
  anchor: { txHash: string; txIx: number },
  prepared: PreparedBlueprint
): NetworkDeploymentState {
  const referenceScripts = blankReferenceScriptRecord();
  for (const name of Object.keys(referenceScripts) as ScriptName[]) {
    referenceScripts[name] = {
      txHash: "",
      txIx: 0,
      hash: prepared.hashes[name],
      cbor: prepared.cbors[name],
    };
  }

  return {
    network,
    style,
    updatedAt: new Date().toISOString(),
    blueprintPath: path.relative(REPO_ROOT, blueprintPath),
    anchor: { ...anchor },
    hashes: { ...prepared.hashes },
    addresses: { ...prepared.addresses },
    cbors: { ...prepared.cbors },
    referenceScripts,
    protocolParameters: {
      txHash: "",
      txIx: 0,
      hash: prepared.hashes.protocol_parameters,
      cbor: prepared.cbors.protocol_parameters,
      address: prepared.addresses.protocol_parameters,
    },
  };
}

function readAnchorFromAikenToml(network: NetworkName): { txHash: string; txIx: number } {
  const content = fs.readFileSync(AIKEN_TOML_PATH, "utf8");
  const section = networkToAikenEnv(network);
  const ixMatch = content.match(new RegExp(`\\[config\\.${section}\\][\\s\\S]*?anchor_ix = (\\d+)`));
  const txMatch = content.match(
    new RegExp(`\\[config\\.${section}\\.anchor_tx_id\\]\\s*\\nbytes = "([^"]*)"`)
  );

  return {
    txHash: txMatch?.[1] ?? "",
    txIx: ixMatch ? Number(ixMatch[1]) : 0,
  };
}

function createDefaultManifestState(network: NetworkName): NetworkDeploymentState {
  const style: BlueprintStyle = "verbose";
  const anchor = readAnchorFromAikenToml(network);
  const blueprintPath = resolveDefaultBlueprintPath(network, style);

  if (!fs.existsSync(blueprintPath)) {
    return {
      network,
      style,
      updatedAt: new Date(0).toISOString(),
      blueprintPath: path.relative(REPO_ROOT, blueprintPath),
      anchor,
      hashes: blankStringScriptRecord(),
      addresses: {
        attestation_validator: "",
        protocol_parameters: "",
        signer_metadata_validator: "",
      },
      cbors: blankStringScriptRecord(),
      referenceScripts: blankReferenceScriptRecord(),
      protocolParameters: blankProtocolParametersDeployment(),
    };
  }

  return buildManifestState(network, style, blueprintPath, anchor, prepareBlueprint(network, blueprintPath));
}

function loadManifest(): DeploymentManifest {
  if (!fs.existsSync(DEPLOYMENT_MANIFEST_PATH)) {
    return {
      mainnet: createDefaultManifestState("mainnet"),
      preprod: createDefaultManifestState("preprod"),
    };
  }

  return JSON.parse(fs.readFileSync(DEPLOYMENT_MANIFEST_PATH, "utf8")) as DeploymentManifest;
}

function renderDeploymentModule(manifest: DeploymentManifest): string {
  return `// Generated by scripts/deploy-protocol.ts\nexport const DEPLOYMENTS = ${JSON.stringify(
    manifest,
    null,
    2
  )} as const;\n\nexport type DeploymentNetwork = keyof typeof DEPLOYMENTS;\nexport type DeploymentInfo = (typeof DEPLOYMENTS)[DeploymentNetwork];\n`;
}

function syncDeploymentArtifacts(manifest: DeploymentManifest): void {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(FRONTEND_GENERATED_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(BACKEND_GENERATED_PATH), { recursive: true });

  fs.writeFileSync(DEPLOYMENT_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  const moduleContent = renderDeploymentModule(manifest);
  fs.writeFileSync(FRONTEND_GENERATED_PATH, moduleContent);
  fs.writeFileSync(BACKEND_GENERATED_PATH, moduleContent);
}

function updateAnchorInAikenToml(network: NetworkName, anchor: { txHash: string; txIx: number }): void {
  const section = networkToAikenEnv(network);
  const original = fs.readFileSync(AIKEN_TOML_PATH, "utf8");

  const ixPattern = new RegExp(`(\\[config\\.${section}\\][\\s\\S]*?anchor_ix = )(\\d+)`);
  const txPattern = new RegExp(`(\\[config\\.${section}\\.anchor_tx_id\\]\\s*\\nbytes = ")([^"]*)(")`);

  if (!ixPattern.test(original)) fail(`Could not locate anchor_ix for config.${section} in aiken.toml`);
  if (!txPattern.test(original)) fail(`Could not locate anchor_tx_id for config.${section} in aiken.toml`);

  const updated = original
    .replace(ixPattern, `$1${anchor.txIx}`)
    .replace(txPattern, `$1${anchor.txHash}$3`);

  fs.writeFileSync(AIKEN_TOML_PATH, updated);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

async function buildContracts(network: NetworkName, style: BlueprintStyle): Promise<string> {
  const target = resolveBuildTarget(network, style);
  console.log(`\n🔨 Building ${target} via contracts/Makefile…`);
  await runCommand("make", ["build-in-nix", `TARGET=${target}`], CONTRACTS_DIR);
  return resolveDefaultBlueprintPath(network, style);
}

function availableWithoutAnchor(utxos: UTxO[], anchor: AnchorSelection): UTxO[] {
  return utxos.filter(
    (utxo) => !sameOutRef({ txHash: utxo.input.txHash, txIx: utxo.input.outputIndex }, anchor)
  );
}

async function listWalletAddresses(wallet: MeshWallet): Promise<string[]> {
  const [changeAddress, usedAddresses, unusedAddresses] = await Promise.all([
    wallet.getChangeAddress(),
    wallet.getUsedAddresses().catch(() => []),
    wallet.getUnusedAddresses().catch(() => []),
  ]);

  return Array.from(new Set([changeAddress, ...usedAddresses, ...unusedAddresses].filter(Boolean)));
}

async function fetchWalletUtxos(wallet: MeshWallet, provider: BlockfrostProvider): Promise<UTxO[]> {
  const addresses = await listWalletAddresses(wallet);
  const utxosByOutRef = new Map<string, UTxO>();

  for (const address of addresses) {
    const utxos = await provider.fetchAddressUTxOs(address);
    for (const utxo of utxos) {
      utxosByOutRef.set(outRefKey(utxoOutRef(utxo)), utxo);
    }
  }

  if (utxosByOutRef.size > 0) {
    return Array.from(utxosByOutRef.values());
  }

  return wallet.getUtxos();
}

function extractSelectedInputs(builder: MeshTxBuilder): OutRef[] {
  const body = (
    builder as unknown as {
      meshTxBuilderBody?: {
        inputs?: Array<{
          txIn: {
            txHash: string;
            txIndex: number;
          };
        }>;
      };
    }
  ).meshTxBuilderBody;

  if (!body?.inputs) {
    fail("Could not inspect selected inputs from MeshTxBuilder");
  }

  return body.inputs.map((input) => ({
    txHash: input.txIn.txHash,
    txIx: input.txIn.txIndex,
  }));
}

async function waitForTxInfo(provider: BlockfrostProvider, txHash: string): Promise<void> {
  const deadline = Date.now() + TX_CONFIRMATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await provider.fetchTxInfo(txHash);
      return;
    } catch {
      await sleep(TX_CONFIRMATION_POLL_MS);
    }
  }

  fail(`Timed out waiting for transaction confirmation: ${txHash}`);
}

async function waitForWalletUtxoSettlement(
  wallet: MeshWallet,
  provider: BlockfrostProvider,
  anchor: AnchorSelection,
  txHash: string,
  consumedInputs: OutRef[]
): Promise<UTxO[]> {
  const deadline = Date.now() + TX_CONFIRMATION_TIMEOUT_MS;
  const walletAddresses = new Set(await listWalletAddresses(wallet));
  const consumedInputKeys = new Set(consumedInputs.map(outRefKey));

  while (Date.now() < deadline) {
    let expectedWalletOutputKeys: Set<string> | null = null;

    try {
      const outputs = await provider.fetchUTxOs(txHash);
      expectedWalletOutputKeys = new Set(
        outputs.filter((utxo) => walletAddresses.has(utxo.output.address)).map((utxo) => outRefKey(utxoOutRef(utxo)))
      );
    } catch {
      await sleep(TX_CONFIRMATION_POLL_MS);
      continue;
    }

    const walletUtxos = await fetchWalletUtxos(wallet, provider);
    const availableUtxos = availableWithoutAnchor(walletUtxos, anchor);
    const walletUtxoKeys = new Set(availableUtxos.map((utxo) => outRefKey(utxoOutRef(utxo))));
    const hasConsumedInput = [...consumedInputKeys].some((key) => walletUtxoKeys.has(key));
    const missingExpectedWalletOutput = [...expectedWalletOutputKeys].some((key) => !walletUtxoKeys.has(key));

    if (!hasConsumedInput && !missingExpectedWalletOutput) {
      return availableUtxos;
    }

    await sleep(TX_CONFIRMATION_POLL_MS);
  }

  fail(`Timed out waiting for wallet UTxO settlement after transaction: ${txHash}`);
}

async function resolveCollateralSelection(
  wallet: MeshWallet,
  provider: BlockfrostProvider,
  excluded: OutRef[]
): Promise<UTxO> {
  const excludedKeys = new Set(excluded.map(outRefKey));
  const sortByLovelaceAsc = (left: UTxO, right: UTxO) => {
    const leftLovelace = getLovelace(left.output.amount);
    const rightLovelace = getLovelace(right.output.amount);
    if (leftLovelace === rightLovelace) return 0;
    return leftLovelace < rightLovelace ? -1 : 1;
  };

  const pickCollateral = (utxos: UTxO[]): UTxO | undefined =>
    [...utxos]
      .filter((utxo) => !excludedKeys.has(outRefKey(utxoOutRef(utxo))))
      .filter(isPureLovelaceUtxo)
      .filter((utxo) => getLovelace(utxo.output.amount) >= MIN_COLLATERAL_LOVELACE)
      .sort(sortByLovelaceAsc)[0];

  const walletCollateral = pickCollateral(await wallet.getCollateral().catch(() => []));
  if (walletCollateral) {
    return walletCollateral;
  }

  const fetchedCollateral = pickCollateral(await fetchWalletUtxos(wallet, provider));
  if (fetchedCollateral) {
    return fetchedCollateral;
  }

  fail(
    `No pure-lovelace collateral UTxO >= ${MIN_COLLATERAL_LOVELACE.toString()} lovelace ` +
      "is available after excluding the anchor input."
  );
}

async function buildReferenceScriptBatch(
  provider: BlockfrostProvider,
  protocolParams: Pick<Protocol, "coinsPerUtxoSize" | "minFeeRefScriptCostPerByte" | "maxTxSize">,
  changeAddress: string,
  alwaysFalseAddress: string,
  availableUtxos: UTxO[],
  prepared: PreparedBlueprint,
  names: ScriptName[]
): Promise<ReferenceScriptBatch> {
  const builder = createConfiguredTxBuilder(provider, protocolParams);

  for (const name of names) {
    const minLovelace = calculateMinLovelace(builder, {
      address: alwaysFalseAddress,
      amount: [{ unit: "lovelace", quantity: "0" }],
      referenceScript: { code: prepared.cbors[name], version: "V3" },
    });

    builder
      .txOut(alwaysFalseAddress, [{ unit: "lovelace", quantity: minLovelace.toString() }])
      .txOutReferenceScript(prepared.cbors[name], "V3");
  }

  const unsignedTx = await builder
    .changeAddress(changeAddress)
    .selectUtxosFrom(availableUtxos)
    .complete();

  const size = builder.getSerializedSize();
  if (size > protocolParams.maxTxSize) {
    fail(
      `Reference script batch ${names.join(", ")} serialized to ${size} bytes, ` +
        `which exceeds max tx size ${protocolParams.maxTxSize}.`
    );
  }

  return {
    names,
    unsignedTx,
    size,
    selectedInputs: extractSelectedInputs(builder),
  };
}

async function buildLargestReferenceScriptBatch(
  provider: BlockfrostProvider,
  protocolParams: Pick<Protocol, "coinsPerUtxoSize" | "minFeeRefScriptCostPerByte" | "maxTxSize">,
  changeAddress: string,
  alwaysFalseAddress: string,
  availableUtxos: UTxO[],
  prepared: PreparedBlueprint,
  remainingSpecs: ReadonlyArray<{
    name: ScriptName;
  }>
): Promise<ReferenceScriptBatch> {
  let lastGoodBatch: ReferenceScriptBatch | null = null;

  for (let count = 1; count <= remainingSpecs.length; count += 1) {
    const candidateNames = remainingSpecs.slice(0, count).map((spec) => spec.name);

    try {
      const batch = await buildReferenceScriptBatch(
        provider,
        protocolParams,
        changeAddress,
        alwaysFalseAddress,
        availableUtxos,
        prepared,
        candidateNames
      );
      lastGoodBatch = batch;
    } catch (error) {
      if (lastGoodBatch) {
        return lastGoodBatch;
      }
      throw error;
    }
  }

  if (!lastGoodBatch) {
    fail("Could not build any reference script batch");
  }

  return lastGoodBatch;
}

async function deployReferenceScripts(
  wallet: MeshWallet,
  provider: BlockfrostProvider,
  network: NetworkName,
  anchor: AnchorSelection,
  prepared: PreparedBlueprint
): Promise<Record<ScriptName, ReferenceScriptDeployment>> {
  const changeAddress = await wallet.getChangeAddress();
  const alwaysFalseAddress = getAlwaysFalseAddress(network);
  const protocolParams = await provider.fetchProtocolParameters();
  const results = blankReferenceScriptRecord();

  let availableUtxos = availableWithoutAnchor(await fetchWalletUtxos(wallet, provider), anchor);
  const remainingSpecs = [...SCRIPT_SPECS];

  console.log(`\n📍 AlwaysFalse address: ${alwaysFalseAddress}`);
  console.log(`   Wallet UTxOs available for phase 1: ${availableUtxos.length}`);
  console.log(`\n📦 Deploying ${SCRIPT_SPECS.length} reference scripts…\n`);

  while (remainingSpecs.length > 0) {
    const batch = await buildLargestReferenceScriptBatch(
      provider,
      protocolParams,
      changeAddress,
      alwaysFalseAddress,
      availableUtxos,
      prepared,
      remainingSpecs
    );

    const label = batch.names.length === 1 ? batch.names[0] : batch.names.join(", ");
    process.stdout.write(`  ${label}: `);

    const signedTx = await wallet.signTx(batch.unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    console.log(`tx ${txHash} (${batch.size} bytes)`);
    batch.names.forEach((name, index) => {
      results[name] = {
        txHash,
        txIx: index,
        hash: prepared.hashes[name],
        cbor: prepared.cbors[name],
      };
    });

    await waitForTxInfo(provider, txHash);
    availableUtxos = await waitForWalletUtxoSettlement(wallet, provider, anchor, txHash, batch.selectedInputs);
    remainingSpecs.splice(0, batch.names.length);
  }

  return results;
}

async function deployProtocolParameters(
  wallet: MeshWallet,
  provider: BlockfrostProvider,
  anchor: AnchorSelection,
  prepared: PreparedBlueprint
): Promise<{ deployment: ProtocolParametersDeployment; minLovelace: bigint }> {
  const changeAddress = await wallet.getChangeAddress();
  const protocolParams = await provider.fetchProtocolParameters();
  const builder = createConfiguredTxBuilder(provider, protocolParams);
  const collateral = await resolveCollateralSelection(wallet, provider, [
    { txHash: anchor.txHash, txIx: anchor.txIx },
  ]);

  const datum = protocolParametersDatum(prepared.hashes);
  const protocolOutputMinLovelace = calculateMinLovelace(builder, {
    address: prepared.addresses.protocol_parameters,
    amount: [
      { unit: "lovelace", quantity: "0" },
      { unit: prepared.hashes.protocol_parameters + PROTOCOL_PARAMETERS_TOKEN_HEX, quantity: "1" },
    ],
    datum: {
      type: "Inline",
      data: { type: "Mesh", content: datum },
    },
    referenceScript: { code: prepared.cbors.protocol_parameters, version: "V3" },
  });

  const minimumAnchorLovelace = protocolOutputMinLovelace + ANCHOR_FEE_BUFFER_LOVELACE;
  if (anchor.lovelace < minimumAnchorLovelace) {
    fail(
      `Selected anchor ${anchor.txHash}#${anchor.txIx} holds ${anchor.lovelace.toString()} lovelace, ` +
        `but phase 2 needs at least ${minimumAnchorLovelace.toString()} lovelace ` +
        `(protocol output ${protocolOutputMinLovelace.toString()} + ${ANCHOR_FEE_BUFFER_LOVELACE.toString()} fee buffer).`
    );
  }

  console.log("\n📍 Protocol parameters address:", prepared.addresses.protocol_parameters);
  console.log("   Policy ID:", prepared.hashes.protocol_parameters);
  console.log("   Anchor:", `${anchor.txHash}#${anchor.txIx}`);
  console.log(`   Anchor lovelace: ${anchor.lovelace.toString()}`);
  console.log(
    "   Collateral:",
    `${collateral.input.txHash}#${collateral.input.outputIndex} (${getLovelace(collateral.output.amount).toString()} lovelace)`
  );
  console.log(`   Protocol output min lovelace: ${protocolOutputMinLovelace.toString()}`);

  const mintRedeemer = { alternative: 0, fields: [] };

  const unsignedTx = await builder
    .txIn(anchor.txHash, anchor.txIx, anchor.amount, anchor.address)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .mintPlutusScriptV3()
    .mint("1", prepared.hashes.protocol_parameters, PROTOCOL_PARAMETERS_TOKEN_HEX)
    .mintingScript(prepared.cbors.protocol_parameters)
    .mintRedeemerValue(mintRedeemer, "Mesh")
    .mintPlutusScriptV3()
    .mint("1", prepared.hashes.protocol_parameters, ADMIN_TOKEN_HEX)
    .mintingScript(prepared.cbors.protocol_parameters)
    .mintRedeemerValue(mintRedeemer, "Mesh")
    .txOut(prepared.addresses.protocol_parameters, [
      { unit: "lovelace", quantity: protocolOutputMinLovelace.toString() },
      { unit: prepared.hashes.protocol_parameters + PROTOCOL_PARAMETERS_TOKEN_HEX, quantity: "1" },
    ])
    .txOutInlineDatumValue(datum, "Mesh")
    .txOutReferenceScript(prepared.cbors.protocol_parameters, "V3")
    .changeAddress(changeAddress)
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);
  const txHash = await wallet.submitTx(signedTx);

  return {
    deployment: {
      txHash,
      txIx: 0,
      hash: prepared.hashes.protocol_parameters,
      cbor: prepared.cbors.protocol_parameters,
      address: prepared.addresses.protocol_parameters,
    },
    minLovelace: protocolOutputMinLovelace,
  };
}

function applyReferenceDeployments(
  state: NetworkDeploymentState,
  results: Record<ScriptName, ReferenceScriptDeployment>
): void {
  state.updatedAt = new Date().toISOString();
  for (const name of Object.keys(results) as ScriptName[]) {
    state.referenceScripts[name] = results[name];
  }
}

function applyProtocolDeployment(
  state: NetworkDeploymentState,
  deployment: ProtocolParametersDeployment
): void {
  state.updatedAt = new Date().toISOString();
  state.protocolParameters = deployment;
}

function reuseRecordedReferenceDeployments(
  existingState: NetworkDeploymentState | undefined,
  prepared: PreparedBlueprint
): Record<ScriptName, ReferenceScriptDeployment> {
  if (!existingState) {
    fail("--resume-phase2 requires an existing deployment manifest entry for this network");
  }

  const results = blankReferenceScriptRecord();

  for (const spec of SCRIPT_SPECS) {
    const existing = existingState.referenceScripts[spec.name];
    if (!existing?.txHash) {
      fail(`--resume-phase2 requires an existing phase-1 deployment for ${spec.name}`);
    }
    if (existing.hash !== prepared.hashes[spec.name]) {
      fail(
        `--resume-phase2 hash mismatch for ${spec.name}: manifest has ${existing.hash}, ` +
          `current build has ${prepared.hashes[spec.name]}`
      );
    }

    results[spec.name] = existing;
  }

  return results;
}

function printSummary(
  options: CliOptions,
  state: NetworkDeploymentState,
  referenceResults: Record<ScriptName, ReferenceScriptDeployment>,
  protocolDeployment: ProtocolParametersDeployment
): void {
  const sep = "─".repeat(70);
  console.log(`\n✅ Deployment complete!\n${sep}`);
  console.log(`   Network:      ${options.network}`);
  console.log(`   Style:        ${options.style}`);
  console.log(`   Blueprint:    ${state.blueprintPath}`);
  console.log(`   Anchor:       ${state.anchor.txHash}#${state.anchor.txIx}`);
  console.log(`   Protocol UTxO ${protocolDeployment.txHash}#${protocolDeployment.txIx}`);
  console.log(`   Manifest:     ${path.relative(REPO_ROOT, DEPLOYMENT_MANIFEST_PATH)}`);
  console.log(`   Frontend:     ${path.relative(REPO_ROOT, FRONTEND_GENERATED_PATH)}`);
  console.log(`   Backend:      ${path.relative(REPO_ROOT, BACKEND_GENERATED_PATH)}`);
  console.log("\n# Reference scripts:");
  for (const [name, deployment] of Object.entries(referenceResults).filter(([, entry]) => entry.txHash !== "")) {
    console.log(`#   ${name}: ${deployment.txHash}#${deployment.txIx} (hash: ${deployment.hash})`);
  }
  console.log(sep);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const provider = createProvider(options.blockfrostApiKey);
  const wallet = createWallet(provider, options.deployerSeed, options.network);
  const deployerAddress = await wallet.getChangeAddress();
  const configuredAnchor =
    options.skipBuild && options.anchorTxHash === undefined && options.anchorTxIx === undefined
      ? readAnchorFromAikenToml(options.network)
      : {
          txHash: options.anchorTxHash,
          txIx: options.anchorTxIx,
        };

  console.log("🚀 VeriScript one-shot deploy");
  console.log(`   Network:   ${options.network}`);
  console.log(`   Style:     ${options.style}`);
  console.log(`   Deployer:  ${deployerAddress}`);

  const anchor = await resolveAnchorSelection(wallet, provider, configuredAnchor.txHash, configuredAnchor.txIx);
  console.log(
    `   Anchor:    ${anchor.txHash}#${anchor.txIx} (${anchor.lovelace.toString()} lovelace${
      anchor.autoSelected ? ", auto-selected" : ""
    })`
  );

  if (!options.skipBuild) {
    updateAnchorInAikenToml(options.network, { txHash: anchor.txHash, txIx: anchor.txIx });
    console.log(`   Updated:   ${path.relative(REPO_ROOT, AIKEN_TOML_PATH)}`);
  } else {
    console.log(`   Reusing:   ${path.relative(REPO_ROOT, AIKEN_TOML_PATH)}`);
  }

  let blueprintPath = options.blueprintPath
    ? path.resolve(options.blueprintPath)
    : resolveDefaultBlueprintPath(options.network, options.style);

  if (!options.skipBuild) {
    blueprintPath = await buildContracts(options.network, options.style);
  } else if (!fs.existsSync(blueprintPath)) {
    fail(`Blueprint not found and --skip-build was set: ${blueprintPath}`);
  }

  const prepared = prepareBlueprint(options.network, blueprintPath);
  const manifest = loadManifest();
  const previousState = manifest[options.network];
  manifest[options.network] = buildManifestState(
    options.network,
    options.style,
    blueprintPath,
    { txHash: anchor.txHash, txIx: anchor.txIx },
    prepared
  );

  let referenceResults: Record<ScriptName, ReferenceScriptDeployment>;
  if (options.resumePhase2) {
    referenceResults = reuseRecordedReferenceDeployments(previousState, prepared);
    applyReferenceDeployments(manifest[options.network], referenceResults);
  } else {
    referenceResults = blankReferenceScriptRecord();
  }

  syncDeploymentArtifacts(manifest);

  if (options.buildOnly) {
    console.log("\n✅ Build complete. Deployment manifest and generated config files were updated.");
    return;
  }

  if (!options.resumePhase2) {
    referenceResults = await deployReferenceScripts(wallet, provider, options.network, anchor, prepared);
    applyReferenceDeployments(manifest[options.network], referenceResults);
    syncDeploymentArtifacts(manifest);

    console.log(`\n⏳ Waiting ${Math.floor(REF_SCRIPT_SETTLE_MS / 1000)}s for reference scripts to settle…`);
    await sleep(REF_SCRIPT_SETTLE_MS);
  } else {
    console.log("\n⏭️  Reusing recorded phase-1 reference scripts from deployment manifest");
  }

  const protocolDeployment = await deployProtocolParameters(wallet, provider, anchor, prepared);
  applyProtocolDeployment(manifest[options.network], protocolDeployment.deployment);
  syncDeploymentArtifacts(manifest);

  printSummary(options, manifest[options.network], referenceResults, protocolDeployment.deployment);
}

main().catch((error: unknown) => {
  console.error("\n❌ Deployment failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
