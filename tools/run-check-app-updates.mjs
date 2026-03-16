// SPDX-FileCopyrightText: (c) 2026 ale5000
// SPDX-License-Identifier: GPL-3.0-or-later

import run from '../includes/app-update-checker-lib.mjs';

// Minimal console-based shim for @actions/core — used when running outside
// GitHub Actions (e.g. invoked by tools/check-app-updates.sh).
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
        // Strip HTML tags (e.g. <a href="...">…</a>) for terminal output
        const strip = s => String(s ?? '').replace(/<[^>]*>/g, '');
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

const apkFiles = process.env.APKS_FILES
  ? process.env.APKS_FILES.split('\n').filter(Boolean)
  : undefined;

run({
  core,
  baseDir:      process.env.APKS_BASE_DIR      || undefined,
  repoCacheDir: process.env.APKS_REPO_CACHE_DIR || undefined,
  apkFiles,
}).catch(err => {
  console.error(`\x1b[31mERROR: ${err.message}\x1b[0m`);
  process.exitCode = 1;
});
