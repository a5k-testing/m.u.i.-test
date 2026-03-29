#!/usr/bin/env -S make -f

# SPDX-FileCopyrightText: (c) 2024 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

.POSIX:

DESCRIPTION_TARGET_ALL = Build full OTA and OSS OTA packages
DESCRIPTION_TARGET_BUILDOTA = Build full OTA package
DESCRIPTION_TARGET_BUILDOTAOSS = Build OSS OTA package
DESCRIPTION_TARGET_BUILD = Alias for buildotaoss
DESCRIPTION_TARGET_TEST = Run recovery simulator tests
DESCRIPTION_TARGET_CHECK = Alias for test
DESCRIPTION_TARGET_DISTCHECK = Alias for check
DESCRIPTION_TARGET_CLEAN = Remove build artifacts
DESCRIPTION_TARGET_HELP = List available targets

all: buildota buildotaoss

.PHONY: all clean test check distcheck build help

buildota:
	BUILD_TYPE=full "$(CURDIR)/build.sh" --no-default-build-type --no-pause $(ARGS)

buildotaoss:
	BUILD_TYPE=oss "$(CURDIR)/build.sh" --no-default-build-type --no-pause $(ARGS)
build: buildotaoss

test:
	"$(CURDIR)/recovery-simulator/recovery.sh" "$(CURDIR)"/output/*.zip
check: test
distcheck: check

clean:
	rm -f "$(CURDIR)"/output/*.zip
	rm -f "$(CURDIR)"/output/*.zip.md5
	rm -f "$(CURDIR)"/output/*.zip.sha256

help:
	@$(MAKE) -qnrp 2>/dev/null | awk \
		'/^DESCRIPTION_TARGET_[A-Z][A-Z0-9_]*[[:space:]]*=[[:space:]]*/{ desc[tolower(substr($$1,20))]=substr($$0,index($$0,"=")+2) } \
		 /^\.hide:/{ n=split(substr($$0,7),a); for(i=1;i<=n;i++) hide[a[i]]=1 } \
		 /^[a-zA-Z_][a-zA-Z0-9_-]*:/{ t=substr($$0,1,index($$0,":")-1); if(tolower(t)!="makefile") tgt[t]=1 } \
		 END{ for(t in tgt){ if(t in hide) continue; if(t in desc) printf "%-20s %s\n",t,desc[t]|"sort"; else print t|"sort" } }'

# Disable the default inference rule for .sh files
.sh:
	@:
