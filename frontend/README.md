# VeriScript Frontend

React + TypeScript + Vite application for interacting with the VeriScript on-chain attestation protocol.

## Dependencies

- **Node.js** v18+
- **Backend** must be running and reachable (see `../backend/README.md`)
- A **Blockfrost** project ID for the target network ([blockfrost.io](https://blockfrost.io))
- A **Cardano browser wallet** (Eternl, Nami, etc.) connected to the same network
- Deployed contracts using [../deploy-protocol](../deploy-protocol), documented in [../scripts/README](../scripts/README)

## Running locally

```bash
# 1. Copy the example environment file
cp .env.example .env

# 2. Fill out .env
#    VITE_API_URL            — URL of the running backend (default: http://localhost:3001)
#    VITE_BLOCKFROST_API_KEY — your Blockfrost project ID
#    VITE_CARDANO_NETWORK    — preprod | mainnet

# 3. Install dependencies and start the dev server
npm install
npm run dev
```

The app will be available at `http://localhost:5173` by default.

## Environment variables

| Variable                       | Required | Description                                                                                                          |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`                 | No       | Backend base URL. Defaults to `http://localhost:3001`.                                                               |
| `VITE_BLOCKFROST_API_KEY`      | Yes      | Blockfrost project ID used by MeshSDK for transaction building.                                                      |
| `VITE_CARDANO_NETWORK`         | No       | `preprod` (default) or `mainnet`.                                                                                    |
| `VITE_PROTOCOL_PARAMS_TX_HASH` | No       | Override for the Protocol Parameters UTxO tx hash. Falls back to the value in `src/generated/protocolDeployment.ts`. |
| `VITE_PROTOCOL_PARAMS_TX_IX`   | No       | Output index for the above. Defaults to `0`.                                                                         |
