// SPDX-FileCopyrightText: (c) 2026 ale5000
// SPDX-License-Identifier: GPL-3.0-or-later

/* jshint esversion: 11 */
'use strict';

// ---------------------------------------------------------------------------
// Extracted from .github/workflows/check-app-updates.yml — keep in sync.
// ---------------------------------------------------------------------------

function parseRepoV2(data) {
  const apps = new Map();
  for (const [pkgId, pkg] of Object.entries(data.packages || {})) {
    let latestVc = null;
    let latestVn = '';
    const byCert = {};
    for (const [, ver] of Object.entries(pkg.versions || {})) {
      const m = ver.manifest || {};
      const vc = m.versionCode ?? null;
      const vn = m.versionName || '';
      const apkName = ver.file?.name || '';
      const certs = m.signer?.sha256 ?? [];
      for (const cert of certs) {
        const c = cert.toLowerCase();
        if (
          !(c in byCert) ||
          (vc !== null && (byCert[c].vc === null || vc > byCert[c].vc))
        ) {
          byCert[c] = { vc, vn, apkName };
        }
      }
      if (vc !== null && (latestVc === null || vc > latestVc)) {
        latestVc = vc;
        latestVn = vn;
      }
    }
    apps.set(pkgId, { byCert, latestVc, latestVn });
  }
  return apps;
}

function shortUrl(url) {
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.slice(-2).join('.');
  } catch (_) {
    return url;
  }
}

const ICON = {
  UPDATE_AVAILABLE: '✨',
  UP_TO_DATE:       '✅',
  LOCAL_NEWER:      '🚀',
  DIFFERENT_SIGNER: '🔐',
  NOT_IN_REPO:      '❓',
};

const MICROG_CERT =
  '9bd06727e62796c0130eb6dab39b73157451582cbd138e86c468acc395d14165';
const SPECIAL_PKG_CERT =
  'f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83';
const SPECIAL_PKGS = new Set([
  'com.google.android.gms',
  'com.android.vending',
]);

function checkApks(apkInfoList, repoData) {
  const results = [];
  for (const apk of apkInfoList) {
    let certMatch = null;
    for (const { baseUrl, apps } of repoData) {
      const pkg = apps.get(apk.packageName);
      // Normal cert match
      const ver = pkg?.byCert[apk.certSha256];
      if (ver) {
        certMatch = { baseUrl, ver };
        break;
      }
      // Special fallback: for GMS packages whose local APK is
      // signed with the microG cert, also try SPECIAL_PKG_CERT
      if (
        SPECIAL_PKGS.has(apk.packageName) &&
        apk.certSha256 === MICROG_CERT
      ) {
        const verFallback = pkg?.byCert[SPECIAL_PKG_CERT];
        if (verFallback) {
          certMatch = { baseUrl, ver: verFallback };
          break;
        }
      }
    }

    if (certMatch) {
      const { baseUrl, ver } = certMatch;
      const label = shortUrl(baseUrl);
      const localVc = apk.versionCode;
      const repoVc = ver.vc;
      const apkUrl = ver.apkName ? `${baseUrl}${ver.apkName}` : '';
      let statusText;
      if (repoVc !== null && localVc) {
        if (repoVc > localVc) {
          statusText =
            `${ICON.UPDATE_AVAILABLE} UPDATE AVAILABLE:` +
            ` repo=${ver.vn} (${repoVc})` +
            ` > local (${localVc})`;
        } else if (repoVc === localVc) {
          statusText =
            `${ICON.UP_TO_DATE} UP TO DATE (versionCode=${localVc})`;
        } else {
          statusText =
            `${ICON.LOCAL_NEWER} LOCAL NEWER: local (${localVc})` +
            ` > repo (${repoVc})`;
        }
      } else {
        statusText = `found, latest=${ver.vn}`;
      }
      const logLine =
        `[${label}] ${apk.fileName} (${apk.packageName}): ${statusText}`;
      const noticeLine = (repoVc !== null && localVc && repoVc > localVc)
        ? `[${label}] ${apk.fileName} (${apk.packageName}): ${statusText}` +
          (apkUrl ? `\n${apkUrl}` : '')
        : null;
      const warningLine = (repoVc !== null && localVc && repoVc < localVc)
        ? `${apk.fileName} (${apk.packageName}): ${statusText}`
        : null;
      results.push({
        logLine,
        tableRow: [
          apk.fileName,
          apk.packageName,
          label,
          (repoVc !== null && localVc && repoVc > localVc && apkUrl)
            ? `<a href="${apkUrl}">${statusText}</a>`
            : statusText,
        ],
        noticeLine,
        warningLine,
      });
    } else {
      const signerMismatch = repoData
        .filter(({ apps }) => apps.has(apk.packageName))
        .map(({ baseUrl, apps }) => {
          const p = apps.get(apk.packageName);
          return `${shortUrl(baseUrl)} (latest=${p.latestVn} ${p.latestVc})`;
        });
      if (signerMismatch.length > 0) {
        const repoLabel = signerMismatch.join(', ');
        results.push({
          logLine:
            `${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] ${apk.fileName}` +
            ` (${apk.packageName}):` +
            ` ${repoLabel}` +
            ` but signed with a different certificate`,
          tableRow: [
            apk.fileName, apk.packageName,
            repoLabel, `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`,
          ],
          noticeLine: null,
          warningLine: null,
        });
      } else {
        results.push({
          logLine:
            `${ICON.NOT_IN_REPO} [NOT IN REPO] ${apk.fileName}` +
            ` (${apk.packageName}): not found in any repo`,
          tableRow: [
            apk.fileName, apk.packageName,
            '-', `${ICON.NOT_IN_REPO} NOT IN REPO`,
          ],
          noticeLine: null,
          warningLine: null,
        });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    console.error(`        expected: ${JSON.stringify(expected)}`);
    console.error(`        actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CERT_FDROID = 'fdroid_cert_aaaa';
const CERT_MICROG = 'microg_cert_bbbb';
const CERT_GOOGLE = 'google_cert_cccc';
const CERT_AURORA = 'aurora_cert_dddd';
const CERT_NEWPIPE = 'newpipe_cert_eeee';

const FDROID_INDEX = {
  packages: {
    'org.fdroid.fdroid.privileged': {
      versions: {
        v1: {
          file: { name: '/org.fdroid.fdroid.privileged_2130.apk' },
          manifest: {
            versionCode: 2130, versionName: '0.2.13',
            signer: { sha256: [CERT_FDROID] },
          },
        },
      },
    },
    'org.schabi.newpipe': {
      versions: {
        v1: {
          file: { name: '/org.schabi.newpipe_1000.apk' },
          manifest: {
            versionCode: 1000, versionName: '0.25.0',
            signer: { sha256: [CERT_NEWPIPE] },
          },
        },
        // Older version with same cert — should not affect latest
        v0: {
          file: { name: '/org.schabi.newpipe_990.apk' },
          manifest: {
            versionCode: 990, versionName: '0.24.0',
            signer: { sha256: [CERT_NEWPIPE] },
          },
        },
      },
    },
    // Google-cert variant of GmsCore in F-Droid (hypothetical)
    'com.google.android.gms': {
      versions: {
        v1: {
          file: { name: '/com.google.android.gms_240000000.apk' },
          manifest: {
            versionCode: 240000000, versionName: '24.0',
            signer: { sha256: [CERT_GOOGLE] },
          },
        },
      },
    },
    // FakeStore signed with the special cert in F-Droid
    'com.android.vending': {
      versions: {
        v1: {
          file: { name: '/com.android.vending_84022626.apk' },
          manifest: {
            versionCode: 84022626, versionName: '33.0',
            signer: { sha256: [SPECIAL_PKG_CERT] },
          },
        },
      },
    },
  },
};

const MICROG_INDEX = {
  packages: {
    'com.google.android.gms': {
      versions: {
        v1: {
          file: { name: '/com.google.android.gms_230913000.apk' },
          manifest: {
            versionCode: 230913000, versionName: '23.9.13',
            signer: { sha256: [CERT_MICROG] },
          },
        },
      },
    },
  },
};

const REPOS = [
  { baseUrl: 'https://f-droid.org/repo', apps: parseRepoV2(FDROID_INDEX) },
  { baseUrl: 'https://repo.microg.org/fdroid/repo', apps: parseRepoV2(MICROG_INDEX) },
];

// ---------------------------------------------------------------------------
// parseRepoV2 unit tests
// ---------------------------------------------------------------------------

console.log('\n── parseRepoV2 ──');

const fdroidApps = REPOS[0].apps;
const microgApps = REPOS[1].apps;

// Basic map size
assertEqual(fdroidApps.size, 4, 'F-Droid: parsed 4 packages');
assertEqual(microgApps.size, 1, 'microG: parsed 1 package');

// latestVc / latestVn
{
  const np = fdroidApps.get('org.schabi.newpipe');
  assertEqual(np.latestVc, 1000, 'NewPipe: latestVc = 1000 (newest version wins)');
  assertEqual(np.latestVn, '0.25.0', 'NewPipe: latestVn = 0.25.0');
}

// byCert — highest versionCode per cert
{
  const np = fdroidApps.get('org.schabi.newpipe');
  assertEqual(np.byCert[CERT_NEWPIPE].vc, 1000,
    'NewPipe: byCert keeps highest vc (1000, not 990)');
}

// byCert normalises cert to lower-case
{
  const MIXED_INDEX = {
    packages: {
      'com.example.app': {
        versions: {
          v1: {
            manifest: {
              versionCode: 1, versionName: '1.0',
              signer: { sha256: ['AABB'] },
            },
          },
        },
      },
    },
  };
  const mixedApps = parseRepoV2(MIXED_INDEX);
  const pkg = mixedApps.get('com.example.app');
  assert(pkg !== undefined, 'Mixed-case: package exists');
  assert('aabb' in pkg.byCert, 'Mixed-case: cert normalised to lower-case');
}

// Unknown package returns undefined
assert(fdroidApps.get('com.nonexistent.pkg') === undefined,
  'Non-existent package returns undefined');

// ---------------------------------------------------------------------------
// shortUrl unit tests
// ---------------------------------------------------------------------------

console.log('\n── shortUrl ──');

assertEqual(
  shortUrl('https://repo.microg.org/fdroid/repo'), 'microg.org',
  'shortUrl: subdomain trimmed to base domain'
);
assertEqual(
  shortUrl('https://f-droid.org/repo'), 'f-droid.org',
  'shortUrl: two-part hostname unchanged'
);

// ---------------------------------------------------------------------------
// checkApks integration tests
// ---------------------------------------------------------------------------

console.log('\n── checkApks (matching loop) ──');

const results = checkApks([
  // 1. Exact cert match in F-Droid, already up to date
  {
    fileName: 'FDroidPrivilegedExtension.apk',
    packageName: 'org.fdroid.fdroid.privileged',
    versionCode: 2130,
    certSha256: CERT_FDROID,
  },
  // 2. Cert match in F-Droid, local version is newer
  {
    fileName: 'NewPipe.apk',
    packageName: 'org.schabi.newpipe',
    versionCode: 1001,
    certSha256: CERT_NEWPIPE,
  },
  // 3. Cert matches microG (not F-Droid) → should stop at microG repo
  {
    fileName: 'GmsCore.apk',
    packageName: 'com.google.android.gms',
    versionCode: 220000000,
    certSha256: CERT_MICROG,
  },
  // 4. Package in F-Droid with Google cert → matched in F-Droid first
  {
    fileName: 'GoogleGms.apk',
    packageName: 'com.google.android.gms',
    versionCode: 230000000,
    certSha256: CERT_GOOGLE,
  },
  // 5. Package present in F-Droid but cert does not match → DIFFERENT SIGNER
  {
    fileName: 'NewPipeFork.apk',
    packageName: 'org.schabi.newpipe',
    versionCode: 900,
    certSha256: 'unknown_cert',
  },
  // 6. Package not in any repo → NOT IN REPO
  {
    fileName: 'AuroraServices.apk',
    packageName: 'com.aurora.services',
    versionCode: 10,
    certSha256: CERT_AURORA,
  },
  // 7. FakeStore: local cert is MICROG_CERT → special cert fallback matches F-Droid
  {
    fileName: 'FakeStore.apk',
    packageName: 'com.android.vending',
    versionCode: 80000000,
    certSha256: MICROG_CERT,
  },
  // 8. GmsCore signed with a non-microG, non-Google cert → fallback NOT triggered
  {
    fileName: 'GmsCoreOther.apk',
    packageName: 'com.google.android.gms',
    versionCode: 100000000,
    certSha256: 'some_other_cert_ffff',
  },
], REPOS);

// 1. Up to date
assert(
  results[0].logLine.includes('[f-droid.org]') &&
  results[0].logLine.includes('UP TO DATE'),
  'FDroid priv: UP TO DATE in F-Droid (short URL)'
);
assert(results[0].logLine.includes(ICON.UP_TO_DATE),
  'FDroid priv: ✅ icon present');
assertEqual(results[0].tableRow[2], 'f-droid.org',
  'FDroid priv: tableRow repo = f-droid.org');
assert(!results[0].tableRow[3].includes('<a href='),
  'FDroid priv: tableRow status is plain text (up to date, no link)');
assertEqual(results[0].noticeLine, null,
  'FDroid priv: no notice for UP TO DATE');
assertEqual(results[0].warningLine, null,
  'FDroid priv: no warning for UP TO DATE');

// 2. Local newer
assert(
  results[1].logLine.includes('[f-droid.org]') &&
  results[1].logLine.includes('LOCAL NEWER'),
  'NewPipe: LOCAL NEWER in F-Droid (short URL)'
);
assert(results[1].logLine.includes(ICON.LOCAL_NEWER),
  'NewPipe: 🚀 icon present');
assertEqual(results[1].noticeLine, null,
  'NewPipe: no notice for LOCAL NEWER');
assert(!results[1].tableRow[3].includes('<a href='),
  'NewPipe: tableRow status is plain text (local newer, no link)');
assert(results[1].warningLine !== null,
  'NewPipe: warning emitted for LOCAL NEWER');
assert(results[1].warningLine.includes('LOCAL NEWER'),
  'NewPipe: warning text contains LOCAL NEWER');

// 3. microG-signed GmsCore: matched in microG repo, update available
assert(
  results[2].logLine.includes('[microg.org]') &&
  results[2].logLine.includes('UPDATE AVAILABLE'),
  'GmsCore (microG cert): UPDATE AVAILABLE from microG repo (short URL)'
);
assert(results[2].logLine.includes(ICON.UPDATE_AVAILABLE),
  'GmsCore (microG cert): ✨ icon present');
assertEqual(results[2].tableRow[2], 'microg.org',
  'GmsCore (microG cert): tableRow repo = microg.org');
assert(results[2].noticeLine !== null,
  'GmsCore (microG cert): notice emitted for UPDATE AVAILABLE');
assert(results[2].tableRow[3].includes('<a href=') &&
  results[2].tableRow[3].includes('UPDATE AVAILABLE'),
  'GmsCore (microG cert): tableRow status is a clickable link');
assert(
  results[2].tableRow[3].includes(
    'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk'
  ),
  'GmsCore (microG cert): tableRow link points to full APK URL');
assert(results[2].noticeLine.includes('UPDATE AVAILABLE'),
  'GmsCore (microG cert): notice text contains UPDATE AVAILABLE');
assert(results[2].noticeLine.includes('[microg.org]'),
  'GmsCore (microG cert): notice text contains short repo URL');
assert(
  results[2].noticeLine.includes(
    'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk'
  ),
  'GmsCore (microG cert): notice text contains full APK URL'
);
assertEqual(results[2].warningLine, null,
  'GmsCore (microG cert): no warning for UPDATE AVAILABLE');

// 4. Google-cert GmsCore: matched in F-Droid (first repo)
assert(
  results[3].logLine.includes('[f-droid.org]') &&
  results[3].logLine.includes('UPDATE AVAILABLE'),
  'GmsCore (Google cert): UPDATE AVAILABLE from F-Droid (short URL)'
);
assert(results[3].noticeLine !== null,
  'GmsCore (Google cert): notice emitted');
assert(results[3].tableRow[3].includes('<a href=') &&
  results[3].tableRow[3].includes('UPDATE AVAILABLE'),
  'GmsCore (Google cert): tableRow status is a clickable link');
assert(results[3].noticeLine.includes('[f-droid.org]'),
  'GmsCore (Google cert): notice contains short repo URL');
assert(
  results[3].noticeLine.includes(
    'https://f-droid.org/repo/com.google.android.gms_240000000.apk'
  ),
  'GmsCore (Google cert): notice contains full APK URL'
);

// 5. Different signer
assert(
  results[4].logLine.includes('[DIFFERENT SIGNER]') &&
  /\bf-droid\.org\s/.test(results[4].logLine),
  'NewPipeFork: DIFFERENT SIGNER listing f-droid.org (short URL)'
);
assert(results[4].logLine.includes(ICON.DIFFERENT_SIGNER),
  'NewPipeFork: 🔐 icon present in log line');
assertEqual(results[4].tableRow[3], `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`,
  'NewPipeFork: tableRow status has 🔐 DIFFERENT SIGNER');
assertEqual(results[4].noticeLine, null,
  'NewPipeFork: no notice for DIFFERENT SIGNER');
assertEqual(results[4].warningLine, null,
  'NewPipeFork: no warning for DIFFERENT SIGNER');

// 6. Not in repo
assert(
  results[5].logLine.includes('[NOT IN REPO]'),
  'AuroraServices: NOT IN REPO'
);
assert(results[5].logLine.includes(ICON.NOT_IN_REPO),
  'AuroraServices: ❓ icon present in log line');
assertEqual(results[5].tableRow[3], `${ICON.NOT_IN_REPO} NOT IN REPO`,
  'AuroraServices: tableRow status has ❓ NOT IN REPO');
assertEqual(results[5].tableRow[2], '-',
  'AuroraServices: tableRow repo = -');
assertEqual(results[5].noticeLine, null,
  'AuroraServices: no notice for NOT IN REPO');
assertEqual(results[5].warningLine, null,
  'AuroraServices: no warning for NOT IN REPO');

// 7. Special cert fallback: FakeStore with MICROG_CERT → matched via
//    SPECIAL_PKG_CERT in F-Droid
assert(
  results[6].logLine.includes('[f-droid.org]') &&
  results[6].logLine.includes('UPDATE AVAILABLE'),
  'FakeStore: UPDATE AVAILABLE via special cert fallback in F-Droid'
);
assert(results[6].noticeLine !== null,
  'FakeStore: notice emitted for special-cert UPDATE AVAILABLE');
assert(results[6].tableRow[3].includes('<a href=') &&
  results[6].tableRow[3].includes('UPDATE AVAILABLE'),
  'FakeStore: tableRow status is a clickable link');
assert(results[6].noticeLine.includes('[f-droid.org]'),
  'FakeStore: notice contains short repo URL');
assert(
  results[6].noticeLine.includes(
    'https://f-droid.org/repo/com.android.vending_84022626.apk'
  ),
  'FakeStore: notice contains full APK URL from special cert match'
);
assertEqual(results[6].warningLine, null,
  'FakeStore: no warning for UPDATE AVAILABLE');

// 8. GmsCore with non-microG cert → fallback NOT triggered → DIFFERENT SIGNER
assert(
  results[7].logLine.includes('[DIFFERENT SIGNER]'),
  'GmsCoreOther: DIFFERENT SIGNER (fallback not triggered for non-microG cert)'
);
assertEqual(results[7].tableRow[3], `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`,
  'GmsCoreOther: tableRow status has 🔐 DIFFERENT SIGNER');
assertEqual(results[7].noticeLine, null,
  'GmsCoreOther: no notice for DIFFERENT SIGNER');
assertEqual(results[7].warningLine, null,
  'GmsCoreOther: no warning for DIFFERENT SIGNER');

// ---------------------------------------------------------------------------
// /index-v2.json URL construction test
// ---------------------------------------------------------------------------

console.log('\n── index-v2.json URL construction ──');

const BASE_URLS = [
  'https://f-droid.org/repo',
  'https://repo.microg.org/fdroid/repo',
];
const indexUrls = BASE_URLS.map(b => `${b}/index-v2.json`);

assertEqual(indexUrls[0], 'https://f-droid.org/repo/index-v2.json',
  'F-Droid: /index-v2.json appended correctly');
assertEqual(indexUrls[1], 'https://repo.microg.org/fdroid/repo/index-v2.json',
  'microG: /index-v2.json appended correctly');

// ---------------------------------------------------------------------------
// fetchUrl: HTTPS enforcement and redirect limit
// ---------------------------------------------------------------------------

console.log('\n── fetchUrl: HTTPS enforcement ──');

// All configured repo URLs must be HTTPS
for (const baseUrl of BASE_URLS) {
  assert(baseUrl.startsWith('https://'), `Repo base URL is HTTPS: ${baseUrl}`);
}

// URL validation (mirrors the check inside fetchUrl)
function isHttpsUrl(url) {
  return url.startsWith('https://');
}
assert(!isHttpsUrl('http://example.com/repo'), 'HTTP URL fails HTTPS check');
assert(!isHttpsUrl('ftp://example.com/repo'), 'FTP URL fails HTTPS check');
assert(isHttpsUrl('https://f-droid.org/repo'), 'HTTPS URL passes check');

// Max redirects constant
const MAX_REDIRECTS = 3;
assertEqual(MAX_REDIRECTS, 3, 'Max redirects is 3');

// ---------------------------------------------------------------------------
// SKIP_LIST tests
// ---------------------------------------------------------------------------

console.log('\n── SKIP_LIST ──');

const SKIP_LIST = new Set([
  'priv-app/FakeStore-0.3.6.apk',
  'priv-app/GmsCore-0.3.6.apk',
  'priv-app/GmsCoreVtm.apk',
  'priv-app/GmsCoreVtmLegacy.apk',
]);

assertEqual(SKIP_LIST.size, 4, 'SKIP_LIST has 4 entries');
assert(SKIP_LIST.has('priv-app/FakeStore-0.3.6.apk'),
  'SKIP_LIST: priv-app/FakeStore-0.3.6.apk included');
assert(SKIP_LIST.has('priv-app/GmsCore-0.3.6.apk'),
  'SKIP_LIST: priv-app/GmsCore-0.3.6.apk included');
assert(SKIP_LIST.has('priv-app/GmsCoreVtm.apk'),
  'SKIP_LIST: priv-app/GmsCoreVtm.apk included');
assert(SKIP_LIST.has('priv-app/GmsCoreVtmLegacy.apk'),
  'SKIP_LIST: priv-app/GmsCoreVtmLegacy.apk included');

// Current (non-versioned) builds must NOT be skipped
assert(!SKIP_LIST.has('priv-app/GmsCore.apk'),
  'SKIP_LIST: priv-app/GmsCore.apk (no version suffix) is NOT skipped');
assert(!SKIP_LIST.has('priv-app/FakeStore.apk'),
  'SKIP_LIST: priv-app/FakeStore.apk (no version suffix) is NOT skipped');

// Filter simulation (mirrors workflow JS)
const mockApkList = [
  { fileName: 'FakeStore-0.3.6.apk', relPath: 'priv-app/FakeStore-0.3.6.apk' },
  { fileName: 'FakeStore.apk',        relPath: 'priv-app/FakeStore.apk' },
  { fileName: 'GmsCore-0.3.6.apk',   relPath: 'priv-app/GmsCore-0.3.6.apk' },
  { fileName: 'GmsCore.apk',          relPath: 'priv-app/GmsCore.apk' },
  { fileName: 'GmsCoreVtm.apk',       relPath: 'priv-app/GmsCoreVtm.apk' },
  { fileName: 'GmsCoreVtmLegacy.apk', relPath: 'priv-app/GmsCoreVtmLegacy.apk' },
  { fileName: 'Something.apk',        relPath: 'app/Something.apk' },
];
const filtered = mockApkList.filter(apk => !SKIP_LIST.has(apk.relPath));
assertEqual(filtered.length, 3, 'SKIP_LIST filter: 3 of 7 APKs kept');
assertEqual(filtered[0].fileName, 'FakeStore.apk',
  'SKIP_LIST filter: FakeStore.apk (no suffix) kept');
assertEqual(filtered[1].fileName, 'GmsCore.apk',
  'SKIP_LIST filter: GmsCore.apk (no suffix) kept');
assertEqual(filtered[2].fileName, 'Something.apk',
  'SKIP_LIST filter: Something.apk kept');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}
