# Deployment Scripts

This folder contains the TypeScript deploy tooling for the VeriScript protocol.

The recommended entrypoint is the repo-root wrapper:

```bash
./deploy-protocol
```

That wrapper runs `scripts/deploy-protocol.ts` through the local `tsx` loader in `scripts/node_modules`.

## What The Deploy Does

A normal full deploy does this:

1. Picks an anchor UTxO from the deployer wallet, unless you provide one explicitly.
2. Writes that anchor into `contracts/aiken.toml`.
3. Builds the selected blueprint through `contracts/Makefile` using Nix.
4. Deploys the 4 execution reference scripts to the AlwaysFalse address:
   - `attestation_validator`
   - `signature_token_policy`
   - `signer_metadata_validator`
   - `signer_token_policy`
5. Creates the protocol parameters UTxO in phase 2.
   That UTxO itself carries the `protocol_parameters` reference script.
6. Writes the deployment result to:
   - `deployments/protocol-deployment.json`
   - `frontend/src/generated/protocolDeployment.ts`
   - `backend/src/generated/protocolDeployment.ts`

## Requirements

- Node dependencies for `scripts/`
- Nix, because the build step delegates to `contracts/Makefile`
- A funded deployer wallet seed phrase
- A Blockfrost API key for the target network

Install the local script dependencies once:

```bash
npm --prefix scripts install
```

## Recommended Usage

From the repo root:

```bash
./deploy-protocol \
  --deployer-seed "word1 word2 word3 ..." \
  --network preprod \
  --blockfrost-api-key <key>
```

This is the preferred path because it both builds and deploys.

## CLI Options

```bash
./deploy-protocol \
  --deployer-seed "<mnemonic>" \
  --network preprod \
  --blockfrost-api-key <key> \
  [--style verbose|silent] \
  [--blueprint-path <path>] \
  [--anchor-tx-hash <hash> --anchor-tx-ix <ix>] \
  [--skip-build] \
  [--build-only] \
  [--resume-phase2]
```

Notes:

- `--style verbose|silent`
  Selects which Aiken blueprint variant to build. Default is `verbose`.
- `--blueprint-path`
  Uses an existing blueprint file instead of the default one for the selected network/style.
- `--skip-build`
  Reuses the current built blueprint instead of rebuilding contracts.
- `--build-only`
  Stops after build plus manifest/generated-file sync. It does not submit on-chain transactions.
- `--resume-phase2`
  Reuses recorded phase-1 reference-script outputs from the deployment manifest and only submits phase 2.
- `--anchor-tx-hash` and `--anchor-tx-ix`
  Override automatic anchor selection.

## Examples

Full deploy:

```bash
./deploy-protocol \
  --deployer-seed "word1 word2 word3 ..." \
  --network preprod \
  --blockfrost-api-key <key>
```

Build only:

```bash
./deploy-protocol \
  --deployer-seed "word1 word2 word3 ..." \
  --network preprod \
  --blockfrost-api-key <key> \
  --build-only
```

Reuse the existing blueprint without rebuilding:

```bash
./deploy-protocol \
  --deployer-seed "word1 word2 word3 ..." \
  --network preprod \
  --blockfrost-api-key <key> \
  --skip-build
```

Retry only phase 2 after a phase-1 success:

```bash
./deploy-protocol \
  --deployer-seed "word1 word2 word3 ..." \
  --network preprod \
  --blockfrost-api-key <key> \
  --skip-build \
  --resume-phase2
```

## Environment Variable Fallbacks

The deploy script also reads these variables if you do not pass the matching CLI flags:

```bash
DEPLOYER_SEED=...
CARDANO_NETWORK=preprod
BLOCKFROST_API_KEY=...
BLUEPRINT_STYLE=verbose
BLUEPRINT_PATH=
ANCHOR_TX_HASH=
ANCHOR_TX_IX=
```

The CLI flags take precedence.

## Running From `scripts/`

If you want to invoke the TypeScript file directly instead of using the repo-root wrapper, run this from `scripts/`:

```bash
npm run deploy -- \
  --deployer-seed "word1 word2 word3 ..." \
  --network preprod \
  --blockfrost-api-key <key>
```

The root wrapper is still the simpler option.

## Outputs

After a successful deploy, the script prints:

- the selected anchor
- the protocol parameters address and policy id
- the reference-script output references
- the final protocol parameters UTxO
- the paths of the updated manifest/generated files

The generated deployment files are the source of truth used by the frontend and backend.

## Operational Notes

- Re-running a full deploy from the same wallet will create a new set of reference-script outputs and a new protocol parameters UTxO.
- If phase 1 already succeeded and you only want to finish phase 2, use `--resume-phase2`.
- If you use `--skip-build` without providing a `--blueprint-path`, the script reuses the default blueprint path for the chosen network/style.
