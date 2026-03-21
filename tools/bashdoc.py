#!/usr/bin/env python3
# SPDX-FileCopyrightText: NONE
# SPDX-License-Identifier: CC0-1.0

# @name bashdoc
# @brief Generate Mermaid flow diagrams from shell scripts
# @description
#   Parses shell scripts to extract function definitions and call relationships,
#   then generates Mermaid flowchart diagrams saved as Markdown files.
# @usage bashdoc.py <script.sh> [script.sh ...] --output-dir <dir>

"""bashdoc - Generate Mermaid flow diagrams from shell scripts."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def _strip_comments(content: str) -> str:
    """Remove comments from shell source, respecting single/double-quoted strings.

    Full comment lines (optional whitespace then ``#``) are blanked out.
    Inline ``#`` characters that start an unquoted comment are removed.
    ``#`` characters inside single- or double-quoted strings are preserved.
    """
    result: list[str] = []
    for line in content.splitlines():
        stripped = line.lstrip()
        if stripped.startswith('#'):
            result.append('')
            continue
        # Walk the line character by character to find an unquoted '#'
        in_single = False
        in_double = False
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == '\\' and not in_single:
                i += 2  # skip escaped character
                continue
            if ch == "'" and not in_double:
                in_single = not in_single
            elif ch == '"' and not in_single:
                in_double = not in_double
            elif ch == '#' and not in_single and not in_double:
                line = line[:i]
                break
            i += 1
        result.append(line)
    return '\n'.join(result)


def extract_functions(content: str) -> dict[str, str]:
    """Extract function definitions and their bodies from a shell script.

    Returns a mapping of function name -> function body.
    Handles both POSIX style ``name() {`` and Bash style ``function name() {``.
    The opening brace may appear on the same line as the signature or on the
    following line (the most common style in this codebase).
    """
    # Match function header; the opening '{' may be on the same line or the
    # next line, optionally preceded by whitespace.
    func_header = re.compile(
        r'^[ \t]*(?:function[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(\s*\)'
        r'[ \t]*\n?[ \t]*\{',
        re.MULTILINE,
    )

    functions: dict[str, str] = {}
    clean = _strip_comments(content)

    for match in func_header.finditer(clean):
        name = match.group(1)
        # match.end() is the position right after the opening '{'
        body_start = match.end()

        # Find the matching closing brace by counting nesting
        depth = 1
        pos = body_start
        while pos < len(clean) and depth > 0:
            ch = clean[pos]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
            pos += 1

        body = clean[body_start : pos - 1]
        functions[name] = body

    return functions


def extract_calls(body: str, known_funcs: set[str]) -> list[str]:
    """Return an ordered list of unique function calls found in *body*."""
    calls: list[str] = []
    seen: set[str] = set()
    for func in known_funcs:
        pattern = r'(?<![A-Za-z0-9_])' + re.escape(func) + r'(?![A-Za-z0-9_])'
        if re.search(pattern, body) and func not in seen:
            seen.add(func)
            calls.append(func)
    return calls


def _safe_id(name: str) -> str:
    """Convert a function name to a safe Mermaid node identifier."""
    return re.sub(r'[^A-Za-z0-9]', '_', name)


def _remove_function_bodies(clean: str, functions: dict[str, str]) -> str:
    """Return *clean* with every function body replaced by a placeholder.

    Uses the same opening-brace-to-matching-closing-brace counting as
    ``extract_functions`` so nested braces are handled correctly.
    """
    func_header = re.compile(
        r'^[ \t]*(?:function[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(\s*\)'
        r'[ \t]*\n?[ \t]*\{',
        re.MULTILINE,
    )
    # Collect (start, end) spans to remove, in reverse order so positions stay valid
    spans: list[tuple[int, int]] = []
    for match in func_header.finditer(clean):
        name = match.group(1)
        if name not in functions:
            continue
        body_start = match.end()
        depth = 1
        pos = body_start
        while pos < len(clean) and depth > 0:
            ch = clean[pos]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
            pos += 1
        # Replace from the start of the match to the closing '}' with a placeholder
        spans.append((match.start(), pos))

    result = clean
    for start, end in sorted(spans, reverse=True):
        placeholder = f'_FUNC_{_safe_id(functions[func_header.search(result[start:end]).group(1)])}_'
        result = result[:start] + placeholder + result[end:]
    return result


def generate_mermaid(script_path: Path, functions: dict[str, str]) -> str:
    """Build a Mermaid flowchart for the function call graph of *script_path*."""
    script_name = script_path.name
    known = set(functions.keys())

    lines: list[str] = [
        f'# {script_name}',
        '',
        '```mermaid',
        'flowchart TD',
        f'    ENTRY(["▶ {script_name}"])',
    ]

    # Declare function nodes
    for name in functions:
        nid = _safe_id(name)
        lines.append(f'    {nid}["{name}()"]')

    lines.append('')

    # Wire entry point to top-level calls (calls outside any function body)
    full_clean = _strip_comments(script_path.read_text(encoding='utf-8', errors='replace'))
    # Remove function definitions so we only scan the top-level code
    top_level = _remove_function_bodies(full_clean, functions)
    for name in functions:
        pattern = r'(?<![A-Za-z0-9_])' + re.escape(name) + r'(?![A-Za-z0-9_])'
        if re.search(pattern, top_level):
            nid = _safe_id(name)
            lines.append(f'    ENTRY --> {nid}')

    # Wire intra-function calls
    for caller, body in functions.items():
        callees = extract_calls(body, known - {caller})
        for callee in callees:
            caller_id = _safe_id(caller)
            callee_id = _safe_id(callee)
            lines.append(f'    {caller_id} --> {callee_id}')

    lines.append('```')
    return '\n'.join(lines)


def process_script(script: Path, output_dir: Path) -> bool:
    """Parse *script*, generate a Mermaid diagram, and write it to *output_dir*.

    Returns True on success, False on error.
    """
    try:
        content = script.read_text(encoding='utf-8', errors='replace')
    except OSError as exc:
        print(f'ERROR: cannot read {script}: {exc}', file=sys.stderr)
        return False

    functions = extract_functions(content)
    if not functions:
        print(f'  {script.name}: no functions found, skipping.', file=sys.stderr)
        return True

    diagram = generate_mermaid(script, functions)

    out_file = output_dir / (script.stem + '.md')
    try:
        out_file.write_text(diagram + '\n', encoding='utf-8')
    except OSError as exc:
        print(f'ERROR: cannot write {out_file}: {exc}', file=sys.stderr)
        return False

    print(f'  {script.name}: {len(functions)} function(s) → {out_file}')
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Generate Mermaid flow diagrams from shell scripts.',
    )
    parser.add_argument(
        'scripts',
        metavar='SCRIPT',
        nargs='+',
        type=Path,
        help='Shell script file(s) to process',
    )
    parser.add_argument(
        '--output-dir',
        metavar='DIR',
        type=Path,
        default=Path('docs/flowcharts'),
        help='Directory to write the generated Markdown files (default: docs/flowcharts)',
    )
    args = parser.parse_args(argv)

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    success = True
    for script in args.scripts:
        if not script.is_file():
            print(f'WARNING: {script} is not a file, skipping.', file=sys.stderr)
            continue
        ok = process_script(script, output_dir)
        success = success and ok

    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
