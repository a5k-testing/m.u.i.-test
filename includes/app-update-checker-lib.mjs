// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

// Library module: APK update checker for F-Droid and microG repositories.
// When invoked directly by Node.js it also acts as a CLI entry point.

// Node.js 20 or later is required
if (parseInt(process.versions.node.split('.')[0], 10) < 20) {
  throw new Error(
    `Node.js 20 or later is required (current: ${process.versions.node})`
  );
}

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'fs';
import path from 'path';
import https from 'https';
import { execFile as execFileCb, spawnSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFile = promisify(execFileCb);

// Path to this library file; used for workspace default and CLI entry detection
const _LIB_PATH = fileURLToPath(import.meta.url);
const _LIB_DIR  = path.dirname(_LIB_PATH);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Files to skip the update check (relative to zip-content/origin/)
export const SKIP_LIST = new Set([
  'priv-app/FakeStore-0.3.6.apk',
  'priv-app/GmsCore-0.3.6.apk',
  'priv-app/GmsCoreVtm.apk',
  'priv-app/GmsCoreVtmLegacy.apk',
]);

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
  'https://repo.microg.org/fdroid/repo',
  'https://f-droid.org/repo',
  'https://apt.izzysoft.de/fdroid/repo',
];

// How long a cached repo index is considered fresh (7 days in milliseconds)
export const REPO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Unicode icons for each result state
export const ICON = {
  UP_TO_DATE:       '✅',
  UPDATE_AVAILABLE: '✨',
  LOCAL_NEWER:      '🚀',
  CHECK_FAILED:     '⚠️',
  DIFFERENT_SIGNER: '🔐',
  NOT_IN_REPO:      '❓',
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

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
          byCert[c] = { vc, vn, apkName, sha256: ver.file?.sha256 ?? '' };
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

// Sanitize a repository base URL into a safe cache filename.
// e.g. "https://repo.microg.org/fdroid/repo" → "repo.microg.org_fdroid_repo.json"
function repoCacheFilename(baseUrl) {
  return baseUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}

// Load a repo index from repoCacheDir if fresh (< REPO_CACHE_TTL_MS old),
// otherwise fetch from the network and write to cache.
// Returns the parsed JSON data object.
async function loadOrFetchRepoIndex(baseUrl, repoCacheDir, core) {
  const indexUrl = `${baseUrl}/index-v2.json`;
  if (repoCacheDir) {
    const cacheFile = path.join(repoCacheDir, repoCacheFilename(baseUrl));
    let cacheAgeMs = Infinity;
    try {
      cacheAgeMs = Date.now() - statSync(cacheFile).mtimeMs;
    } catch { /* file does not exist or is not accessible */ }
    if (cacheAgeMs < REPO_CACHE_TTL_MS) {
      core?.info(
        `Using cached index for ${shortUrl(baseUrl)}` +
        ` (age: ${Math.round(cacheAgeMs / 3_600_000)}h)`
      );
      try {
        return JSON.parse(readFileSync(cacheFile, 'utf-8'));
      } catch {
        core?.info(
          `WARNING: cache read failed for ${shortUrl(baseUrl)}, fetching…`
        );
      }
    } else {
      core?.info(`Fetching ${indexUrl}…`);
    }
    const raw = await fetchUrl(indexUrl);
    try {
      mkdirSync(repoCacheDir, { recursive: true });
      writeFileSync(cacheFile, raw, 'utf-8');
    } catch (e) {
      core?.info(
        `WARNING: could not save index cache for ${shortUrl(baseUrl)}: ${e.message}`
      );
    }
    return JSON.parse(raw);
  }
  core?.info(`Fetching ${indexUrl}…`);
  return JSON.parse(await fetchUrl(indexUrl));
}

// Check apkInfoList against repoData; returns one result per APK:
//   { logLine, tableRow, noticeLine, warningLine, checkFailedLine }
// noticeLine/warningLine/checkFailedLine are null when not applicable.
export function checkApks(apkInfoList, repoData) {
  const results = [];
  for (const apk of apkInfoList) {
    const displayName = apk.relPath;
    const logEntry = (icon, status, desc) =>
      `${icon} [${status}] ${displayName} (${apk.packageName}): ${desc}`;
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
      const label  = shortUrl(baseUrl);
      const tLabel = label.split('.')[0];
      const localVc = apk.versionCode || 0;
      const repoVc  = ver.vc || 0;
      const apkUrl  = ver.apkName ? `${baseUrl}${ver.apkName}` : '';
      const localVn = apk.versionName || '';
      const updateStatus = (() => {
        if (localVc < 1 || repoVc < 1) return 'check-failed';
        if (repoVc === localVc) return 'up-to-date';
        if (repoVc > localVc) return 'update-available';
        return 'local-newer';
      })();
      let tableStatus, logLine, noticeTitle, noticeLine, warningLine, checkFailedLine,
          updateInfo;
      switch (updateStatus) {
        case 'check-failed': {
          const info = `(localVc=${localVc}, repoVc=${repoVc})`;
          tableStatus = `${ICON.CHECK_FAILED} CHECK FAILED ${info}`;
          logLine = logEntry(ICON.CHECK_FAILED, 'CHECK FAILED', `[${label}] ${info}`);
          noticeTitle = null;
          noticeLine = null;
          warningLine = null;
          checkFailedLine =
            `${displayName} (${apk.packageName}): CHECK FAILED ${info}`;
          updateInfo = null;
          break;
        }
        case 'up-to-date': {
          const desc = `version=${ver.vn} (${repoVc})`;
          tableStatus = `${ICON.UP_TO_DATE} UP TO DATE<br>${desc}`;
          logLine = logEntry(ICON.UP_TO_DATE, 'UP TO DATE', `[${label}] ${desc}`);
          noticeTitle = null;
          noticeLine = null;
          warningLine = null;
          checkFailedLine = null;
          updateInfo = null;
          break;
        }
        case 'update-available': {
          const versionInfo =
            `repo=${ver.vn} (${repoVc}) > local=${localVn} (${localVc})`;
          const tableVersionInfo = `version=${ver.vn} (${repoVc})`;
          tableStatus = apkUrl
            ? `${ICON.UPDATE_AVAILABLE}` +
              ` <a href="${apkUrl}">UPDATE AVAILABLE</a><br>${tableVersionInfo}`
            : `${ICON.UPDATE_AVAILABLE} UPDATE AVAILABLE<br>${tableVersionInfo}`;
          logLine = logEntry(
            ICON.UPDATE_AVAILABLE, 'UPDATE AVAILABLE', `[${label}] ${versionInfo}`
          );
          noticeTitle =
            `${ICON.UPDATE_AVAILABLE} Update available for ${displayName}` +
            ` (${apk.packageName}): [${label}] version=${ver.vn} (${repoVc})`;
          noticeLine = apkUrl;
          warningLine = null;
          checkFailedLine = null;
          updateInfo = {
            relPath:    displayName,
            package:    apk.packageName,
            repo:       label,
            localVn,
            localVc,
            repoVn:     ver.vn,
            repoVc,
            repoFileSha256: ver.sha256,
            url:        apkUrl,
          };
          break;
        }
        case 'local-newer': {
          const versionInfo =
            `local=${localVn} (${localVc}) > repo=${ver.vn} (${repoVc})`;
          tableStatus = `${ICON.LOCAL_NEWER} LOCAL NEWER<br>${versionInfo}`;
          logLine = logEntry(
            ICON.LOCAL_NEWER, 'LOCAL NEWER', `[${label}] ${versionInfo}`
          );
          noticeTitle = null;
          noticeLine = null;
          warningLine =
            `${displayName} (${apk.packageName}): LOCAL NEWER: ${versionInfo}`;
          checkFailedLine = null;
          updateInfo = null;
          break;
        }
      }
      results.push({
        logLine,
        tableRow: [displayName, apk.packageName, tLabel, tableStatus],
        noticeLine,
        noticeTitle,
        warningLine,
        checkFailedLine,
        updateInfo,
      });
    } else {
      // Collect repos where the package exists under a different cert
      const signerMismatch = repoData
        .filter(({ apps }) => apps.has(apk.packageName));
      if (signerMismatch.length > 0) {
        const logRepoLabel = signerMismatch
          .map(({ baseUrl }) => shortUrl(baseUrl))
          .join(', ');
        const tableRepoLabel = signerMismatch
          .map(({ baseUrl }) => shortUrl(baseUrl).split('.')[0])
          .join(', ');
        results.push({
          logLine:
            logEntry(ICON.DIFFERENT_SIGNER, 'DIFFERENT SIGNER',
              `[${logRepoLabel}] signed with a different certificate`),
          tableRow: [
            displayName,
            apk.packageName,
            tableRepoLabel,
            `${ICON.DIFFERENT_SIGNER} DIFFERENT SIGNER`,
          ],
          noticeLine: null,
          noticeTitle: null,
          warningLine: null,
          checkFailedLine: null,
          updateInfo: null,
        });
      } else {
        results.push({
          logLine:
            logEntry(ICON.NOT_IN_REPO, 'NOT IN REPO', 'not found in any repo'),
          tableRow: [
            displayName,
            apk.packageName,
            '-',
            `${ICON.NOT_IN_REPO} NOT IN REPO`,
          ],
          noticeLine: null,
          noticeTitle: null,
          warningLine: null,
          checkFailedLine: null,
          updateInfo: null,
        });
      }
    }
  }
  return results;
}

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

// Extract package name, version code, and version name from an APK via aapt.
// Returns { packageName, versionCode, versionName } or null on failure.
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
    const vnMatch   = pkgLine.match(/ versionName='([^']*)'/);
    return {
      packageName:  nameMatch?.[1] ?? null,
      versionCode:  vcMatch ? parseInt(vcMatch[1], 10) : 0,
      versionName:  vnMatch?.[1] ?? '',
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

// Scan baseDir recursively for *.apk files (or use an explicit apkFiles list),
// extract package name, version code, version name, and signing-certificate
// SHA-256 for each one, and return the list.
//
// LFS pointer files (tiny text stubs) are resolved from lfsCacheDir when
// provided; if not resolvable they are skipped with a log message.
//
// Options:
//   apkFiles    {string[]|null} – explicit list of absolute APK paths to process
//                                 instead of scanning baseDir; when provided,
//                                 baseDir may be null
//   workspace   {string|null}   – workspace root used to compute relPath for APKs
//                                 found via apkFiles (path relative to workspace);
//                                 for dir-scanned APKs, relPath is relative to baseDir
//   lfsCacheDir {string|null}   – path to a Git-LFS cache directory
//                                 (e.g. GITHUB_WORKSPACE/cache/lfs)
//   core        {object}        – logger implementing .info(msg) (optional)
//
// Returns: Promise<Array<{fileName, relPath, packageName, versionCode, versionName, certSha256}>>
export async function extractApkInfo(
  baseDir,
  { apkFiles = null, workspace = null, lfsCacheDir = null, core } = {}
) {
  const aaptBin = findAaptBin();
  if (!aaptBin) {
    throw new Error(
      "'aapt' not found. " +
      'Install Android build-tools or set ANDROID_SDK_ROOT.'
    );
  }
  core?.info(`Using aapt: ${aaptBin}`);

  const apkPaths = apkFiles ?? findApkFiles(baseDir);
  const results = [];

  for (const apkPath of apkPaths) {
    const fileName = path.basename(apkPath);
    const relPath = apkFiles != null
      ? (workspace ? path.posix.relative(workspace, apkPath) : path.basename(apkPath))
      : path.posix.relative(baseDir, apkPath);

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

    // Extract package name, version code, and version name
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
      ` vc=${manifest.versionCode}, vn=${manifest.versionName},` +
      ` cert=${certSha256}`
    );
    results.push({
      fileName,
      relPath,
      packageName:  manifest.packageName,
      versionCode:  manifest.versionCode,
      versionName:  manifest.versionName,
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
//   core         {object}        – @actions/core or compatible shim (required)
//   apkDirs      {string[]|undefined} – APK root directories to scan. Pass an
//                                       empty array [] to use the default
//                                       (workspace/zip-content/origin). Omit
//                                       only when apkFiles is provided.
//   apkFiles     {string[]|undefined} – Explicit list of APK paths to check
//                                       instead of (or in addition to) scanning
//                                       directories. Must not be empty when set.
//   lfsCacheDir  {string|undefined}   – LFS cache dir; defaults to
//                                       workspace/cache/lfs.
//   repoCacheDir {string|undefined}   – Directory to cache repo index JSON files;
//                                       defaults to workspace/cache/repos.
//   dumpInfoFile {string|null}        – When set, write UPDATE AVAILABLE entries
//                                       to this path in key=value format.
export default async function run(
  { core, apkDirs, apkFiles, lfsCacheDir, repoCacheDir, dumpInfoFile = null } = {}
) {
  // Determine workspace root: GITHUB_WORKSPACE (Actions) or parent of includes/
  const workspace = process.env.GITHUB_WORKSPACE
    || path.resolve(_LIB_DIR, '..');

  // Validate inputs
  if (apkDirs === undefined && apkFiles === undefined) {
    throw new Error(
      'Either apkDirs or apkFiles must be provided.'
    );
  }
  if (apkFiles !== undefined && apkFiles.length === 0) {
    throw new Error('apkFiles must not be empty when provided.');
  }

  // Resolve effective APK scan directories
  // An empty apkDirs array signals "use the default directory".
  const effectiveDirs = apkDirs !== undefined
    ? (apkDirs.length === 0
        ? [path.join(workspace, 'zip-content/origin')]
        : apkDirs)
    : [];

  // Validate apkDirs elements: skip entries that are not directories
  const validDirs = [];
  for (const dir of effectiveDirs) {
    let isDir = false;
    try { isDir = statSync(dir).isDirectory(); } catch { /* ignore */ }
    if (isDir) {
      validDirs.push(dir);
    } else {
      core.warning(`APK directory not found, skipping: ${dir}`);
    }
  }

  // Cache directories always have a valid path (never disabled)
  const lfsDir  = lfsCacheDir  ?? path.join(workspace, 'cache/lfs');
  const reposDir = repoCacheDir ?? path.join(workspace, 'cache/repos');

  // Extract APK info from all valid directories
  let allApkInfo = [];
  for (const dir of validDirs) {
    const info = await extractApkInfo(dir, { workspace, lfsCacheDir: lfsDir, core });
    allApkInfo = allApkInfo.concat(info);
  }

  // Validate apkFiles elements: skip entries that are not files
  let validApkFiles = null;
  if (apkFiles?.length) {
    validApkFiles = [];
    for (const f of apkFiles) {
      let isFile = false;
      try { isFile = statSync(f).isFile(); } catch { /* ignore */ }
      if (isFile) {
        validApkFiles.push(f);
      } else {
        core.warning(`APK file not found or not a file, skipping: ${f}`);
      }
    }
  }

  // Extract APK info from explicit file list (if provided)
  if (validApkFiles?.length) {
    const info = await extractApkInfo(null, {
      apkFiles: validApkFiles,
      workspace,
      lfsCacheDir: lfsDir,
      core,
    });
    allApkInfo = allApkInfo.concat(info);
  }

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

  // Load or fetch (with TTL) every repo index
  const repoData = [];
  for (const baseUrl of repos) {
    const data = await loadOrFetchRepoIndex(baseUrl, reposDir, core);
    const apps = parseRepoV2(data);
    core.info(`  Parsed ${apps.size} app(s) from ${shortUrl(baseUrl)}`);
    repoData.push({ baseUrl, apps });
  }

  // Collect rows for Job Summary table
  const summaryRows = [];
  const updateInfoEntries = [];

  // Report results
  core.info('');
  core.info('=== Update check results ===');
  for (const { logLine, tableRow, noticeLine, noticeTitle, warningLine, checkFailedLine,
               updateInfo }
    of checkApks(apkInfoList, repoData)) {
    core.info(logLine);
    if (noticeTitle !== null) {
      core.notice(noticeLine, { title: noticeTitle });
    }
    if (warningLine !== null) {
      core.warning(warningLine, { title: 'Local Newer' });
    }
    if (checkFailedLine !== null) {
      core.warning(checkFailedLine, { title: 'Version check failed' });
    }
    summaryRows.push(tableRow);
    if (updateInfo !== null) {
      updateInfoEntries.push(updateInfo);
    }
  }

  // Write update-info.dat when requested
  if (dumpInfoFile && updateInfoEntries.length > 0) {
    const lines = updateInfoEntries.map(info => {
      const fields = [info.relPath, info.url, info.repoVn, String(info.repoVc), info.repoFileSha256];
      for (const field of fields) {
        if (field.includes('|') || field.includes('\n')) {
          throw new Error(
            `update-info.dat: field contains reserved character ('|' or '\\n'): ${JSON.stringify(field)}`
          );
        }
      }
      return fields.join('|');
    });
    writeFileSync(dumpInfoFile, lines.join('\n'));
    core.info(`Wrote update info for ${updateInfoEntries.length} APK(s) to ${dumpInfoFile}`);
  }

  // Write Job Summary table
  core.info('Update check results');
  await core.summary
    .addHeading('Summary')
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

// ---------------------------------------------------------------------------
// CLI entry point — runs only when invoked directly by Node.js
// ---------------------------------------------------------------------------

if (process.argv[1] === _LIB_PATH) {
  const summary = {
    _items: [],
    addHeading(text) {
      this._items.push({ type: 'heading', text });
      return this;
    },
    addTable(rows) {
      this._items.push({ type: 'table', rows });
      return this;
    },
    async write() {
      for (const item of this._items) {
        if (item.type === 'heading') {
          console.log(`\n=== ${item.text} ===`);
        } else if (item.type === 'table') {
          const [headerRow, ...dataRows] = item.rows;
          const cols = headerRow.map(
            h => (h && typeof h === 'object' ? h.data : h) ?? ''
          );
          // Replace <br> with ' - ' then strip remaining HTML tags for terminal output
          const strip = s => String(s ?? '')
            .replace(/<br\s*\/?>/gi, ' - ')
            .replace(/<[^>]*>/g, '');
          const widths = cols.map((c, i) =>
            Math.max(c.length, ...dataRows.map(r => strip(r[i]).length))
          );
          const fmt = row =>
            row.map((cell, i) => strip(cell).padEnd(widths[i])).join(' | ');
          console.log(fmt(cols));
          console.log(widths.map(w => '-'.repeat(w)).join('-+-'));
          for (const row of dataRows) console.log(fmt(row));
        }
      }
    },
  };

  const core = {
    info:    msg        => console.log(msg),
    warning: (msg, _o) => console.warn(`\x1b[33mWARNING: ${msg}\x1b[0m`),
    notice:  (msg, _o) => console.log(`\x1b[36mNOTICE: ${msg}\x1b[0m`),
    error:   (msg, _o) => console.error(`\x1b[31mERROR: ${msg}\x1b[0m`),
    summary,
  };

  const apkDirsEnv = process.env.APKS_DIRS
    ? process.env.APKS_DIRS.split('\n').filter(Boolean)
    : undefined;
  const apkFilesEnv = process.env.APKS_FILES
    ? process.env.APKS_FILES.split('\n').filter(Boolean)
    : undefined;
  const dumpInfoFileEnv = process.env.APKS_DUMP_INFO
    ? path.join(process.cwd(), 'update-info.dat')
    : null;

  run({
    core,
    apkDirs:      apkDirsEnv,
    apkFiles:     apkFilesEnv,
    repoCacheDir: process.env.APKS_REPO_CACHE_DIR || undefined,
    dumpInfoFile: dumpInfoFileEnv,
  }).catch(err => {
    console.error(`\x1b[31mERROR: ${err.message}\x1b[0m`);
    process.exitCode = 1;
  });
}
