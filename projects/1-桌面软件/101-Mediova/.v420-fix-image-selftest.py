from __future__ import annotations

import pathlib

root = pathlib.Path(__file__).resolve().parent
path = root / "代码" / "cmd" / "mediaworkbench" / "main_windows.go"
text = path.read_text(encoding="utf-8")

old_output = '\ta.settings.OutputDir = imageOutputDir\n'
new_output = '\ta.settings.SetOutputDirFor(model.KindImage, imageOutputDir)\n'
if text.count(old_output) != 1:
    raise RuntimeError(f"image output root marker count={text.count(old_output)}")
text = text.replace(old_output, new_output, 1)

old_task = '''\t\tif task != nil && task.Kind == model.KindImage && filepath.Clean(task.Input) == filepath.Clean(imgPath) {
\t\t\timageTaskID = task.ID
\t\t\ttask.Status = model.StatusReady
\t\t\ttask.Error = ""
\t\t\ttask.OutputPath = ""
\t\t\tbreak
\t\t}'''
new_task = '''\t\tif task != nil && task.Kind == model.KindImage && filepath.Clean(task.Input) == filepath.Clean(imgPath) {
\t\t\timageTaskID = task.ID
\t\t\ttask.Status = model.StatusReady
\t\t\ttask.Error = ""
\t\t\ttask.OutputPath = ""
\t\t\ttask.OutputSize = 0
\t\t\ttask.Options = a.settings.DefaultOptions(model.KindImage)
\t\t\ttask.Queue = nil
\t\t\ttask.Hold = nil
\t\t\tbreak
\t\t}'''
if text.count(old_task) != 1:
    raise RuntimeError(f"image task reset marker count={text.count(old_task)}")
text = text.replace(old_task, new_task, 1)
path.write_text(text, encoding="utf-8")
print("v4.2.0 image self-test explicit defaults fixed")
