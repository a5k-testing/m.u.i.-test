#!/usr/bin/env -S make -f

# SPDX-FileCopyrightText: (c) 2024 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

.POSIX:

all: buildota buildotaoss ; ## Build full OTA and OSS OTA packages

.PHONY: all clean test check distcheck build help

buildota: ## Build full OTA package
	BUILD_TYPE=full "$(CURDIR)/build.sh" --no-default-build-type --no-pause $(ARGS)

buildotaoss: ## Build OSS OTA package
	BUILD_TYPE=oss "$(CURDIR)/build.sh" --no-default-build-type --no-pause $(ARGS)
build: buildotaoss ; ## Alias for buildotaoss

test: ## Run recovery simulator tests
	"$(CURDIR)/recovery-simulator/recovery.sh" "$(CURDIR)"/output/*.zip
check: test ; ## Alias for test
distcheck: check ; ## Alias for check

clean: ## Remove build artifacts
	rm -f "$(CURDIR)"/output/*.zip
	rm -f "$(CURDIR)"/output/*.zip.md5
	rm -f "$(CURDIR)"/output/*.zip.sha256

help: ## List available targets
	@awk -F ':.*## ' '/^[a-zA-Z_][a-zA-Z0-9_-]*:.*## /{printf "%-20s %s\n", $$1, $$2}' Makefile
# Note: 'Makefile' is hardcoded above for portability across GNU make, BSD Make and pdpmake,
# which have no common special variable that expands to the current makefile name.

# Disable the default inference rule for .sh files
.sh:
	@:
