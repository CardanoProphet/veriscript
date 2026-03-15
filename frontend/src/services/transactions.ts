/**
 * VeriScript transaction builders using MeshSDK.
 *
 * Contract constraints:
 * - MintSignerToken: EXACTLY 1 input. Choose a UTxO with ≥ 6 ADA.
 * - CreateAttestation: EXACTLY 1 input (the signer's UTxO with signer token).
 * - SignAttestation: 2 inputs sorted by outref; indices must match sorted order.
 * - RetireAttestation: 2 inputs; all signature tokens are burned.
 */

import {
  BrowserWallet,
  MeshTxBuilder,
  BlockfrostProvider,
} from "@meshsdk/core";
import type { BuilderData, Output, UTxO } from "@meshsdk/core";
import { sha3_256 } from "js-sha3";
import {
  ATTESTATION_VALIDATOR_REFERENCE,
  BLOCKFROST_API_KEY,
  MIN_ATTESTATION_LOVELACE,
  MIN_COLLATERAL_LOVELACE,
  PROTOCOL_PARAMS_TX_HASH,
  PROTOCOL_PARAMS_TX_IX,
  SIGNATURE_TOKEN_POLICY_REFERENCE,
  SIGNER_METADATA_LOVELACE,
  SIGNER_TOKEN_POLICY_REFERENCE,
} from "../config";
import type {
  AttestationUtxo,
  OutRef,
  ProtocolParametersDatum,
  ReferenceScriptDeployment,
} from "../types";
import { attestationDatum, signerMetadataDatum } from "./datum";

function getProvider() {
  return new BlockfrostProvider(BLOCKFROST_API_KEY);
}

function getTxBuilder(provider: BlockfrostProvider) {
  return new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  });
}

function referenceScriptSize(script: ReferenceScriptDeployment): string {
  return (script.cbor.length / 2).toString();
}

function calculateMinLovelace(builder: MeshTxBuilder, output: Output): bigint {
  return builder.calculateMinLovelaceForOutput(output);
}

function attachMintingScriptSource(
  builder: MeshTxBuilder,
  referenceScript: ReferenceScriptDeployment,
  redeemer: BuilderData["content"],
): MeshTxBuilder {
  return builder
    .mintTxInReference(
      referenceScript.txHash,
      referenceScript.txIx,
      referenceScriptSize(referenceScript),
      referenceScript.hash,
    )
    .mintReferenceTxInRedeemerValue(redeemer, "Mesh");
}

function attachSpendingScriptSource(
  builder: MeshTxBuilder,
  input: OutRef,
  referenceScript: ReferenceScriptDeployment,
  redeemer: BuilderData["content"],
  utxo?: {
    amount: { unit: string; quantity: string }[];
    address: string;
  },
): MeshTxBuilder {
  const tx = builder
    .spendingPlutusScriptV3()
    .txIn(input.txHash, input.txIndex, utxo?.amount, utxo?.address);

  return tx
    .spendingTxInReference(
      referenceScript.txHash,
      referenceScript.txIx,
      referenceScriptSize(referenceScript),
      referenceScript.hash,
    )
    .spendingReferenceTxInInlineDatumPresent()
    .spendingReferenceTxInRedeemerValue(redeemer, "Mesh");
}

function outRefKey(outRef: OutRef): string {
  return `${outRef.txHash}#${outRef.txIndex}`;
}

function getLovelace(amount: { unit: string; quantity: string }[]): bigint {
  return BigInt(
    amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0",
  );
}

function isPureLovelaceUtxo(utxo: UTxO): boolean {
  return utxo.output.amount.every((asset) => asset.unit === "lovelace");
}

async function fetchWalletUtxos(
  wallet: BrowserWallet,
  provider: BlockfrostProvider,
): Promise<UTxO[]> {
  const directUtxos = await wallet.getUtxos().catch(() => []);
  if (directUtxos.length > 0) {
    return directUtxos;
  }

  const [changeAddress, usedAddresses, unusedAddresses] = await Promise.all([
    wallet.getChangeAddress().catch(() => ""),
    wallet.getUsedAddresses().catch(() => []),
    wallet.getUnusedAddresses().catch(() => []),
  ]);

  const addresses = [
    ...new Set(
      [changeAddress, ...usedAddresses, ...unusedAddresses].filter(Boolean),
    ),
  ];
  const fetched = await Promise.all(
    addresses.map((address) =>
      provider.fetchAddressUTxOs(address).catch(() => []),
    ),
  );

  const byOutRef = new Map<string, UTxO>();
  for (const utxos of fetched) {
    for (const utxo of utxos) {
      byOutRef.set(
        outRefKey({
          txHash: utxo.input.txHash,
          txIndex: utxo.input.outputIndex,
        }),
        utxo,
      );
    }
  }
  return [...byOutRef.values()];
}

async function resolveCollateralSelection(
  wallet: BrowserWallet,
  provider: BlockfrostProvider,
  excluded: OutRef[],
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
      .filter(
        (utxo) =>
          !excludedKeys.has(
            outRefKey({
              txHash: utxo.input.txHash,
              txIndex: utxo.input.outputIndex,
            }),
          ),
      )
      .filter(isPureLovelaceUtxo)
      .filter(
        (utxo) => getLovelace(utxo.output.amount) >= MIN_COLLATERAL_LOVELACE,
      )
      .sort(sortByLovelaceAsc)[0];

  const walletCollateral = pickCollateral(
    await wallet.getCollateral().catch(() => []),
  );
  if (walletCollateral) {
    return walletCollateral;
  }

  const walletUtxos = pickCollateral(await wallet.getUtxos().catch(() => []));
  if (walletUtxos) {
    return walletUtxos;
  }

  const fetchedCollateral = pickCollateral(
    await fetchWalletUtxos(wallet, provider),
  );
  if (fetchedCollateral) {
    return fetchedCollateral;
  }

  throw new Error(
    `No pure-lovelace collateral UTxO >= ${MIN_COLLATERAL_LOVELACE.toString()} lovelace is available in the connected wallet.`,
  );
}

/**
 * Compute the signer token name as the contracts define it:
 *   sha3_256( [output_index_byte] ++ tx_hash_bytes )
 */
export function computeSignerTokenName(
  txHash: string,
  outputIndex: number,
): string {
  const txHashBytes = Buffer.from(txHash, "hex");
  const indexByte = Buffer.from([outputIndex & 0xff]);
  const input = Buffer.concat([indexByte, txHashBytes]);
  return sha3_256(input);
}

/**
 * Sort two inputs lexicographically, as Cardano ledger does.
 * Returns indices of a and b in the sorted array.
 */
function sortedInputs(
  a: { txHash: string; txIndex: number },
  b: { txHash: string; txIndex: number },
): {
  sorted: { txHash: string; txIndex: number }[];
  aIdx: number;
  bIdx: number;
} {
  const aKey = a.txHash + a.txIndex.toString().padStart(8, "0");
  const bKey = b.txHash + b.txIndex.toString().padStart(8, "0");
  if (aKey <= bKey) {
    return { sorted: [a, b], aIdx: 0, bIdx: 1 };
  }
  return { sorted: [b, a], aIdx: 1, bIdx: 0 };
}

/**
 * Mint signer token setup. Requires EXACTLY 1 UTxO as input (≥ 6 ADA).
 */
export async function mintSignerToken(
  wallet: BrowserWallet,
  params: {
    protocolDatum: ProtocolParametersDatum;
    signerMetadataAddress: string;
    nickName: string;
    realName?: string;
    contactInfo?: string;
    additionalInfo?: string;
    anchorUtxo: {
      txHash: string;
      txIndex: number;
      amount: { unit: string; quantity: string }[];
    };
  },
): Promise<string> {
  const provider = getProvider();
  const changeAddress = await wallet.getChangeAddress();
  const collateral = await resolveCollateralSelection(wallet, provider, [
    { txHash: params.anchorUtxo.txHash, txIndex: params.anchorUtxo.txIndex },
  ]);

  const tokenName = computeSignerTokenName(
    params.anchorUtxo.txHash,
    params.anchorUtxo.txIndex,
  );
  const policyId = params.protocolDatum.signer_token_policy;

  const metadataDatum = signerMetadataDatum(
    params.nickName,
    params.realName ?? "",
    params.contactInfo ?? "",
    params.additionalInfo ?? "",
  );

  // The redeemer is the index of the protocol params UTxO in the sorted
  // reference_inputs list. Cardano sorts reference inputs by outref lex order.
  const { aIdx: protocolParamsIdx } = sortedInputs(
    { txHash: PROTOCOL_PARAMS_TX_HASH, txIndex: PROTOCOL_PARAMS_TX_IX },
    {
      txHash: SIGNER_TOKEN_POLICY_REFERENCE.txHash,
      txIndex: SIGNER_TOKEN_POLICY_REFERENCE.txIx,
    },
  );

  const inputLovelace = getLovelace(params.anchorUtxo.amount);
  // Any existing non-lovelace tokens in the anchor UTxO must be returned to the
  // signer output; otherwise MeshTxBuilder adds a 3rd change output which
  // violates the contract's `expect [metadata_out, signer_out] = outputs` check.
  const existingTokens = params.anchorUtxo.amount.filter(
    (a) => a.unit !== "lovelace",
  );

  const buildTx = (signerLovelace: bigint, feeOverride?: string) => {
    const signerOutputAssets = [
      { unit: "lovelace", quantity: signerLovelace.toString() },
      ...existingTokens,
      { unit: policyId + tokenName, quantity: "1" },
    ];

    let tx = getTxBuilder(provider)
      .txIn(
        params.anchorUtxo.txHash,
        params.anchorUtxo.txIndex,
        params.anchorUtxo.amount,
        changeAddress,
      )
      .readOnlyTxInReference(PROTOCOL_PARAMS_TX_HASH, PROTOCOL_PARAMS_TX_IX)
      .mintPlutusScriptV3()
      .mint("2", policyId, tokenName);

    tx = attachMintingScriptSource(
      tx,
      SIGNER_TOKEN_POLICY_REFERENCE,
      BigInt(protocolParamsIdx),
    );

    tx = tx
      .txOut(params.signerMetadataAddress, [
        { unit: "lovelace", quantity: SIGNER_METADATA_LOVELACE.toString() },
        { unit: policyId + tokenName, quantity: "1" },
      ])
      .txOutInlineDatumValue(metadataDatum, "Mesh")
      .txOut(changeAddress, signerOutputAssets)
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      );

    if (feeOverride !== undefined) {
      tx = tx.setFee(feeOverride);
    }

    return tx;
  };

  const feeEstBuilder = buildTx(inputLovelace - SIGNER_METADATA_LOVELACE);
  feeEstBuilder.completeSync();
  const estimatedFee = feeEstBuilder.calculateFee();
  const adjustedFee = BigInt(Math.ceil(Number(estimatedFee) * 1.1));

  const signerLovelace = inputLovelace - SIGNER_METADATA_LOVELACE - adjustedFee;
  const unsignedTx = buildTx(
    signerLovelace,
    adjustedFee.toString(),
  ).completeSync();

  const signedTx = await wallet.signTx(unsignedTx);
  return wallet.submitTx(signedTx);
}

/**
 * Create a new attestation. The signer's UTxO must be the ONLY input.
 */
export async function createAttestation(
  wallet: BrowserWallet,
  params: {
    protocolDatum: ProtocolParametersDatum;
    attestationValidatorAddress: string;
    signerUtxo: {
      txHash: string;
      txIndex: number;
      amount: { unit: string; quantity: string }[];
    };
    signerTokenName: string;
    description: string;
    sourceCode: string;
    scriptHash: string;
    scriptAddress?: string;
    stakingPolicy?: string;
    mintingPolicy?: string;
    referencedScriptCbor?: string;
  },
): Promise<string> {
  const provider = getProvider();
  const changeAddress = await wallet.getChangeAddress();
  const collateral = await resolveCollateralSelection(wallet, provider, [
    { txHash: params.signerUtxo.txHash, txIndex: params.signerUtxo.txIndex },
  ]);

  const sigPolicyId = params.protocolDatum.signature_token_policy;
  const mintRedeemer = { alternative: 0, fields: [0n, -1n] };

  const datum = attestationDatum(
    params.signerTokenName,
    params.description,
    params.sourceCode,
    params.scriptHash,
    params.scriptAddress ?? "",
    params.stakingPolicy ?? "",
    params.mintingPolicy ?? "",
  );

  const existingTokens = params.signerUtxo.amount.filter(
    (asset) => asset.unit !== "lovelace",
  );
  const inputLovelace = getLovelace(params.signerUtxo.amount);
  const minLovelaceBuilder = getTxBuilder(provider);

  const attestationOutputMinLovelace = calculateMinLovelace(
    minLovelaceBuilder,
    {
      address: params.attestationValidatorAddress,
      amount: [
        { unit: "lovelace", quantity: "0" },
        { unit: sigPolicyId + params.signerTokenName, quantity: "1" },
      ],
      datum: {
        type: "Inline",
        data: { type: "Mesh", content: datum },
      },
      ...(params.referencedScriptCbor
        ? {
            referenceScript: {
              code: params.referencedScriptCbor,
              version: "V3" as const,
            },
          }
        : {}),
    },
  );
  const attestationLovelace =
    attestationOutputMinLovelace > MIN_ATTESTATION_LOVELACE
      ? attestationOutputMinLovelace
      : MIN_ATTESTATION_LOVELACE;
  const signerOutputMinLovelace = calculateMinLovelace(minLovelaceBuilder, {
    address: changeAddress,
    amount: [{ unit: "lovelace", quantity: "0" }, ...existingTokens],
  });

  const buildTx = (signerLovelace: bigint, feeOverride?: string) => {
    let tx = getTxBuilder(provider)
      .txIn(
        params.signerUtxo.txHash,
        params.signerUtxo.txIndex,
        params.signerUtxo.amount,
        changeAddress,
      )
      .readOnlyTxInReference(PROTOCOL_PARAMS_TX_HASH, PROTOCOL_PARAMS_TX_IX)
      .mintPlutusScriptV3()
      .mint("1", sigPolicyId, params.signerTokenName);

    tx = attachMintingScriptSource(
      tx,
      SIGNATURE_TOKEN_POLICY_REFERENCE,
      mintRedeemer,
    );

    tx = tx
      .txOut(params.attestationValidatorAddress, [
        { unit: "lovelace", quantity: attestationLovelace.toString() },
        { unit: sigPolicyId + params.signerTokenName, quantity: "1" },
      ])
      .txOutInlineDatumValue(datum, "Mesh");

    if (params.referencedScriptCbor) {
      tx = tx.txOutReferenceScript(params.referencedScriptCbor, "V3");
    }

    tx = tx
      .txOut(changeAddress, [
        { unit: "lovelace", quantity: signerLovelace.toString() },
        ...existingTokens,
      ])
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      );

    if (feeOverride !== undefined) {
      tx = tx.setFee(feeOverride);
    }

    return tx;
  };

  const maxSignerLovelaceBeforeFee = inputLovelace - attestationLovelace;
  if (maxSignerLovelaceBeforeFee < signerOutputMinLovelace) {
    throw new Error(
      `Selected signer UTxO does not hold enough lovelace. This flow needs a single signer-token UTxO with at least ${(
        attestationLovelace + signerOutputMinLovelace
      ).toString()} lovelace before fees.`,
    );
  }

  const feeEstBuilder = buildTx(maxSignerLovelaceBeforeFee);
  feeEstBuilder.completeSync();
  const estimatedFee = feeEstBuilder.calculateFee();
  const adjustedFee = BigInt(Math.ceil(Number(estimatedFee) * 1.1));
  const signerLovelace = inputLovelace - attestationLovelace - adjustedFee;
  if (signerLovelace < signerOutputMinLovelace) {
    throw new Error(
      `Selected signer UTxO does not hold enough lovelace. This flow needs at least ${(
        attestationLovelace +
        signerOutputMinLovelace +
        adjustedFee
      ).toString()} lovelace in the signer-token UTxO, including fees.`,
    );
  }

  const unsignedTx = buildTx(
    signerLovelace,
    adjustedFee.toString(),
  ).completeSync();

  const signedTx = await wallet.signTx(unsignedTx);
  return wallet.submitTx(signedTx);
}

/**
 * Sign an existing attestation (add your signature token).
 */
export async function signAttestation(
  wallet: BrowserWallet,
  params: {
    protocolDatum: ProtocolParametersDatum;
    attestationValidatorAddress: string;
    attestationUtxo: AttestationUtxo;
    signerUtxo: {
      txHash: string;
      txIndex: number;
      amount: { unit: string; quantity: string }[];
    };
    signerTokenName: string;
  },
): Promise<string> {
  const provider = getProvider();
  const changeAddress = await wallet.getChangeAddress();

  const sigPolicyId = params.protocolDatum.signature_token_policy;

  const attIn = {
    txHash: params.attestationUtxo.txHash,
    txIndex: params.attestationUtxo.txIx,
  };
  const sigIn = {
    txHash: params.signerUtxo.txHash,
    txIndex: params.signerUtxo.txIndex,
  };
  const { sorted, aIdx: attIdx, bIdx: signerIdx } = sortedInputs(attIn, sigIn);
  const collateral = await resolveCollateralSelection(wallet, provider, [
    attIn,
    sigIn,
  ]);

  const attRedeemer = {
    alternative: 0,
    fields: [0n, BigInt(signerIdx), BigInt(attIdx)],
  };
  const mintRedeemer = { alternative: 0, fields: [0n, BigInt(signerIdx)] };

  const updatedAssets = [
    { unit: "lovelace", quantity: params.attestationUtxo.lovelace },
    ...params.attestationUtxo.signers.map((s) => ({
      unit: s.policyId + s.tokenName,
      quantity: s.quantity,
    })),
    { unit: sigPolicyId + params.signerTokenName, quantity: "1" },
  ];
  const existingSignerTokens = params.signerUtxo.amount.filter(
    (asset) => asset.unit !== "lovelace",
  );
  const signerInputLovelace = getLovelace(params.signerUtxo.amount);
  const signerOutputMinLovelace = calculateMinLovelace(getTxBuilder(provider), {
    address: changeAddress,
    amount: [{ unit: "lovelace", quantity: "0" }, ...existingSignerTokens],
  });
  const attestationInputAssets = [
    { unit: "lovelace", quantity: params.attestationUtxo.lovelace },
    ...params.attestationUtxo.signers.map((s) => ({
      unit: s.policyId + s.tokenName,
      quantity: s.quantity,
    })),
  ];

  const { datum } = params.attestationUtxo;
  const existingDatum = attestationDatum(
    datum.original_author,
    datum.description,
    datum.source_code,
    datum.script_hash,
    datum.script_address,
    datum.staking_policy,
    datum.minting_policy,
  );

  const buildTx = (signerLovelace: bigint, feeOverride?: string) => {
    let tx = getTxBuilder(provider).readOnlyTxInReference(
      PROTOCOL_PARAMS_TX_HASH,
      PROTOCOL_PARAMS_TX_IX,
    );

    for (const inp of sorted) {
      if (inp.txHash === attIn.txHash && inp.txIndex === attIn.txIndex) {
        tx = attachSpendingScriptSource(
          tx,
          inp,
          ATTESTATION_VALIDATOR_REFERENCE,
          attRedeemer,
          {
            amount: attestationInputAssets,
            address: params.attestationValidatorAddress,
          },
        );
      } else {
        tx = tx.txIn(
          inp.txHash,
          inp.txIndex,
          params.signerUtxo.amount,
          changeAddress,
        );
      }
    }

    tx = tx.mintPlutusScriptV3().mint("1", sigPolicyId, params.signerTokenName);
    tx = attachMintingScriptSource(
      tx,
      SIGNATURE_TOKEN_POLICY_REFERENCE,
      mintRedeemer,
    );

    tx = tx
      .txOut(params.attestationValidatorAddress, updatedAssets)
      .txOutInlineDatumValue(existingDatum, "Mesh")
      .txOut(changeAddress, [
        { unit: "lovelace", quantity: signerLovelace.toString() },
        ...existingSignerTokens,
      ])
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      );

    if (feeOverride !== undefined) {
      tx = tx.setFee(feeOverride);
    }

    return tx;
  };

  const feeEstBuilder = buildTx(signerInputLovelace);
  feeEstBuilder.completeSync();
  const estimatedFee = feeEstBuilder.calculateFee();
  const adjustedFee = BigInt(Math.ceil(Number(estimatedFee) * 1.1));
  const signerLovelace = signerInputLovelace - adjustedFee;
  if (signerLovelace < signerOutputMinLovelace) {
    throw new Error(
      `Selected signer UTxO does not hold enough lovelace. This flow needs at least ${(
        signerOutputMinLovelace + adjustedFee
      ).toString()} lovelace in the signer-token UTxO, including fees.`,
    );
  }

  const unsignedTx = buildTx(
    signerLovelace,
    adjustedFee.toString(),
  ).completeSync();

  const signedTx = await wallet.signTx(unsignedTx);
  return wallet.submitTx(signedTx);
}

/**
 * Retire an attestation (original author only). Burns all signature tokens.
 */
export async function retireAttestation(
  wallet: BrowserWallet,
  params: {
    protocolDatum: ProtocolParametersDatum;
    attestationValidatorAddress: string;
    attestationUtxo: AttestationUtxo;
    signerUtxo: {
      txHash: string;
      txIndex: number;
      amount: { unit: string; quantity: string }[];
    };
    signerTokenName: string;
  },
): Promise<string> {
  const provider = getProvider();
  const changeAddress = await wallet.getChangeAddress();

  const sigPolicyId = params.protocolDatum.signature_token_policy;

  const attIn = {
    txHash: params.attestationUtxo.txHash,
    txIndex: params.attestationUtxo.txIx,
  };
  const sigIn = {
    txHash: params.signerUtxo.txHash,
    txIndex: params.signerUtxo.txIndex,
  };
  const { sorted, aIdx: attIdx, bIdx: signerIdx } = sortedInputs(attIn, sigIn);
  const collateral = await resolveCollateralSelection(wallet, provider, [
    attIn,
    sigIn,
  ]);

  const attRedeemer = {
    alternative: 1,
    fields: [0n, BigInt(signerIdx), BigInt(attIdx)],
  };
  const burnRedeemer = { alternative: 1, fields: [] };
  const attestationInputAssets = [
    { unit: "lovelace", quantity: params.attestationUtxo.lovelace },
    ...params.attestationUtxo.signers.map((s) => ({
      unit: s.policyId + s.tokenName,
      quantity: s.quantity,
    })),
  ];
  const existingSignerTokens = params.signerUtxo.amount.filter(
    (asset) => asset.unit !== "lovelace",
  );
  const totalInputLovelace =
    getLovelace(params.signerUtxo.amount) +
    BigInt(params.attestationUtxo.lovelace);
  const signerOutputMinLovelace = calculateMinLovelace(getTxBuilder(provider), {
    address: changeAddress,
    amount: [{ unit: "lovelace", quantity: "0" }, ...existingSignerTokens],
  });

  const buildTx = (walletOutputLovelace: bigint, feeOverride?: string) => {
    let tx = getTxBuilder(provider).readOnlyTxInReference(
      PROTOCOL_PARAMS_TX_HASH,
      PROTOCOL_PARAMS_TX_IX,
    );

    for (const inp of sorted) {
      if (inp.txHash === attIn.txHash && inp.txIndex === attIn.txIndex) {
        tx = attachSpendingScriptSource(
          tx,
          inp,
          ATTESTATION_VALIDATOR_REFERENCE,
          attRedeemer,
          {
            amount: attestationInputAssets,
            address: params.attestationValidatorAddress,
          },
        );
      } else {
        tx = tx.txIn(
          inp.txHash,
          inp.txIndex,
          params.signerUtxo.amount,
          changeAddress,
        );
      }
    }

    for (const sig of params.attestationUtxo.signers) {
      tx = tx.mintPlutusScriptV3().mint("-1", sigPolicyId, sig.tokenName);
      tx = attachMintingScriptSource(
        tx,
        SIGNATURE_TOKEN_POLICY_REFERENCE,
        burnRedeemer,
      );
    }

    tx = tx
      .txOut(changeAddress, [
        { unit: "lovelace", quantity: walletOutputLovelace.toString() },
        ...existingSignerTokens,
      ])
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      );

    if (feeOverride !== undefined) {
      tx = tx.setFee(feeOverride);
    }

    return tx;
  };

  const feeEstBuilder = buildTx(totalInputLovelace);
  feeEstBuilder.completeSync();
  const estimatedFee = feeEstBuilder.calculateFee();
  const adjustedFee = BigInt(Math.ceil(Number(estimatedFee) * 1.1));
  const walletOutputLovelace = totalInputLovelace - adjustedFee;
  if (walletOutputLovelace < signerOutputMinLovelace) {
    throw new Error(
      `Retire transaction does not leave enough lovelace for the return UTxO. It needs at least ${(
        signerOutputMinLovelace + adjustedFee
      ).toString()} lovelace across the signer and attestation inputs, including fees.`,
    );
  }

  const unsignedTx = buildTx(
    walletOutputLovelace,
    adjustedFee.toString(),
  ).completeSync();

  const signedTx = await wallet.signTx(unsignedTx);
  return wallet.submitTx(signedTx);
}
