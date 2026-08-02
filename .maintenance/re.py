"""Temporary stdlib re proxy for the AtlasDesk v0.8.1 one-time patch.

Python re.subn interprets backslashes in replacement strings. The patch needs
C# string escapes such as \\n to remain literal, so string replacements are
routed through a callable. This file is temporary and is removed after the
verified product commit.
"""

from __future__ import annotations

import importlib.util
import sys
import sysconfig
from pathlib import Path
from typing import Any, Callable

_RE_DIR = Path(sysconfig.get_paths()["stdlib"]) / "re"
_SPEC = importlib.util.spec_from_file_location(
    "_atlasdesk_stdlib_re",
    _RE_DIR / "__init__.py",
    submodule_search_locations=[str(_RE_DIR)],
)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError("Unable to load the Python standard-library re package.")

_REAL_RE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _REAL_RE
_SPEC.loader.exec_module(_REAL_RE)

S = _REAL_RE.S


def subn(
    pattern: Any,
    repl: str | Callable[..., str],
    string: str,
    count: int = 0,
    flags: int = 0,
):
    if isinstance(repl, str):
        literal = repl
        return _REAL_RE.subn(pattern, lambda _match: literal, string, count=count, flags=flags)
    return _REAL_RE.subn(pattern, repl, string, count=count, flags=flags)


def __getattr__(name: str) -> Any:
    return getattr(_REAL_RE, name)
