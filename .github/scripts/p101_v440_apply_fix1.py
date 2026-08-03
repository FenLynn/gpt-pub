from __future__ import annotations

import runpy
from pathlib import Path

source = Path(__file__).with_name("p101_v440_apply.py")
text = source.read_text(encoding="utf-8")
old = '''\tend, err := parseTimeValue(getText(d.hEnd))'''
new = '''\tend, err = parseTimeValue(getText(d.hEnd))'''
if text.count(old) != 1:
    raise SystemExit(f"v4.4.0 end assignment count={text.count(old)}")
text = text.replace(old, new, 1)
target = Path("/tmp/p101_v440_apply.py")
target.write_text(text, encoding="utf-8", newline="\n")
compile(text, str(target), "exec")
runpy.run_path(str(target), run_name="__main__")
