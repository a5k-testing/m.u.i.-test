// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import fs from 'fs';
import path from 'path';
import https from 'https';

// Files to skip the update check (relative to zip-content/origin/)
export const SKIP_LIST = new Set([
  'priv-app/FakeStore-0.3.6.apk',
  'priv-app/GmsCore-0.3.6.apk',
  'priv-app/GmsCoreVtm.apk',
  'priv-app/GmsCoreVtmLegacy.apk',
]);

// Fetch a URL over HTTPS only, following up to maxRedirects redirects
function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const doGet = (targetUrl, remaining) => {
      if (!targetUrl.startsWith('https://')) {
        reject(new Error(
          `Non-HTTPS URL rejected: ${targetUrl}`
        ));
        return;
      }
      https.get(targetUrl, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (remaining <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          doGet(res.headers.location, remaining - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(
            `HTTP ${res.statusCode} for ${targetUrl}`
          ));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf-8'))
        );
        res.on('error', reject);
      }).on('error', reject);
    };
    doGet(url, maxRedirects);
  });
}

// Parse index-v2.json → Map<pkgId, {byCert, latestVc, latestVn}>
// Each version entry carries manifest.signer.sha256 (array of
// signing certificate SHA-256 hashes). We index versions by cert
// so that we can match our local APKs (identified via keytool) to
// the exact signer family present in the repo.
export function parseRepoV2(data) {
  const apps = new Map();
  for (const [pkgId, pkg] of
    Object.entries(data.packages || {})
  ) {
    let latestVc = null;
    let latestVn = '';
    const byCert = {};
    for (const [, ver] of
      Object.entries(pkg.versions || {})
    ) {
      const m = ver.manifest || {};
      const vc = m.versionCode ?? null;
      const vn = m.versionName || '';
      const apkName = ver.file?.name || '';
      const certs = m.signer?.sha256 ?? [];
      for (const cert of certs) {
        const c = cert.toLowerCase();
        if (
          !(c in byCert) ||
          (vc !== null &&
            (byCert[c].vc === null || vc > byCert[c].vc))
        ) {
          byCert[c] = { vc, vn, apkName };
        }
      }
      if (vc !== null &&
        (latestVc === null || vc > latestVc)
      ) {
        latestVc = vc;
        latestVn = vn;
      }
    }
    apps.set(pkgId, { byCert, latestVc, latestVn });
  }
  return apps;
}

// Shorten a full repo URL to just its base domain
// e.g. "https://repo.microg.org/fdroid/repo" → "microg.org"
export function shortUrl(url) {
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.slice(-2).join('.');
  } catch (_) {
    return url;
  }
}

// Unicode icons for each result state
export const ICON = {
  UPDATE_AVAILABLE: '✨',
  UP_TO_DATE:       '✅',
  LOCAL_NEWER:      '🚀',
  DIFFERENT_SIGNER: '🔐',
  NOT_IN_REPO:      '❓',
};

// Packages that get a special cert fallback when the local APK
// is signed with the microG certificate
export const MICROG_CERT =
  '9bd06727e62796c0130eb6dab39b73157451582cbd138e86c468acc395d14165';
export const SPECIAL_PKG_CERT =
  'f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83';
export const SPECIAL_PKGS = new Set([
  'com.google.android.gms',
  'com.android.vending',
]);

// Ordered list of F-Droid-compatible repository base URLs.
// "/index-v2.json" is appended automatically when fetching.
export const repos = [
  'https://f-droid.org/repo',
  'https://repo.microg.org/fdroid/repo',
];

// Check apkInfoList against repoData; returns one result per APK:
//   { logLine, tableRow, noticeLine, warningLine }
// noticeLine/warningLine are null when no notice/warning should be emitted.
export function checkApks(apkInfoList, repoData) {
  const results = [];
  for (const apk of apkInfoList) {
    // Loop through repos in order; stop at the first one that has
    // both a matching package name and a matching signing certificate
    let certMatch = null;
    for (const { baseUrl, apps } of repoData) {
      const pkg = apps.get(apk.packageName);
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
      // Package found with our signing certificate
      const { baseUrl, ver } = certMatch;
      const label = shortUrl(baseUrl);
      const localVc = apk.versionCode;
      const repoVc = ver.vc;
      const apkUrl =
        ver.apkName ? `${baseUrl}${ver.apkName}` : '';
      const hasVc = repoVc !== null && localVc;
      const isUpdateAvail = hasVc && repoVc > localVc;
      const isLocalNewer = hasVc && repoVc < localVc;
      let statusText, versionInfo;
      if (isUpdateAvail) {
        versionInfo =
          `repo=${ver.vn} (${repoVc}) > local (${localVc})`;
        statusText =
          `${ICON.UPDATE_AVAILABLE} UPDATE AVAILABLE: ${versionInfo}`;
      } else if (hasVc && repoVc === localVc) {
        statusText =
          `${ICON.UP_TO_DATE} UP TO DATE (versionCode=${localVc})`;
      } else if (isLocalNewer) {
        statusText =
          `${ICON.LOCAL_NEWER} LOCAL NEWER: local (${localVc})` +
          ` > repo (${repoVc})`;
      } else {
        statusText = `found, latest=${ver.vn}`;
      }
      const logLine =
        `[${label}] ${apk.fileName}` +
        ` (${apk.packageName}): ${statusText}`;
      const noticeLine = isUpdateAvail
        ? `[${label}] ${apk.fileName} (${apk.packageName}):` +
          ` ${statusText}` +
          (apkUrl ? `\n${apkUrl}` : '')
        : null;
      const warningLine = isLocalNewer
        ? `${apk.fileName} (${apk.packageName}): ${statusText}`
        : null;
      const tableStatus = (isUpdateAvail && apkUrl)
        ? `${ICON.UPDATE_AVAILABLE}` +
          ` <a href="${apkUrl}">UPDATE AVAILABLE</a>:` +
          ` ${versionInfo}`
        : statusText;
      results.push({
        logLine,
        tableRow: [apk.fileName, apk.packageName, label, tableStatus],
        noticeLine,
        warningLine,
      });
    } else {
      // Collect repos where the package exists under a different cert
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
            apk.fileName,
            apk.packageName,
            repoLabel,
            `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`,
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
            apk.fileName,
            apk.packageName,
            '-',
            `${ICON.NOT_IN_REPO} NOT IN REPO`,
          ],
          noticeLine: null,
          warningLine: null,
        });
      }
    }
  }
  return results;
}

export default async function ({ core }) {
  // Load APK info produced by the shell step, filtering out skipped entries
  const allApkInfo = JSON.parse(
    fs.readFileSync(
      path.join(process.env.RUNNER_TEMP, 'apk_info.json'),
      'utf-8'
    )
  );
  const apkInfoList = allApkInfo.filter(apk => {
    if (SKIP_LIST.has(apk.relPath)) {
      core.info(`Skipping (skip list): ${apk.relPath}`);
      return false;
    }
    return true;
  });
  core.info(
    `Loaded info for ${apkInfoList.length} APK(s)` +
    (allApkInfo.length !== apkInfoList.length
      ? ` (skipped ${allApkInfo.length - apkInfoList.length})`
      : '')
  );

  // Fetch and parse every repo index
  const repoData = [];
  for (const baseUrl of repos) {
    const indexUrl = `${baseUrl}/index-v2.json`;
    core.info(`Fetching ${indexUrl}…`);
    const data = JSON.parse(await fetchUrl(indexUrl));
    const apps = parseRepoV2(data);
    core.info(`  Parsed ${apps.size} app(s) from ${baseUrl}`);
    repoData.push({ baseUrl, apps });
  }

  // Collect rows for Job Summary table
  const summaryRows = [];

  // Report results
  core.info('');
  core.info('=== Update check results ===');
  for (const { logLine, tableRow, noticeLine, warningLine }
    of checkApks(apkInfoList, repoData)) {
    core.info(logLine);
    if (noticeLine !== null) {
      core.notice(noticeLine, { title: 'Update available' });
    }
    if (warningLine !== null) {
      core.warning(warningLine, { title: 'Local Newer' });
    }
    summaryRows.push(tableRow);
  }

  // Write Job Summary table
  await core.summary
    .addHeading('Update check results')
    .addTable([
      [
        { data: 'APK', header: true },
        { data: 'Package', header: true },
        { data: 'Repo', header: true },
        { data: 'Status', header: true },
      ],
      ...summaryRows,
    ])
    .write();
}
