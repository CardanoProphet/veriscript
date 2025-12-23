
.PHONY: help
help:
	@echo "Usage: make <target>"
	@echo
	@echo "Targets:"
	@echo "  help   -- show this help"
	@echo "  shell  -- open nix dev shell"
	@echo "  build  -- builds the doc"
	@echo "  clean  -- clean up latexmk files"

.PHONY: shell
shell:
	nix develop

.PHONY: build
build:
	latexmk -pdf -verbose -file-line-error -synctex=1 -interaction=nonstopmode

.PHONY: clean
clean:
	latexmk -C
	find . -type f -name "*.aux" -exec rm {} \;
