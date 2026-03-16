#!/usr/bin/env bats
# SPDX-FileCopyrightText: (c) 2026 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

# Bats-core test suite for tools/check-app-updates.sh

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="${REPO_DIR}/tools/check-app-updates.sh"

setup() {
  # Create a temporary directory for mock binaries and test artifacts
  MOCK_DIR="$(mktemp -d)"
  MOCK_OUTPUT="${MOCK_DIR}/node_output"

  # Mock node: captures APKS_BASE_DIR and APKS_FILES to MOCK_OUTPUT_FILE
  # (inherited from the parent environment), then exits cleanly.
  cat > "${MOCK_DIR}/node" << 'MOCK'
#!/bin/sh
printf 'BASE_DIR=%s\n' "${APKS_BASE_DIR:-}" >> "${MOCK_OUTPUT_FILE:-/dev/null}"
printf 'FILES=%s\n'    "${APKS_FILES:-}"    >> "${MOCK_OUTPUT_FILE:-/dev/null}"
exit 0
MOCK
  chmod +x "${MOCK_DIR}/node"

  # Prepend the mock directory so our fake node takes precedence
  export PATH="${MOCK_DIR}:${PATH}"
  export MOCK_OUTPUT_FILE="${MOCK_OUTPUT}"

  # Suppress the interactive "Press any key" prompt
  export CI='true'
  export NO_PAUSE='1'
}

teardown() {
  rm -rf "${MOCK_DIR}"
}

# ---------------------------------------------------------------------------
# Argument parsing — no node required
# ---------------------------------------------------------------------------

@test "--version prints script name and version number" {
  run sh "${SCRIPT}" --version
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"Check app updates"* ]]
  [[ "${output}" == *"v"[0-9]* ]]
}

@test "unknown long option exits with code 2" {
  run sh "${SCRIPT}" --unknown-option
  [ "${status}" -eq 2 ]
  [[ "${output}" == *"unrecognized option"* ]]
}

@test "invalid short option exits with code 2" {
  run sh "${SCRIPT}" -z
  [ "${status}" -eq 2 ]
  [[ "${output}" == *"invalid option"* ]]
}

@test "--dir with non-existent path exits with code 1" {
  run sh "${SCRIPT}" --dir '/nonexistent/path/to/apks'
  [ "${status}" -eq 1 ]
  [[ "${output}" == *"APK directory not found"* ]]
}

# ---------------------------------------------------------------------------
# Environment variable forwarding — uses mock node
# ---------------------------------------------------------------------------

@test "--dir sets APKS_BASE_DIR for node" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir "${tmp_dir}"
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "BASE_DIR=${tmp_dir}" "${MOCK_OUTPUT_FILE}"
}

@test "single --file sets APKS_FILES for node" {
  run sh "${SCRIPT}" --file '/tmp/first.apk'
  [ "${status}" -eq 0 ]
  grep -qF '/tmp/first.apk' "${MOCK_OUTPUT_FILE}"
}

@test "multiple --file flags all accumulate in APKS_FILES" {
  run sh "${SCRIPT}" --file '/tmp/first.apk' --file '/tmp/second.apk'
  [ "${status}" -eq 0 ]
  grep -qF '/tmp/first.apk'  "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/second.apk' "${MOCK_OUTPUT_FILE}"
}

@test "--dir and multiple --file together set both env vars" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run sh "${SCRIPT}" --dir "${tmp_dir}" --file '/tmp/a.apk' --file '/tmp/b.apk'
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  grep -qF "BASE_DIR=${tmp_dir}" "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/a.apk' "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/b.apk' "${MOCK_OUTPUT_FILE}"
}

@test "multiple --dir: last value wins; multiple --file all accumulate" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # The first --dir points to a non-existent path; the second overrides it
  run sh "${SCRIPT}" \
    --dir '/nonexistent/first' \
    --dir "${tmp_dir}" \
    --file '/tmp/c.apk' \
    --file '/tmp/d.apk'
  rmdir "${tmp_dir}"
  [ "${status}" -eq 0 ]
  # Last --dir wins
  grep -qF  "BASE_DIR=${tmp_dir}"   "${MOCK_OUTPUT_FILE}"
  ! grep -qF 'BASE_DIR=/nonexistent/first' "${MOCK_OUTPUT_FILE}"
  # Both --file values are present
  grep -qF '/tmp/c.apk' "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/d.apk' "${MOCK_OUTPUT_FILE}"
}

@test "no --dir with only --file: APKS_BASE_DIR is empty" {
  run sh "${SCRIPT}" --file '/tmp/only.apk'
  [ "${status}" -eq 0 ]
  grep -qF 'BASE_DIR=' "${MOCK_OUTPUT_FILE}"
  grep -qF '/tmp/only.apk' "${MOCK_OUTPUT_FILE}"
}
