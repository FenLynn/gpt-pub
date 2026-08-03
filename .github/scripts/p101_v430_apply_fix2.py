from __future__ import annotations

import re
import runpy
from pathlib import Path

source = Path(__file__).with_name("p101_v430_apply.py")
text = source.read_text(encoding="utf-8")

# Upgrade both dialog-construction failure returns to the new three-value API.
return_pattern = r"replace_once\(TRIM, 'return opts, false\\n\\t}', 'return opts, false, false\\n\\t}',\)\n# The window-creation failure is the second two-value return\.\nreplace_once\(TRIM, 'return opts, false\\n\\t}\\n\\td\.hwnd = h', 'return opts, false, false\\n\\t}\\n\\td\.hwnd = h'\)\n"
return_replacement = r'''_trim_return_text = TRIM.read_text(encoding="utf-8")
_return_anchor = "return opts, false\n\t}"
_return_count = _trim_return_text.count(_return_anchor)
if _return_count != 2:
    raise SystemExit(f"trim dialog failure return count={_return_count}")
TRIM.write_text(_trim_return_text.replace(_return_anchor, "return opts, false, false\n\t}"), encoding="utf-8", newline="\n")
'''
text, count = re.subn(return_pattern, lambda _match: return_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"v4.3.0 return wrapper replacement count={count}")

# Keep new_edit limited to editTrimCrop itself. Preserve the following source
# function verbatim and replace by explicit start/end indexes instead of regex.
old_tail = "\n\nfunc (a *application) copyTrimCropOptions'''"
if text.count(old_tail) != 1:
    raise SystemExit(f"new_edit tail count={text.count(old_tail)}")
text = text.replace(old_tail, "'''", 1)

old_call = '''replace_regex_once(
    MAIN,
    r"func \\(a \\*application\\) editTrimCrop\\(\\) \\{.*?\\n\\}\\n\\nfunc \\(a \\*application\\) copyTrimCropOptions",
    new_edit,
)
'''
new_call = r'''_main_text = MAIN.read_text(encoding="utf-8")
_edit_start_anchor = "func (a *application) editTrimCrop() {"
_edit_end_anchor = "\nfunc (a *application) showFFmpegCommand()"
if _main_text.count(_edit_start_anchor) != 1 or _main_text.count(_edit_end_anchor) != 1:
    raise SystemExit(
        f"editTrimCrop anchors start={_main_text.count(_edit_start_anchor)} "
        f"end={_main_text.count(_edit_end_anchor)}"
    )
_edit_start = _main_text.index(_edit_start_anchor)
_edit_end = _main_text.index(_edit_end_anchor, _edit_start)
MAIN.write_text(_main_text[:_edit_start] + new_edit.rstrip() + "\n" + _main_text[_edit_end:], encoding="utf-8", newline="\n")
'''
if text.count(old_call) != 1:
    raise SystemExit(f"old edit regex call count={text.count(old_call)}")
text = text.replace(old_call, new_call, 1)

target = Path("/tmp/p101_v430_apply.py")
target.write_text(text, encoding="utf-8", newline="\n")
compile(text, str(target), "exec")
runpy.run_path(str(target), run_name="__main__")
