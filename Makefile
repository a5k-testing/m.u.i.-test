#!/usr/bin/env -S make -f

# SPDX-FileCopyrightText: (c) 2024 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

.POSIX:

ALL_DESCRIPTION = Build full OTA and OSS OTA packages
BUILDOTA_DESCRIPTION = Build full OTA package
BUILDOTAOSS_DESCRIPTION = Build OSS OTA package
BUILD_DESCRIPTION = Alias for buildotaoss
TEST_DESCRIPTION = Run recovery simulator tests
CHECK_DESCRIPTION = Alias for test
DISTCHECK_DESCRIPTION = Alias for check
CLEAN_DESCRIPTION = Remove build artifacts
HELP_DESCRIPTION = List available targets

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
		'/^[A-Z][A-Z0-9_]*_DESCRIPTION[[:space:]]*=[[:space:]]*/{ key=$$1; sub(/_DESCRIPTION$$/, "", key); val=$$0; sub(/^[^=]*=[[:space:]]*/,"",val); desc[tolower(key)]=val } \
		 /^\.hide:/{ line=$$0; sub(/^\.hide:[[:space:]]*/,"",line); n_h=split(line,ha," "); for(i=1;i<=n_h;i++) if(ha[i]!="") hide[ha[i]]=1 } \
		 /^[a-zA-Z_][a-zA-Z0-9_-]*:/{ t=$$0; sub(/:.*$$/,"",t); if(tolower(t)!="makefile" && substr(t,1,1)!="." && !(t in seen)) { seen[t]=1; targets[t]=1 } } \
		 END{ for(t in hide) delete targets[t]; n=asorti(targets,sorted); \
		   for(i=1;i<=n;i++) { if(sorted[i]=="all") { k="all"; if(k in desc) printf "%-20s %s\n","all",desc[k]; else print "all"; break } }; \
		   for(i=1;i<=n;i++) { t=sorted[i]; if(t=="all") continue; k=tolower(t); gsub(/-/,"_",k); if(k in desc) printf "%-20s %s\n",t,desc[k]; else print t } }'

# Disable the default inference rule for .sh files
.sh:
	@:
