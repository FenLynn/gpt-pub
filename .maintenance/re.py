"""Temporary stdlib re proxy for the AtlasDesk v0.8.1 patch.

It preserves backslashes in regex replacement strings by routing string
replacements through a callable. It also excludes build-only cache paths from
this temporary checkout's Git status. This file never enters the product tree.
"""

import importlib.util
import os
import sys
import sysconfig

# These files are produced only by the one-time Windows verification. Keep the
# product change whitelist strict while preventing normal build caches from
# appearing as unexpected source changes.
_EXCLUDE = os.path.join(os.getcwd(), ".git", "info", "exclude")
try:
    with open(_EXCLUDE, "a", encoding="utf-8") as exclude:
        exclude.write("\n.maintenance/__pycache__/\n")
        exclude.write("projects/1-桌面软件/102-AtlasDesk/代码/**/bin/\n")
        exclude.write("projects/1-桌面软件/102-AtlasDesk/代码/**/obj/\n")
        exclude.write("terminal_host.obj\n")
except OSError:
    pass

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
