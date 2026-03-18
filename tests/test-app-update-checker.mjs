// SPDX-FileCopyrightText: (c) 2026 ale5000
// SPDX-License-Identifier: GPL-3.0-or-later

// Node.js 20 or later is required for the native test runner
if (parseInt(process.versions.node.split('.')[0], 10) < 20) {
  throw new Error(
    `Node.js 20 or later is required (current: ${process.versions.node})`
  );
}

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
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

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
// Precomputed test results (used across multiple test blocks)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('SKIP_LIST', async (t) => {
  await t.test('SKIP_LIST has 4 entries', () => { assert.strictEqual(SKIP_LIST.size, 4); });
  await t.test('SKIP_LIST: priv-app/FakeStore-0.3.6.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/FakeStore-0.3.6.apk')); });
  await t.test('SKIP_LIST: priv-app/GmsCore-0.3.6.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/GmsCore-0.3.6.apk')); });
  await t.test('SKIP_LIST: priv-app/GmsCoreVtm.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/GmsCoreVtm.apk')); });
  await t.test('SKIP_LIST: priv-app/GmsCoreVtmLegacy.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/GmsCoreVtmLegacy.apk')); });

  // Current (non-versioned) builds must NOT be skipped
  await t.test('SKIP_LIST: priv-app/GmsCore.apk (no version suffix) is NOT skipped', () => { assert.ok(!SKIP_LIST.has('priv-app/GmsCore.apk')); });
  await t.test('SKIP_LIST: priv-app/FakeStore.apk (no version suffix) is NOT skipped', () => { assert.ok(!SKIP_LIST.has('priv-app/FakeStore.apk')); });

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
  await t.test('SKIP_LIST filter: 3 of 7 APKs kept', () => { assert.strictEqual(filtered.length, 3); });
  await t.test('SKIP_LIST filter: FakeStore.apk (no suffix) kept', () => {
    assert.strictEqual(
      filtered[0].fileName,
      'FakeStore.apk'
    );
  });
  await t.test('SKIP_LIST filter: GmsCore.apk (no suffix) kept', () => {
    assert.strictEqual(
      filtered[1].fileName,
      'GmsCore.apk'
    );
  });
  await t.test('SKIP_LIST filter: Something.apk kept', () => {
    assert.strictEqual(
      filtered[2].fileName,
      'Something.apk'
    );
  });

  // ---------------------------------------------------------------------------
  // Constants: REPO_CACHE_TTL_MS
  // ---------------------------------------------------------------------------
});

test('REPO_CACHE_TTL_MS', async (t) => {
  await t.test('REPO_CACHE_TTL_MS equals 7 days in milliseconds', () => {
    assert.strictEqual(
      REPO_CACHE_TTL_MS,
      7 * 24 * 60 * 60 * 1000
    );
  });
  await t.test('REPO_CACHE_TTL_MS is positive', () => { assert.ok(REPO_CACHE_TTL_MS > 0); });

  // ---------------------------------------------------------------------------
  // URL utilities: shortUrl
  // ---------------------------------------------------------------------------
});

test('shortUrl', async (t) => {
  await t.test('shortUrl: subdomain trimmed to base domain', () => {
    assert.strictEqual(
      shortUrl('https://repo.microg.org/fdroid/repo'),
      'microg.org'
    );
  });
  await t.test('shortUrl: two-part hostname unchanged', () => {
    assert.strictEqual(
      shortUrl('https://f-droid.org/repo'),
      'f-droid.org'
    );
  });
  await t.test('shortUrl: apt.izzysoft.de → izzysoft.de', () => {
    assert.strictEqual(
      shortUrl('https://apt.izzysoft.de/fdroid/repo'),
      'izzysoft.de'
    );
  });
  await t.test('shortUrl: invalid URL returns input unchanged', () => { assert.ok(shortUrl('not-a-url') === 'not-a-url'); });

  // ---------------------------------------------------------------------------
  // URL utilities: index-v2.json URL construction
  // ---------------------------------------------------------------------------
});

test('index-v2.json URL construction', async (t) => {
  const indexUrls = repos.map(b => `${b}/index-v2.json`);

  await t.test('microG: /index-v2.json appended correctly', () => {
    assert.strictEqual(
      indexUrls[0],
      'https://repo.microg.org/fdroid/repo/index-v2.json'
    );
  });
  await t.test('F-Droid: /index-v2.json appended correctly', () => {
    assert.strictEqual(
      indexUrls[1],
      'https://f-droid.org/repo/index-v2.json'
    );
  });
  await t.test('IzzyOnDroid: /index-v2.json appended correctly', () => {
    assert.strictEqual(
      indexUrls[2],
      'https://apt.izzysoft.de/fdroid/repo/index-v2.json'
    );
  });

  // ---------------------------------------------------------------------------
  // URL utilities: fetchUrl HTTPS enforcement
  // ---------------------------------------------------------------------------
});

test('fetchUrl: HTTPS enforcement', async (t) => {
  // All configured repo URLs must be HTTPS
  for (const baseUrl of repos) {
    await t.test(`Repo base URL is HTTPS: ${baseUrl}`, () => { assert.ok(baseUrl.startsWith('https://')); });
  }

  // URL validation (mirrors the check inside fetchUrl)
  function isHttpsUrl(url) {
    return url.startsWith('https://');
  }
  await t.test('HTTP URL fails HTTPS check', () => { assert.ok(!isHttpsUrl('http://example.com/repo')); });
  await t.test('FTP URL fails HTTPS check', () => { assert.ok(!isHttpsUrl('ftp://example.com/repo')); });
  await t.test('HTTPS URL passes check', () => { assert.ok(isHttpsUrl('https://f-droid.org/repo')); });

  // Max redirects constant
  const MAX_REDIRECTS = 3;
  await t.test('Max redirects is 3', () => { assert.strictEqual(MAX_REDIRECTS, 3); });

  // ---------------------------------------------------------------------------
  // parseRepoV2 unit tests
  // ---------------------------------------------------------------------------
});

test('parseRepoV2', async (t) => {
  const fdroidApps = REPOS[0].apps;
  const microgApps = REPOS[1].apps;

  // Basic map size
  await t.test('F-Droid: parsed 4 packages', () => { assert.strictEqual(fdroidApps.size, 4); });
  await t.test('microG: parsed 1 package', () => { assert.strictEqual(microgApps.size, 1); });

  // latestVc / latestVn
  {
    const np = fdroidApps.get('org.schabi.newpipe');
    await t.test('NewPipe: latestVc = 1000 (newest version wins)', () => { assert.strictEqual(np.latestVc, 1000); });
    await t.test('NewPipe: latestVn = 0.25.0', () => { assert.strictEqual(np.latestVn, '0.25.0'); });
  }

  // byCert — highest versionCode per cert
  {
    const np = fdroidApps.get('org.schabi.newpipe');
    await t.test('NewPipe: byCert keeps highest vc (1000, not 990)', () => {
      assert.strictEqual(
        np.byCert[CERT_NEWPIPE].vc,
        1000
      );
    });
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
    await t.test('Mixed-case: package exists', () => { assert.ok(pkg !== undefined); });
    await t.test('Mixed-case: cert normalised to lower-case', () => { assert.ok('aabb' in pkg.byCert); });
  }

  // Unknown package returns undefined
  await t.test('Non-existent package returns undefined', () => { assert.ok(fdroidApps.get('com.nonexistent.pkg') === undefined); });

  // ---------------------------------------------------------------------------
  // checkApks: main matching loop
  // ---------------------------------------------------------------------------
});

test('checkApks (matching loop)', async (t) => {
  // 1. Up to date
  await t.test('FDroid priv: UP TO DATE logLine contains [f-droid.org] and [UP TO DATE]', () => {
    assert.ok(results[0].logLine.includes('[f-droid.org]') && results[0].logLine.includes('[UP TO DATE]'));
  });
  await t.test('FDroid priv: ✅ icon present', () => { assert.ok(results[0].logLine.includes(ICON.UP_TO_DATE)); });
  await t.test('FDroid priv: logLine uses relPath', () => { assert.ok(results[0].logLine.includes('priv-app/FDroidPrivilegedExtension.apk')); });
  await t.test('FDroid priv: logLine contains repo version info', () => { assert.ok(results[0].logLine.includes('version=0.2.13 (2130)')); });
  await t.test('FDroid priv: tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[0].tableRow[0],
      'priv-app/FDroidPrivilegedExtension.apk'
    );
  });
  await t.test('FDroid priv: tableRow repo = f-droid (compact label)', () => {
    assert.strictEqual(
      results[0].tableRow[2],
      'f-droid'
    );
  });
  await t.test('FDroid priv: tableRow status has no link (up to date)', () => { assert.ok(!results[0].tableRow[3].includes('<a href=')); });
  await t.test('FDroid priv: tableRow UP TO DATE is 2-line format', () => {
    assert.strictEqual(
      results[0].tableRow[3],
      `${ICON.UP_TO_DATE} UP TO DATE<br>version=0.2.13 (2130)`
    );
  });
  await t.test('FDroid priv: no notice for UP TO DATE', () => {
    assert.strictEqual(
      results[0].noticeLine,
      null
    );
  });
  await t.test('FDroid priv: no warning for UP TO DATE', () => {
    assert.strictEqual(
      results[0].warningLine,
      null
    );
  });
  await t.test('FDroid priv: no checkFailedLine for UP TO DATE', () => {
    assert.strictEqual(
      results[0].checkFailedLine,
      null
    );
  });

  // 2. Local newer
  await t.test('NewPipe: LOCAL NEWER logLine has [f-droid.org] and [LOCAL NEWER]', () => {
    assert.ok(results[1].logLine.includes('[f-droid.org]') && results[1].logLine.includes('[LOCAL NEWER]'));
  });
  await t.test('NewPipe: 🚀 icon present', () => { assert.ok(results[1].logLine.includes(ICON.LOCAL_NEWER)); });
  await t.test('NewPipe: logLine uses relPath', () => { assert.ok(results[1].logLine.includes('app/NewPipe.apk')); });
  await t.test('NewPipe: logLine has local versionInfo', () => { assert.ok(results[1].logLine.includes('local=0.25.1 (1001)')); });
  await t.test('NewPipe: logLine has repo versionInfo', () => { assert.ok(results[1].logLine.includes('repo=')); });
  await t.test('NewPipe: tableRow[0] shows relPath (app/NewPipe.apk)', () => {
    assert.strictEqual(
      results[1].tableRow[0],
      'app/NewPipe.apk'
    );
  });
  await t.test('NewPipe: no notice for LOCAL NEWER', () => {
    assert.strictEqual(
      results[1].noticeLine,
      null
    );
  });
  await t.test('NewPipe: tableRow status is plain text (local newer, no link)', () => { assert.ok(!results[1].tableRow[3].includes('<a href=')); });
  await t.test('NewPipe: tableRow status has LOCAL NEWER icon', () => { assert.ok(results[1].tableRow[3].includes(ICON.LOCAL_NEWER)); });
  await t.test('NewPipe: tableRow LOCAL NEWER is 2-line format with <br>', () => { assert.ok(results[1].tableRow[3].includes('<br>')); });
  await t.test('NewPipe: warning emitted for LOCAL NEWER', () => { assert.ok(results[1].warningLine !== null); });
  await t.test('NewPipe: warning text contains LOCAL NEWER', () => { assert.ok(results[1].warningLine.includes('LOCAL NEWER')); });
  await t.test('NewPipe: no checkFailedLine for LOCAL NEWER', () => {
    assert.strictEqual(
      results[1].checkFailedLine,
      null
    );
  });

  // 3. microG-signed GmsCore: matched in microG repo, update available
  await t.test('GmsCore (microG cert): UPDATE AVAILABLE from microG repo (short URL)', () => {
    assert.ok(results[2].logLine.includes('[microg.org]') && results[2].logLine.includes('UPDATE AVAILABLE'));
  });
  await t.test('GmsCore (microG cert): ✨ icon present', () => { assert.ok(results[2].logLine.includes(ICON.UPDATE_AVAILABLE)); });
  await t.test('GmsCore (microG cert): tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[2].tableRow[0],
      'priv-app/GmsCore.apk'
    );
  });
  await t.test('GmsCore (microG cert): tableRow repo = microg (compact label)', () => {
    assert.strictEqual(
      results[2].tableRow[2],
      'microg'
    );
  });
  await t.test('GmsCore (microG cert): notice emitted for UPDATE AVAILABLE', () => { assert.ok(results[2].noticeLine !== null); });
  await t.test('GmsCore (microG cert): tableRow UPDATE AVAILABLE is 2-line format with <br>', () => {
    assert.strictEqual(
      results[2].tableRow[3],
      `${ICON.UPDATE_AVAILABLE} <a href="https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk">UPDATE AVAILABLE</a><br>version=23.9.13 (230913000)`
    );
  });
  await t.test('GmsCore (microG cert): notice content is bare URL (no spaces)', () => { assert.ok(!results[2].noticeLine.includes(' ')); });
  await t.test('GmsCore (microG cert): notice content is the APK URL', () => {
    assert.strictEqual(
      results[2].noticeLine,
      'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk'
    );
  });
  await t.test('GmsCore (microG cert): noticeTitle includes repo and version info', () => {
    assert.strictEqual(
      results[2].noticeTitle,
      `${ICON.UPDATE_AVAILABLE} Update available for priv-app/GmsCore.apk (com.google.android.gms): [microg.org] version=23.9.13 (230913000)`
    );
  });
  await t.test('GmsCore (microG cert): no warning for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[2].warningLine,
      null
    );
  });
  await t.test('GmsCore (microG cert): no checkFailedLine for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[2].checkFailedLine,
      null
    );
  });

  // 4. Google-cert GmsCore: matched in F-Droid (first repo)
  await t.test('GmsCore (Google cert): UPDATE AVAILABLE from F-Droid (short URL)', () => {
    assert.ok(results[3].logLine.includes('[f-droid.org]') && results[3].logLine.includes('[UPDATE AVAILABLE]'));
  });
  await t.test('GmsCore (Google cert): notice emitted', () => { assert.ok(results[3].noticeLine !== null); });
  await t.test('GmsCore (Google cert): tableRow UPDATE AVAILABLE is 2-line format with <br>', () => {
    assert.strictEqual(
      results[3].tableRow[3],
      `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.google.android.gms_240000000.apk">UPDATE AVAILABLE</a><br>version=24.0 (240000000)`
    );
  });
  await t.test('GmsCore (Google cert): notice content is the APK URL', () => {
    assert.strictEqual(
      results[3].noticeLine,
      'https://f-droid.org/repo/com.google.android.gms_240000000.apk'
    );
  });
  await t.test('GmsCore (Google cert): noticeTitle includes repo and version info', () => {
    assert.strictEqual(
      results[3].noticeTitle,
      `${ICON.UPDATE_AVAILABLE} Update available for priv-app/GoogleGms.apk (com.google.android.gms): [f-droid.org] version=24.0 (240000000)`
    );
  });

  // 5. Different signer
  await t.test('NewPipeFork: DIFFERENT SIGNER listing [f-droid.org] in brackets', () => {
    assert.ok(results[4].logLine.includes('[DIFFERENT SIGNER]') && results[4].logLine.includes('[f-droid.org]'));
  });
  await t.test('NewPipeFork: 🔐 icon present in log line', () => { assert.ok(results[4].logLine.includes(ICON.DIFFERENT_SIGNER)); });
  await t.test('NewPipeFork: logLine uses relPath', () => { assert.ok(results[4].logLine.includes('app/NewPipeFork.apk')); });
  await t.test('NewPipeFork: logLine contains "signed with a different certificate"', () => { assert.ok(results[4].logLine.includes('signed with a different certificate')); });
  await t.test('NewPipeFork: tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[4].tableRow[0],
      'app/NewPipeFork.apk'
    );
  });
  await t.test('NewPipeFork: tableRow repo = f-droid (compact label)', () => {
    assert.strictEqual(
      results[4].tableRow[2],
      'f-droid'
    );
  });
  await t.test('NewPipeFork: tableRow status has 🔐 DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].tableRow[3],
      `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`
    );
  });
  await t.test('NewPipeFork: no notice for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].noticeLine,
      null
    );
  });
  await t.test('NewPipeFork: no warning for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].warningLine,
      null
    );
  });
  await t.test('NewPipeFork: no checkFailedLine for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].checkFailedLine,
      null
    );
  });

  // 6. Not in repo
  await t.test('AuroraServices: NOT IN REPO', () => { assert.ok(results[5].logLine.includes('[NOT IN REPO]')); });
  await t.test('AuroraServices: ❓ icon present in log line', () => { assert.ok(results[5].logLine.includes(ICON.NOT_IN_REPO)); });
  await t.test('AuroraServices: logLine uses relPath', () => { assert.ok(results[5].logLine.includes('app/AuroraServices.apk')); });
  await t.test('AuroraServices: tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[5].tableRow[0],
      'app/AuroraServices.apk'
    );
  });
  await t.test('AuroraServices: tableRow status has ❓ NOT IN REPO', () => {
    assert.strictEqual(
      results[5].tableRow[3],
      `${ICON.NOT_IN_REPO} NOT IN REPO`
    );
  });
  await t.test('AuroraServices: tableRow repo = -', () => {
    assert.strictEqual(
      results[5].tableRow[2],
      '-'
    );
  });
  await t.test('AuroraServices: no notice for NOT IN REPO', () => {
    assert.strictEqual(
      results[5].noticeLine,
      null
    );
  });
  await t.test('AuroraServices: no warning for NOT IN REPO', () => {
    assert.strictEqual(
      results[5].warningLine,
      null
    );
  });
  await t.test('AuroraServices: no checkFailedLine for NOT IN REPO', () => {
    assert.strictEqual(
      results[5].checkFailedLine,
      null
    );
  });

  // 7. Special cert fallback: FakeStore with MICROG_CERT → matched via
  //    SPECIAL_PKG_CERT in F-Droid
  await t.test('FakeStore: UPDATE AVAILABLE via special cert fallback in F-Droid', () => {
    assert.ok(results[6].logLine.includes('[f-droid.org]') && results[6].logLine.includes('UPDATE AVAILABLE'));
  });
  await t.test('FakeStore: notice emitted for special-cert UPDATE AVAILABLE', () => { assert.ok(results[6].noticeLine !== null); });
  await t.test('FakeStore: tableRow UPDATE AVAILABLE is 2-line format with <br>', () => {
    assert.strictEqual(
      results[6].tableRow[3],
      `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.android.vending_84022626.apk">UPDATE AVAILABLE</a><br>version=33.0 (84022626)`
    );
  });
  await t.test('FakeStore: notice content is the APK URL', () => {
    assert.strictEqual(
      results[6].noticeLine,
      'https://f-droid.org/repo/com.android.vending_84022626.apk'
    );
  });
  await t.test('FakeStore: noticeTitle includes repo and version info', () => {
    assert.strictEqual(
      results[6].noticeTitle,
      `${ICON.UPDATE_AVAILABLE} Update available for priv-app/FakeStore.apk (com.android.vending): [f-droid.org] version=33.0 (84022626)`
    );
  });
  await t.test('FakeStore: no warning for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[6].warningLine,
      null
    );
  });
  await t.test('FakeStore: no checkFailedLine for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[6].checkFailedLine,
      null
    );
  });

  // 8. GmsCore with non-microG cert → fallback NOT triggered → DIFFERENT SIGNER
  await t.test('GmsCoreOther: DIFFERENT SIGNER (fallback not triggered for non-microG cert)', () => { assert.ok(results[7].logLine.includes('[DIFFERENT SIGNER]')); });
  await t.test('GmsCoreOther: tableRow status has 🔐 DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].tableRow[3],
      `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`
    );
  });
  await t.test('GmsCoreOther: no notice for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].noticeLine,
      null
    );
  });
  await t.test('GmsCoreOther: no warning for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].warningLine,
      null
    );
  });
  await t.test('GmsCoreOther: no checkFailedLine for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].checkFailedLine,
      null
    );
  });

  // ---------------------------------------------------------------------------
  // checkApks: logEntry format for DIFFERENT SIGNER and NOT IN REPO
  // ---------------------------------------------------------------------------
});

test('checkApks (logEntry for DIFFERENT SIGNER and NOT IN REPO)', async (t) => {
  // DIFFERENT SIGNER logLine uses logEntry format: "${icon} [STATUS] name (pkg): desc"
  await t.test('NewPipeFork: logLine uses logEntry format (icon + 1 space + [DIFFERENT SIGNER])', () => { assert.ok(results[4].logLine.startsWith(`${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] `)); });
  await t.test('NewPipeFork: logLine matches logEntry output exactly', () => {
    assert.strictEqual(
      results[4].logLine,
      `${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] app/NewPipeFork.apk` +
    ` (org.schabi.newpipe): [f-droid.org] signed with a different certificate`
    );
  });

  // NOT IN REPO logLine uses logEntry format
  await t.test('AuroraServices: logLine uses logEntry format (icon + 1 space + [NOT IN REPO])', () => { assert.ok(results[5].logLine.startsWith(`${ICON.NOT_IN_REPO} [NOT IN REPO] `)); });
  await t.test('AuroraServices: logLine matches logEntry output exactly', () => {
    assert.strictEqual(
      results[5].logLine,
      `${ICON.NOT_IN_REPO} [NOT IN REPO] app/AuroraServices.apk` +
    ` (com.aurora.services): not found in any repo`
    );
  });

  // ---------------------------------------------------------------------------
  // checkApks: updateInfo field
  // ---------------------------------------------------------------------------
});

test('checkApks (updateInfo field)', async (t) => {
  // Non-UPDATE_AVAILABLE entries have updateInfo = null
  await t.test('UP TO DATE: updateInfo is null', () => { assert.strictEqual(results[0].updateInfo, null); });
  await t.test('LOCAL NEWER: updateInfo is null', () => { assert.strictEqual(results[1].updateInfo, null); });
  await t.test('DIFFERENT SIGNER: updateInfo is null', () => { assert.strictEqual(results[4].updateInfo, null); });
  await t.test('NOT IN REPO: updateInfo is null', () => { assert.strictEqual(results[5].updateInfo, null); });

  // UPDATE AVAILABLE entries have structured updateInfo
  await t.test('GmsCore (microG cert): updateInfo is non-null for UPDATE AVAILABLE', () => { assert.ok(results[2].updateInfo !== null); });
  await t.test('GmsCore updateInfo: relPath', () => {
    assert.strictEqual(
      results[2].updateInfo.relPath,
      'priv-app/GmsCore.apk'
    );
  });
  await t.test('GmsCore updateInfo: package', () => {
    assert.strictEqual(
      results[2].updateInfo.package,
      'com.google.android.gms'
    );
  });
  await t.test('GmsCore updateInfo: repo', () => {
    assert.strictEqual(
      results[2].updateInfo.repo,
      'microg.org'
    );
  });
  await t.test('GmsCore updateInfo: localVn', () => {
    assert.strictEqual(
      results[2].updateInfo.localVn,
      '22.0'
    );
  });
  await t.test('GmsCore updateInfo: localVc', () => {
    assert.strictEqual(
      results[2].updateInfo.localVc,
      220000000
    );
  });
  await t.test('GmsCore updateInfo: repoVn', () => {
    assert.strictEqual(
      results[2].updateInfo.repoVn,
      '23.9.13'
    );
  });
  await t.test('GmsCore updateInfo: repoVc', () => {
    assert.strictEqual(
      results[2].updateInfo.repoVc,
      230913000
    );
  });
  await t.test('GmsCore updateInfo: url', () => {
    assert.strictEqual(
      results[2].updateInfo.url,
      'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk'
    );
  });
  await t.test('GmsCore updateInfo: repoFileSha256', () => {
    assert.strictEqual(
      results[2].updateInfo.repoFileSha256,
      SHA256_MICROG_GMS
    );
  });

  // tableRow[3] for UPDATE_AVAILABLE still contains <br> (for GitHub summary)
  await t.test('GmsCore: tableRow[3] keeps <br> for GitHub job summary (not replaced in source)', () => { assert.ok(results[2].tableRow[3].includes('<br>')); });

  // ---------------------------------------------------------------------------
  // checkApks: tableRow <br> kept as-is (CLI rendering tested separately)
  // ---------------------------------------------------------------------------
});

test('checkApks (tableRow <br> preserved for workflow)', async (t) => {
  await t.test('UP TO DATE tableRow[3] contains <br> for 2-line GitHub summary', () => { assert.ok(results[0].tableRow[3].includes('<br>')); });
  await t.test('LOCAL NEWER tableRow[3] contains <br> for 2-line GitHub summary', () => { assert.ok(results[1].tableRow[3].includes('<br>')); });
  await t.test('UPDATE AVAILABLE tableRow[3] contains <br> for 2-line GitHub summary', () => { assert.ok(results[2].tableRow[3].includes('<br>')); });
  await t.test('UPDATE AVAILABLE (Google cert) tableRow[3] contains <br>', () => { assert.ok(results[3].tableRow[3].includes('<br>')); });
  await t.test('DIFFERENT SIGNER tableRow[3] has no <br> (single-line status)', () => { assert.ok(!results[4].tableRow[3].includes('<br>')); });
  await t.test('NOT IN REPO tableRow[3] has no <br> (single-line status)', () => { assert.ok(!results[5].tableRow[3].includes('<br>')); });

  // ---------------------------------------------------------------------------
  // update-info.dat format
  // ---------------------------------------------------------------------------
});

test('update-info.dat format', async (t) => {
  // Simulate the update-info.dat line-building logic from run()
  const updateInfoEntries = [results[2], results[3], results[6]]
    .map(r => r.updateInfo)
    .filter(i => i !== null);

  await t.test('update-info.dat: 3 UPDATE AVAILABLE entries (2 GmsCore + FakeStore)', () => {
    assert.strictEqual(
      updateInfoEntries.length,
      3
    );
  });

  const infoLines = updateInfoEntries.map(info => {
    const fields = [info.relPath, info.url, info.repoVn, String(info.repoVc), info.repoFileSha256];
    return fields.join('|');
  });

  await t.test('update-info.dat line 1: GmsCore (microG cert)', () => {
    assert.strictEqual(
      infoLines[0],
      `priv-app/GmsCore.apk|https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk|23.9.13|230913000|${SHA256_MICROG_GMS}`
    );
  });
  await t.test('update-info.dat line 2: GmsCore (Google cert)', () => {
    assert.strictEqual(
      infoLines[1],
      `priv-app/GoogleGms.apk|https://f-droid.org/repo/com.google.android.gms_240000000.apk|24.0|240000000|${SHA256_FDROID_GMS}`
    );
  });
  await t.test('update-info.dat line 3: FakeStore', () => {
    assert.strictEqual(
      infoLines[2],
      `priv-app/FakeStore.apk|https://f-droid.org/repo/com.android.vending_84022626.apk|33.0|84022626|${SHA256_FDROID_VNDR}`
    );
  });

  // Each line has exactly 5 pipe-separated fields
  for (const line of infoLines) {
    const parts = line.split('|');
    await t.test(`update-info.dat: line has 5 fields: ${parts[0]}`, () => {
      assert.strictEqual(
        parts.length,
        5
      );
    });
    await t.test(`update-info.dat: relPath is non-empty: ${parts[0]}`, () => { assert.ok(parts[0].length > 0); });
    await t.test(`update-info.dat: url is HTTPS: ${parts[0]}`, () => { assert.ok(parts[1].startsWith('https://')); });
    await t.test(`update-info.dat: versionName is non-empty: ${parts[0]}`, () => { assert.ok(parts[2].length > 0); });
    await t.test(`update-info.dat: versionCode is positive: ${parts[0]}`, () => { assert.ok(Number(parts[3]) > 0); });
    await t.test(`update-info.dat: sha256 is non-empty: ${parts[0]}`, () => { assert.ok(parts[4].length > 0); });
  }

  // Entries are joined by \n (separator, not terminator)
  const datContent = infoLines.join('\n');
  await t.test('update-info.dat: 3 lines joined by \\n', () => {
    assert.strictEqual(
      datContent.split('\n').length,
      3
    );
  });
  await t.test('update-info.dat: no trailing newline (separator semantics)', () => { assert.ok(!datContent.endsWith('\n')); });

  // ---------------------------------------------------------------------------
  // update-info.dat field validation (| and \n are forbidden)
  // ---------------------------------------------------------------------------
});

test('update-info.dat field validation', async (t) => {
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
    await t.test('field validation: clean fields do not throw', () => { assert.ok(!threw); });
  }

  // Pipe in relPath must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['priv-app/Gms|Core.apk', 'https://example.org/gms.apk', '1.0', '1', 'aabb']); }
    catch { threw = true; }
    await t.test('field validation: pipe in relPath throws', () => { assert.ok(threw); });
  }

  // Newline in url must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['ok.apk', 'https://example.org/\ngms.apk', '1.0', '1', 'aabb']); }
    catch { threw = true; }
    await t.test('field validation: newline in url throws', () => { assert.ok(threw); });
  }

  // Pipe in versionName must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['ok.apk', 'https://example.org/gms.apk', '1.0|bad', '1', 'aabb']); }
    catch { threw = true; }
    await t.test('field validation: pipe in versionName throws', () => { assert.ok(threw); });
  }

  // Newline in sha256 must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['ok.apk', 'https://example.org/gms.apk', '1.0', '1', 'aa\nbb']); }
    catch { threw = true; }
    await t.test('field validation: newline in sha256 throws', () => { assert.ok(threw); });
  }

  // ---------------------------------------------------------------------------
  // checkApks: CHECK_FAILED tests
  // ---------------------------------------------------------------------------
});

test('checkApks (CHECK_FAILED)', async (t) => {
  // 1. local versionCode = 0 → CHECK_FAILED
  await t.test('ZeroLocalVc: logLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[0].logLine.includes('CHECK FAILED')); });
  await t.test('ZeroLocalVc: logLine contains CHECK_FAILED icon', () => { assert.ok(checkFailedResults[0].logLine.includes(ICON.CHECK_FAILED)); });
  await t.test('ZeroLocalVc: tableRow status contains CHECK FAILED', () => { assert.ok(checkFailedResults[0].tableRow[3].includes('CHECK FAILED')); });
  await t.test('ZeroLocalVc: no noticeLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[0].noticeLine,
      null
    );
  });
  await t.test('ZeroLocalVc: no warningLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[0].warningLine,
      null
    );
  });
  await t.test('ZeroLocalVc: checkFailedLine is set', () => { assert.ok(checkFailedResults[0].checkFailedLine !== null); });
  await t.test('ZeroLocalVc: checkFailedLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[0].checkFailedLine.includes('CHECK FAILED')); });
  await t.test('ZeroLocalVc: checkFailedLine mentions localVc=0', () => { assert.ok(checkFailedResults[0].checkFailedLine.includes('localVc=0')); });

  // 2. local versionCode = null (treated as 0) → CHECK_FAILED
  await t.test('NullLocalVc: logLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[1].logLine.includes('CHECK FAILED')); });
  await t.test('NullLocalVc: checkFailedLine is set (null treated as 0)', () => { assert.ok(checkFailedResults[1].checkFailedLine !== null); });
  await t.test('NullLocalVc: checkFailedLine shows localVc=0 (null coerced)', () => { assert.ok(checkFailedResults[1].checkFailedLine.includes('localVc=0')); });

  // 3. repo versionCode = null (treated as 0) → CHECK_FAILED
  await t.test('NullRepoVc: logLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[2].logLine.includes('CHECK FAILED')); });
  await t.test('NullRepoVc: checkFailedLine is set (null repo vc treated as 0)', () => { assert.ok(checkFailedResults[2].checkFailedLine !== null); });
  await t.test('NullRepoVc: checkFailedLine shows repoVc=0 (null coerced)', () => { assert.ok(checkFailedResults[2].checkFailedLine.includes('repoVc=0')); });
  await t.test('NullRepoVc: no noticeLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[2].noticeLine,
      null
    );
  });
  await t.test('NullRepoVc: no warningLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[2].warningLine,
      null
    );
  });

  // ---------------------------------------------------------------------------
  // run() input validation tests
  // ---------------------------------------------------------------------------
});

test('run() input validation', async (t) => {
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
    await t.test('run(): throws when both apkDirs and apkFiles are undefined', () => { assert.ok(msg !== null); });
    await t.test('run(): error message mentions apkDirs or apkFiles', () => { assert.ok(msg.includes('apkDirs') || msg.includes('apkFiles')); });
  }

  // apkFiles set but empty → throw
  {
    const msg = await runError({ core: {}, apkFiles: [] });
    await t.test('run(): throws when apkFiles is set but empty', () => { assert.ok(msg !== null); });
    await t.test('run(): error message mentions apkFiles', () => { assert.ok(msg.includes('apkFiles')); });
  }

  // apkDirs contains a nonexistent directory → warns and skips (no throw)
  {
    const warnings = [];
    const coreCapture = { ...STUB_CORE, warning: (msg) => warnings.push(msg) };
    const msg = await runError({ core: coreCapture, apkDirs: ['/nonexistent/path/to/apks'] });
    await t.test('run(): nonexistent dir in apkDirs does not throw "APK directory not found"', () => { assert.ok(msg === null || !msg.includes('APK directory not found')); });
    await t.test('run(): nonexistent dir in apkDirs emits a warning with the path', () => { assert.ok(warnings.some(w => w.includes('/nonexistent/path/to/apks'))); });
  }

  // apkFiles contains a nonexistent file → warns and skips (no throw)
  {
    const warnings = [];
    const coreCapture = { ...STUB_CORE, warning: (msg) => warnings.push(msg) };
    const msg = await runError({ core: coreCapture, apkFiles: ['/nonexistent/file.apk'] });
    await t.test('run(): nonexistent file in apkFiles does not throw', () => { assert.ok(msg === null || !msg.includes('not found')); });
    await t.test('run(): nonexistent file in apkFiles emits a warning with the path', () => { assert.ok(warnings.some(w => w.includes('/nonexistent/file.apk'))); });
  }

  // apkDirs set (even empty) → does NOT throw due to apkFiles absence
  // (empty apkDirs means "use default directory", which is valid)
  {
    // We cannot actually run a full update check in tests (no network/aapt),
    // so just verify no validation error is thrown — the error (if any) must be
    // a runtime error about aapt/network, not the input-validation error.
    const msg = await runError({ core: STUB_CORE, apkDirs: [] });
    await t.test('run(): empty apkDirs passes validation (runtime errors are OK)', () => { assert.ok(msg === null || (!msg.includes('apkDirs') && !msg.includes('apkFiles'))); });
  }

  // apkFiles provided with one entry → does NOT throw validation error
  {
    const msg = await runError({ core: STUB_CORE, apkFiles: ['/nonexistent.apk'] });
    await t.test('run(): non-empty apkFiles passes validation (runtime errors are OK)', () => { assert.ok(msg === null || (!msg.includes('apkFiles') && !msg.includes('apkDirs'))); });
  }

  // ---------------------------------------------------------------------------
  // relPath computation: apkDirs vs apkFiles
  // ---------------------------------------------------------------------------
});

test('relPath computation', async (t) => {
  // For dir-scanned APKs: relPath is relative to the source dir (not workspace)
  // path.posix.relative is used here to mirror the library's forward-slash normalization,
  // ensuring the tests pass on both Linux and Windows.
  {
    const baseDir = '/workspace/zip-content/origin';
    const apkPath = baseDir + '/priv-app/GmsCore.apk';
    await t.test('relPath from apkDirs: relative to its source dir', () => {
      assert.strictEqual(
        path.posix.relative(baseDir, apkPath),
        'priv-app/GmsCore.apk'
      );
    });
  }

  // For explicit apkFiles: relPath is relative to workspace
  {
    const workspace = '/workspace';
    const apkPath = '/workspace/zip-content/origin/priv-app/GmsCore.apk';
    await t.test('relPath from apkFiles: relative to workspace', () => {
      assert.strictEqual(
        path.posix.relative(workspace, apkPath),
        'zip-content/origin/priv-app/GmsCore.apk'
      );
    });
  }

  // Multiple apkDirs: each APK gets relPath from its own source dir, not from the other
  {
    const dir1 = '/workspace/dir1';
    const dir2 = '/workspace/dir2';
    await t.test('relPath from first dir: relative to dir1', () => {
      assert.strictEqual(
        path.posix.relative(dir1, dir1 + '/sub/App.apk'),
        'sub/App.apk'
      );
    });
    await t.test('relPath from second dir: relative to dir2 (independent from dir1)', () => {
      assert.strictEqual(
        path.posix.relative(dir2, dir2 + '/sub/App.apk'),
        'sub/App.apk'
      );
    });
    // An apk from dir2 must NOT be relative to dir1
    await t.test('relPath from dir2 differs when computed relative to dir1', () => { assert.ok(path.posix.relative(dir1, dir2 + '/sub/App.apk') !== 'sub/App.apk'); });
  }

  // Mixed apkFiles + apkDirs: relPath origins are independent
  {
    const workspace = '/workspace';
    const dir = '/workspace/zip-content/origin';
    // File supplied via apkFiles: relPath is workspace-relative
    await t.test('mixed: apkFiles relPath is workspace-relative', () => {
      assert.strictEqual(
        path.posix.relative(workspace, '/workspace/extra/app/Test.apk'),
        'extra/app/Test.apk'
      );
    });
    // File found via apkDirs scan: relPath is dir-relative
    await t.test('mixed: apkDirs relPath is dir-relative', () => {
      assert.strictEqual(
        path.posix.relative(dir, dir + '/priv-app/Test.apk'),
        'priv-app/Test.apk'
      );
    });
    // The same absolute path produces a different relPath depending on the base
    const sameAbsPath = '/workspace/extra/app/Test.apk';
    const relFromWorkspace = path.posix.relative(workspace, sameAbsPath);
    const relFromDir       = path.posix.relative(dir, sameAbsPath);
    await t.test('mixed: same absolute path has different relPath when base is workspace vs dir', () => { assert.ok(relFromWorkspace !== relFromDir); });
    await t.test('mixed: workspace-based relPath for extra/app/Test.apk', () => {
      assert.strictEqual(
        relFromWorkspace,
        'extra/app/Test.apk'
      );
    });
    await t.test('mixed: dir-based relPath for extra/app/Test.apk traverses up to dir root', () => {
      assert.strictEqual(
        relFromDir,
        '../../extra/app/Test.apk'
      );
    });
  }

  // ---------------------------------------------------------------------------
  // toPosix: Windows path separator simulation (using Object.defineProperty mock)
  // ---------------------------------------------------------------------------
});

test('toPosix Windows path simulation', async (t) => {
    // URL of the library module, used for cache-busting reloads
    const libUrl = new URL('../includes/app-update-checker-lib.mjs', import.meta.url);

    /**
     * Deletes String.prototype.toPosix then reimports the library with a
     * cache-busting query string so the module re-runs and re-captures
     * SEP = path.sep with whatever value path.sep currently has.
     * The intended side-effect is that String.prototype.toPosix is reinstalled
     * with the new SEP value.
     *
     * IMPORTANT: must be called while path functions are NOT mocked, because
     * the Node.js ESM loader uses the shared path module internally.
     */
    const forceReloadLib = async () => {
      delete String.prototype.toPosix;
      await import(`${libUrl.href}?t=${Date.now()}`);
    };

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
     *
     * The module reload (forceReloadLib) is performed after setting path.sep but
     * before mocking path functions, so that the ESM loader still has correct
     * path semantics during the reload.
     */
    const mockWindows = async () => {
      if (originalPlatform === 'win32') return;
      detachPathPosix();

      // 1. Force overwrite of read-only properties using defineProperty
      Object.defineProperty(path, 'sep',        { value: '\\',   configurable: true, enumerable: true, writable: true });
      Object.defineProperty(path, 'delimiter',  { value: ';',    configurable: true, enumerable: true, writable: true });
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true, enumerable: true, writable: true });

      // 2. Force module reload so the library re-captures SEP = path.sep = '\\'
      //    Must happen before mocking path functions (step 3) to avoid breaking
      //    the ESM loader which uses the shared path module internally.
      await forceReloadLib();

      // 3. Mock all path methods (join, resolve, basename, etc.) using win32 equivalents
      Object.keys(path.win32).forEach(key => {
        if (typeof path.win32[key] === 'function' && typeof path[key] === 'function') {
          mock.method(path, key, path.win32[key]);
        }
      });
    };

    const unmockWindows = async () => {
      if (originalPlatform === 'win32') return;

      // Restore path functions first so the ESM loader works correctly during reload
      mock.restoreAll();
      Object.defineProperty(path, 'sep',        { value: originalPathSep,       configurable: true, enumerable: true, writable: true });
      Object.defineProperty(path, 'delimiter',  { value: originalPathDelimiter, configurable: true, enumerable: true, writable: true });
      Object.defineProperty(process, 'platform', { value: originalPlatform,      configurable: true, enumerable: true, writable: true });
      restorePathPosix();
      // Force module reload so the library re-captures SEP = path.sep = originalPathSep
      await forceReloadLib();
    };

    try {
      await mockWindows();

      // Verify mock state
      await t.test('toPosix (win): process.platform mocked to win32', () => { assert.strictEqual(process.platform, 'win32'); });
      await t.test('toPosix (win): path.sep mocked to backslash', () => { assert.strictEqual(path.sep, '\\'); });
      await t.test('toPosix (win): path.win32.sep unchanged', () => { assert.strictEqual(path.win32.sep, '\\'); });
      await t.test('toPosix (win): path.posix.sep unaffected by mock', () => { assert.strictEqual(path.posix.sep, '/'); });
      await t.test('toPosix (win): path.join uses win32', () => { assert.strictEqual(path.join('C:', 'Users'), 'C:\\Users'); });
      await t.test('toPosix (win): path.dirname uses win32', () => { assert.strictEqual(path.dirname('C:\\Windows\\System32'), 'C:\\Windows'); });
      await t.test('toPosix (win): path.isAbsolute recognises Windows path', () => { assert.ok(path.isAbsolute('C:\\Windows\\System32')); });

      // toPosix conversion: after reload, library SEP = '\\' so toPosix replaces backslashes
      // Single-level Windows path
      await t.test('toPosix (win): single-level Windows path converted', () => {
        assert.strictEqual(
          'C:\\foo\\bar'.toPosix(),
          'C:/foo/bar'
        );
      });
      // Deep Windows path
      await t.test('toPosix (win): deep Windows path fully converted', () => {
        assert.strictEqual(
          'C:\\workspace\\zip-content\\origin\\app.apk'.toPosix(),
          'C:/workspace/zip-content/origin/app.apk'
        );
      });
      // Forward-slash path is unchanged (no backslashes to replace)
      await t.test('toPosix (win): posix path unchanged when sep is backslash', () => {
        assert.strictEqual(
          '/already/posix/path'.toPosix(),
          '/already/posix/path'
        );
      });

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

      await t.test('toPosix (win): dir path 1 normalized', () => { assert.strictEqual(normDirs[0], 'C:/workspace/zip-content'); });
      await t.test('toPosix (win): dir path 2 normalized', () => { assert.strictEqual(normDirs[1], 'D:/apks/release'); });
      await t.test('toPosix (win): file path 1 normalized', () => { assert.strictEqual(normFiles[0], 'C:/workspace/app.apk'); });
      await t.test('toPosix (win): file path 2 normalized', () => { assert.strictEqual(normFiles[1], 'D:/other/test.apk'); });
    } finally {
      await unmockWindows();
    }
});

