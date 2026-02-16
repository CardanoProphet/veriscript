.PHONY: usage
usage:
	@echo "usage: make <command>"
	@echo "Available commands:"
	@echo "  shell                 -- nix shell github:aiken-lang/aiken/v1.1.21#aiken"
	@echo "  all                   -- build all versions"
	@echo "  mainnet-silent.json   -- aiken build (for Mainnet)"
	@echo "  mainnet-verbose.json  -- aiken build -t verbose (for Mainnet)"
	@echo "  preprod-silent.json   -- aiken build (for Preprod)"
	@echo "  preprod-verbose.json  -- aiken build -t verbose (for Preprod)"
	@echo "  check                 -- aiken check"

.PHONY: shell
shell:
	nix shell github:aiken-lang/aiken/v1.1.21#aiken

define aiken-build
	@aiken build --env ${1} -t ${2}
	@HASH=$$(aiken blueprint policy -v protocol_parameters); \
	sed -E -i ' \
	  /^\[config\.'"${1}"'\.protocol_parameters_script_hash\]$$/ { \
	    N; N; \
	    s/bytes = "[^"]*"/bytes = "'"$$HASH"'"/ \
	  } \
	  ' aiken.toml
	aiken build --env ${1} -t ${2} -o $(if $(filter preprod,$(1)),preprod,mainnet)-${2}.json
	@rm plutus.json
endef

# phonies are used here to avoid problematic timestamp detection

.PHONY: mainnet-silent.json
mainnet-silent.json:
	$(call aiken-build,default,silent)

.PHONY: mainnet-verbose.json
mainnet-verbose.json:
	$(call aiken-build,default,verbose)

.PHONY: preprod-silent.json
preprod-silent.json:
	$(call aiken-build,preprod,silent)

.PHONY: preprod-verbose.json
preprod-verbose.json:
	$(call aiken-build,preprod,verbose)

.PHONY: all
all: mainnet-silent.json mainnet-verbose.json preprod-silent.json preprod-verbose.json

.PHONY: check
check:
	aiken check
