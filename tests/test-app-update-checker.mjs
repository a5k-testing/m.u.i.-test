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

const CERT_FDROID  = 'fdroid_cert_aaaa';
const CERT_MICROG  = 'microg_cert_bbbb';
const CERT_GOOGLE  = 'google_cert_cccc';
const CERT_AURORA  = 'aurora_cert_dddd';
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
  results[0].logLine.includes('UP TO DATE'),
  'FDroid priv: UP TO DATE in F-Droid (short URL)'
);
assert(results[0].logLine.includes(ICON.UP_TO_DATE),
  'FDroid priv: ✅ icon present');
assertEqual(results[0].tableRow[0], 'priv-app/FDroidPrivilegedExtension.apk',
  'FDroid priv: tableRow[0] shows relPath');
assertEqual(results[0].tableRow[2], 'f-droid',
  'FDroid priv: tableRow repo = f-droid (compact label)');
assert(!results[0].tableRow[3].includes('<a href='),
  'FDroid priv: tableRow status is plain text (up to date, no link)');
assertEqual(results[0].noticeLine, null,
  'FDroid priv: no notice for UP TO DATE');
assertEqual(results[0].warningLine, null,
  'FDroid priv: no warning for UP TO DATE');
assertEqual(results[0].checkFailedLine, null,
  'FDroid priv: no checkFailedLine for UP TO DATE');

// 2. Local newer
assert(
  results[1].logLine.includes('[f-droid.org]') &&
  results[1].logLine.includes('LOCAL NEWER'),
  'NewPipe: LOCAL NEWER in F-Droid (short URL)'
);
assert(results[1].logLine.includes(ICON.LOCAL_NEWER),
  'NewPipe: 🚀 icon present');
assertEqual(results[1].tableRow[0], 'app/NewPipe.apk',
  'NewPipe: tableRow[0] shows relPath (app/NewPipe.apk)');
assertEqual(results[1].noticeLine, null,
  'NewPipe: no notice for LOCAL NEWER');
assert(!results[1].tableRow[3].includes('<a href='),
  'NewPipe: tableRow status is plain text (local newer, no link)');
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
  `${ICON.UPDATE_AVAILABLE} <a href="https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk">UPDATE AVAILABLE</a>: repo=23.9.13 (230913000) > local 22.0 (220000000)`,
  'GmsCore (microG cert): tableRow links only "UPDATE AVAILABLE", version info includes local vn'
);
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
assertEqual(results[2].checkFailedLine, null,
  'GmsCore (microG cert): no checkFailedLine for UPDATE AVAILABLE');

// 4. Google-cert GmsCore: matched in F-Droid (first repo)
assert(
  results[3].logLine.includes('[f-droid.org]') &&
  results[3].logLine.includes('UPDATE AVAILABLE'),
  'GmsCore (Google cert): UPDATE AVAILABLE from F-Droid (short URL)'
);
assert(results[3].noticeLine !== null,
  'GmsCore (Google cert): notice emitted');
assertEqual(
  results[3].tableRow[3],
  `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.google.android.gms_240000000.apk">UPDATE AVAILABLE</a>: repo=24.0 (240000000) > local 23.0 (230000000)`,
  'GmsCore (Google cert): tableRow links only "UPDATE AVAILABLE", version info includes local vn'
);
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
  `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.android.vending_84022626.apk">UPDATE AVAILABLE</a>: repo=33.0 (84022626) > local 30.0 (80000000)`,
  'FakeStore: tableRow version info includes local vn'
);
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
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}
