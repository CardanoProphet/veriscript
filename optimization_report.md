# VeriScript Optimization Report

This report documents the feedback collected from users during the testing phase, and describes how each reported issue or suggestion was addressed.

---

## User Feedback Summary

Feedback was collected via a public form: https://forms.gle/1Y3S2MyXoXQzdmw5A. 10 responses were received between April 25 and May 17, 2026. The average rating was **8.7 / 10**.

| Date       | Rating | Issue / Suggestion                                                                                                  |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| 2026-04-25 | 9      | Wallet gets stuck in infinite loading state after inactivity; page reload required                                  |
| 2026-04-28 | 10     | Buttons do not change the cursor when hovering                                                                      |
| 2026-04-28 | 10     | No issues                                                                                                           |
| 2026-04-29 | 8      | Transaction hash is cut off in the notification after minting a signer token; a link to an explorer would be better |
| 2026-05-04 | 10     | Validators require exactly one input; wallets with fragmented UTxOs cannot satisfy this                             |
| 2026-05-09 | 10     | No issues                                                                                                           |
| 2026-05-10 | 10     | Different fonts appear in text fields                                                                               |
| 2026-05-14 | 7      | Infinite spinning wheel issue at first                                                                              |
| 2026-05-16 | 10     | No issues                                                                                                           |
| 2026-05-17 | 3      | Cost model error when minting the signer token                                                                      |

---

## Issues Addressed

### 1. Wallet stuck in infinite loading state after inactivity

**Reported:** 2026-04-25 (rating 9), 2026-05-14 (rating 7)

**Root cause:** A dormant wallet browser extension can leave its `enable()` call pending indefinitely, stranding the UI in a loading state with no way to recover other than reloading the page.

**Fix:** A `withTimeout` wrapper was introduced in `frontend/src/hooks/useWallet.ts` that races both `BrowserWallet.enable()` and `wallet.getChangeAddress()` against a 3-second deadline. On timeout, the promise rejects with a clear message and `connecting` is reset to `false`, allowing the user to retry immediately without a page reload. The error is surfaced via an error toast notification.

---

### 2. Buttons do not show a pointer cursor on hover

**Reported:** 2026-04-28 (rating 10)

**Fix:** A global CSS rule was added in `frontend/src/index.css` applying `cursor: pointer` to all enabled buttons via a Tailwind base layer override:

```css
@layer base {
  button:not(:disabled) {
    cursor: pointer;
  }
}
```

---

### 3. Transaction hash cut off after minting; no explorer link

**Reported:** 2026-04-29 (rating 8)

**Fix:** The `Toast` component (`frontend/src/components/Toast.tsx`) was updated to accept an optional `txHash` field. When present, a clickable "View transaction on explorer ↗" link is rendered below the message, pointing to the block explorer URL for that transaction. The auto-dismiss timer is also extended from 5 seconds to 10 seconds for toasts that carry a transaction hash, giving the user time to click the link.

---

### 4. Validators required exactly one input; fragmented UTxOs could not satisfy them

**Reported:** 2026-05-04 (rating 10)

**Root cause:** The `signer_token_policy` and `signature_token_policy` validators used `expect [single_input] = inputs`, hard-requiring exactly one transaction input. Wallets with fragmented UTxOs naturally produce multiple inputs and could not complete the transaction.

**Fix:** Both validators were updated to use explicit index-based lookup (`list.at(inputs, ix)`) driven by indices supplied in the redeemer:

- `signer_token_policy` now accepts a `SignerTokenPolicyRedeemer` with `signer_input_ix`, `protocol_parameters_ix`, and `signer_metadata_output_ix`.
- `signature_token_policy`'s `MintSignatureToken` redeemer was updated with `signer_input_ix` and `attestation_output_ix` fields, and the previous `-1` sentinel hack for single-input detection was removed.

Transaction builders supply the correct indices, so any number of wallet inputs is now supported.

---

### 5. Inconsistent fonts in text fields

**Reported:** 2026-05-10 (rating 10)

**Fix:** The `font-family` declaration in `frontend/src/index.css` was audited and confirmed to be consistently set to `"Inter"` as the primary typeface across the entire application. The CSS was reformatted for clarity. Component-level font overrides that diverged from this baseline were removed.

---

### 6. Cost model error when minting the signer token

**Reported:** 2026-05-17 (rating 3)

**Root cause:** The Mesh SDK ships its own hardcoded ("offline") cost model lists (`DEFAULT_V1_COST_MODEL_LIST`, `DEFAULT_V2_COST_MODEL_LIST`, `DEFAULT_V3_COST_MODEL_LIST`) that it uses for transaction fee evaluation. During testing, the preprod testnet updated its cost models. Because the SDK was using its bundled static values rather than the live on-chain parameters, the cost evaluation diverged from what the node expected, causing transactions to fail with a cost model error.

**Fix:** A `syncMeshCostModels()` function was added in `frontend/src/services/transactions.ts` that fetches the current epoch's protocol parameters from Blockfrost on first use and **mutates the Mesh SDK's exported cost model arrays in place** to match the live on-chain values. This runs once per session (the promise is cached) and completes before any transaction is built, ensuring the SDK always evaluates against the actual network cost models rather than its bundled defaults.

---

## Internally Identified Fixes

The following issues were identified and resolved internally during development and testing, independently of user reports.

---

### I-1. Signing could target an already-spent attestation UTxO

**Root cause:** The `signAttestation` transaction builder was constructing the attestation input using the top-level `attestationUtxo.txHash` field. This field holds the hash of the representative constituent (the first one merged into the group), which may have already been spent if the attestation has been signed since it was first indexed. The actual live UTxO on-chain is the most recent constituent - not necessarily the representative.

**Fix:** The builder now selects the correct constituent by finding the one whose `originalAuthor` matches `attestationUtxo.datum.original_author` (falling back to the first constituent if none matches). This ensures the transaction always references the UTxO that is currently unspent:

```ts
const mainConstituent =
  params.attestationUtxo.constituents.find(
    (c) => c.originalAuthor === params.attestationUtxo.datum.original_author,
  ) ?? params.attestationUtxo.constituents[0];
```

---

### I-2. Counter-attestation always created a new UTxO instead of joining an existing one

**Root cause:** The `SignCounterAttestationModal` always called `createAttestation`, even when a counter-attestation UTxO for that attestation already existed on-chain. This meant a second signer attempting to counter-attest would create a duplicate UTxO rather than adding their signature token to the existing one - the correct behaviour, consistent with how regular signing works.

**Fix:** The modal now checks whether a counter-attestation constituent already exists in the attestation's `constituents` list. If one does, it calls `signAttestation` against that UTxO instead of creating a new one. Additionally, a guard was added to prevent the same signer from submitting a duplicate counter-attestation: the UI checks the signer's token name against the already-present counter-signers, disables the submit button, and shows an informational message if they have already counter-attested.

---

### I-3. Signer impersonation via signer tokens locked at arbitrary script addresses

**Root cause:** Every spend path that proves "the caller controls signer token X" — `attestation_validator.Sign`, `attestation_validator.Retire`, `signature_token_policy.MintSignatureToken`, and `signer_metadata_validator.Update` — locates the signer input by index (`list.at(inputs, signer_input_ix)`) and then verifies only that the referenced UTxO holds the expected signer token. The address holding the token was effectively unconstrained. The single guard that existed, in `signature_token_policy`, merely excluded the attestation validator's own address (`payment_credential != Script(attestation_validator)`), leaving every _other_ script address acceptable.

**Fix:** All four affected entry points now pattern-match the signer input as `Address { payment_credential: VerificationKey(..), .. }`, forcing the signer token to come from a wallet (key-controlled) address rather than from any script. The previous narrow "not the attestation script" check in `signature_token_policy` was removed in favour of this stricter shape match. Tests were added covering each entry point against script-locked signer inputs.

---

### I-4. Protocol hijack via admin-token co-location with the ProtocolParameters UTxO

**Root cause:** `protocol_parameters.UpdateProtocol` authorises a parameter change by verifying that the admin token is spent in the same transaction (`admin_token_spent`). Nothing prevented the admin token from sitting _inside_ the ProtocolParameters UTxO itself. If it did, anyone could spend the PP UTxO, point `deployer_ix` back at that same input, and trivially satisfy `admin_token_spent` from the PP UTxO's own value — taking control of protocol parameters without ever holding the admin token.

**Fix:** Both `MintInitProtocol` and `UpdateProtocol` now assert `quantity_of(protocol_value, policy_id, admin_token) == 0`, so the admin token and the PP UTxO can never live at the same output. The check is enforced at mint time (so the protocol cannot be initialised into a vulnerable state) and at every update (so it cannot be rolled into one later).

---

### I-5. Attestation datum spoofing when minting a signature token onto an existing attestation

**Root cause:** `signature_token_policy.MintSignatureToken` performs full datum validation only when `is_new_attestation` is true. In the existing-attestation branch the datum check was unconditionally `True`, on the assumption that the spend of the existing attestation UTxO would run `attestation_validator.Sign` and re-validate the datum. The policy never actually checked that such a spend was happening. A registered signer could therefore mint a signature token onto a brand-new `attestation_validator` output carrying an arbitrary datum — for example forging `original_author` to attribute their signature to someone else.

**Fix:** The existing-attestation branch now also requires that at least one transaction input is being spent from the attestation validator's address (`list.any(inputs, fn(input) { input.output.address.payment_credential == Script(attestation_validator) })`). This guarantees `attestation_validator.Sign` runs in the same transaction and enforces datum invariance against an already-validated input, closing the spoofing path.

---

### I-6. Second signer token could be minted to a script address, bricking the signer identity

**Root cause:** `signer_token_policy` mints two signer tokens. Only the first token's destination was constrained (it must accompany the signer metadata datum). The second token's output was unchecked. After I-3, every spend path that uses a signer token requires it to come from a `VerificationKey` (wallet) address — so if the second token were minted to a script address it would be permanently unusable, irrecoverably bricking the signer's identity at the moment of registration. This is a footgun introduced as a direct consequence of the I-3 hardening.

**Fix:** `signer_token_policy` now additionally requires that at least one output carrying the signer token sits at a `VerificationKey` address (`second_token_at_wallet`), ensuring the signer always retains a usable token in their wallet.

---

## Summary

### User-Reported Issues

| #   | Issue                                          | Status |
| --- | ---------------------------------------------- | ------ |
| 1   | Wallet infinite loading state after inactivity | Fixed  |
| 2   | No pointer cursor on button hover              | Fixed  |
| 3   | Transaction hash truncated; no explorer link   | Fixed  |
| 4   | Validators reject fragmented UTxO wallets      | Fixed  |
| 5   | Inconsistent fonts in text fields              | Fixed  |
| 6   | Cost model error when minting signer token     | Fixed  |

### Internally Identified Issues

| #   | Issue                                                                   | Status |
| --- | ----------------------------------------------------------------------- | ------ |
| I-1 | Signing targets already-spent attestation UTxO                          | Fixed  |
| I-2 | Counter-attestation always creates new UTxO instead of joining existing | Fixed  |
| I-3 | Signer impersonation via signer tokens locked at script addresses       | Fixed  |
| I-4 | Protocol hijack via admin-token co-location with PP UTxO                | Fixed  |
| I-5 | Attestation datum spoofing on signature-token mint over existing UTxO   | Fixed  |
| I-6 | Second signer token mintable to script address, bricking signer         | Fixed  |
