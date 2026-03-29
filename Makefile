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
	@$(MAKE) -qnrp 2>/dev/null | awk \
		'/^MAKEFILE_LIST[[:space:]]*:=[[:space:]]*/{ mf=$$3; next } \
		 /^# Not a target:/{ s=1; next } \
		 s{ s=0; next } \
		 /^[a-zA-Z_][a-zA-Z0-9_-]*:/{ t=$$0; sub(/:.*$$/, "", t); v[t]=1 } \
		 END{ if (!mf) mf="Makefile"; \
		   while ((getline l < mf) > 0) \
		     if (match(l, /^[a-zA-Z_][a-zA-Z0-9_-]*:.*## /)) { \
		       t=substr(l,1,index(l,":")-1); \
		       if (t in v) printf "%-20s %s\n", t, substr(l,index(l,"## ")+3) } }'

# Disable the default inference rule for .sh files
.sh:
	@:
