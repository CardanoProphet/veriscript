# VeriScript Backend

Express API server that indexes attestation UTxOs and signer metadata from the Cardano blockchain via Blockfrost.

## Dependencies

- **Node.js** v18+
- A **Blockfrost** project ID for the target network ([blockfrost.io](https://blockfrost.io))
- Deployed contracts using [../deploy-protocol](../deploy-protocol), documented in [../scripts/README](../scripts/README)

## Running locally

```bash
# 1. Copy the example environment file
cp .env.example .env

# 2. Fill out .env
#    BLOCKFROST_API_KEY — your Blockfrost project ID
#    CARDANO_NETWORK    — preprod | mainnet
#    PORT               — port to listen on (default: 3001)

# 3. Install dependencies and start the dev server
npm install
npm run dev
```

The server will be available at `http://localhost:3001` by default.

For production, build and run the compiled output:

```bash
npm run build
npm start
```

## Environment variables

| Variable             | Required | Description                                             |
| -------------------- | -------- | ------------------------------------------------------- |
| `BLOCKFROST_API_KEY` | Yes      | Blockfrost project ID used to query the chain.          |
| `CARDANO_NETWORK`    | No       | `preprod` (default) or `mainnet`.                       |
| `PORT`               | No       | Port the Express server listens on. Defaults to `3001`. |

## API endpoints

| Method | Path                              | Description                                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/config`                     | Protocol parameters and deployed script hashes/addresses.                                              |
| `GET`  | `/api/attestations`               | List attestations. Supports `?scriptHash=`, `?scriptAddress=`, `?mintingPolicy=`, `?page=`, `?limit=`. |
| `GET`  | `/api/attestations/:txHash/:txIx` | Fetch a single attestation UTxO by outref.                                                             |
| `GET`  | `/api/signers`                    | List all registered signers.                                                                           |
| `GET`  | `/api/protocol`                   | Current protocol parameters UTxO.                                                                      |
