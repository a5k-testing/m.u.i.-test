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
  EXIT_CODES,
  MICROG_CERT,
  SPECIAL_PKG_CERT,
  SKIP_LIST,
  repos,
  REPO_CACHE_TTL_MS,
} from '../includes/app-update-checker-lib.mjs';

import { default as run } from '../includes/app-update-checker-lib.mjs';

import path from 'node:path';
import { describe, it, before, after, mock } from 'node:test';
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

describe('SKIP_LIST', () => {
  it('SKIP_LIST has 4 entries', () => { assert.strictEqual(SKIP_LIST.size, 4); });
  it('SKIP_LIST: priv-app/FakeStore-0.3.6.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/FakeStore-0.3.6.apk')); });
  it('SKIP_LIST: priv-app/GmsCore-0.3.6.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/GmsCore-0.3.6.apk')); });
  it('SKIP_LIST: priv-app/GmsCoreVtm.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/GmsCoreVtm.apk')); });
  it('SKIP_LIST: priv-app/GmsCoreVtmLegacy.apk included', () => { assert.ok(SKIP_LIST.has('priv-app/GmsCoreVtmLegacy.apk')); });

  // Current (non-versioned) builds must NOT be skipped
  it('SKIP_LIST: priv-app/GmsCore.apk (no version suffix) is NOT skipped', () => { assert.ok(!SKIP_LIST.has('priv-app/GmsCore.apk')); });
  it('SKIP_LIST: priv-app/FakeStore.apk (no version suffix) is NOT skipped', () => { assert.ok(!SKIP_LIST.has('priv-app/FakeStore.apk')); });

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
  it('SKIP_LIST filter: 3 of 7 APKs kept', () => { assert.strictEqual(filtered.length, 3); });
  it('SKIP_LIST filter: FakeStore.apk (no suffix) kept', () => {
    assert.strictEqual(
      filtered[0].fileName,
      'FakeStore.apk'
    );
  });
  it('SKIP_LIST filter: GmsCore.apk (no suffix) kept', () => {
    assert.strictEqual(
      filtered[1].fileName,
      'GmsCore.apk'
    );
  });
  it('SKIP_LIST filter: Something.apk kept', () => {
    assert.strictEqual(
      filtered[2].fileName,
      'Something.apk'
    );
  });

  // ---------------------------------------------------------------------------
  // Constants: REPO_CACHE_TTL_MS
  // ---------------------------------------------------------------------------
});

describe('REPO_CACHE_TTL_MS', () => {
  it('REPO_CACHE_TTL_MS equals 7 days in milliseconds', () => {
    assert.strictEqual(
      REPO_CACHE_TTL_MS,
      7 * 24 * 60 * 60 * 1000
    );
  });
  it('REPO_CACHE_TTL_MS is positive', () => { assert.ok(REPO_CACHE_TTL_MS > 0); });

  // ---------------------------------------------------------------------------
  // URL utilities: shortUrl
  // ---------------------------------------------------------------------------
});

describe('shortUrl', () => {
  it('shortUrl: subdomain trimmed to base domain', () => {
    assert.strictEqual(
      shortUrl('https://repo.microg.org/fdroid/repo'),
      'microg.org'
    );
  });
  it('shortUrl: two-part hostname unchanged', () => {
    assert.strictEqual(
      shortUrl('https://f-droid.org/repo'),
      'f-droid.org'
    );
  });
  it('shortUrl: apt.izzysoft.de → izzysoft.de', () => {
    assert.strictEqual(
      shortUrl('https://apt.izzysoft.de/fdroid/repo'),
      'izzysoft.de'
    );
  });
  it('shortUrl: invalid URL returns input unchanged', () => { assert.ok(shortUrl('not-a-url') === 'not-a-url'); });

  // ---------------------------------------------------------------------------
  // URL utilities: index-v2.json URL construction
  // ---------------------------------------------------------------------------
});

describe('index-v2.json URL construction', () => {
  const indexUrls = repos.map(b => `${b}/index-v2.json`);

  it('microG: /index-v2.json appended correctly', () => {
    assert.strictEqual(
      indexUrls[0],
      'https://repo.microg.org/fdroid/repo/index-v2.json'
    );
  });
  it('F-Droid: /index-v2.json appended correctly', () => {
    assert.strictEqual(
      indexUrls[1],
      'https://f-droid.org/repo/index-v2.json'
    );
  });
  it('IzzyOnDroid: /index-v2.json appended correctly', () => {
    assert.strictEqual(
      indexUrls[2],
      'https://apt.izzysoft.de/fdroid/repo/index-v2.json'
    );
  });

  // ---------------------------------------------------------------------------
  // URL utilities: fetchUrl HTTPS enforcement
  // ---------------------------------------------------------------------------
});

describe('fetchUrl: HTTPS enforcement', () => {
  // All configured repo URLs must be HTTPS
  for (const baseUrl of repos) {
    it(`Repo base URL is HTTPS: ${baseUrl}`, () => { assert.ok(baseUrl.startsWith('https://')); });
  }

  // URL validation (mirrors the check inside fetchUrl)
  function isHttpsUrl(url) {
    return url.startsWith('https://');
  }
  it('HTTP URL fails HTTPS check', () => { assert.ok(!isHttpsUrl('http://example.com/repo')); });
  it('FTP URL fails HTTPS check', () => { assert.ok(!isHttpsUrl('ftp://example.com/repo')); });
  it('HTTPS URL passes check', () => { assert.ok(isHttpsUrl('https://f-droid.org/repo')); });

  // Max redirects constant
  const MAX_REDIRECTS = 3;
  it('Max redirects is 3', () => { assert.strictEqual(MAX_REDIRECTS, 3); });

  // ---------------------------------------------------------------------------
  // parseRepoV2 unit tests
  // ---------------------------------------------------------------------------
});

describe('parseRepoV2', () => {
  const fdroidApps = REPOS[0].apps;
  const microgApps = REPOS[1].apps;

  // Basic map size
  it('F-Droid: parsed 4 packages', () => { assert.strictEqual(fdroidApps.size, 4); });
  it('microG: parsed 1 package', () => { assert.strictEqual(microgApps.size, 1); });

  // latestVc / latestVn
  {
    const np = fdroidApps.get('org.schabi.newpipe');
    it('NewPipe: latestVc = 1000 (newest version wins)', () => { assert.strictEqual(np.latestVc, 1000); });
    it('NewPipe: latestVn = 0.25.0', () => { assert.strictEqual(np.latestVn, '0.25.0'); });
  }

  // byCert — highest versionCode per cert
  {
    const np = fdroidApps.get('org.schabi.newpipe');
    it('NewPipe: byCert keeps highest vc (1000, not 990)', () => {
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
    it('Mixed-case: package exists', () => { assert.ok(pkg !== undefined); });
    it('Mixed-case: cert normalised to lower-case', () => { assert.ok('aabb' in pkg.byCert); });
  }

  // Unknown package returns undefined
  it('Non-existent package returns undefined', () => { assert.ok(fdroidApps.get('com.nonexistent.pkg') === undefined); });

  // ---------------------------------------------------------------------------
  // checkApks: main matching loop
  // ---------------------------------------------------------------------------
});

describe('checkApks (matching loop)', () => {
  // 1. Up to date
  it('FDroid priv: UP TO DATE logLine contains [f-droid.org] and [UP TO DATE]', () => {
    assert.ok(results[0].logLine.includes('[f-droid.org]') && results[0].logLine.includes('[UP TO DATE]'));
  });
  it('FDroid priv: ✅ icon present', () => { assert.ok(results[0].logLine.includes(ICON.UP_TO_DATE)); });
  it('FDroid priv: logLine uses relPath', () => { assert.ok(results[0].logLine.includes('priv-app/FDroidPrivilegedExtension.apk')); });
  it('FDroid priv: logLine contains repo version info', () => { assert.ok(results[0].logLine.includes('version=0.2.13 (2130)')); });
  it('FDroid priv: tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[0].tableRow[0],
      'priv-app/FDroidPrivilegedExtension.apk'
    );
  });
  it('FDroid priv: tableRow repo = f-droid (compact label)', () => {
    assert.strictEqual(
      results[0].tableRow[2],
      'f-droid'
    );
  });
  it('FDroid priv: tableRow status has no link (up to date)', () => { assert.ok(!results[0].tableRow[3].includes('<a href=')); });
  it('FDroid priv: tableRow UP TO DATE is 2-line format', () => {
    assert.strictEqual(
      results[0].tableRow[3],
      `${ICON.UP_TO_DATE} UP TO DATE<br>version=0.2.13 (2130)`
    );
  });
  it('FDroid priv: no notice for UP TO DATE', () => {
    assert.strictEqual(
      results[0].noticeLine,
      null
    );
  });
  it('FDroid priv: no warning for UP TO DATE', () => {
    assert.strictEqual(
      results[0].warningLine,
      null
    );
  });
  it('FDroid priv: no checkFailedLine for UP TO DATE', () => {
    assert.strictEqual(
      results[0].checkFailedLine,
      null
    );
  });

  // 2. Local newer
  it('NewPipe: LOCAL NEWER logLine has [f-droid.org] and [LOCAL NEWER]', () => {
    assert.ok(results[1].logLine.includes('[f-droid.org]') && results[1].logLine.includes('[LOCAL NEWER]'));
  });
  it('NewPipe: 🚀 icon present', () => { assert.ok(results[1].logLine.includes(ICON.LOCAL_NEWER)); });
  it('NewPipe: logLine uses relPath', () => { assert.ok(results[1].logLine.includes('app/NewPipe.apk')); });
  it('NewPipe: logLine has local versionInfo', () => { assert.ok(results[1].logLine.includes('local=0.25.1 (1001)')); });
  it('NewPipe: logLine has repo versionInfo', () => { assert.ok(results[1].logLine.includes('repo=')); });
  it('NewPipe: tableRow[0] shows relPath (app/NewPipe.apk)', () => {
    assert.strictEqual(
      results[1].tableRow[0],
      'app/NewPipe.apk'
    );
  });
  it('NewPipe: no notice for LOCAL NEWER', () => {
    assert.strictEqual(
      results[1].noticeLine,
      null
    );
  });
  it('NewPipe: tableRow status is plain text (local newer, no link)', () => { assert.ok(!results[1].tableRow[3].includes('<a href=')); });
  it('NewPipe: tableRow status has LOCAL NEWER icon', () => { assert.ok(results[1].tableRow[3].includes(ICON.LOCAL_NEWER)); });
  it('NewPipe: tableRow LOCAL NEWER is 2-line format with <br>', () => { assert.ok(results[1].tableRow[3].includes('<br>')); });
  it('NewPipe: warning emitted for LOCAL NEWER', () => { assert.ok(results[1].warningLine !== null); });
  it('NewPipe: warning text contains LOCAL NEWER', () => { assert.ok(results[1].warningLine.includes('LOCAL NEWER')); });
  it('NewPipe: no checkFailedLine for LOCAL NEWER', () => {
    assert.strictEqual(
      results[1].checkFailedLine,
      null
    );
  });

  // 3. microG-signed GmsCore: matched in microG repo, update available
  it('GmsCore (microG cert): UPDATE AVAILABLE from microG repo (short URL)', () => {
    assert.ok(results[2].logLine.includes('[microg.org]') && results[2].logLine.includes('UPDATE AVAILABLE'));
  });
  it('GmsCore (microG cert): ✨ icon present', () => { assert.ok(results[2].logLine.includes(ICON.UPDATE_AVAILABLE)); });
  it('GmsCore (microG cert): tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[2].tableRow[0],
      'priv-app/GmsCore.apk'
    );
  });
  it('GmsCore (microG cert): tableRow repo = microg (compact label)', () => {
    assert.strictEqual(
      results[2].tableRow[2],
      'microg'
    );
  });
  it('GmsCore (microG cert): notice emitted for UPDATE AVAILABLE', () => { assert.ok(results[2].noticeLine !== null); });
  it('GmsCore (microG cert): tableRow UPDATE AVAILABLE is 2-line format with <br>', () => {
    assert.strictEqual(
      results[2].tableRow[3],
      `${ICON.UPDATE_AVAILABLE} <a href="https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk">UPDATE AVAILABLE</a><br>version=23.9.13 (230913000)`
    );
  });
  it('GmsCore (microG cert): notice content is bare URL (no spaces)', () => { assert.ok(!results[2].noticeLine.includes(' ')); });
  it('GmsCore (microG cert): notice content is the APK URL', () => {
    assert.strictEqual(
      results[2].noticeLine,
      'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk'
    );
  });
  it('GmsCore (microG cert): noticeTitle includes repo and version info', () => {
    assert.strictEqual(
      results[2].noticeTitle,
      `${ICON.UPDATE_AVAILABLE} Update available for priv-app/GmsCore.apk (com.google.android.gms): [microg.org] version=23.9.13 (230913000)`
    );
  });
  it('GmsCore (microG cert): no warning for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[2].warningLine,
      null
    );
  });
  it('GmsCore (microG cert): no checkFailedLine for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[2].checkFailedLine,
      null
    );
  });

  // 4. Google-cert GmsCore: matched in F-Droid (first repo)
  it('GmsCore (Google cert): UPDATE AVAILABLE from F-Droid (short URL)', () => {
    assert.ok(results[3].logLine.includes('[f-droid.org]') && results[3].logLine.includes('[UPDATE AVAILABLE]'));
  });
  it('GmsCore (Google cert): notice emitted', () => { assert.ok(results[3].noticeLine !== null); });
  it('GmsCore (Google cert): tableRow UPDATE AVAILABLE is 2-line format with <br>', () => {
    assert.strictEqual(
      results[3].tableRow[3],
      `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.google.android.gms_240000000.apk">UPDATE AVAILABLE</a><br>version=24.0 (240000000)`
    );
  });
  it('GmsCore (Google cert): notice content is the APK URL', () => {
    assert.strictEqual(
      results[3].noticeLine,
      'https://f-droid.org/repo/com.google.android.gms_240000000.apk'
    );
  });
  it('GmsCore (Google cert): noticeTitle includes repo and version info', () => {
    assert.strictEqual(
      results[3].noticeTitle,
      `${ICON.UPDATE_AVAILABLE} Update available for priv-app/GoogleGms.apk (com.google.android.gms): [f-droid.org] version=24.0 (240000000)`
    );
  });

  // 5. Different signer
  it('NewPipeFork: DIFFERENT SIGNER listing [f-droid.org] in brackets', () => {
    assert.ok(results[4].logLine.includes('[DIFFERENT SIGNER]') && results[4].logLine.includes('[f-droid.org]'));
  });
  it('NewPipeFork: 🔐 icon present in log line', () => { assert.ok(results[4].logLine.includes(ICON.DIFFERENT_SIGNER)); });
  it('NewPipeFork: logLine uses relPath', () => { assert.ok(results[4].logLine.includes('app/NewPipeFork.apk')); });
  it('NewPipeFork: logLine contains "signed with a different certificate"', () => { assert.ok(results[4].logLine.includes('signed with a different certificate')); });
  it('NewPipeFork: tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[4].tableRow[0],
      'app/NewPipeFork.apk'
    );
  });
  it('NewPipeFork: tableRow repo = f-droid (compact label)', () => {
    assert.strictEqual(
      results[4].tableRow[2],
      'f-droid'
    );
  });
  it('NewPipeFork: tableRow status has 🔐 DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].tableRow[3],
      `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`
    );
  });
  it('NewPipeFork: no notice for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].noticeLine,
      null
    );
  });
  it('NewPipeFork: no warning for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].warningLine,
      null
    );
  });
  it('NewPipeFork: no checkFailedLine for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[4].checkFailedLine,
      null
    );
  });

  // 6. Not in repo
  it('AuroraServices: NOT IN REPO', () => { assert.ok(results[5].logLine.includes('[NOT IN REPO]')); });
  it('AuroraServices: ❓ icon present in log line', () => { assert.ok(results[5].logLine.includes(ICON.NOT_IN_REPO)); });
  it('AuroraServices: logLine uses relPath', () => { assert.ok(results[5].logLine.includes('app/AuroraServices.apk')); });
  it('AuroraServices: tableRow[0] shows relPath', () => {
    assert.strictEqual(
      results[5].tableRow[0],
      'app/AuroraServices.apk'
    );
  });
  it('AuroraServices: tableRow status has ❓ NOT IN REPO', () => {
    assert.strictEqual(
      results[5].tableRow[3],
      `${ICON.NOT_IN_REPO} NOT IN REPO`
    );
  });
  it('AuroraServices: tableRow repo = -', () => {
    assert.strictEqual(
      results[5].tableRow[2],
      '-'
    );
  });
  it('AuroraServices: no notice for NOT IN REPO', () => {
    assert.strictEqual(
      results[5].noticeLine,
      null
    );
  });
  it('AuroraServices: no warning for NOT IN REPO', () => {
    assert.strictEqual(
      results[5].warningLine,
      null
    );
  });
  it('AuroraServices: no checkFailedLine for NOT IN REPO', () => {
    assert.strictEqual(
      results[5].checkFailedLine,
      null
    );
  });

  // 7. Special cert fallback: FakeStore with MICROG_CERT → matched via
  //    SPECIAL_PKG_CERT in F-Droid
  it('FakeStore: UPDATE AVAILABLE via special cert fallback in F-Droid', () => {
    assert.ok(results[6].logLine.includes('[f-droid.org]') && results[6].logLine.includes('UPDATE AVAILABLE'));
  });
  it('FakeStore: notice emitted for special-cert UPDATE AVAILABLE', () => { assert.ok(results[6].noticeLine !== null); });
  it('FakeStore: tableRow UPDATE AVAILABLE is 2-line format with <br>', () => {
    assert.strictEqual(
      results[6].tableRow[3],
      `${ICON.UPDATE_AVAILABLE} <a href="https://f-droid.org/repo/com.android.vending_84022626.apk">UPDATE AVAILABLE</a><br>version=33.0 (84022626)`
    );
  });
  it('FakeStore: notice content is the APK URL', () => {
    assert.strictEqual(
      results[6].noticeLine,
      'https://f-droid.org/repo/com.android.vending_84022626.apk'
    );
  });
  it('FakeStore: noticeTitle includes repo and version info', () => {
    assert.strictEqual(
      results[6].noticeTitle,
      `${ICON.UPDATE_AVAILABLE} Update available for priv-app/FakeStore.apk (com.android.vending): [f-droid.org] version=33.0 (84022626)`
    );
  });
  it('FakeStore: no warning for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[6].warningLine,
      null
    );
  });
  it('FakeStore: no checkFailedLine for UPDATE AVAILABLE', () => {
    assert.strictEqual(
      results[6].checkFailedLine,
      null
    );
  });

  // 8. GmsCore with non-microG cert → fallback NOT triggered → DIFFERENT SIGNER
  it('GmsCoreOther: DIFFERENT SIGNER (fallback not triggered for non-microG cert)', () => { assert.ok(results[7].logLine.includes('[DIFFERENT SIGNER]')); });
  it('GmsCoreOther: tableRow status has 🔐 DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].tableRow[3],
      `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`
    );
  });
  it('GmsCoreOther: no notice for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].noticeLine,
      null
    );
  });
  it('GmsCoreOther: no warning for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].warningLine,
      null
    );
  });
  it('GmsCoreOther: no checkFailedLine for DIFFERENT SIGNER', () => {
    assert.strictEqual(
      results[7].checkFailedLine,
      null
    );
  });

  // ---------------------------------------------------------------------------
  // checkApks: logEntry format for DIFFERENT SIGNER and NOT IN REPO
  // ---------------------------------------------------------------------------
});

describe('checkApks (logEntry for DIFFERENT SIGNER and NOT IN REPO)', () => {
  // DIFFERENT SIGNER logLine uses logEntry format: "${icon} [STATUS] name (pkg): desc"
  it('NewPipeFork: logLine uses logEntry format (icon + 1 space + [DIFFERENT SIGNER])', () => { assert.ok(results[4].logLine.startsWith(`${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] `)); });
  it('NewPipeFork: logLine matches logEntry output exactly', () => {
    assert.strictEqual(
      results[4].logLine,
      `${ICON.DIFFERENT_SIGNER} [DIFFERENT SIGNER] app/NewPipeFork.apk` +
    ` (org.schabi.newpipe): [f-droid.org] signed with a different certificate`
    );
  });

  // NOT IN REPO logLine uses logEntry format
  it('AuroraServices: logLine uses logEntry format (icon + 1 space + [NOT IN REPO])', () => { assert.ok(results[5].logLine.startsWith(`${ICON.NOT_IN_REPO} [NOT IN REPO] `)); });
  it('AuroraServices: logLine matches logEntry output exactly', () => {
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

describe('checkApks (updateInfo field)', () => {
  // Non-UPDATE_AVAILABLE entries have updateInfo = null
  it('UP TO DATE: updateInfo is null', () => { assert.strictEqual(results[0].updateInfo, null); });
  it('LOCAL NEWER: updateInfo is null', () => { assert.strictEqual(results[1].updateInfo, null); });
  it('DIFFERENT SIGNER: updateInfo is null', () => { assert.strictEqual(results[4].updateInfo, null); });
  it('NOT IN REPO: updateInfo is null', () => { assert.strictEqual(results[5].updateInfo, null); });

  // UPDATE AVAILABLE entries have structured updateInfo
  it('GmsCore (microG cert): updateInfo is non-null for UPDATE AVAILABLE', () => { assert.ok(results[2].updateInfo !== null); });
  it('GmsCore updateInfo: relPath', () => {
    assert.strictEqual(
      results[2].updateInfo.relPath,
      'priv-app/GmsCore.apk'
    );
  });
  it('GmsCore updateInfo: package', () => {
    assert.strictEqual(
      results[2].updateInfo.package,
      'com.google.android.gms'
    );
  });
  it('GmsCore updateInfo: repo', () => {
    assert.strictEqual(
      results[2].updateInfo.repo,
      'microg.org'
    );
  });
  it('GmsCore updateInfo: localVn', () => {
    assert.strictEqual(
      results[2].updateInfo.localVn,
      '22.0'
    );
  });
  it('GmsCore updateInfo: localVc', () => {
    assert.strictEqual(
      results[2].updateInfo.localVc,
      220000000
    );
  });
  it('GmsCore updateInfo: repoVn', () => {
    assert.strictEqual(
      results[2].updateInfo.repoVn,
      '23.9.13'
    );
  });
  it('GmsCore updateInfo: repoVc', () => {
    assert.strictEqual(
      results[2].updateInfo.repoVc,
      230913000
    );
  });
  it('GmsCore updateInfo: url', () => {
    assert.strictEqual(
      results[2].updateInfo.url,
      'https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk'
    );
  });
  it('GmsCore updateInfo: repoFileSha256', () => {
    assert.strictEqual(
      results[2].updateInfo.repoFileSha256,
      SHA256_MICROG_GMS
    );
  });

  // tableRow[3] for UPDATE_AVAILABLE still contains <br> (for GitHub summary)
  it('GmsCore: tableRow[3] keeps <br> for GitHub job summary (not replaced in source)', () => { assert.ok(results[2].tableRow[3].includes('<br>')); });

  // ---------------------------------------------------------------------------
  // checkApks: tableRow <br> kept as-is (CLI rendering tested separately)
  // ---------------------------------------------------------------------------
});

describe('checkApks (tableRow <br> preserved for workflow)', () => {
  it('UP TO DATE tableRow[3] contains <br> for 2-line GitHub summary', () => { assert.ok(results[0].tableRow[3].includes('<br>')); });
  it('LOCAL NEWER tableRow[3] contains <br> for 2-line GitHub summary', () => { assert.ok(results[1].tableRow[3].includes('<br>')); });
  it('UPDATE AVAILABLE tableRow[3] contains <br> for 2-line GitHub summary', () => { assert.ok(results[2].tableRow[3].includes('<br>')); });
  it('UPDATE AVAILABLE (Google cert) tableRow[3] contains <br>', () => { assert.ok(results[3].tableRow[3].includes('<br>')); });
  it('DIFFERENT SIGNER tableRow[3] has no <br> (single-line status)', () => { assert.ok(!results[4].tableRow[3].includes('<br>')); });
  it('NOT IN REPO tableRow[3] has no <br> (single-line status)', () => { assert.ok(!results[5].tableRow[3].includes('<br>')); });

  // ---------------------------------------------------------------------------
  // update-info.dat format
  // ---------------------------------------------------------------------------
});

describe('update-info.dat format', () => {
  // Simulate the update-info.dat line-building logic from run()
  const updateInfoEntries = [results[2], results[3], results[6]]
    .map(r => r.updateInfo)
    .filter(i => i !== null);

  it('update-info.dat: 3 UPDATE AVAILABLE entries (2 GmsCore + FakeStore)', () => {
    assert.strictEqual(
      updateInfoEntries.length,
      3
    );
  });

  const infoLines = updateInfoEntries.map(info => {
    const fields = [info.relPath, info.url, info.repoVn, String(info.repoVc), info.repoFileSha256];
    return fields.join('|');
  });

  it('update-info.dat line 1: GmsCore (microG cert)', () => {
    assert.strictEqual(
      infoLines[0],
      `priv-app/GmsCore.apk|https://repo.microg.org/fdroid/repo/com.google.android.gms_230913000.apk|23.9.13|230913000|${SHA256_MICROG_GMS}`
    );
  });
  it('update-info.dat line 2: GmsCore (Google cert)', () => {
    assert.strictEqual(
      infoLines[1],
      `priv-app/GoogleGms.apk|https://f-droid.org/repo/com.google.android.gms_240000000.apk|24.0|240000000|${SHA256_FDROID_GMS}`
    );
  });
  it('update-info.dat line 3: FakeStore', () => {
    assert.strictEqual(
      infoLines[2],
      `priv-app/FakeStore.apk|https://f-droid.org/repo/com.android.vending_84022626.apk|33.0|84022626|${SHA256_FDROID_VNDR}`
    );
  });

  // Each line has exactly 5 pipe-separated fields
  for (const line of infoLines) {
    const parts = line.split('|');
    it(`update-info.dat: line has 5 fields: ${parts[0]}`, () => {
      assert.strictEqual(
        parts.length,
        5
      );
    });
    it(`update-info.dat: relPath is non-empty: ${parts[0]}`, () => { assert.ok(parts[0].length > 0); });
    it(`update-info.dat: url is HTTPS: ${parts[0]}`, () => { assert.ok(parts[1].startsWith('https://')); });
    it(`update-info.dat: versionName is non-empty: ${parts[0]}`, () => { assert.ok(parts[2].length > 0); });
    it(`update-info.dat: versionCode is positive: ${parts[0]}`, () => { assert.ok(Number(parts[3]) > 0); });
    it(`update-info.dat: sha256 is non-empty: ${parts[0]}`, () => { assert.ok(parts[4].length > 0); });
  }

  // Entries are joined by \n (separator, not terminator)
  const datContent = infoLines.join('\n');
  it('update-info.dat: 3 lines joined by \\n', () => {
    assert.strictEqual(
      datContent.split('\n').length,
      3
    );
  });
  it('update-info.dat: no trailing newline (separator semantics)', () => { assert.ok(!datContent.endsWith('\n')); });

  // ---------------------------------------------------------------------------
  // update-info.dat field validation (| and \n are forbidden)
  // ---------------------------------------------------------------------------
});

describe('update-info.dat field validation', () => {
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
    it('field validation: clean fields do not throw', () => { assert.ok(!threw); });
  }

  // Pipe in relPath must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['priv-app/Gms|Core.apk', 'https://example.org/gms.apk', '1.0', '1', 'aabb']); }
    catch { threw = true; }
    it('field validation: pipe in relPath throws', () => { assert.ok(threw); });
  }

  // Newline in url must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['ok.apk', 'https://example.org/\ngms.apk', '1.0', '1', 'aabb']); }
    catch { threw = true; }
    it('field validation: newline in url throws', () => { assert.ok(threw); });
  }

  // Pipe in versionName must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['ok.apk', 'https://example.org/gms.apk', '1.0|bad', '1', 'aabb']); }
    catch { threw = true; }
    it('field validation: pipe in versionName throws', () => { assert.ok(threw); });
  }

  // Newline in sha256 must throw
  {
    let threw = false;
    try { validateUpdateInfoFields(['ok.apk', 'https://example.org/gms.apk', '1.0', '1', 'aa\nbb']); }
    catch { threw = true; }
    it('field validation: newline in sha256 throws', () => { assert.ok(threw); });
  }

  // ---------------------------------------------------------------------------
  // checkApks: CHECK_FAILED tests
  // ---------------------------------------------------------------------------
});

describe('checkApks (CHECK_FAILED)', () => {
  // 1. local versionCode = 0 → CHECK_FAILED
  it('ZeroLocalVc: logLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[0].logLine.includes('CHECK FAILED')); });
  it('ZeroLocalVc: logLine contains CHECK_FAILED icon', () => { assert.ok(checkFailedResults[0].logLine.includes(ICON.CHECK_FAILED)); });
  it('ZeroLocalVc: tableRow status contains CHECK FAILED', () => { assert.ok(checkFailedResults[0].tableRow[3].includes('CHECK FAILED')); });
  it('ZeroLocalVc: no noticeLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[0].noticeLine,
      null
    );
  });
  it('ZeroLocalVc: no warningLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[0].warningLine,
      null
    );
  });
  it('ZeroLocalVc: checkFailedLine is set', () => { assert.ok(checkFailedResults[0].checkFailedLine !== null); });
  it('ZeroLocalVc: checkFailedLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[0].checkFailedLine.includes('CHECK FAILED')); });
  it('ZeroLocalVc: checkFailedLine mentions localVc=0', () => { assert.ok(checkFailedResults[0].checkFailedLine.includes('localVc=0')); });

  // 2. local versionCode = null (treated as 0) → CHECK_FAILED
  it('NullLocalVc: logLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[1].logLine.includes('CHECK FAILED')); });
  it('NullLocalVc: checkFailedLine is set (null treated as 0)', () => { assert.ok(checkFailedResults[1].checkFailedLine !== null); });
  it('NullLocalVc: checkFailedLine shows localVc=0 (null coerced)', () => { assert.ok(checkFailedResults[1].checkFailedLine.includes('localVc=0')); });

  // 3. repo versionCode = null (treated as 0) → CHECK_FAILED
  it('NullRepoVc: logLine contains CHECK FAILED', () => { assert.ok(checkFailedResults[2].logLine.includes('CHECK FAILED')); });
  it('NullRepoVc: checkFailedLine is set (null repo vc treated as 0)', () => { assert.ok(checkFailedResults[2].checkFailedLine !== null); });
  it('NullRepoVc: checkFailedLine shows repoVc=0 (null coerced)', () => { assert.ok(checkFailedResults[2].checkFailedLine.includes('repoVc=0')); });
  it('NullRepoVc: no noticeLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[2].noticeLine,
      null
    );
  });
  it('NullRepoVc: no warningLine when CHECK FAILED', () => {
    assert.strictEqual(
      checkFailedResults[2].warningLine,
      null
    );
  });

  // ---------------------------------------------------------------------------
  // run() input validation tests
  // ---------------------------------------------------------------------------
});

describe('run() input validation', () => {
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

  // Both apkDirs and apkFiles are undefined → core.error + EX_USAGE exit code
  describe('both apkDirs and apkFiles undefined', () => {
    let errors, capturedExitCode;
    before(async () => {
      errors = [];
      const coreCapture = { ...STUB_CORE, error: (m) => errors.push(m) };
      const prevExitCode = process.exitCode;
      try {
        await run({ core: coreCapture });
        capturedExitCode = process.exitCode;
      } finally {
        process.exitCode = prevExitCode;
      }
    });
    it('run(): both undefined calls core.error', () => { assert.ok(errors.length > 0); });
    it('run(): both undefined error mentions apkDirs or apkFiles', () => { assert.ok(errors[0].includes('apkDirs') || errors[0].includes('apkFiles')); });
    it('run(): both undefined exit code is EX_USAGE (64)', () => { assert.strictEqual(capturedExitCode, EXIT_CODES.EX_USAGE); });
  });

  // apkFiles set but empty → no longer throws; uses the default directory
  describe('apkFiles set but empty', () => {
    let threw;
    before(async () => {
      threw = false;
      const prevExitCode = process.exitCode;
      const origWorkspace = process.env.GITHUB_WORKSPACE;
      try {
        // Set a workspace without zip-content/origin so the default dir is absent;
        // this keeps the test fast and avoids unintended network access.
        process.env.GITHUB_WORKSPACE = '/tmp';
        await run({ core: STUB_CORE, apkFiles: [] });
      } catch {
        threw = true;
      } finally {
        if (origWorkspace === undefined) { delete process.env.GITHUB_WORKSPACE; }
        else { process.env.GITHUB_WORKSPACE = origWorkspace; }
        process.exitCode = prevExitCode;
      }
    });
    it('run(): empty apkFiles no longer throws (uses default dir)', () => { assert.strictEqual(threw, false); });
  });

  // apkDirs contains a nonexistent directory → warns and skips (no throw)
  // This also triggers core.error + process.exitCode = EX_NOINPUT
  // because no APKs survive filtering.  Save/restore process.exitCode so the
  // test runner is not affected.
  // apkFiles is also provided so effectiveDirs uses normDirs (not the default dir).
  describe('apkDirs contains a nonexistent directory', () => {
    let msg, warnings;
    before(async () => {
      warnings = [];
      const coreCapture = { ...STUB_CORE, warning: (m) => warnings.push(m) };
      const prevExitCode = process.exitCode;
      try {
        msg = await runError({ core: coreCapture, apkDirs: ['/nonexistent/path/to/apks'], apkFiles: ['/nonexistent.apk'] });
      } finally {
        process.exitCode = prevExitCode;
      }
    });
    it('run(): nonexistent dir in apkDirs does not throw "APK directory not found"', () => { assert.ok(msg === null || !msg.includes('APK directory not found')); });
    it('run(): nonexistent dir in apkDirs emits a warning with the path', () => { assert.ok(warnings.some(w => w.includes('/nonexistent/path/to/apks'))); });
  });

  // apkFiles contains a nonexistent file → warns and skips (no throw)
  // apkDirs is also provided so effectiveDirs uses normDirs (not the default dir).
  describe('apkFiles contains a nonexistent file', () => {
    let msg, warnings;
    before(async () => {
      warnings = [];
      const coreCapture = { ...STUB_CORE, warning: (m) => warnings.push(m) };
      const prevExitCode = process.exitCode;
      try {
        msg = await runError({ core: coreCapture, apkFiles: ['/nonexistent/file.apk'], apkDirs: ['/nonexistent'] });
      } finally {
        process.exitCode = prevExitCode;
      }
    });
    it('run(): nonexistent file in apkFiles does not throw', () => { assert.ok(msg === null || !msg.includes('not found')); });
    it('run(): nonexistent file in apkFiles emits a warning with the path', () => { assert.ok(warnings.some(w => w.includes('/nonexistent/file.apk'))); });
  });

  // apkDirs set (even empty) → does NOT throw due to apkFiles absence
  // (empty apkDirs means "use default directory", which is valid)
  describe('empty apkDirs passes validation', () => {
    let msg;
    before(async () => {
      // We cannot actually run a full update check in tests (no network/aapt),
      // so just verify no validation error is thrown — the error (if any) must be
      // a runtime error about aapt/network, not the input-validation error.
      const prevExitCode = process.exitCode;
      try {
        msg = await runError({ core: STUB_CORE, apkDirs: [] });
      } finally {
        process.exitCode = prevExitCode;
      }
    });
    it('run(): empty apkDirs passes validation (runtime errors are OK)', () => { assert.ok(msg === null || (!msg.includes('apkDirs') && !msg.includes('apkFiles'))); });
  });

  // apkFiles provided with one entry → does NOT throw validation error
  describe('non-empty apkFiles passes validation', () => {
    let msg;
    before(async () => {
      const prevExitCode = process.exitCode;
      try {
        msg = await runError({ core: STUB_CORE, apkFiles: ['/nonexistent.apk'] });
      } finally {
        process.exitCode = prevExitCode;
      }
    });
    it('run(): non-empty apkFiles passes validation (runtime errors are OK)', () => { assert.ok(msg === null || (!msg.includes('apkFiles') && !msg.includes('apkDirs'))); });
  });

  // ---------------------------------------------------------------------------
  // relPath computation: apkDirs vs apkFiles
  // ---------------------------------------------------------------------------
});

describe('run() no processed APKs', () => {
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

  // All APKs are in a nonexistent directory → validDirs is empty →
  // apkInfoList is empty → core.error is called and process.exitCode is set.
  // apkFiles is also provided so effectiveDirs uses normDirs (not the default dir).
  describe('all APK dirs nonexistent', () => {
    let errors, capturedExitCode;
    before(async () => {
      errors = [];
      const coreCapture = { ...STUB_CORE, error: (msg) => errors.push(msg) };
      const prevExitCode = process.exitCode;
      try {
        await run({ core: coreCapture, apkDirs: ['/nonexistent/path/to/apks'], apkFiles: ['/nonexistent.apk'] });
        capturedExitCode = process.exitCode;
      } finally {
        process.exitCode = prevExitCode;
      }
    });
    it('run(): no processed APKs calls core.error', () => { assert.ok(errors.length > 0); });
    it('run(): no processed APKs error message mentions APK', () => { assert.ok(errors[0].toLowerCase().includes('apk')); });
    it('run(): no processed APKs exit code is EX_NOINPUT (66)', () => { assert.strictEqual(capturedExitCode, EXIT_CODES.EX_NOINPUT); });
  });
});

describe('relPath computation', () => {
  // For dir-scanned APKs: relPath is relative to the source dir (not workspace)
  // path.posix.relative is used here to mirror the library's forward-slash normalization,
  // ensuring the tests pass on both Linux and Windows.
  {
    const baseDir = '/workspace/zip-content/origin';
    const apkPath = baseDir + '/priv-app/GmsCore.apk';
    it('relPath from apkDirs: relative to its source dir', () => {
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
    it('relPath from apkFiles: relative to workspace', () => {
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
    it('relPath from first dir: relative to dir1', () => {
      assert.strictEqual(
        path.posix.relative(dir1, dir1 + '/sub/App.apk'),
        'sub/App.apk'
      );
    });
    it('relPath from second dir: relative to dir2 (independent from dir1)', () => {
      assert.strictEqual(
        path.posix.relative(dir2, dir2 + '/sub/App.apk'),
        'sub/App.apk'
      );
    });
    // An apk from dir2 must NOT be relative to dir1
    it('relPath from dir2 differs when computed relative to dir1', () => { assert.ok(path.posix.relative(dir1, dir2 + '/sub/App.apk') !== 'sub/App.apk'); });
  }

  // Mixed apkFiles + apkDirs: relPath origins are independent
  {
    const workspace = '/workspace';
    const dir = '/workspace/zip-content/origin';
    // File supplied via apkFiles: relPath is workspace-relative
    it('mixed: apkFiles relPath is workspace-relative', () => {
      assert.strictEqual(
        path.posix.relative(workspace, '/workspace/extra/app/Test.apk'),
        'extra/app/Test.apk'
      );
    });
    // File found via apkDirs scan: relPath is dir-relative
    it('mixed: apkDirs relPath is dir-relative', () => {
      assert.strictEqual(
        path.posix.relative(dir, dir + '/priv-app/Test.apk'),
        'priv-app/Test.apk'
      );
    });
    // The same absolute path produces a different relPath depending on the base
    const sameAbsPath = '/workspace/extra/app/Test.apk';
    const relFromWorkspace = path.posix.relative(workspace, sameAbsPath);
    const relFromDir       = path.posix.relative(dir, sameAbsPath);
    it('mixed: same absolute path has different relPath when base is workspace vs dir', () => { assert.ok(relFromWorkspace !== relFromDir); });
    it('mixed: workspace-based relPath for extra/app/Test.apk', () => {
      assert.strictEqual(
        relFromWorkspace,
        'extra/app/Test.apk'
      );
    });
    it('mixed: dir-based relPath for extra/app/Test.apk traverses up to dir root', () => {
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

describe('toPosix Windows path simulation', () => {
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

    // Shared state computed inside before() after Windows mock is applied.
    // These are populated by before() and consumed by the last four it() calls below.
    let normDirs, normFiles;

    before(async () => {
      await mockWindows();

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
      normDirs  = winDirs.map(d => d.toPosix());
      normFiles = winFiles.map(f => f.toPosix());
    });

    after(async () => {
      await unmockWindows();
    });

    // Verify mock state
    it('toPosix (win): process.platform mocked to win32', () => { assert.strictEqual(process.platform, 'win32'); });
    it('toPosix (win): path.sep mocked to backslash', () => { assert.strictEqual(path.sep, '\\'); });
    it('toPosix (win): path.win32.sep unchanged', () => { assert.strictEqual(path.win32.sep, '\\'); });
    it('toPosix (win): path.posix.sep unaffected by mock', () => { assert.strictEqual(path.posix.sep, '/'); });
    it('toPosix (win): path.join uses win32', () => { assert.strictEqual(path.join('C:', 'Users'), 'C:\\Users'); });
    it('toPosix (win): path.dirname uses win32', () => { assert.strictEqual(path.dirname('C:\\Windows\\System32'), 'C:\\Windows'); });
    it('toPosix (win): path.isAbsolute recognises Windows path', () => { assert.ok(path.isAbsolute('C:\\Windows\\System32')); });

    // toPosix conversion: after reload, library SEP = '\\' so toPosix replaces backslashes
    // Single-level Windows path
    it('toPosix (win): single-level Windows path converted', () => {
      assert.strictEqual(
        'C:\\foo\\bar'.toPosix(),
        'C:/foo/bar'
      );
    });
    // Deep Windows path
    it('toPosix (win): deep Windows path fully converted', () => {
      assert.strictEqual(
        'C:\\workspace\\zip-content\\origin\\app.apk'.toPosix(),
        'C:/workspace/zip-content/origin/app.apk'
      );
    });
    // Forward-slash path is unchanged (no backslashes to replace)
    it('toPosix (win): posix path unchanged when sep is backslash', () => {
      assert.strictEqual(
        '/already/posix/path'.toPosix(),
        '/already/posix/path'
      );
    });

    it('toPosix (win): dir path 1 normalized', () => { assert.strictEqual(normDirs[0], 'C:/workspace/zip-content'); });
    it('toPosix (win): dir path 2 normalized', () => { assert.strictEqual(normDirs[1], 'D:/apks/release'); });
    it('toPosix (win): file path 1 normalized', () => { assert.strictEqual(normFiles[0], 'C:/workspace/app.apk'); });
    it('toPosix (win): file path 2 normalized', () => { assert.strictEqual(normFiles[1], 'D:/other/test.apk'); });
});

