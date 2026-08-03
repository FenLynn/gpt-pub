from __future__ import annotations

import runpy
from pathlib import Path

source = Path(__file__).with_name("p101_v440_apply.py")
text = source.read_text(encoding="utf-8")
anchor = "\nreplace_once(\n    TRIM,\n    '''func (d *trimDialog) updateInfo() {"
insertion = r"""
replace_once(
    TRIM,
    '''\tend, err := parseTimeValue(getText(d.hEnd))''',
    '''\tend, err = parseTimeValue(getText(d.hEnd))''',
)
"""
if text.count(anchor) != 1:
    raise SystemExit(f"v4.4.0 updateInfo insertion anchor count={text.count(anchor)}")
text = text.replace(anchor, insertion + anchor, 1)
target = Path("/tmp/p101_v440_apply.py")
target.write_text(text, encoding="utf-8", newline="\n")
compile(text, str(target), "exec")
runpy.run_path(str(target), run_name="__main__")
