from __future__ import annotations

import re
import runpy
from pathlib import Path

source = Path(__file__).with_name("p101_v423_apply.py")
text = source.read_text(encoding="utf-8")
pattern = r"replace_once\(CONTRACT,\s*'const appVersion = .*?'\s*,\s*'const appVersion = .*?'\s*\)"
replacement = "replace_once(CONTRACT, 'const appVersion = \\\"4.2.2\\\"', 'const appVersion = \\\"4.2.3\\\"')"
text, count = re.subn(pattern, replacement, text, count=1)
if count != 1:
    raise SystemExit(f"v4.2.3 contract wrapper replacement count={count}")
target = Path("/tmp/p101_v423_apply.py")
target.write_text(text, encoding="utf-8", newline="\n")
compile(text, str(target), "exec")
runpy.run_path(str(target), run_name="__main__")
