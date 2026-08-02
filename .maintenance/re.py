"""Temporary stdlib re proxy for the AtlasDesk v0.8.1 patch.

It preserves backslashes in regex replacement strings by routing string
replacements through a callable. This file is temporary and never enters the
AtlasDesk product tree.
"""

import importlib.util
import os
import sys
import sysconfig

_RE_DIR = os.path.join(sysconfig.get_paths()["stdlib"], "re")
_SPEC = importlib.util.spec_from_file_location(
    "_atlasdesk_stdlib_re",
    os.path.join(_RE_DIR, "__init__.py"),
    submodule_search_locations=[_RE_DIR],
)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError("Unable to load the Python standard-library re package.")

_REAL_RE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _REAL_RE
_SPEC.loader.exec_module(_REAL_RE)

S = _REAL_RE.S


def subn(pattern, repl, string, count=0, flags=0):
    if isinstance(repl, str):
        literal = repl
        return _REAL_RE.subn(pattern, lambda _match: literal, string, count=count, flags=flags)
    return _REAL_RE.subn(pattern, repl, string, count=count, flags=flags)


def __getattr__(name):
    return getattr(_REAL_RE, name)
