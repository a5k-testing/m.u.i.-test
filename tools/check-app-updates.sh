#!/usr/bin/env sh
# @name Check app updates
# @brief Check for updates of Android APKs against F-Droid and microG repos

# SPDX-FileCopyrightText: (c) 2026 ale5000
# SPDX-License-Identifier: GPL-3.0-or-later

# shellcheck enable=all
# shellcheck disable=SC3043 # In POSIX sh, local is undefined

readonly SCRIPT_NAME='Check app updates'
readonly SCRIPT_SHORTNAME='CheckAppUpdates'
readonly SCRIPT_VERSION='0.2.0'
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
  local apk_dir="${1:-}"
  local script_dir repo_dir

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

  # Node.js 24+ is required (the library checks at import time, but give a
  # clear error here too so the user sees it before Node even starts)
  command -v 'node' 1>/dev/null 2>&1 || {
    show_error "'node' not found. Please install Node.js 24 or later."
    return 1
  }

  printf 'APK directory: %s\n\n' "${apk_dir}"

  # APK info extraction and update checking are both handled by the JS library.
  # Pass the APK directory via APKS_BASE_DIR; Node discovers aapt/keytool itself.
  APKS_BASE_DIR="${apk_dir}" node "${script_dir}/run-check-app-updates.mjs"
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
