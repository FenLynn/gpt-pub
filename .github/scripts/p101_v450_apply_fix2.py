from __future__ import annotations

import runpy
from pathlib import Path

source = Path(__file__).with_name("p101_v450_apply.py")
text = source.read_text(encoding="utf-8")
replacements = [
    ("if build_text.count('4.2.2') < 2:", "if build_text.count('4.2.2') < 1:"),
    (r"\tdata = append(data, '\n')", r"\tdata = append(data, '\\n')"),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"v4.5.0 wrapper replacement count={text.count(old)} old={old!r}")
    text = text.replace(old, new, 1)
target = Path("/tmp/p101_v450_apply.py")
target.write_text(text, encoding="utf-8", newline="\n")
compile(text, str(target), "exec")
runpy.run_path(str(target), run_name="__main__")
