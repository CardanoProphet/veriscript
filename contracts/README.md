# VeriScript contracts

This directory contains the source code for the smart contracts of the VeriScript protocol.
(See: https://projectcatalyst.io/funds/14/cardano-use-cases-concepts/veriscript-on-chain-source-code-verification)

The project supports building validator scripts for both **Mainnet** and **Preprod** environments, with two output styles:

- `silent` — minimal Plutus JSON (cleaner, smaller)
- `verbose` — full debug information included

## Requirements

- Nix (recommended way to get a reproducible Aiken toolchain)
- or Docker + Aiken installed manually

## Quick Start

```bash
# Enter the Aiken development shell (recommended)
make shell
```

This drops you into a nix-shell with Aiken v1.1.21 available.

## Main Commands

```bash
make              # show this help
make all          # build all four variants
make check        # run aiken check (type checking + linting)

# Individual builds
make mainnet-silent.json
make mainnet-verbose.json
make preprod-silent.json
make preprod-verbose.json
```

## Output Files

After running any build command, you will get one or more of these files:

| File                        | Network  | Tracing style | Purpose                                 |
|-----------------------------|----------|---------------|-----------------------------------------|
| `mainnet-silent.json`       | Mainnet  | silent        | Production deployment (clean)           |
| `mainnet-verbose.json`      | Mainnet  | verbose       | Debugging / testing on Mainnet params   |
| `preprod-silent.json`       | Preprod  | silent        | Testing / development                   |
| `preprod-verbose.json`      | Preprod  | verbose       | Debugging on Preprod                    |

Each JSON file contains the compiled Plutus validator(s) + the correct protocol parameters script hash for that network.

## How it works

The Makefile:

1. Uses the correct `--env` flag (`default` or `preprod`)
2. Builds once to extract the policy script hash via `aiken blueprint policy -v protocol_parameters`
3. Updates `aiken.toml` with the freshly computed hash
4. Re-builds with the updated config → produces final JSON
5. Cleans up temporary `plutus.json`

This ensures the generated Plutus script always contains the correct protocol parameters hash for the target network.

## Development Workflow (recommended)

```bash
# 1. Enter the shell once
make shell

# 2. Work on your validators / aiken code
#    (aiken fmt, aiken check, etc. are available)

# 3. Build everything when ready
make all

# or just one variant
make preprod-verbose.json
```

## Updating Aiken version

To use a different Aiken version:

1. Edit the `github:aiken-lang/aiken/v1.1.21#aiken` reference in the Makefile
2. (optionally) pin it to a commit hash instead of a tag for better reproducibility

```make
nix shell github:aiken-lang/aiken/<commit-hash>#aiken
```
