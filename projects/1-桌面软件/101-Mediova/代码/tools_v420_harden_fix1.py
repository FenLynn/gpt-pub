from __future__ import annotations

import pathlib
import runpy

path = pathlib.Path(__file__).resolve().with_name("tools_v420_harden.py")
text = path.read_text(encoding="utf-8")
old = '"func (a *application) prepareTaskForRetry(t *model.Task) bool {"'
new = '"func prepareTaskForRetry(t *model.Task) bool {"'
if text.count(old) != 1:
    raise RuntimeError(f"prepareTaskForRetry signature marker count={text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
runpy.run_path(str(path), run_name="__main__")
