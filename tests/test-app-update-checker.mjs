// SPDX-FileCopyrightText: (c) 2026 ale5000
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  parseRepoV2,
  shortUrl,
  checkApks,
  ICON,
  MICROG_CERT,
  SPECIAL_PKG_CERT,
  SKIP_LIST,
  repos,
  REPO_CACHE_TTL_MS,
} from '../includes/app-update-checker-lib.mjs';

import { default as run } from '../includes/app-update-checker-lib.mjs';

import path from 'node:path';
import { mock } from 'node:test';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(message) {
  console.log(`  SKIP: ${message}`);
  skipped++;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CERT_FDROID  = 'fdroid_cert_aaaa';
const CERT_MICROG  = 'microg_cert_bbbb';
const CERT_GOOGLE  = 'google_cert_cccc';
const CERT_AURORA  = 'aurora_cert_dddd';
const CERT_NEWPIPE = 'newpipe_cert_eeee';

const SHA256_MICROG_GMS  = 'aaaa1111microg_gms_230913000';
const SHA256_FDROID_GMS  = 'bbbb2222fdroid_gms_240000000';
const SHA256_FDROID_VNDR = 'cccc3333fdroid_vending_84022626';

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
          file: { name: '/com.google.android.gms_240000000.apk', sha256: SHA256_FDROID_GMS },
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
          file: { name: '/com.android.vending_84022626.apk', sha256: SHA256_FDROID_VNDR },
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
          file: { name: '/com.google.android.gms_230913000.apk', sha256: SHA256_MICROG_GMS },
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
  { baseUrl: 'https://f-droid.org/repo',            apps: parseRepoV2(FDROID_INDEX) },
  { baseUrl: 'https://repo.microg.org/fdroid/repo', apps: parseRepoV2(MICROG_INDEX) },
];

// ---------------------------------------------------------------------------
// Constants: SKIP_LIST
// ---------------------------------------------------------------------------

console.log('\n── SKIP_LIST ──');

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
// Constants: REPO_CACHE_TTL_MS
// ---------------------------------------------------------------------------

console.log('\n── REPO_CACHE_TTL_MS ──');

assertEqual(REPO_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000,
  'REPO_CACHE_TTL_MS equals 7 days in milliseconds');
assert(REPO_CACHE_TTL_MS > 0,
  'REPO_CACHE_TTL_MS is positive');

// ---------------------------------------------------------------------------
// URL utilities: shortUrl
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
assertEqual(
  shortUrl('https://apt.izzysoft.de/fdroid/repo'), 'izzysoft.de',
  'shortUrl: apt.izzysoft.de → izzysoft.de'
);
assert(shortUrl('not-a-url') === 'not-a-url',
  'shortUrl: invalid URL returns input unchanged');

// ---------------------------------------------------------------------------
// URL utilities: index-v2.json URL construction
// ---------------------------------------------------------------------------

console.log('\n── index-v2.json URL construction ──');

const indexUrls = repos.map(b => `${b}/index-v2.json`);

assertEqual(indexUrls[0], 'https://repo.microg.org/fdroid/repo/index-v2.json',
  'microG: /index-v2.json appended correctly');
assertEqual(indexUrls[1], 'https://f-droid.org/repo/index-v2.json',
  'F-Droid: /index-v2.json appended correctly');
assertEqual(indexUrls[2], 'https://apt.izzysoft.de/fdroid/repo/index-v2.json',
  'IzzyOnDroid: /index-v2.json appended correctly');

// ---------------------------------------------------------------------------
// URL utilities: fetchUrl HTTPS enforcement
// ---------------------------------------------------------------------------

console.log('\n── fetchUrl: HTTPS enforcement ──');

// All configured repo URLs must be HTTPS
for (const baseUrl of repos) {
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
// checkApks: main matching loop
// ---------------------------------------------------------------------------

console.log('\n── checkApks (matching loop) ──');

const results = checkApks([
  // 1. Exact cert match in F-Droid, already up to date
  {
    fileName: 'FDroidPrivilegedExtension.apk',
    relPath:  'priv-app/FDroidPrivilegedExtension.apk',
    packageName: 'org.fdroid.fdroid.privileged',
    versionCode: 2130,
    versionName: '0.2.13',
    certSha256: CERT_FDROID,
  },
  // 2. Cert match in F-Droid, local version is newer
  {
    fileName: 'NewPipe.apk',
    relPath:  'app/NewPipe.apk',
    packageName: 'org.schabi.newpipe',
    versionCode: 1001,
    versionName: '0.25.1',
    certSha256: CERT_NEWPIPE,
  },
  // 3. Cert matches microG (not F-Droid) → should stop at microG repo
  {
    fileName: 'GmsCore.apk',
    relPath:  'priv-app/GmsCore.apk',
    packageName: 'com.google.android.gms',
    versionCode: 220000000,
    versionName: '22.0',
    certSha256: CERT_MICROG,
  },
  // 4. Package in F-Droid with Google cert → matched in F-Droid first
  {
    fileName: 'GoogleGms.apk',
    relPath:  'priv-app/GoogleGms.apk',
    packageName: 'com.google.android.gms',
    versionCode: 230000000,
    versionName: '23.0',
    certSha256: CERT_GOOGLE,
  },
  // 5. Package present in F-Droid but cert does not match → DIFFERENT SIGNER
  {
    fileName: 'NewPipeFork.apk',
    relPath:  'app/NewPipeFork.apk',
    packageName: 'org.schabi.newpipe',
    versionCode: 900,
    versionName: '0.22.0',
    certSha256: 'unknown_cert',
  },
  // 6. Package not in any repo → NOT IN REPO
  {
    fileName: 'AuroraServices.apk',
    relPath:  'app/AuroraServices.apk',
    packageName: 'com.aurora.services',
    versionCode: 10,
    versionName: '1.0',
    certSha256: CERT_AURORA,
  },
  // 7. FakeStore: local cert is MICROG_CERT → special cert fallback matches F-Droid
  {
    fileName: 'FakeStore.apk',
    relPath:  'priv-app/FakeStore.apk',
    packageName: 'com.android.vending',
    versionCode: 80000000,
    versionName: '30.0',
    certSha256: MICROG_CERT,
  },
  // 8. GmsCore signed with a non-microG, non-Google cert → fallback NOT triggered
  {
    fileName: 'GmsCoreOther.apk',
    relPath:  'priv-app/GmsCoreOther.apk',
    packageName: 'com.google.android.gms',
    versionCode: 100000000,
    versionName: '10.0',
    certSha256: 'some_other_cert_ffff',
  },
], REPOS);

// 1. Up to date
assert(
  results[0].logLine.includes('[f-droid.org]') &&
  results[0].logLine.includes('[UP TO DATE]'),
  'FDroid priv: UP TO DATE logLine contains [f-droid.org] and [UP TO DATE]'
);
assert(results[0].logLine.includes(ICON.UP_TO_DATE),
  'FDroid priv: ✅ icon present');
assert(results[0].logLine.includes('priv-app/FDroidPrivilegedExtension.apk'),
  'FDroid priv: logLine uses relPath');
assert(results[0].logLine.includes('version=0.2.13 (2130)'),
  'FDroid priv: logLine contains repo version info');
assertEqual(results[0].tableRow[0], 'priv-app/FDroidPrivilegedExtension.apk',
  'FDroid priv: tableRow[0] shows relPath');
assertEqual(results[0].tableRow[2], 'f-droid',
  'FDroid priv: tableRow repo = f-droid (compact label)');
assert(!results[0].tableRow[3].includes('<a href='),
  'FDroid priv: tableRow status has no link (up to date)');
assertEqual(
  results[0].tableRow[3],
  `${ICON.UP_TO_DATE} UP TO DATE<br>version=0.2.13 (2130)`,
  'FDroid priv: tableRow UP TO DATE is 2-line format'
);
assertEqual(results[0].noticeLine, null,
  'FDroid priv: no notice for UP TO DATE');
assertEqual(results[0].warningLine, null,
  'FDroid priv: no warning for UP TO DATE');
assertEqual(results[0].checkFailedLine, null,
  'FDroid priv: no checkFailedLine for UP TO DATE');

// 2. Local newer
assert(
  results[1].logLine.includes('[f-droid.org]') &&
  results[1].logLine.includes('[LOCAL NEWER]'),
  'NewPipe: LOCAL NEWER logLine has [f-droid.org] and [LOCAL NEWER]'
);
assert(results[1].logLine.includes(ICON.LOCAL_NEWER),
  'NewPipe: 🚀 icon present');
assert(results[1].logLine.includes('app/NewPipe.apk'),
  'NewPipe: logLine uses relPath');
assert(results[1].logLine.includes('local=0.25.1 (1001)'),
  'NewPipe: logLine has local versionInfo');
assert(results[1].logLine.includes('repo='),
  'NewPipe: logLine has repo versionInfo');
assertEqual(results[1].tableRow[0], 'app/NewPipe.apk',
  'NewPipe: tableRow[0] shows relPath (app/NewPipe.apk)');
assertEqual(results[1].noticeLine, null,
  'NewPipe: no notice for LOCAL NEWER');
assert(!results[1].tableRow[3].includes('<a href='),
  'NewPipe: tableRow status is plain text (local newer, no link)');
assert(results[1].tableRow[3].includes(ICON.LOCAL_NEWER),
  'NewPipe: tableRow status has LOCAL NEWER icon');
assert(results[1].tableRow[3].includes('<br>'),
  'NewPipe: tableRow LOCAL NEWER is 2-line format with <br>');
assert(results[1].warningLine !== null,
  'NewPipe: warning emitted for LOCAL NEWER');
assert(results[1].warningLine.includes('LOCAL NEWER'),
  'NewPipe: warning text contains LOCAL NEWER');
assertEqual(results[1].checkFailedLine, null,
  'NewPipe: no checkFailedLine for LOCAL NEWER');

// 3. microG-signed GmsCore: matched in microG repo, update available
assert(
  results[2].logLine.includes('[microg.org]') &&
  results[2].logLine.includes('UPDATE AVAILABLE'),
  'GmsCore (microG cert): UPDATE AVAILABLE from microG repo (short URL)'
);
assert(results[2].logLine.includes(ICON.UPDATE_AVAILABLE),
  'GmsCore (microG cert): ✨ icon present');
assertEqual(results[2].tableRow[0], 'priv-app/GmsCore.apk',
  'GmsCore (microG cert): tableRow[0] shows relPath');
assertEqual(results[2].tableRow[2], 'microg',
  'GmsCore (microG cert): tableRow repo = microg (compact label)');
assert(results[2].noticeLine !== null,
  'GmsCore (microG cert): notice emitted for UPDATE AVAILABLE');
assertEqual(
  results[2].tableRow[3],
  `${ICON.UPDATE_AVAILABLE} <a href="https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk">UPDATE AVAILABLE</a><br>version=23.9.13 (230913000)`,
  'GmsCore (microG cert): tableRow UPDATE AVAILABLE is 2-line format with <br>'
);
assert(!results[2].noticeLine.includes(' '),
  'GmsCore (microG cert): notice content is bare URL (no spaces)');
assertEqual(
  results[2].noticeLine,
  'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk',
  'GmsCore (microG cert): notice content is the APK URL'
);
assertEqual(
  results[2].noticeTitle,
  `${ICON.UPDATE_AVAILABLE} Update available for priv-app/GmsCore.apk (com.google.android.gms): [microg.org] version=23.9.13 (230913000)`,
  'GmsCore (microG cert): noticeTitle includes repo and version info'
);
assertEqual(results[2].warningLine, null,
  'GmsCore (microG cert): no warning for UPDATE AVAILABLE');
assertEqual(results[2].checkFailedLine, null,
  'GmsCore (microG cert): no checkFailedLine for UPDATE AVAILABLE');

// 4. Google-cert GmsCore: matched in F-Droid (first repo)
assert(
  results[3].logLine.includes('[f-droid.org]') &&
  results[3].logLine.includes('[UPDATE AVAILABLE]'),
  'GmsCore (Google cert): UPDATE AVAILABLE from F-Droid (short URL)'
);
assert(results[3].noticeLine !== null,
  'GmsCore (Google cert): notice emitted');
assertEqual(
  results[3].tableRow[3],
  `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.google.android.gms_240000000.apk">UPDATE AVAILABLE</a><br>version=24.0 (240000000)`,
  'GmsCore (Google cert): tableRow UPDATE AVAILABLE is 2-line format with <br>'
);
assertEqual(
  results[3].noticeLine,
  'https://f-droid.org/repo/com.google.android.gms_240000000.apk',
  'GmsCore (Google cert): notice content is the APK URL'
);
assertEqual(
  results[3].noticeTitle,
  `${ICON.UPDATE_AVAILABLE} Update available for priv-app/GoogleGms.apk (com.google.android.gms): [f-droid.org] version=24.0 (240000000)`,
  'GmsCore (Google cert): noticeTitle includes repo and version info'
);

// 5. Different signer
assert(
  results[4].logLine.includes('[DIFFERENT SIGNER]') &&
  results[4].logLine.includes('[f-droid.org]'),
  'NewPipeFork: DIFFERENT SIGNER listing [f-droid.org] in brackets'
);
assert(results[4].logLine.includes(ICON.DIFFERENT_SIGNER),
  'NewPipeFork: 🔐 icon present in log line');
assert(results[4].logLine.includes('app/NewPipeFork.apk'),
  'NewPipeFork: logLine uses relPath');
assert(results[4].logLine.includes('signed with a different certificate'),
  'NewPipeFork: logLine contains "signed with a different certificate"');
assertEqual(results[4].tableRow[0], 'app/NewPipeFork.apk',
  'NewPipeFork: tableRow[0] shows relPath');
assertEqual(results[4].tableRow[2], 'f-droid',
  'NewPipeFork: tableRow repo = f-droid (compact label)');
assertEqual(results[4].tableRow[3], `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`,
  'NewPipeFork: tableRow status has 🔐 DIFFERENT SIGNER');
assertEqual(results[4].noticeLine, null,
  'NewPipeFork: no notice for DIFFERENT SIGNER');
assertEqual(results[4].warningLine, null,
  'NewPipeFork: no warning for DIFFERENT SIGNER');
assertEqual(results[4].checkFailedLine, null,
  'NewPipeFork: no checkFailedLine for DIFFERENT SIGNER');

// 6. Not in repo
assert(
  results[5].logLine.includes('[NOT IN REPO]'),
  'AuroraServices: NOT IN REPO'
);
assert(results[5].logLine.includes(ICON.NOT_IN_REPO),
  'AuroraServices: ❓ icon present in log line');
assert(results[5].logLine.includes('app/AuroraServices.apk'),
  'AuroraServices: logLine uses relPath');
assertEqual(results[5].tableRow[0], 'app/AuroraServices.apk',
  'AuroraServices: tableRow[0] shows relPath');
assertEqual(results[5].tableRow[3], `${ICON.NOT_IN_REPO} NOT IN REPO`,
  'AuroraServices: tableRow status has ❓ NOT IN REPO');
assertEqual(results[5].tableRow[2], '-',
  'AuroraServices: tableRow repo = -');
assertEqual(results[5].noticeLine, null,
  'AuroraServices: no notice for NOT IN REPO');
assertEqual(results[5].warningLine, null,
  'AuroraServices: no warning for NOT IN REPO');
assertEqual(results[5].checkFailedLine, null,
  'AuroraServices: no checkFailedLine for NOT IN REPO');

// 7. Special cert fallback: FakeStore with MICROG_CERT → matched via
//    SPECIAL_PKG_CERT in F-Droid
assert(
  results[6].logLine.includes('[f-droid.org]') &&
  results[6].logLine.includes('UPDATE AVAILABLE'),
  'FakeStore: UPDATE AVAILABLE via special cert fallback in F-Droid'
);
assert(results[6].noticeLine !== null,
  'FakeStore: notice emitted for special-cert UPDATE AVAILABLE');
assertEqual(
  results[6].tableRow[3],
  `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.android.vending_84022626.apk">UPDATE AVAILABLE</a><br>version=33.0 (84022626)`,
  'FakeStore: tableRow UPDATE AVAILABLE is 2-line format with <br>'
);
assertEqual(
  results[6].noticeLine,
  'https://f-droid.org/repo/com.android.vending_84022626.apk',
  'FakeStore: notice content is the APK URL'
);
assertEqual(
  results[6].noticeTitle,
  `${ICON.UPDATE_AVAILABLE} Update available for priv-app/FakeStore.apk (com.android.vending): [f-droid.org] version=33.0 (84022626)`,
  'FakeStore: noticeTitle includes repo and version info'
);
assertEqual(results[6].warningLine, null,
  'FakeStore: no warning for UPDATE AVAILABLE');
assertEqual(results[6].checkFailedLine, null,
  'FakeStore: no checkFailedLine for UPDATE AVAILABLE');

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
assertEqual(results[7].checkFailedLine, null,
  'GmsCoreOther: no checkFailedLine for DIFFERENT SIGNER');

// ---------------------------------------------------------------------------
// checkApks: logEntry format for DIFFERENT SIGNER and NOT IN REPO
// ---------------------------------------------------------------------------

console.log('\n── checkApks (logEntry for DIFFERENT SIGNER and NOT IN REPO) ──');

// DIFFERENT SIGNER logLine uses logEntry format: "${icon} [STATUS] name (pkg): desc"
assert(
  results[4].logLine.startsWith(`${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] `),
  'NewPipeFork: logLine uses logEntry format (icon + 1 space + [DIFFERENT SIGNER])'
);
assertEqual(
  results[4].logLine,
  `${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] app/NewPipeFork.apk` +
  ` (org.schabi.newpipe): [f-droid.org] signed with a different certificate`,
  'NewPipeFork: logLine matches logEntry output exactly'
);

// NOT IN REPO logLine uses logEntry format
assert(
  results[5].logLine.startsWith(`${ICON.NOT_IN_REPO} [NOT IN REPO] `),
  'AuroraServices: logLine uses logEntry format (icon + 1 space + [NOT IN REPO])'
);
assertEqual(
  results[5].logLine,
  `${ICON.NOT_IN_REPO} [NOT IN REPO] app/AuroraServices.apk` +
  ` (com.aurora.services): not found in any repo`,
  'AuroraServices: logLine matches logEntry output exactly'
);

// ---------------------------------------------------------------------------
// checkApks: updateInfo field
// ---------------------------------------------------------------------------

console.log('\n── checkApks (updateInfo field) ──');

// Non-UPDATE_AVAILABLE entries have updateInfo = null
assertEqual(results[0].updateInfo, null, 'UP TO DATE: updateInfo is null');
assertEqual(results[1].updateInfo, null, 'LOCAL NEWER: updateInfo is null');
assertEqual(results[4].updateInfo, null, 'DIFFERENT SIGNER: updateInfo is null');
assertEqual(results[5].updateInfo, null, 'NOT IN REPO: updateInfo is null');

// UPDATE AVAILABLE entries have structured updateInfo
assert(results[2].updateInfo !== null,
  'GmsCore (microG cert): updateInfo is non-null for UPDATE AVAILABLE');
assertEqual(results[2].updateInfo.relPath,   'priv-app/GmsCore.apk',
  'GmsCore updateInfo: relPath');
assertEqual(results[2].updateInfo.package,   'com.google.android.gms',
  'GmsCore updateInfo: package');
assertEqual(results[2].updateInfo.repo,      'microg.org',
  'GmsCore updateInfo: repo');
assertEqual(results[2].updateInfo.localVn,   '22.0',
  'GmsCore updateInfo: localVn');
assertEqual(results[2].updateInfo.localVc,   220000000,
  'GmsCore updateInfo: localVc');
assertEqual(results[2].updateInfo.repoVn,    '23.9.13',
  'GmsCore updateInfo: repoVn');
assertEqual(results[2].updateInfo.repoVc,    230913000,
  'GmsCore updateInfo: repoVc');
assertEqual(results[2].updateInfo.url,
  'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk',
  'GmsCore updateInfo: url');
assertEqual(results[2].updateInfo.repoFileSha256, SHA256_MICROG_GMS,
  'GmsCore updateInfo: repoFileSha256');

// tableRow[3] for UPDATE_AVAILABLE still contains <br> (for GitHub summary)
assert(results[2].tableRow[3].includes('<br>'),
  'GmsCore: tableRow[3] keeps <br> for GitHub job summary (not replaced in source)');

// ---------------------------------------------------------------------------
// checkApks: tableRow <br> kept as-is (CLI rendering tested separately)
// ---------------------------------------------------------------------------

console.log('\n── checkApks (tableRow <br> preserved for workflow) ──');

assert(results[0].tableRow[3].includes('<br>'),
  'UP TO DATE tableRow[3] contains <br> for 2-line GitHub summary');
assert(results[1].tableRow[3].includes('<br>'),
  'LOCAL NEWER tableRow[3] contains <br> for 2-line GitHub summary');
assert(results[2].tableRow[3].includes('<br>'),
  'UPDATE AVAILABLE tableRow[3] contains <br> for 2-line GitHub summary');
assert(results[3].tableRow[3].includes('<br>'),
  'UPDATE AVAILABLE (Google cert) tableRow[3] contains <br>');
assert(!results[4].tableRow[3].includes('<br>'),
  'DIFFERENT SIGNER tableRow[3] has no <br> (single-line status)');
assert(!results[5].tableRow[3].includes('<br>'),
  'NOT IN REPO tableRow[3] has no <br> (single-line status)');

// ---------------------------------------------------------------------------
// update-info.dat format
// ---------------------------------------------------------------------------

console.log('\n── update-info.dat format ──');

// Simulate the update-info.dat line-building logic from run()
const updateInfoEntries = [results[2], results[3], results[6]]
  .map(r => r.updateInfo)
  .filter(i => i !== null);

assertEqual(updateInfoEntries.length, 3,
  'update-info.dat: 3 UPDATE AVAILABLE entries (2 GmsCore + FakeStore)');

const infoLines = updateInfoEntries.map(info => {
  const fields = [info.relPath, info.url, info.repoVn, String(info.repoVc), info.repoFileSha256];
  return fields.join('|');
});

assertEqual(
  infoLines[0],
  `priv-app/GmsCore.apk|https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk|23.9.13|230913000|${SHA256_MICROG_GMS}`,
  'update-info.dat line 1: GmsCore (microG cert)'
);
assertEqual(
  infoLines[1],
  `priv-app/GoogleGms.apk|https://f-droid.org/repo/com.google.android.gms_240000000.apk|24.0|240000000|${SHA256_FDROID_GMS}`,
  'update-info.dat line 2: GmsCore (Google cert)'
);
assertEqual(
  infoLines[2],
  `priv-app/FakeStore.apk|https://f-droid.org/repo/com.android.vending_84022626.apk|33.0|84022626|${SHA256_FDROID_VNDR}`,
  'update-info.dat line 3: FakeStore'
);

// Each line has exactly 5 pipe-separated fields
for (const line of infoLines) {
  const parts = line.split('|');
  assertEqual(parts.length, 5,
    `update-info.dat: line has 5 fields: ${parts[0]}`);
  assert(parts[0].length > 0,
    `update-info.dat: relPath is non-empty: ${parts[0]}`);
  assert(parts[1].startsWith('https://'),
    `update-info.dat: url is HTTPS: ${parts[0]}`);
  assert(parts[2].length > 0,
    `update-info.dat: versionName is non-empty: ${parts[0]}`);
  assert(Number(parts[3]) > 0,
    `update-info.dat: versionCode is positive: ${parts[0]}`);
  assert(parts[4].length > 0,
    `update-info.dat: sha256 is non-empty: ${parts[0]}`);
}

// Entries are joined by \n (separator, not terminator)
const datContent = infoLines.join('\n');
assertEqual(datContent.split('\n').length, 3,
  'update-info.dat: 3 lines joined by \\n');
assert(!datContent.endsWith('\n'),
  'update-info.dat: no trailing newline (separator semantics)');

// ---------------------------------------------------------------------------
// update-info.dat field validation (| and \n are forbidden)
// ---------------------------------------------------------------------------

console.log('\n── update-info.dat field validation ──');

function validateUpdateInfoFields(fields) {
  for (const field of fields) {
    if (field.includes('|') || field.includes('\n')) {
      throw new Error(
        `update-info.dat: field contains reserved character ('|' or '\\n'): ${JSON.stringify(field)}`
      );
    }
  }
}

// Clean fields must not throw
{
  let threw = false;
  try {
    validateUpdateInfoFields(['priv-app/GmsCore.apk', 'https://repo.example.org/gms.apk', '23.9.13', '230913000', 'aabbccdd']);
  } catch { threw = true; }
  assert(!threw, 'field validation: clean fields do not throw');
}

// Pipe in relPath must throw
{
  let threw = false;
  try { validateUpdateInfoFields(['priv-app/Gms|Core.apk', 'https://example.org/gms.apk', '1.0', '1', 'aabb']); }
  catch { threw = true; }
  assert(threw, 'field validation: pipe in relPath throws');
}

// Newline in url must throw
{
  let threw = false;
  try { validateUpdateInfoFields(['ok.apk', 'https://example.org/\ngms.apk', '1.0', '1', 'aabb']); }
  catch { threw = true; }
  assert(threw, 'field validation: newline in url throws');
}

// Pipe in versionName must throw
{
  let threw = false;
  try { validateUpdateInfoFields(['ok.apk', 'https://example.org/gms.apk', '1.0|bad', '1', 'aabb']); }
  catch { threw = true; }
  assert(threw, 'field validation: pipe in versionName throws');
}

// Newline in sha256 must throw
{
  let threw = false;
  try { validateUpdateInfoFields(['ok.apk', 'https://example.org/gms.apk', '1.0', '1', 'aa\nbb']); }
  catch { threw = true; }
  assert(threw, 'field validation: newline in sha256 throws');
}

// ---------------------------------------------------------------------------
// checkApks: CHECK_FAILED tests
// ---------------------------------------------------------------------------

console.log('\n── checkApks (CHECK_FAILED) ──');

// Repo entry with null versionCode (no vc in index)
const NULL_VC_INDEX = {
  packages: {
    'com.example.nullvc': {
      versions: {
        v1: {
          file: { name: '/com.example.nullvc_1.apk' },
          manifest: {
            // versionCode deliberately absent → vc=null in parseRepoV2
            versionName: '1.0',
            signer: { sha256: ['cert_nullvc_aaaa'] },
          },
        },
      },
    },
  },
};

const REPOS_WITH_NULLVC = [
  ...REPOS,
  { baseUrl: 'https://example.com/repo', apps: parseRepoV2(NULL_VC_INDEX) },
];

const checkFailedResults = checkApks([
  // 1. local versionCode = 0 (could not be extracted)
  {
    fileName: 'ZeroLocalVc.apk',
    relPath:  'app/ZeroLocalVc.apk',
    packageName: 'org.fdroid.fdroid.privileged',
    versionCode: 0,
    versionName: '',
    certSha256: CERT_FDROID,
  },
  // 2. local versionCode = null (explicitly null)
  {
    fileName: 'NullLocalVc.apk',
    relPath:  'app/NullLocalVc.apk',
    packageName: 'org.fdroid.fdroid.privileged',
    versionCode: null,
    versionName: '',
    certSha256: CERT_FDROID,
  },
  // 3. repo versionCode = null (no vc in index entry)
  {
    fileName: 'NullRepoVc.apk',
    relPath:  'app/NullRepoVc.apk',
    packageName: 'com.example.nullvc',
    versionCode: 100,
    versionName: '1.0.0',
    certSha256: 'cert_nullvc_aaaa',
  },
], REPOS_WITH_NULLVC);

// 1. local versionCode = 0 → CHECK_FAILED
assert(
  checkFailedResults[0].logLine.includes('CHECK FAILED'),
  'ZeroLocalVc: logLine contains CHECK FAILED'
);
assert(
  checkFailedResults[0].logLine.includes(ICON.CHECK_FAILED),
  'ZeroLocalVc: logLine contains CHECK_FAILED icon'
);
assert(
  checkFailedResults[0].tableRow[3].includes('CHECK FAILED'),
  'ZeroLocalVc: tableRow status contains CHECK FAILED'
);
assertEqual(checkFailedResults[0].noticeLine, null,
  'ZeroLocalVc: no noticeLine when CHECK FAILED');
assertEqual(checkFailedResults[0].warningLine, null,
  'ZeroLocalVc: no warningLine when CHECK FAILED');
assert(
  checkFailedResults[0].checkFailedLine !== null,
  'ZeroLocalVc: checkFailedLine is set'
);
assert(
  checkFailedResults[0].checkFailedLine.includes('CHECK FAILED'),
  'ZeroLocalVc: checkFailedLine contains CHECK FAILED'
);
assert(
  checkFailedResults[0].checkFailedLine.includes('localVc=0'),
  'ZeroLocalVc: checkFailedLine mentions localVc=0'
);

// 2. local versionCode = null (treated as 0) → CHECK_FAILED
assert(
  checkFailedResults[1].logLine.includes('CHECK FAILED'),
  'NullLocalVc: logLine contains CHECK FAILED'
);
assert(
  checkFailedResults[1].checkFailedLine !== null,
  'NullLocalVc: checkFailedLine is set (null treated as 0)'
);
assert(
  checkFailedResults[1].checkFailedLine.includes('localVc=0'),
  'NullLocalVc: checkFailedLine shows localVc=0 (null coerced)'
);

// 3. repo versionCode = null (treated as 0) → CHECK_FAILED
assert(
  checkFailedResults[2].logLine.includes('CHECK FAILED'),
  'NullRepoVc: logLine contains CHECK FAILED'
);
assert(
  checkFailedResults[2].checkFailedLine !== null,
  'NullRepoVc: checkFailedLine is set (null repo vc treated as 0)'
);
assert(
  checkFailedResults[2].checkFailedLine.includes('repoVc=0'),
  'NullRepoVc: checkFailedLine shows repoVc=0 (null coerced)'
);
assertEqual(checkFailedResults[2].noticeLine, null,
  'NullRepoVc: no noticeLine when CHECK FAILED');
assertEqual(checkFailedResults[2].warningLine, null,
  'NullRepoVc: no warningLine when CHECK FAILED');

// ---------------------------------------------------------------------------
// run() input validation tests
// ---------------------------------------------------------------------------

console.log('\n── run() input validation ──');

// Helper: call run() and capture the thrown error message, or return null
async function runError(opts) {
  try {
    await run(opts);
    return null;
  } catch (e) {
    return e.message;
  }
}

// Minimal core stub sufficient to reach the validation checks
const STUB_CORE = {
  info:    () => {},
  warning: () => {},
  notice:  () => {},
  error:   () => {},
  summary: {
    addHeading: function() { return this; },
    addTable:   function() { return this; },
    write:      async () => {},
  },
};

// Both apkDirs and apkFiles are undefined → throw
{
  const msg = await runError({ core: {} });
  assert(msg !== null, 'run(): throws when both apkDirs and apkFiles are undefined');
  assert(msg.includes('apkDirs') || msg.includes('apkFiles'),
    'run(): error message mentions apkDirs or apkFiles');
}

// apkFiles set but empty → throw
{
  const msg = await runError({ core: {}, apkFiles: [] });
  assert(msg !== null, 'run(): throws when apkFiles is set but empty');
  assert(msg.includes('apkFiles'),
    'run(): error message mentions apkFiles');
}

// apkDirs contains a nonexistent directory → warns and skips (no throw)
{
  const warnings = [];
  const coreCapture = { ...STUB_CORE, warning: (msg) => warnings.push(msg) };
  const msg = await runError({ core: coreCapture, apkDirs: ['/nonexistent/path/to/apks'] });
  assert(msg === null || !msg.includes('APK directory not found'),
    'run(): nonexistent dir in apkDirs does not throw "APK directory not found"');
  assert(warnings.some(w => w.includes('/nonexistent/path/to/apks')),
    'run(): nonexistent dir in apkDirs emits a warning with the path');
}

// apkFiles contains a nonexistent file → warns and skips (no throw)
{
  const warnings = [];
  const coreCapture = { ...STUB_CORE, warning: (msg) => warnings.push(msg) };
  const msg = await runError({ core: coreCapture, apkFiles: ['/nonexistent/file.apk'] });
  assert(msg === null || !msg.includes('not found'),
    'run(): nonexistent file in apkFiles does not throw');
  assert(warnings.some(w => w.includes('/nonexistent/file.apk')),
    'run(): nonexistent file in apkFiles emits a warning with the path');
}

// apkDirs set (even empty) → does NOT throw due to apkFiles absence
// (empty apkDirs means "use default directory", which is valid)
{
  // We cannot actually run a full update check in tests (no network/aapt),
  // so just verify no validation error is thrown — the error (if any) must be
  // a runtime error about aapt/network, not the input-validation error.
  const msg = await runError({ core: STUB_CORE, apkDirs: [] });
  assert(msg === null || (!msg.includes('apkDirs') && !msg.includes('apkFiles')),
    'run(): empty apkDirs passes validation (runtime errors are OK)');
}

// apkFiles provided with one entry → does NOT throw validation error
{
  const msg = await runError({ core: STUB_CORE, apkFiles: ['/nonexistent.apk'] });
  assert(msg === null || (!msg.includes('apkFiles') && !msg.includes('apkDirs')),
    'run(): non-empty apkFiles passes validation (runtime errors are OK)');
}

// ---------------------------------------------------------------------------
// relPath computation: apkDirs vs apkFiles
// ---------------------------------------------------------------------------

console.log('\n── relPath computation ──');

// For dir-scanned APKs: relPath is relative to the source dir (not workspace)
// path.posix.relative is used here to mirror the library's forward-slash normalization,
// ensuring the tests pass on both Linux and Windows.
{
  const baseDir = '/workspace/zip-content/origin';
  const apkPath = baseDir + '/priv-app/GmsCore.apk';
  assertEqual(
    path.posix.relative(baseDir, apkPath),
    'priv-app/GmsCore.apk',
    'relPath from apkDirs: relative to its source dir'
  );
}

// For explicit apkFiles: relPath is relative to workspace
{
  const workspace = '/workspace';
  const apkPath = '/workspace/zip-content/origin/priv-app/GmsCore.apk';
  assertEqual(
    path.posix.relative(workspace, apkPath),
    'zip-content/origin/priv-app/GmsCore.apk',
    'relPath from apkFiles: relative to workspace'
  );
}

// Multiple apkDirs: each APK gets relPath from its own source dir, not from the other
{
  const dir1 = '/workspace/dir1';
  const dir2 = '/workspace/dir2';
  assertEqual(
    path.posix.relative(dir1, dir1 + '/sub/App.apk'),
    'sub/App.apk',
    'relPath from first dir: relative to dir1'
  );
  assertEqual(
    path.posix.relative(dir2, dir2 + '/sub/App.apk'),
    'sub/App.apk',
    'relPath from second dir: relative to dir2 (independent from dir1)'
  );
  // An apk from dir2 must NOT be relative to dir1
  assert(
    path.posix.relative(dir1, dir2 + '/sub/App.apk') !== 'sub/App.apk',
    'relPath from dir2 differs when computed relative to dir1'
  );
}

// Mixed apkFiles + apkDirs: relPath origins are independent
{
  const workspace = '/workspace';
  const dir = '/workspace/zip-content/origin';
  // File supplied via apkFiles: relPath is workspace-relative
  assertEqual(
    path.posix.relative(workspace, '/workspace/extra/app/Test.apk'),
    'extra/app/Test.apk',
    'mixed: apkFiles relPath is workspace-relative'
  );
  // File found via apkDirs scan: relPath is dir-relative
  assertEqual(
    path.posix.relative(dir, dir + '/priv-app/Test.apk'),
    'priv-app/Test.apk',
    'mixed: apkDirs relPath is dir-relative'
  );
  // The same absolute path produces a different relPath depending on the base
  const sameAbsPath = '/workspace/extra/app/Test.apk';
  const relFromWorkspace = path.posix.relative(workspace, sameAbsPath);
  const relFromDir       = path.posix.relative(dir, sameAbsPath);
  assert(
    relFromWorkspace !== relFromDir,
    'mixed: same absolute path has different relPath when base is workspace vs dir'
  );
  assertEqual(
    relFromWorkspace, 'extra/app/Test.apk',
    'mixed: workspace-based relPath for extra/app/Test.apk'
  );
  assertEqual(
    relFromDir, '../../extra/app/Test.apk',
    'mixed: dir-based relPath for extra/app/Test.apk traverses up to dir root'
  );
}

// ---------------------------------------------------------------------------
// toPosix: Windows path separator simulation (using Object.defineProperty mock)
// ---------------------------------------------------------------------------

console.log('\n── toPosix Windows path simulation ──');

{
  const originalPathPosix = path.posix;
  // Clone path.posix into a new detached object so that changes to path
  // (which on POSIX is the same object as path.posix) do not affect path.posix.sep
  const detachedPathPosix = Object.assign({}, originalPathPosix);

  const originalPathSep       = path.sep;
  const originalPathDelimiter = path.delimiter;
  const originalPlatform      = process.platform;

  // Override path.posix with the detached clone so path.posix !== path
  const detachPathPosix = () => {
    Object.defineProperty(path, 'posix', { value: detachedPathPosix, configurable: true, enumerable: true, writable: true });
  };

  // Restore path.posix to the original object
  const restorePathPosix = () => {
    Object.defineProperty(path, 'posix', { value: originalPathPosix, configurable: true, enumerable: true, writable: true });
  };

  /**
   * Mocks the Node.js environment to behave like Windows.
   * Works natively in Node 20+ without external libraries.
   */
  const mockWindows = () => {
    detachPathPosix();

    // 1. Mock all path methods (join, resolve, basename, etc.) using win32 equivalents
    Object.keys(path.win32).forEach(key => {
      if (typeof path.win32[key] === 'function' && typeof path[key] === 'function') {
        mock.method(path, key, path.win32[key]);
      }
    });

    // 2. Force overwrite of read-only properties using defineProperty
    Object.defineProperty(path, 'sep',        { value: '\\',   configurable: true, enumerable: true, writable: true });
    Object.defineProperty(path, 'delimiter',  { value: ';',    configurable: true, enumerable: true, writable: true });
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true, enumerable: true, writable: true });
  };

  const unmockWindows = () => {
    Object.defineProperty(path, 'sep',        { value: originalPathSep,       configurable: true, enumerable: true, writable: true });
    Object.defineProperty(path, 'delimiter',  { value: originalPathDelimiter, configurable: true, enumerable: true, writable: true });
    Object.defineProperty(process, 'platform', { value: originalPlatform,      configurable: true, enumerable: true, writable: true });
    restorePathPosix();
    mock.restoreAll();
  };

  try {
    mockWindows();

    // Verify mock state
    assertEqual(process.platform, 'win32', 'toPosix (win): process.platform mocked to win32');
    assertEqual(path.sep,        '\\',     'toPosix (win): path.sep mocked to backslash');
    assertEqual(path.win32.sep,  '\\',     'toPosix (win): path.win32.sep unchanged');
    assertEqual(path.posix.sep,  '/',      'toPosix (win): path.posix.sep unaffected by mock');
    assertEqual(path.join('C:', 'Users'),               'C:\\Users',   'toPosix (win): path.join uses win32');
    assertEqual(path.dirname('C:\\Windows\\System32'), 'C:\\Windows', 'toPosix (win): path.dirname uses win32');
    assert(path.isAbsolute('C:\\Windows\\System32'),                   'toPosix (win): path.isAbsolute recognises Windows path');

    // toPosix conversion: path.sep is now '\\' so toPosix replaces backslashes
    // Single-level Windows path
    assertEqual(
      'C:\\foo\\bar'.toPosix(),
      'C:/foo/bar',
      'toPosix (win): single-level Windows path converted'
    );
    // Deep Windows path
    assertEqual(
      'C:\\workspace\\zip-content\\origin\\app.apk'.toPosix(),
      'C:/workspace/zip-content/origin/app.apk',
      'toPosix (win): deep Windows path fully converted'
    );
    // Forward-slash path is unchanged (no backslashes to replace)
    assertEqual(
      '/already/posix/path'.toPosix(),
      '/already/posix/path',
      'toPosix (win): posix path unchanged when sep is backslash'
    );

    // Verify that toPosix converts Windows-style dirs and files when used
    // as the map() callback (mirrors the map(toPosix) call in the library)
    const winDirs = [
      'C:\\workspace\\zip-content',
      'D:\\apks\\release',
    ];
    const winFiles = [
      'C:\\workspace\\app.apk',
      'D:\\other\\test.apk',
    ];
    const normDirs  = winDirs.map(d => d.toPosix());
    const normFiles = winFiles.map(f => f.toPosix());

    assertEqual(normDirs[0],  'C:/workspace/zip-content', 'toPosix (win): dir path 1 normalized');
    assertEqual(normDirs[1],  'D:/apks/release',          'toPosix (win): dir path 2 normalized');
    assertEqual(normFiles[0], 'C:/workspace/app.apk',     'toPosix (win): file path 1 normalized');
    assertEqual(normFiles[1], 'D:/other/test.apk',        'toPosix (win): file path 2 normalized');
  } finally {
    unmockWindows();
  }
}



console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
if (failed > 0) {
  process.exitCode = 1;
}
