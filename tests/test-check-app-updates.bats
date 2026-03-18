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

  # Shared file to track per-test results for the final summary
  BATS_RESULTS_FILE="$(mktemp)"
  export BATS_RESULTS_FILE
}

# ---------------------------------------------------------------------------
# Per-test setup: create a mock node binary that records env vars
# ---------------------------------------------------------------------------

setup() {
  MOCK_DIR="$(mktemp -d)"
  export MOCK_OUTPUT_FILE="${MOCK_DIR}/node_output"

  # Mock node: validates APKS_DIRS elements (mimics app-update-checker-lib.mjs run()),
  # warning and skipping entries that are not directories, then records env vars.
  cat > "${MOCK_DIR}/node" << 'MOCK'
#!/bin/sh
if [ -n "${APKS_DIRS:-}" ]; then
  while IFS= read -r _dir || [ -n "${_dir}" ]; do
    [ -z "${_dir}" ] && continue
    if ! test -d "${_dir}"; then
      printf 1>&2 'WARNING: APK directory not found, skipping: %s\n' "${_dir}"
    fi
  done << __DIRS__
${APKS_DIRS}
__DIRS__
fi
printf 'DIRS=%s\n'      "${APKS_DIRS:-}"      >> "${MOCK_OUTPUT_FILE:-/dev/null}"
printf 'FILES=%s\n'     "${APKS_FILES:-}"     >> "${MOCK_OUTPUT_FILE:-/dev/null}"
printf 'DUMP_INFO=%s\n' "${APKS_DUMP_INFO:-}" >> "${MOCK_OUTPUT_FILE:-/dev/null}"
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
  local _result
  if [ -n "${BATS_TEST_SKIPPED:-}" ]; then
    _result='skipped'
  elif [ "${BATS_TEST_COMPLETED:-0}" = '1' ]; then
    _result='passed'
  else
    _result='failed'
  fi
  printf '%s\n' "${_result}" >> "${BATS_RESULTS_FILE:-/dev/null}"
  rm -rf "${MOCK_DIR}"
}

teardown_file() {
  local _total _passed _failed _skipped _line
  _total=0; _passed=0; _failed=0; _skipped=0
  if [ -f "${BATS_RESULTS_FILE:-}" ]; then
    while IFS= read -r _line || [ -n "${_line}" ]; do
      [ -z "${_line}" ] && continue
      _total=$((_total + 1))
      case "${_line}" in
        passed)  _passed=$((_passed + 1)) ;;
        failed)  _failed=$((_failed + 1)) ;;
        skipped) _skipped=$((_skipped + 1)) ;;
      esac
    done < "${BATS_RESULTS_FILE}"
    rm -f "${BATS_RESULTS_FILE}"
  fi
  printf '\n── Test Summary ──\nTotal: %d  Passed: %d  Failed: %d  Skipped: %d\n' \
    "${_total}" "${_passed}" "${_failed}" "${_skipped}" >&3
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

@test "--dir with nonexistent path warns and exits 0" {
  run sh "${SCRIPT}" --dir '/nonexistent/path/to/apks'
  [ "${status}" -eq 0 ]
  # The path is still forwarded to node (node warns and skips it internally)
  grep -qF '/nonexistent/path/to/apks' "${MOCK_OUTPUT_FILE}"
}

@test "first --dir nonexistent with second existing exits 0" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir '/nonexistent/first' --dir "${tmp_dir}"
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir}" "${MOCK_OUTPUT_FILE}"
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

# ---------------------------------------------------------------------------
# --dump-info flag
# ---------------------------------------------------------------------------

@test "--dump-info sets APKS_DUMP_INFO=1" {
  run sh "${SCRIPT}" --file '/tmp/app.apk' --dump-info
  [ "${status}" -eq 0 ]
  grep -qxF 'DUMP_INFO=1' "${MOCK_OUTPUT_FILE}"
}

@test "without --dump-info APKS_DUMP_INFO is empty" {
  run sh "${SCRIPT}" --file '/tmp/app.apk'
  [ "${status}" -eq 0 ]
  grep -qxF 'DUMP_INFO=' "${MOCK_OUTPUT_FILE}"
}

@test "--dump-info can be combined with --dir and --file" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir "${tmp_dir}" --file '/tmp/extra.apk' --dump-info
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "${tmp_dir}"     "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/extra.apk' "${MOCK_OUTPUT_FILE}"
  grep -qxF 'DUMP_INFO=1'   "${MOCK_OUTPUT_FILE}"
}

# ---------------------------------------------------------------------------
# Edge cases: number-like, null-string, and empty entries in dirs/files lists
# ---------------------------------------------------------------------------

@test "dirs and files lists with number-like and null-string entries are accepted" {
  # Values like '42' (number-like) and 'null' (null-like string) are valid
  # path strings from the shell's point of view; the JS library is responsible
  # for deciding whether they exist on disk.  The script must pass them through
  # unchanged so Node can validate them.
  run sh "${SCRIPT}" --dir '42' --dir 'null' --file '42' --file 'null'
  [ "${status}" -eq 0 ]
  grep -qF '42'   "${MOCK_OUTPUT_FILE}"
  grep -qF 'null' "${MOCK_OUTPUT_FILE}"
}

@test "empty-string entries in dirs and files are handled gracefully" {
  # Passing empty strings for both --dir and --file should not crash the
  # script; the resulting APKS_DIRS and APKS_FILES env vars will be empty,
  # which is an accepted (no-op) state for the JS library.
  run sh "${SCRIPT}" --dir '' --file ''
  [ "${status}" -eq 0 ]
  grep -qxF 'DIRS='  "${MOCK_OUTPUT_FILE}"
  grep -qxF 'FILES=' "${MOCK_OUTPUT_FILE}"
}

# ---------------------------------------------------------------------------
# Default directory: zip-content/origin
# ---------------------------------------------------------------------------

@test "no args: JS library uses zip-content/origin as default directory" {
  # Remove the mock node from PATH so the real Node.js handles the library.
  local real_path="${PATH#${MOCK_DIR}:}"

  # Use a workspace directory that has no zip-content/origin subdirectory so
  # the library emits a warning containing the path and exits with EX_NOINPUT.
  local tmp_workspace
  tmp_workspace="$(mktemp -d)"

  run sh -c "GITHUB_WORKSPACE='${tmp_workspace}' PATH='${real_path}' sh '${SCRIPT}' 2>&1"

  rm -rf "${tmp_workspace}"

  # EX_NOINPUT (66): no APKs could be processed because the default dir is absent
  [ "${status}" -eq 66 ]
  # The warning or error output must mention the default directory path
  echo "${output}" | grep -qF 'zip-content/origin'
}
