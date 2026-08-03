from __future__ import annotations

import re
import runpy
from pathlib import Path

source = Path(__file__).with_name("p101_v430_apply.py")
text = source.read_text(encoding="utf-8")
pattern = r"replace_once\(TRIM, 'return opts, false\\n\\t}', 'return opts, false, false\\n\\t}',\)\n# The window-creation failure is the second two-value return\.\nreplace_once\(TRIM, 'return opts, false\\n\\t}\\n\\td\.hwnd = h', 'return opts, false, false\\n\\t}\\n\\td\.hwnd = h'\)\n"
replacement = r'''_trim_return_text = TRIM.read_text(encoding="utf-8")
_return_anchor = "return opts, false\n\t}"
_return_count = _trim_return_text.count(_return_anchor)
if _return_count != 2:
    raise SystemExit(f"trim dialog failure return count={_return_count}")
TRIM.write_text(_trim_return_text.replace(_return_anchor, "return opts, false, false\n\t}"), encoding="utf-8", newline="\n")
'''
text, count = re.subn(pattern, lambda _match: replacement, text, count=1)
if count != 1:
    raise SystemExit(f"v4.3.0 return wrapper replacement count={count}")
target = Path("/tmp/p101_v430_apply.py")
target.write_text(text, encoding="utf-8", newline="\n")
compile(text, str(target), "exec")
runpy.run_path(str(target), run_name="__main__")
