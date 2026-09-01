#!/usr/bin/env python
# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: 2026 ale5000
# SPDX-License-Identifier: LGPL-3.0-or-later

"""
Configuration file for the Sphinx documentation builder.

This module contains the configuration settings for generating documentation
using Sphinx. For a full list of built-in configuration values, see:
https://www.sphinx-doc.org/en/master/usage/configuration.html
"""

import datetime
import os
import re
import shutil
import subprocess  # nosec: B404
import sys

from docutils import nodes
from sphinx import addnodes
from sphinx.util import logging

try:
    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from typing import IO, Any, Callable, Final  # noqa: F401

        from sphinx.application import Sphinx  # noqa: F401
except ImportError:
    pass

try:
    from subprocess import DEVNULL as _TMP_DEVNULL  # nosec: B404

    _DEVNULL = _TMP_DEVNULL  # type: int | IO[Any]
except ImportError:
    import atexit

    _DEVNULL = open(os.devnull, "wb")  # noqa: SIM115
    atexit.register(_DEVNULL.close)

try:
    # Attempt to use the native shutil.which for Python 3.3+
    from shutil import which as _tmp_shutil_which

    _shutil_which = _tmp_shutil_which  # type: Callable[..., str | None] | None
except ImportError:
    _shutil_which = None

try:
    from datetime import timezone as _tmp_tz

    _UTC = _tmp_tz.utc  # type: datetime.tzinfo
except ImportError:

    class TimezoneUTC(datetime.tzinfo):
        """
        UTC implementation for compatibility with legacy Python versions.

        Ensures 'aware' datetime objects can be used for UTC time.
        """

        def utcoffset(self, _dt):
            # type: (datetime.datetime | None) -> datetime.timedelta
            return datetime.timedelta(0)

        def dst(self, _dt):
            # type: (datetime.datetime | None) -> datetime.timedelta
            return datetime.timedelta(0)

        def tzname(self, _dt):
            # type: (datetime.datetime | None) -> str
            return "UTC"

    _UTC = TimezoneUTC()

logger = logging.getLogger(__name__)  # type: Final

_DOCS_DIR = os.path.dirname(os.path.abspath(__file__))  # type: Final
_REPO_ROOT = os.path.normpath(os.path.join(_DOCS_DIR, ".."))  # type: Final

# Directory where generated Markdown files for stand-alone tools/utils are written
_SHDOC_SCRIPTS_OUTPUT_DIR = os.path.join(_DOCS_DIR, "scripts")  # type: Final
# Directory where generated Markdown files for internal/developer scripts are written
_SHDOC_DEVEL_OUTPUT_DIR = os.path.join(_DOCS_DIR, "devel")  # type: Final

# Shell scripts that form part of the *developer guide* (internal/zip-content
# scripts).  Their documentation is placed under ``devel/`` because it is
# intended for contributors and developers, not end-users.
_SHDOC_DEVEL_SCRIPTS = (
    "zip-content/inc/common-functions.sh",
    "zip-content/zip-install.sh",
)  # type: Final[tuple[str, ...]]

_SHDOC_SCRIPTS_SKIP_TOOLS = {"help.sh"}  # type: Final[set[str]]


def which(cmd, mode=os.F_OK | os.X_OK, path=None):
    # type: (str, int, str | None) -> str | None
    """Find the full path to an executable file, mimicking shutil.which.

    :param cmd: The command to search for
    :param mode: The permission mode to check (default is exists and executable)
    :param path: Custom search path (defaults to the PATH environment variable)
    :return: Full path to the executable or None if not found
    """
    if _shutil_which:
        return _shutil_which(cmd, mode, path)

    # If cmd contains a path component, check it directly
    if os.path.dirname(cmd):
        if os.access(cmd, mode) and os.path.isfile(cmd):
            return cmd
        return None

    if path is None:
        path = os.environ.get("PATH", os.defpath)
    if not path:
        return None

    exts = ("", ".exe") if sys.platform == "win32" else ("",)  # type: Final

    for directory in path.split(os.pathsep):
        full_prefix = os.path.join(os.path.expanduser(directory), cmd)
        for ext in exts:
            candidate = full_prefix + ext
            if os.access(candidate, mode) and os.path.isfile(candidate):
                return candidate

    return None


def which(cmd, mode=os.F_OK | os.X_OK, path=None):
    # type: (str, int, str | None) -> str | None
    """
    Find the full path to an executable file, mimicking shutil.which.

    :param cmd: The command to search for
    :param mode: The permission mode to check (default is exists and executable)
    :param path: Custom search path (defaults to the PATH environment variable)
    :return: Full path to the executable or None if not found
    """
    if _shutil_which:
        return _shutil_which(cmd, mode, path)

    # If cmd contains a path component, check it directly
    if os.path.dirname(cmd):
        if os.access(cmd, mode) and os.path.isfile(cmd):
            return cmd
        return None

    if path is None:
        path = os.environ.get("PATH", os.defpath)
    if not path:
        return None

    exts = ("", ".exe") if sys.platform == "win32" else ("",)  # type: Final

    for directory in path.split(os.pathsep):
        full_prefix = os.path.join(os.path.expanduser(directory), cmd)
        for ext in exts:
            candidate = full_prefix + ext
            if os.access(candidate, mode) and os.path.isfile(candidate):
                return candidate

    return None


def get_version():
    # type: () -> str

    props_path = os.path.join(_REPO_ROOT, "zip-content", "module.prop")

    if os.path.exists(props_path):
        with open(props_path) as f:
            for line in f:
                if line.startswith("version="):
                    return line.replace("version=", "").lstrip("v").strip()
    return "0.0.0-unknown"


def get_revision():
    # type: () -> str | None

    # Use Read the Docs environment variables if available
    git_rev = os.environ.get("READTHEDOCS_GIT_COMMIT_HASH", "")[:8] or None
    git_id = os.environ.get("READTHEDOCS_GIT_IDENTIFIER")
    if git_rev:
        return "{0} ({1})".format(git_rev, git_id) if git_id else git_rev

    # Fallback to Git CLI
    git = which("git")  # type: Final
    if not git:
        return None
    try:
        return (
            # Safe: uses list-based arguments (no shell) to prevent injection
            subprocess.check_output(  # nosec: B603 # noqa: S603
                [git, "rev-parse", "--short=8", "HEAD"],  # nosemgrep
                stderr=_DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def _collect_shdoc_scripts():
    # type: () -> dict[str, list[str]]
    """Return shell scripts grouped by source directory.

    Returns a dict ``{"tools": [...], "utils": [...]}`` where each value is a
    sorted list of repository-relative paths
    (e.g. ``"tools/get-signature.sh"``).

    Scripts listed in :data:`_SHDOC_SCRIPTS_SKIP_TOOLS` are excluded from the
    ``tools`` list.
    """
    result = {}  # type: dict[str, list[str]]

    # Cache global constant to local variable for faster lookup
    skip_tools = _SHDOC_SCRIPTS_SKIP_TOOLS  # type: Final

    # Iterate through folders to reduce code duplication
    for folder in ("tools", "utils"):
        target_dir = os.path.join(_REPO_ROOT, folder)

        if os.path.isdir(target_dir):
            entries = sorted(os.listdir(target_dir))
            prefix = folder + os.sep

            # Use list comprehensions for performance
            if folder == "tools":
                result["tools"] = [
                    prefix + e
                    for e in entries
                    if e.endswith(".sh") and e not in skip_tools
                ]
            else:
                result[folder] = [
                    prefix + e for e in entries if e.endswith(".sh")
                ]

    return result


def _myst_slug(heading_text):
    r"""Return the myst_parser (GFM-compatible) anchor slug for *heading_text*.

    Algorithm: lowercase → keep ``\w`` chars (which includes ``_``), spaces
    and hyphens → replace spaces and underscores with ``-`` → strip leading/
    trailing ``-``.

    Example: ``"setup_app"`` → ``"setup-app"``
    """
    slug = heading_text.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    return slug.strip("-")


def _find_shdoc_cmd():
    """Return ``(cmd_list, None)`` for running shdoc, or ``(None, reason)``.

    shdoc (https://github.com/reconquest/shdoc) is a GNU AWK script.
    This function locates both *gawk* and the shdoc script, then returns a
    command prefix that, when the target shell script is appended, produces
    documentation on stdout.

    *reason* is one of ``"gawk"`` or ``"shdoc"`` when the corresponding tool
    is missing, so callers can emit tailored warning messages.

    Search order for the shdoc AWK script:

    1. ``shdoc`` entry in ``PATH`` (the AWK script installed as an executable)
    2. ``~/.local/bin/shdoc`` (download destination used by the RTD build)
    """
    extra_path = os.path.abspath(
        os.path.join(os.path.expanduser("~"), ".local", "bin"),
    )
    search_path = os.environ.get("PATH", "") + os.pathsep + extra_path

    gawk = shutil.which("gawk", path=search_path)
    if not gawk:
        logger.warning(
            "'gawk' not found; shell script docs will not be generated. "
            "Install GNU AWK (gawk) and rebuild.",
        )
        return None, "gawk"

    shdoc = shutil.which(
        "shdoc",
        path=search_path,
        mode=os.F_OK if sys.platform == "win32" else os.F_OK | os.X_OK,
    )
    if not shdoc:
        logger.warning(
            "'shdoc' not found; shell script docs will not be generated. "
            "Install it from https://github.com/reconquest/shdoc and rebuild.",
        )
        return None, "shdoc"

    # Run the shdoc AWK script via gawk
    return [os.path.abspath(gawk), "-f", os.path.abspath(shdoc)], None


def _write_scripts_index(tools_names, utils_names, missing=None):
    """Generate ``docs/scripts/index.rst`` with directory sections.

    *tools_names* and *utils_names* are sorted lists of doc-name stems from the
    ``tools/`` and ``utils/`` directories respectively.  When both are empty a
    placeholder page is written — the text varies depending on *missing*
    (``"gawk"`` or ``"shdoc"``) so readers know exactly what to install.
    """
    index_path = os.path.join(_SHDOC_SCRIPTS_OUTPUT_DIR, "index.rst")
    lines = [
        "#############",
        "Shell scripts",
        "#############",
        "",
        ".. SPDX-FileCopyrightText: NONE",
        ".. SPDX-License-Identifier: CC0-1.0",
        ".. This file is auto-generated by conf.py — do not edit manually.",
        "",
    ]

    if tools_names or utils_names:
        lines += [
            "Auto-generated reference documentation for the stand-alone utility scripts",
            "shipped with this project (``tools/`` and ``utils/`` directories).",
            "Annotations are extracted from inline comments using",
            "`shdoc <https://github.com/reconquest/shdoc>`_.",
            "",
        ]
        for section_title, underline_char, names in [
            ("Tools", "-", tools_names),
            ("Utilities", "-", utils_names),
        ]:
            if not names:
                continue
            lines += [
                section_title,
                underline_char * len(section_title),
                "",
                ".. toctree::",
                "   :maxdepth: 1",
                "",
            ]
            for name in sorted(names):
                lines.append(f"   {name}")
            lines.append("")
    else:
        _append_placeholder(lines, missing)

    lines.append("")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _write_devel_index(doc_names, missing=None):
    """Write ``docs/devel/index.rst`` listing all *doc_names*.

    These are internal/developer scripts (e.g. ``zip-content/``) whose
    documentation forms part of the *developer guide* — intended for
    contributors who need to understand the build internals.

    When *doc_names* is empty a placeholder page is written — the text varies
    depending on *missing* (``"gawk"`` or ``"shdoc"``) so readers know exactly
    what to install.
    """
    index_path = os.path.join(_SHDOC_DEVEL_OUTPUT_DIR, "index.rst")
    lines = [
        "###############",
        "Developer guide",
        "###############",
        "",
        ".. SPDX-FileCopyrightText: NONE",
        ".. SPDX-License-Identifier: CC0-1.0",
        ".. This file is auto-generated by conf.py — do not edit manually.",
        "",
    ]

    if doc_names:
        lines += [
            "Auto-generated reference documentation for the internal build scripts",
            "(e.g. ``zip-content/``).  This section is part of the *developer guide*",
            "and is intended for contributors who need to understand or modify the",
            "build internals.  Annotations are extracted using",
            "`shdoc <https://github.com/reconquest/shdoc>`_.",
            "",
            ".. toctree::",
            "   :maxdepth: 1",
            "",
        ]
        for name in sorted(doc_names):
            lines.append(f"   {name}")
    else:
        _append_placeholder(lines, missing)

    lines.append("")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _append_placeholder(lines, missing):
    """Append a placeholder block to *lines* explaining what is missing."""
    if missing == "gawk":
        lines += [
            "Script documentation could not be generated because",
            "**gawk** (GNU AWK) was not found during this build.",
            "",
            ".. note::",
            "",
            "   Install GNU AWK and rebuild to see the generated documentation.",
            "   On Debian/Ubuntu: ``sudo apt-get install gawk``",
        ]
    else:
        lines += [
            "Shell script documentation is generated automatically when",
            "`shdoc <https://github.com/reconquest/shdoc>`_ is available.",
            "",
            ".. note::",
            "",
            "   ``shdoc`` was not found during this build.",
            "   Install it from https://github.com/reconquest/shdoc and rebuild",
            "   to see the generated documentation.",
        ]


def _generate_shdoc(_app):
    """Sphinx ``builder-inited`` handler: run shdoc and emit Markdown files.

    Executes shdoc (https://github.com/reconquest/shdoc) against every entry
    in :data:`_SHDOC_DEVEL_SCRIPTS` and the scripts discovered by
    :func:`_collect_shdoc_scripts`, writing the generated Markdown output to
    :data:`_SHDOC_DEVEL_OUTPUT_DIR` and :data:`_SHDOC_SCRIPTS_OUTPUT_DIR`
    respectively.

    Index pages are always written for both folders so the toctree references
    in ``index.rst`` remain valid even when shdoc is not installed.
    """
    # Clean and recreate output dirs to avoid stale files from previous builds
    for _dir in (_SHDOC_SCRIPTS_OUTPUT_DIR, _SHDOC_DEVEL_OUTPUT_DIR):
        if os.path.isdir(_dir):
            shutil.rmtree(_dir)
        os.makedirs(_dir)

    shdoc_cmd, missing = _find_shdoc_cmd()
    if not shdoc_cmd:
        _write_scripts_index([], [], missing=missing)
        _write_devel_index([], missing=missing)
        return

    if not isinstance(shdoc_cmd, list):
        err_msg = f"shdoc_cmd must be a list, not a {type(shdoc_cmd).__name__}"
        raise TypeError(err_msg)

    def _run_shdoc(script_rel, output_dir):
        """Run shdoc on *script_rel* and write Markdown to *output_dir*.

        Returns the doc name (stem of the script filename) on success,
        or *None* if the script was skipped or shdoc failed.
        """
        script_path = os.path.normpath(os.path.join(_REPO_ROOT, script_rel))
        if not os.path.exists(script_path):
            logger.warning(
                "[shdoc] Script not found, skipping: %s",
                script_path,
            )
            return None

        doc_name = os.path.splitext(os.path.basename(script_path))[0]
        out_path = os.path.join(output_dir, f"{doc_name}.md")

        try:
            # Safe: list-based call, no shell=True; "--" prevents shdoc from
            # interpreting a leading "-" in a filename as an option.
            result = subprocess.run(  # nosec B603 # noqa: S603
                [*shdoc_cmd, "--", script_path],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                logger.warning(
                    "[shdoc] Non-zero exit (%s) for %s: %s",
                    result.returncode,
                    script_rel,
                    result.stderr.strip(),
                )
                return None

            output = result.stdout.strip()
            if not output:
                logger.info("[shdoc] No output for %s, skipping", script_rel)
                return None

            with open(out_path, "w", encoding="utf-8") as f:
                f.write(output + "\n")
            logger.info("[shdoc] Generated: %s", out_path)
            return doc_name
        except Exception as e:
            logger.warning("[shdoc] Failed to process %s: %s", script_rel, e)
            return None

    # Stand-alone utility scripts -> scripts/ (one section per folder)
    scripts_by_dir = {"tools": [], "utils": []}
    for dir_name, script_names in _collect_shdoc_scripts().items():
        for script_name in script_names:
            name = _run_shdoc(script_name, _SHDOC_SCRIPTS_OUTPUT_DIR)
            if name:
                scripts_by_dir[dir_name].append(name)

    # Developer/internal scripts -> devel/
    devel_generated = []
    for script_rel in _SHDOC_DEVEL_SCRIPTS:
        name = _run_shdoc(script_rel, _SHDOC_DEVEL_OUTPUT_DIR)
        if name:
            devel_generated.append(name)

    _write_scripts_index(scripts_by_dir["tools"], scripts_by_dir["utils"])
    _write_devel_index(devel_generated)


def _fix_shdoc_refs(_app, doctree):
    # type: (Sphinx, nodes.document) -> None

    for node in doctree.findall(addnodes.pending_xref):
        if node.get("reftype") != "myst":
            continue

        target = node.get("reftarget", "")
        if (
            node.get("refexplicit")
            and not node.get("refuri")
            and target
            and "/" not in target
        ):
            new_target = target.replace("_", "-")
            if new_target != target:
                node["reftarget"] = new_target
                doc = node.get("refdoc", "unknown")
                logger.info(
                    "[DEBUG] Fixed target: %s -> %s in %s",
                    target,
                    new_target,
                    doc,
                )


def _transform_rst_links(app, doctree):
    # type: (Sphinx, nodes.document) -> None
    """
    Convert internal .rst file links to Sphinx cross-references.

    Automatically converts internal .rst file links to Sphinx cross-references
    (:doc: or :ref:), enabling validation and proper path resolution.
    """
    docname = app.env.docname  # type: Final
    # Traverse only reference nodes that have a "refuri" attribute
    for node in doctree.findall(nodes.reference):
        uri = node.get("refuri", "")
        if ".rst" not in uri or uri.startswith(("http", "mailto:", "//")):
            continue

        parts = uri.split("#", 1)
        has_anchor = len(parts) > 1
        reftype = "ref" if has_anchor else "doc"
        if has_anchor:
            reftarget = parts[1]
        else:
            reftarget = parts[0][:-4] if parts[0].endswith(".rst") else parts[0]
        logger.info(
            "[DEBUG] Converting %s -> :%s:`%s`",
            uri,
            reftype,
            reftarget,
        )

        # Create pending_xref node which Sphinx resolves during build phase
        new_node = addnodes.pending_xref(
            "",
            reftype=reftype,
            refdomain="std",
            reftarget=reftarget,
            refdoc=docname,
            refwarn=True,
            refexplicit=True,
        )
        # Transfer children (the link text) and replace the original node
        new_node.extend(node.children)
        node.replace_self(new_node)


def setup(app):
    # type: (Sphinx) -> dict[str, Any]
    """
    Connect custom logic to the Sphinx build process.

    This function tells Sphinx to run specific functions (hooks)
    at the right time during documentation generation.
    """
    app.connect("builder-inited", _generate_shdoc)
    app.connect("doctree-read", _fix_shdoc_refs)
    app.connect("doctree-read", _transform_rst_links)
    return {
        "version": "0.1",
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }


# Project information
project = "microG unofficial installer"
author = "ale5000"
project_copyright = "2016-2019, 2021-{0} ale5000".format(
    datetime.datetime.now(_UTC).strftime("%Y"),
)
release = get_version()
version = release

revision = get_revision()
if revision:
    project_copyright += " | Revision: {0}".format(revision)

# General configuration
needs_sphinx = "1.8"
extensions = ["sphinx_rtd_theme", "myst_parser"]

# Options for highlighting
highlight_language = "sh"

# Options for internationalisation
language = "en"

# Options for markup
rst_epilog = "\n.. |release| replace:: v{0}\n".format(release)

# Options for source files
exclude_patterns = ["CONTRIBUTORS.md"]
master_doc = "index"
source_suffix = {".rst": "restructuredtext", ".md": "markdown"}

# Options for warning control

# Links are working using implicit references but MyST still emit warnings
# instead of verify
# TODO: Find an alternative way
suppress_warnings = ["myst.xref_missing"]

# Options for HTML output
html_theme = "sphinx_rtd_theme"
html_context = {
    "display_github": True,
    "github_user": "micro5k",
    "github_repo": "microg-unofficial-installer",
    "github_version": "main",
    "conf_py_path": "/docs/",
}

# Options for LaTeX output (e.g., PDF)
latex_elements = {}

# The "openany" option allows chapters to begin on the next available page;
# this prevents unwanted blank pages by allowing starts on even or odd pages
latex_elements.update({"extraclassoptions": "openany"})
