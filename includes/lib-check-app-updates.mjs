// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

// Library module: APK update checker for F-Droid and microG repositories.
// This file is intended to be imported as a library, not executed directly.

// Node.js 24 or later is required
if (parseInt(process.versions.node.split('.')[0], 10) < 24) {
  throw new Error(
    `Node.js 24 or later is required (current: ${process.versions.node})`
  );
}

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import path from 'path';
import https from 'https';
import { execFile as execFileCb, spawnSync } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

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

// ---------------------------------------------------------------------------
// APK info extraction helpers (used by extractApkInfo)
// ---------------------------------------------------------------------------

// Find the aapt (or aapt2) binary.
// Tries aapt and aapt2 in PATH first, then falls back to ANDROID_SDK_ROOT.
function findAaptBin() {
  for (const bin of ['aapt', 'aapt2']) {
    const r = spawnSync(bin, ['version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!r.error || r.error.code !== 'ENOENT') return bin;
  }
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? '';
  if (sdkRoot) {
    const btDir = path.join(sdkRoot, 'build-tools');
    try {
      const versions = readdirSync(btDir)
        .filter(d => {
          try { return statSync(path.join(btDir, d)).isDirectory(); }
          catch { return false; }
        })
        .sort();
      for (const ver of versions.reverse()) {
        const candidate = path.join(btDir, ver, 'aapt');
        const r = spawnSync(candidate, ['version'], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (!r.error || r.error.code !== 'ENOENT') return candidate;
      }
    } catch { /* ignore */ }
  }
  return null;
}

// Collect all *.apk file paths under baseDir, sorted lexicographically.
function findApkFiles(baseDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.apk'))
        results.push(full);
    }
  }
  walk(baseDir);
  return results.sort();
}

// Extract package name and version code from an APK via aapt dump badging.
// Returns { packageName, versionCode } or null on failure.
async function getApkManifestInfo(aaptBin, apkPath) {
  try {
    const { stdout } = await execFile(
      aaptBin, ['dump', 'badging', apkPath],
      // 30 s is sufficient for typical APKs (< 100 MB); very large APKs
      // on slow I/O may occasionally hit this limit but it avoids hanging.
      { encoding: 'utf-8', timeout: 30_000 }
    );
    const pkgLine =
      stdout.split('\n').find(l => l.startsWith('package:')) ?? '';
    const nameMatch = pkgLine.match(/ name='([^']*)'/);
    const vcMatch   = pkgLine.match(/ versionCode='([^']*)'/);
    return {
      packageName: nameMatch?.[1] ?? null,
      versionCode: vcMatch ? parseInt(vcMatch[1], 10) : 0,
    };
  } catch { return null; }
}

// Extract the SHA-256 certificate fingerprint from an APK.
// Tries apksigner first (APKSIGNER_PATH env var or PATH), then keytool.
// Returns the hex digest (lower-case, no colons) or null.
async function getCertSha256(apkPath) {
  // Try apksigner (preferred: handles APK v2/v3 signatures correctly)
  const apksignerBin =
    process.env.APKSIGNER_PATH ?? 'apksigner';
  const rCheck = spawnSync(apksignerBin, ['version'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!rCheck.error || rCheck.error.code !== 'ENOENT') {
    try {
      const { stdout } = await execFile(
        apksignerBin,
        ['verify', '--min-sdk-version', '24', '--print-certs', '--', apkPath],
        // 30 s is sufficient for typical APKs; same assumption as aapt above.
        { encoding: 'utf-8', timeout: 30_000 }
      );
      const m = stdout.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i);
      if (m) return m[1].toLowerCase();
    } catch { /* fall through to keytool */ }
  }

  // Fall back to keytool
  try {
    const { stdout } = await execFile(
      'keytool', ['-printcert', '-jarfile', apkPath],
      { encoding: 'utf-8', timeout: 30_000 }
    );
    const m = stdout.match(/\bSHA256:\s*((?:[0-9A-Fa-f]{2}:)*[0-9A-Fa-f]{2})/);
    if (m) return m[1].replace(/:/g, '').toLowerCase();
  } catch { /* ignore */ }

  return null;
}

// ---------------------------------------------------------------------------
// extractApkInfo — exported library function
// ---------------------------------------------------------------------------

// Scan baseDir recursively for *.apk files, extract package name, version
// code, and signing-certificate SHA-256 for each one, and return the list.
//
// LFS pointer files (tiny text stubs) are resolved from lfsCacheDir when
// provided; if not resolvable they are skipped with a log message.
//
// Options:
//   lfsCacheDir {string|null} – path to a Git-LFS cache directory
//                               (e.g. GITHUB_WORKSPACE/cache/lfs)
//   core        {object}     – logger implementing .info(msg) (optional)
//
// Returns: Promise<Array<{fileName, relPath, packageName, versionCode, certSha256}>>
export async function extractApkInfo(
  baseDir,
  { lfsCacheDir = null, core } = {}
) {
  const aaptBin = findAaptBin();
  if (!aaptBin) {
    throw new Error(
      "'aapt' not found. " +
      'Install Android build-tools or set ANDROID_SDK_ROOT.'
    );
  }
  core?.info(`Using aapt: ${aaptBin}`);

  const apkPaths = findApkFiles(baseDir);
  const results = [];

  for (const apkPath of apkPaths) {
    const fileName  = path.basename(apkPath);
    const relPath   = path.relative(baseDir, apkPath);

    // Detect and resolve LFS pointer files
    let resolvedPath = apkPath;
    let fileSize;
    try { fileSize = statSync(apkPath).size; }
    catch { core?.info(`WARNING: cannot stat ${fileName}, skipping`); continue; }

    if (fileSize < 1024) {
      let content;
      try { content = readFileSync(apkPath, 'utf-8'); }
      catch { content = ''; }

      if (content.startsWith('version https://git-lfs.github.com/spec/v1\n')) {
        const oidMatch = content.match(/^oid sha256:([0-9a-f]+)$/m);
        const sha256   = oidMatch?.[1] ?? '';
        if (sha256 && lfsCacheDir) {
          const cached = path.join(lfsCacheDir, sha256);
          if (existsSync(cached)) {
            resolvedPath = cached;
            core?.info(
              `INFO: resolved LFS pointer for ${fileName}` +
              ` (sha256=${sha256})`
            );
          } else {
            core?.info(
              `WARNING: skipping LFS pointer (cache miss): ${fileName}`
            );
            continue;
          }
        } else {
          core?.info(
            `WARNING: skipping LFS pointer (not in cache): ${fileName}`
          );
          continue;
        }
      }
    }

    // Extract package name and version code
    const manifest = await getApkManifestInfo(aaptBin, resolvedPath);
    if (!manifest?.packageName) {
      core?.info(`WARNING: skipping ${fileName} (package name not found)`);
      continue;
    }

    // Extract signing certificate SHA-256
    const certSha256 = await getCertSha256(resolvedPath);
    if (!certSha256) {
      core?.info(`WARNING: skipping ${fileName} (cert not found)`);
      continue;
    }

    core?.info(
      `INFO: ${fileName}: pkg=${manifest.packageName},` +
      ` vc=${manifest.versionCode}, cert=${certSha256}`
    );
    results.push({
      fileName,
      relPath,
      packageName: manifest.packageName,
      versionCode: manifest.versionCode,
      certSha256,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Default export — orchestrates extraction, repo fetching, and reporting
// ---------------------------------------------------------------------------

// Run the full update check.
//
// Options:
//   core        {object}      – @actions/core or compatible shim (required)
//   baseDir     {string}      – APK root directory; defaults to
//                               GITHUB_WORKSPACE/zip-content/origin
//   lfsCacheDir {string|null} – LFS cache dir; defaults to
//                               GITHUB_WORKSPACE/cache/lfs (when GITHUB_WORKSPACE
//                               is set), or null
export default async function ({ core, baseDir, lfsCacheDir } = {}) {
  const workspace = process.env.GITHUB_WORKSPACE ?? '';
  const apkBaseDir = baseDir ??
    (workspace ? path.join(workspace, 'zip-content/origin') : null);
  if (!apkBaseDir) {
    throw new Error(
      'APK base directory must be provided via the baseDir option ' +
      'or the GITHUB_WORKSPACE environment variable.'
    );
  }
  const lfsDir = lfsCacheDir ??
    (workspace ? path.join(workspace, 'cache/lfs') : null);

  // Extract APK info from the filesystem
  const allApkInfo = await extractApkInfo(apkBaseDir, {
    lfsCacheDir: lfsDir,
    core,
  });

  // Filter out skip-listed entries
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
