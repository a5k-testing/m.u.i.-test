#!/usr/bin/env -S make -f
# SPDX-FileCopyrightText: 2024 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

.POSIX:

# --- Performance optimizations & global config ---
# Disable the default inference rule for .sh files early to speed up parsing
.sh:
	@:

# --- Variables ---
PROJECT_NAME  = microg-unofficial-installer
OUTPUT_DIR    = output
SBOM_FILENAME = $(PROJECT_NAME).spdx
SBOM_PATH     = $(OUTPUT_DIR)/$(SBOM_FILENAME)
REUSE_TOOL    = reuse

# --- Primary targets ---
.PHONY: all buildota buildotaoss installtest clean help

all: buildota buildotaoss ;

buildota: ## Build the flashable OTA zip
	BUILD_TYPE=full "$(CURDIR)/build.sh" --no-default-build-type --no-pause $(ARGS)

buildotaoss: ## Build the flashable OTA zip (open-source components only)
	BUILD_TYPE=oss "$(CURDIR)/build.sh" --no-default-build-type --no-pause $(ARGS)

installtest: ## Emulate an Android recovery on your PC and run the flashable zip file inside it
	"$(CURDIR)/recovery-simulator/recovery.sh" "$(CURDIR)"/output/*.zip

clean: ## Remove build artifacts
	rm -f "$(CURDIR)"/output/*.zip
	rm -f "$(CURDIR)"/output/*.zip.md5
	rm -f "$(CURDIR)"/output/*.zip.sha256

# --- Compliance targets ---
.PHONY: reuse-lint spdx

reuse-lint: ## Verify license and copyright compliance (REUSE)
	@echo 'Checking REUSE compliance...'
	@'$(REUSE_TOOL)' lint

spdx: reuse-lint ## Generate the SBOM in SPDX format
	@echo ''
	@echo 'Generating SPDX SBOM at $(SBOM_PATH)...'
	@'$(REUSE_TOOL)' spdx --creator-person ale5000 --add-license-concluded -o '$(CURDIR)/$(SBOM_PATH)'
	@echo 'Done.'

# --- Aliases & compatibility ---
.PHONY: build test check distcheck sbom
build: buildotaoss ;
test: installtest ;
check: test ;
distcheck: test ;
sbom: spdx ;

# --- Help ---
help: ## Display this help
	@awk 'substr($$0,1,1)!="\t" && substr($$0,1,1)!="#" && index($$0,":")>0 && index($$0,"##")>index($$0,":") \
		{ t=substr($$0,1,index($$0,":")-1); d=substr($$0,index($$0,"##")+3); \
		  if(t!="") printf "%-15s %s\n",t,d }' "$(MAKEFILE_LIST)" | sort
