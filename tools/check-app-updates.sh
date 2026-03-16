#!/usr/bin/env sh
# @name Check app updates
# @brief Check for updates of Android APKs against F-Droid and microG repos

# SPDX-FileCopyrightText: (c) 2026 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

# shellcheck enable=all
# shellcheck disable=SC3043 # In POSIX sh, local is undefined

readonly SCRIPT_NAME='Check app updates'
readonly SCRIPT_SHORTNAME='CheckAppUpdates'
readonly SCRIPT_VERSION='0.1.0'
readonly SCRIPT_AUTHOR='ale5000'

set -u

pause_if_needed()
{
  # shellcheck disable=SC3028 # Ignore: In POSIX sh, SHLVL is undefined
  if test "${NO_PAUSE:-0}" = '0' && test "${no_pause:-0}" = '0' && test "${CI:-false}" = 'false' && test "${TERM_PROGRAM:-unknown}" != 'vscode' && test "${SHLVL:-1}" = '1' && test -t 0 && test -t 1 && test -t 2; then
    if test -n "${NO_COLOR-}"; then
      printf 1>&2 '\n%s' 'Press any key to exit... ' || :
    else
      printf 1>&2 '\n\033[1;32m\r%s' 'Press any key to exit... ' || :
    fi
    # shellcheck disable=SC3045 # Ignore: In POSIX sh, read -s / -n is undefined
    IFS='' read 2> /dev/null 1>&2 -r -s -n1 _ || IFS='' read 1>&2 -r _ || :
    printf 1>&2 '\n' || :
    test -n "${NO_COLOR-}" || printf 1>&2 '\033[0m\r    \r' || :
  fi
  unset no_pause || :
  return "${1:-0}"
}

show_status()
{
  printf 1>&2 '\033[1;32m%s\033[0m\n' "${1?}"
}

show_error()
{
  printf 1>&2 '\033[1;31m%s\033[0m\n' "ERROR: ${1?}"
}

find_aapt()
{
  if command -v 'aapt' 1>/dev/null 2>&1; then
    command -v 'aapt'
    return 0
  elif command -v 'aapt2' 1>/dev/null 2>&1; then
    command -v 'aapt2'
    return 0
  elif test -n "${ANDROID_SDK_ROOT:-}"; then
    find "${ANDROID_SDK_ROOT}/build-tools" \
      -name 'aapt' -type f 2>/dev/null \
      | sort -V | tail -1
    return 0
  fi
  return 1
}

# Collect APK info from base_dir, write JSON array to out_file.
# Uses aapt_bin to extract package name and version, keytool for cert SHA-256.
# APK paths are sorted before processing.
collect_apk_info()
{
  local base_dir="${1?}" out_file="${2?}" aapt_bin="${3?}"
  local apk_list_file entries_file
  local apk_path file_name rel_path file_size
  local pkg_line pkg version_code cert_sha256 entry
  local apk_count sep line

  apk_list_file="${out_file}.list"
  entries_file="${out_file}.entries"

  # Build sorted list of APK paths (pipe to file, not to while, to avoid
  # POSIX subshell issues with variable scope)
  find "${base_dir}" -name '*.apk' -type f 2>/dev/null \
    | sort > "${apk_list_file}"

  : > "${entries_file}"
  apk_count='0'

  while IFS= read -r apk_path; do
    test -n "${apk_path}" || continue

    file_name="$(basename "${apk_path}")"
    rel_path="${apk_path#"${base_dir}/"}"

    # Skip LFS pointer files (tiny text files, not real APKs)
    file_size="$(wc -c < "${apk_path}")"
    if [ "${file_size}" -lt 1024 ] && \
       grep -m 1 -q -e '^version https://git-lfs.github.com/spec/v1$' \
         -- "${apk_path}"; then
      printf 'WARNING: skipping LFS pointer (not in cache): %s\n' \
        "${file_name}" 1>&2
      continue
    fi

    # Package name and version code from APK manifest
    pkg_line="$("${aapt_bin}" dump badging "${apk_path}" \
      2>/dev/null | grep '^package:' || true)"
    pkg="$(printf '%s' "${pkg_line}" \
      | grep -o " name='[^']*'" \
      | head -1 | cut -d"'" -f2)"
    version_code="$(printf '%s' "${pkg_line}" \
      | grep -o "[[:space:]]versionCode='[^']*'" \
      | head -1 | cut -d"'" -f2)"

    test -n "${pkg}" || {
      printf 'WARNING: skipping %s (package name not found)\n' \
        "${file_name}" 1>&2
      continue
    }

    # SHA-256 of the signing certificate via keytool
    cert_sha256="$(keytool -printcert -jarfile "${apk_path}" \
      2>/dev/null \
      | grep 'SHA256:' | head -1 \
      | sed 's/.*SHA256:[[:space:]]*//' \
      | tr -d ':' \
      | tr '[:upper:]' '[:lower:]' \
      | tr -d '[:space:]')"

    if test -z "${cert_sha256}"; then
      printf 'WARNING: skipping %s (cert not found)\n' \
        "${file_name}" 1>&2
      continue
    fi

    printf 'INFO: %s: pkg=%s, vc=%s, cert=%s\n' \
      "${file_name}" "${pkg}" "${version_code:-?}" "${cert_sha256}"

    # Build JSON entry (package names and hex hashes need no escaping)
    entry='{"fileName":"'"${file_name}"'"'
    entry="${entry}"',"relPath":"'"${rel_path}"'"'
    entry="${entry}"',"packageName":"'"${pkg}"'"'
    entry="${entry}"',"versionCode":'"${version_code:-0}"
    entry="${entry}"',"certSha256":"'"${cert_sha256}"'"}'
    printf '%s\n' "${entry}" >> "${entries_file}"
    apk_count="$((apk_count + 1))"
  done < "${apk_list_file}"

  # Wrap entries into a JSON array
  printf '[' > "${out_file}"
  sep=''
  while IFS= read -r line; do
    printf '%s%s' "${sep}" "${line}" >> "${out_file}"
    sep=','
  done < "${entries_file}"
  printf ']\n' >> "${out_file}"

  rm -f -- "${apk_list_file}" "${entries_file}"

  local plural
  test "${apk_count}" = '1' && plural='y' || plural='ies'
  printf 'Written %s APK entr%s to %s\n' "${apk_count}" "${plural}" "${out_file}"
}

main()
{
  local apk_dir="${1:-}"
  local script_dir repo_dir aapt_bin tmp_dir

  # Resolve the directory containing this script and the repo root
  script_dir="$(cd "$(dirname "${0}")" && pwd)"
  repo_dir="$(cd "${script_dir}/.." && pwd)"

  # Default APK directory: zip-content/origin/ relative to the repo root
  if test -z "${apk_dir}"; then
    apk_dir="${repo_dir}/zip-content/origin"
  fi

  test -d "${apk_dir}" || {
    show_error "APK directory not found: ${apk_dir}"
    return 1
  }

  # Check required tools
  command -v 'node' 1>/dev/null 2>&1 || {
    show_error "'node' not found. Please install Node.js."
    return 1
  }
  command -v 'keytool' 1>/dev/null 2>&1 || {
    show_error "'keytool' not found. Please install a JDK."
    return 1
  }

  aapt_bin="$(find_aapt)" || {
    show_error "'aapt' not found. Please install Android build-tools or set ANDROID_SDK_ROOT."
    return 1
  }
  printf 'Using aapt: %s\n' "${aapt_bin}"
  printf 'APK directory: %s\n\n' "${apk_dir}"

  # Create a temporary directory; clean it up on exit
  tmp_dir="$(mktemp -d)"
  # shellcheck disable=SC2064 # We want the current value of tmp_dir
  trap "rm -rf -- '${tmp_dir}'" EXIT

  collect_apk_info "${apk_dir}" "${tmp_dir}/apk_info.json" "${aapt_bin}"

  printf '\n'
  RUNNER_TEMP="${tmp_dir}" node "${script_dir}/run-check-app-updates.mjs"
}

STATUS=0
execute_script='true'
apk_dir_arg=''

while test "${#}" -gt 0; do
  case "${1?}" in
    -V | --version)
      printf '%s\n' "${SCRIPT_NAME:?} v${SCRIPT_VERSION:?}"
      printf '%s\n' "Copy""right (c) 2026 ${SCRIPT_AUTHOR:?}"
      printf '%s\n' 'License GPLv3+'
      execute_script='false'
      ;;

    --dir)
      shift
      apk_dir_arg="${1?}"
      ;;

    --)
      shift
      break
      ;;

    --*)
      printf 1>&2 '%s\n' "${SCRIPT_SHORTNAME?}: unrecognized option '${1}'"
      execute_script='false'
      STATUS=2
      ;;

    -*)
      printf 1>&2 '%s\n' "${SCRIPT_SHORTNAME?}: invalid option -- '${1#-}'"
      execute_script='false'
      STATUS=2
      ;;

    *)
      break
      ;;
  esac

  shift
done

# Accept a positional argument as an alternative to --dir
if test "${#}" -gt 0 && test -z "${apk_dir_arg}"; then
  apk_dir_arg="${1}"
  shift
fi

if test "${execute_script:?}" = 'true'; then
  show_status "${SCRIPT_NAME:?} v${SCRIPT_VERSION:?} by ${SCRIPT_AUTHOR:?}"

  main "${apk_dir_arg}" || STATUS="${?}"
fi

pause_if_needed "${STATUS:?}"
exit "${?}"
