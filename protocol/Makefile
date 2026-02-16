.PHONY: usage

usage:
	@echo "usage: make <command>"
	@echo "Available commands:"
	@echo "  install-tx3  -- show tx3 installation instructions"
	@echo "  check        -- trix check"
	@echo "  build        -- trix build"
	@echo "  codegen      -- trix codegen"

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Linux)
	OPEN := xdg-open
endif
ifeq ($(UNAME_S),Darwin)
	OPEN := open
endif
ifeq ($(filter $(UNAME_S),Linux Darwin),)
	OPEN := start
endif

TX3-INSTALL-URL := https://docs.txpipe.io/tx3/installation
.PHONY: install-tx3
install-tx3:
	@echo "See tx3 installation instructions at: $(TX3-INSTALL-URL)"
	@$(OPEN) "$(TX3-INSTALL-URL)"

.PHONY: check
check:
	trix check

.PHONY: build
build:
	trix build

.PHONY: codegen
codegen:
	trix codegen
