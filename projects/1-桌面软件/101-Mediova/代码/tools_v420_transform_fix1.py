from __future__ import annotations

import pathlib
import runpy

path = pathlib.Path(__file__).resolve().with_name("tools_v420_transform.py")
text = path.read_text(encoding="utf-8")
start = text.index("# New context-menu commands.")
end = text.index("# Runtime fields for dynamic queue", start)
replacement = '''# New context-menu commands.\ncontext_pattern = re.compile(r"(\\tID_CTX_MOVE_BOTTOM\\s*=\\s*2225\\n)")\nmain, context_count = context_pattern.subn(r"\\1\\tID_CTX_HOLD_EDIT             = 2226\\n\\tID_CTX_REMOVE_SAFE           = 2227\\n", main, count=1)\nif context_count != 1:\n    raise RuntimeError(f"context command ids: expected 1 match, found {context_count}")\n\n'''
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
runpy.run_path(str(path), run_name="__main__")
