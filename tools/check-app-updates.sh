#!/usr/bin/env sh
# @name Check app updates
# @brief Check for updates of Android APKs against F-Droid and microG repos

# SPDX-FileCopyrightText: (c) 2026 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

# shellcheck enable=all
# shellcheck disable=SC3043 # In POSIX sh, local is undefined

readonly SCRIPT_NAME='Check app updates'
readonly SCRIPT_SHORTNAME='CheckAppUpdates'
readonly SCRIPT_VERSION='0.3.0'
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

main()
{
  local apk_dirs="${1:-}" apk_files="${2:-}"
  local script_dir repo_dir _dir _dirs_ok apk_file_count

  # Resolve the directory containing this script and the repo root
  script_dir="$(cd "$(dirname "${0}")" && pwd)"
  repo_dir="$(cd "${script_dir}/.." && pwd)"

  # Default APK directory when neither --dir nor --file is given
  if test -z "${apk_dirs}" && test -z "${apk_files}"; then
    apk_dirs="${repo_dir}/zip-content/origin"
  fi

  # Validate each directory in the newline-separated list
  if test -n "${apk_dirs}"; then
    _dirs_ok='true'
    while IFS= read -r _dir || test -n "${_dir}"; do
      test -z "${_dir}" && continue
      if ! test -d "${_dir}"; then
        show_error "APK directory not found: ${_dir}"
        _dirs_ok='false'
        break
      fi
    done <<EOF
${apk_dirs}
EOF
    test "${_dirs_ok}" = 'true' || return 1
  fi

  # Node.js 24+ is required (the library checks at import time, but give a
  # clear error here too so the user sees it before Node even starts)
  command -v 'node' 1>/dev/null 2>&1 || {
    show_error "'node' not found. Please install Node.js 24 or later."
    return 1
  }

  if test -n "${apk_dirs}"; then
    while IFS= read -r _dir || test -n "${_dir}"; do
      test -z "${_dir}" && continue
      printf 'APK directory: %s\n' "${_dir}"
    done <<EOF
${apk_dirs}
EOF
  fi
  if test -n "${apk_files}"; then
    apk_file_count="$(printf '%s' "${apk_files}" | grep -c . || true)"
    printf 'APK file(s): %s\n' "${apk_file_count}"
  fi
  printf '\n'

  # APK info extraction and update checking are both handled by the JS library.
  # APKS_DIRS:  newline-separated list of APK directories to scan.
  # APKS_FILES: newline-separated list of explicit APK paths (overrides/adds to scan).
  APKS_DIRS="${apk_dirs}" APKS_FILES="${apk_files}" \
    node "${repo_dir}/includes/app-update-checker-lib.mjs"
}

STATUS=0
execute_script='true'
apk_dirs_arg=''
apk_files_arg=''

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
      apk_dirs_arg="${apk_dirs_arg:+${apk_dirs_arg}
}${1?}"
      ;;

    --file)
      shift
      apk_files_arg="${apk_files_arg:+${apk_files_arg}
}${1?}"
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
if test "${#}" -gt 0 && test -z "${apk_dirs_arg}"; then
  apk_dirs_arg="${1}"
  shift
fi

if test "${execute_script:?}" = 'true'; then
  show_status "${SCRIPT_NAME:?} v${SCRIPT_VERSION:?} by ${SCRIPT_AUTHOR:?}"

  main "${apk_dirs_arg}" "${apk_files_arg}" || STATUS="${?}"
fi

pause_if_needed "${STATUS:?}"
exit "${?}"
