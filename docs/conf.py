#!/usr/bin/env python
# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: NONE
# SPDX-License-Identifier: CC0-1.0

"""Configuration file for the Sphinx documentation builder.

This module contains the configuration settings for generating documentation
using Sphinx. For a full list of built-in configuration values, see:
https://www.sphinx-doc.org/en/master/usage/configuration.html
"""

import os
import re
import shutil
import subprocess  # nosec B404
import sys

from docutils import nodes
from sphinx import addnodes
from sphinx.util import logging

TYPE_CHECKING = False
if TYPE_CHECKING:
    from typing import Any, Final  # noqa: F401

    from sphinx.application import Sphinx  # noqa: F401

logger = logging.getLogger(__name__)  # type: Final

_DOCS_DIR = os.path.dirname(os.path.abspath(__file__))  # type: Final
_REPO_ROOT = os.path.normpath(os.path.join(_DOCS_DIR, ".."))  # type: Final

# Directory where generated Markdown files for stand-alone tools/utils are written
_SHDOC_SCRIPTS_OUTPUT_DIR = os.path.join(_DOCS_DIR, "scripts")
# Directory where generated Markdown files for internal/developer scripts are written
_SHDOC_DEVEL_OUTPUT_DIR = os.path.join(_DOCS_DIR, "devel")

# Shell scripts that form part of the *developer guide* (internal/zip-content
# scripts).  Their documentation is placed under ``devel/`` because it is
# intended for contributors and developers, not end-users.
_SHDOC_DEVEL_SCRIPTS = [
    "zip-content/inc/common-functions.sh",
    "zip-content/zip-install.sh",
]  # type: Final[list[str]]
_SHDOC_SCRIPTS_SKIP_TOOLS = {"help.sh"}  # type: Final[set[str]]


def _collect_shdoc_scripts():
    # type: () -> dict[str, list[str]]
    """Return stand-alone shell scripts grouped by source directory.

    Returns a dict ``{"tools": [...], "utils": [...]}`` where each value is a
    sorted list of repository-relative paths (e.g. ``"tools/get-signature.sh"``).
    Scripts listed in :data:`_SHDOC_SCRIPTS_SKIP_TOOLS` are excluded from the
    ``tools`` list.
    """
    result = {"tools": [], "utils": []}

    # tools/*.sh — all scripts except those in _SHDOC_SCRIPTS_SKIP_TOOLS
    tools_dir = os.path.join(_REPO_ROOT, "tools")
    if os.path.isdir(tools_dir):
        for entry in sorted(os.listdir(tools_dir)):
            if entry.endswith(".sh") and entry not in _SHDOC_SCRIPTS_SKIP_TOOLS:
                result["tools"].append(os.path.join("tools", entry))

    # utils/*.sh — all scripts
    utils_dir = os.path.join(_REPO_ROOT, "utils")
    if os.path.isdir(utils_dir):
        for entry in sorted(os.listdir(utils_dir)):
            if entry.endswith(".sh"):
                result["utils"].append(os.path.join("utils", entry))

    return result


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
    git_rev = os.environ.get("READTHEDOCS_GIT_COMMIT_HASH")
    git_id = os.environ.get("READTHEDOCS_GIT_IDENTIFIER")
    if git_rev:
        git_rev = git_rev[:8]
        return f"{git_rev} ({git_id})" if git_id else git_rev

    # Fallback to Git CLI
    git = shutil.which("git")  # type: Final
    if not git:
        return None
    try:
        return (
            # Safe: uses list-based arguments (no shell) to prevent injection
            subprocess.check_output(  # nosec B603 # noqa: S603
                [git, "rev-parse", "--short=8", "HEAD"],
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
    except Exception:
        return None


def _myst_slug(heading_text):
    """Return the myst_parser (GFM-compatible) anchor slug for *heading_text*.

    Algorithm: lowercase → keep ``\\w`` chars (which includes ``_``), spaces
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
    return [gawk, "-f", shdoc], None


def _write_scripts_index(tools_names, utils_names, missing=None):
    """Write ``docs/scripts/index.rst`` with separate sections for each directory.

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


def _generate_shdoc(app):
    """Sphinx ``builder-inited`` handler: run shdoc and emit Markdown files.

    Executes shdoc (https://github.com/reconquest/shdoc) against every entry
    in :data:`_SHDOC_DEVEL_SCRIPTS` and the scripts discovered by
    :func:`_collect_shdoc_scripts`, writing the generated Markdown output to
    :data:`_SHDOC_DEVEL_OUTPUT_DIR` and :data:`_SHDOC_SCRIPTS_OUTPUT_DIR` respectively.
    Index pages are always written for both folders so the toctree references
    in ``index.rst`` remain valid even when shdoc is not installed.
    """
    # Clean and recreate output directories to avoid stale files from previous builds
    for _dir in (_SHDOC_SCRIPTS_OUTPUT_DIR, _SHDOC_DEVEL_OUTPUT_DIR):
        if os.path.isdir(_dir):
            shutil.rmtree(_dir)
        os.makedirs(_dir)

    shdoc_cmd, missing = _find_shdoc_cmd()
    if not shdoc_cmd:
        _write_scripts_index([], [], missing=missing)
        _write_devel_index([], missing=missing)
        return

    def _run_shdoc(script_rel, output_dir):
        """Run shdoc on *script_rel* and write Markdown to *output_dir*.

        Returns the doc name (stem of the script filename) on success,
        or *None* if the script was skipped or shdoc failed.
        """
        script_path = os.path.normpath(os.path.join(_REPO_ROOT, script_rel))
        if not os.path.exists(script_path):
            logger.warning(f"[shdoc] Script not found, skipping: {script_path}")
            return None

        doc_name = os.path.splitext(os.path.basename(script_path))[0]
        out_path = os.path.join(output_dir, f"{doc_name}.md")

        try:
            # Safe: list-based call, no shell=True; "--" prevents shdoc from
            # interpreting a leading "-" in a filename as an option.
            result = subprocess.run(  # nosec B603 # noqa: S603
                shdoc_cmd + ["--", script_path],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                logger.warning(
                    f"[shdoc] Non-zero exit ({result.returncode}) for {script_rel}: "
                    f"{result.stderr.strip()}",
                )
                return None

            output = result.stdout.strip()
            if not output:
                logger.info(f"[shdoc] No output for {script_rel}, skipping")
                return None

            with open(out_path, "w", encoding="utf-8") as f:
                f.write(output + "\n")
            logger.info(f"[shdoc] Generated: {out_path}")
            return doc_name
        except Exception as e:
            logger.warning(f"[shdoc] Failed to process {script_rel}: {e}")
            return None

    # Stand-alone utility scripts → scripts/  (tools and utils kept separate)
    scripts_by_dir = {"tools": [], "utils": []}
    for dir_name, script_rels in _collect_shdoc_scripts().items():
        for script_rel in script_rels:
            name = _run_shdoc(script_rel, _SHDOC_SCRIPTS_OUTPUT_DIR)
            if name:
                scripts_by_dir[dir_name].append(name)

    # Developer/internal scripts → devel/
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


def transform_rst_links(app, doctree):
    # type: (Sphinx, nodes.document) -> None
    """Convert internal .rst file links to Sphinx cross-references.

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
        reftarget = parts[1] if has_anchor else parts[0].removesuffix(".rst")
        logger.info(f"[DEBUG] Converting {uri} -> :{reftype}:`{reftarget}`")

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
    """Connect custom logic to the Sphinx build process.

    This function tells Sphinx to run specific functions (hooks)
    at the right time during documentation generation.
    """
    app.connect("builder-inited", _generate_shdoc)
    app.connect("doctree-read", _fix_shdoc_refs)
    app.connect("doctree-read", transform_rst_links)
    return {
        "version": "0.1",
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }


# TODO: Fix it
suppress_warnings = ["myst.xref_missing"]

# Project information
project = "microG unofficial installer"
author = "ale5000"
project_copyright = "2016-2019, 2021-%Y ale5000"
release = get_version()
version = release

revision = get_revision()
if revision:
    project_copyright += f" | Revision: {revision}"

# General configuration
needs_sphinx = "8.1"
extensions = ["sphinx_rtd_theme", "myst_parser"]

# Options for highlighting
highlight_language = "sh"

# Options for markup
rst_epilog = f"""
.. |release| replace:: v{release}
"""

# Options for source files
exclude_patterns = ["CONTRIBUTORS.md"]
master_doc = "index"
source_suffix = {".rst": "restructuredtext", ".md": "markdown"}

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
