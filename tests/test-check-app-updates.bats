#!/usr/bin/env bats
# SPDX-FileCopyrightText: (c) 2026 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

# Bats-core test suite for tools/check-app-updates.sh

# ---------------------------------------------------------------------------
# File-level setup: resolve paths once before all tests
# ---------------------------------------------------------------------------

setup_file() {
  REPO_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)"
  export REPO_DIR
  SCRIPT="${REPO_DIR}/tools/check-app-updates.sh"
  export SCRIPT
}

# ---------------------------------------------------------------------------
# Per-test setup: create a mock node binary that records env vars
# ---------------------------------------------------------------------------

setup() {
  MOCK_DIR="$(mktemp -d)"
  export MOCK_OUTPUT_FILE="${MOCK_DIR}/node_output"

  # Mock node: validates APKS_DIRS (mimics app-update-checker-lib.mjs run()),
  # then records APKS_DIRS and APKS_FILES to MOCK_OUTPUT_FILE, then exits cleanly.
  cat > "${MOCK_DIR}/node" << 'MOCK'
#!/bin/sh
if [ -n "${APKS_DIRS:-}" ]; then
  while IFS= read -r _dir || [ -n "${_dir}" ]; do
    [ -z "${_dir}" ] && continue
    if ! test -d "${_dir}"; then
      printf 1>&2 'ERROR: APK directory not found: %s\n' "${_dir}"
      exit 1
    fi
  done << __DIRS__
${APKS_DIRS}
__DIRS__
fi
printf 'DIRS=%s\n'  "${APKS_DIRS:-}"  >> "${MOCK_OUTPUT_FILE:-/dev/null}"
printf 'FILES=%s\n' "${APKS_FILES:-}" >> "${MOCK_OUTPUT_FILE:-/dev/null}"
exit 0
MOCK
  chmod +x "${MOCK_DIR}/node"

  # Prepend mock directory so our fake node takes precedence
  export PATH="${MOCK_DIR}:${PATH}"

  # Suppress interactive "Press any key" prompt
  export CI='true'
  export NO_PAUSE='1'
}

teardown() {
  rm -rf "${MOCK_DIR}"
}

# ---------------------------------------------------------------------------
# Version and error reporting
# ---------------------------------------------------------------------------

@test "--version prints script name and version number" {
  run sh "${SCRIPT}" --version
  [ "${status}" -eq 0 ]
  echo "${output}" | grep -q 'Check app updates'
  echo "${output}" | grep -qE 'v[0-9]'
}

@test "unrecognized long option reports error and exits 2" {
  run sh "${SCRIPT}" --unknown-option
  [ "${status}" -eq 2 ]
  echo "${output}" | grep -q 'unrecognized option'
}

@test "invalid short option reports error and exits 2" {
  run sh "${SCRIPT}" -z
  [ "${status}" -eq 2 ]
  echo "${output}" | grep -q 'invalid option'
}

# ---------------------------------------------------------------------------
# --dir validation
# ---------------------------------------------------------------------------

@test "--dir with nonexistent path reports error and exits 1" {
  run sh "${SCRIPT}" --dir '/nonexistent/path/to/apks'
  [ "${status}" -eq 1 ]
  echo "${output}" | grep -q 'APK directory not found'
}

@test "first --dir nonexistent even when second exists reports error and exits 1" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir '/nonexistent/first' --dir "${tmp_dir}"
  rmdir "${tmp_dir}"
  [ "${status}" -eq 1 ]
  echo "${output}" | grep -q 'APK directory not found'
}

# ---------------------------------------------------------------------------
# Single flag: --dir and --file
# ---------------------------------------------------------------------------

@test "single --dir sets APKS_DIRS" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir "${tmp_dir}"
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir}" "${MOCK_OUTPUT_FILE}"
}

@test "single --file sets APKS_FILES" {
  run sh "${SCRIPT}" --file '/tmp/first.apk'
  [ "${status}" -eq 0 ]
  grep -qF '/tmp/first.apk' "${MOCK_OUTPUT_FILE}"
}

# ---------------------------------------------------------------------------
# Multiple flags: accumulation
# ---------------------------------------------------------------------------

@test "multiple --file flags all accumulate in APKS_FILES" {
  run sh "${SCRIPT}" --file '/tmp/first.apk' --file '/tmp/second.apk'
  [ "${status}" -eq 0 ]
  grep -qF '/tmp/first.apk'  "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/second.apk' "${MOCK_OUTPUT_FILE}"
}

@test "multiple --dir flags all accumulate in APKS_DIRS" {
  local tmp_dir1 tmp_dir2
  tmp_dir1="$(mktemp -d)"
  tmp_dir2="$(mktemp -d)"
  run sh "${SCRIPT}" --dir "${tmp_dir1}" --dir "${tmp_dir2}"
  rmdir "${tmp_dir1}" "${tmp_dir2}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir1}" "${MOCK_OUTPUT_FILE}"
  grep -qF "${tmp_dir2}" "${MOCK_OUTPUT_FILE}"
}

# ---------------------------------------------------------------------------
# Combined --dir and --file
# ---------------------------------------------------------------------------

@test "--dir and multiple --file together set both APKS_DIRS and APKS_FILES" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir "${tmp_dir}" --file '/tmp/a.apk' --file '/tmp/b.apk'
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir}"    "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/a.apk'   "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/b.apk'   "${MOCK_OUTPUT_FILE}"
}

@test "multiple --dir and multiple --file together set all values" {
  local tmp_dir1 tmp_dir2
  tmp_dir1="$(mktemp -d)"
  tmp_dir2="$(mktemp -d)"
  run sh "${SCRIPT}" \
    --dir "${tmp_dir1}" \
    --dir "${tmp_dir2}" \
    --file '/tmp/c.apk' \
    --file '/tmp/d.apk'
  rmdir "${tmp_dir1}" "${tmp_dir2}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir1}" "${MOCK_OUTPUT_FILE}"
  grep -qF "${tmp_dir2}" "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/c.apk'  "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/d.apk'  "${MOCK_OUTPUT_FILE}"
}

# ---------------------------------------------------------------------------
# Edge case: only --file without --dir
# ---------------------------------------------------------------------------

@test "only --file without --dir succeeds and sets APKS_FILES" {
  run sh "${SCRIPT}" --file '/tmp/only.apk'
  [ "${status}" -eq 0 ]
  grep -qF '/tmp/only.apk' "${MOCK_OUTPUT_FILE}"
  # APKS_DIRS must be empty (line is exactly "DIRS=")
  grep -qxF 'DIRS=' "${MOCK_OUTPUT_FILE}"
}

# ---------------------------------------------------------------------------
# Positional arguments
# ---------------------------------------------------------------------------

@test "positional directory argument is added to APKS_DIRS" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" "${tmp_dir}"
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir}" "${MOCK_OUTPUT_FILE}"
  # APKS_FILES must be empty (line is exactly "FILES=")
  grep -qxF 'FILES=' "${MOCK_OUTPUT_FILE}"
}

@test "positional non-directory argument is added to APKS_FILES" {
  run sh "${SCRIPT}" '/tmp/some.apk'
  [ "${status}" -eq 0 ]
  grep -qF '/tmp/some.apk' "${MOCK_OUTPUT_FILE}"
  # APKS_DIRS must be empty (line is exactly "DIRS=")
  grep -qxF 'DIRS=' "${MOCK_OUTPUT_FILE}"
}
