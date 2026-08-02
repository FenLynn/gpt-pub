from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
MAIN = ROOT / "cmd" / "mediaworkbench" / "main_windows.go"
V420 = ROOT / "cmd" / "mediaworkbench" / "v420_windows.go"
HARDEN = ROOT / "cmd" / "mediaworkbench" / "v420_harden_windows.go"
MODEL = ROOT / "internal" / "model" / "model.go"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def function_bounds(text: str, signature: str) -> tuple[int, int]:
    start = text.find(signature)
    if start < 0 or text.find(signature, start + 1) >= 0:
        raise RuntimeError(f"{signature}: expected unique signature, found {text.count(signature)}")
    brace = text.find("{", start + len(signature) - 1)
    if brace < 0:
        raise RuntimeError(f"{signature}: opening brace not found")
    depth = 0
    in_string = False
    in_rune = False
    escaped = False
    i = brace
    while i < len(text):
        ch = text[i]
        if escaped:
            escaped = False
        elif ch == "\\" and (in_string or in_rune):
            escaped = True
        elif ch == '"' and not in_rune:
            in_string = not in_string
        elif ch == "'" and not in_string:
            in_rune = not in_rune
        elif not in_string and not in_rune:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return start, i + 1
        i += 1
    raise RuntimeError(f"{signature}: closing brace not found")


def replace_function(text: str, signature: str, replacement: str) -> str:
    start, end = function_bounds(text, signature)
    return text[:start] + replacement.rstrip() + text[end:]


def patch_function(text: str, signature: str, old: str, new: str, label: str) -> str:
    start, end = function_bounds(text, signature)
    block = text[start:end]
    block = replace_once(block, old, new, label)
    return text[:start] + block + text[end:]


main = MAIN.read_text(encoding="utf-8")
v420 = V420.read_text(encoding="utf-8")
harden = HARDEN.read_text(encoding="utf-8")
model = MODEL.read_text(encoding="utf-8")

harden = replace_once(harden, 'import (\n\t"fmt"', 'import (\n\t"context"\n\t"fmt"', "harden context import")
main = replace_once(main, "\trightDraftFields    map[int]bool\n\trightUpdating       bool", "\trightDraftFields    map[int]bool\n\trightUpdating       bool\n\trightSelectionKey   string", "right selection key field")
model = replace_once(model, "return t != nil && (t.Status == StatusQueued || t.Status == StatusProcessing)", "return t != nil && (t.Status == StatusQueued || t.Status == StatusProcessing || t.Status == StatusPaused)", "paused task holdability")

main = replace_function(main, "func (a *application) togglePause() {", '''func (a *application) togglePause() {
	a.v420TogglePause()
}''')
main = replace_function(main, "func (a *application) stopQueue() {", '''func (a *application) stopQueue() {
	a.v420StopQueue()
}''')
main = replace_function(main, "func (a *application) updateRightPanel() {", '''func (a *application) updateRightPanel() {
	a.v420UpdateRightPanel()
}''')

main = patch_function(
    main,
    "func (a *application) finishRun() {",
    "\ta.reservedOutputs = make(map[string]int64)\n\trunStarted := a.runStart",
    "\ta.reservedOutputs = make(map[string]int64)\n\ta.v420ResetRunMaps()\n\trunStarted := a.runStart",
    "finish run map reset",
)
main = patch_function(
    main,
    "func (a *application) finishRun() {",
    "\tif a.settings.OpenOutputOnDone && a.settings.OutputDir != \"\" {\n\t\tshellOpen(a.settings.OutputDir)\n\t}",
    "\tif outputDir := a.settings.OutputDirFor(runKind); a.settings.OpenOutputOnDone && outputDir != \"\" {\n\t\tshellOpen(outputDir)\n\t}",
    "finish mode output open",
)
main = patch_function(
    main,
    "func (a *application) refreshTotal() {",
    "\trunIDs := a.runTaskIDs",
    "\trunIDs := copyTaskIDSet(a.runTaskIDs)",
    "refresh total run ids snapshot",
)
main = patch_function(
    main,
    "func (a *application) prepareTaskForRetry(t *model.Task) bool {",
    "if t == nil || t.Status == model.StatusQueued || t.Status == model.StatusProcessing || t.Status == model.StatusPaused",
    "if t == nil || t.IsLocked()",
    "retry locked guard",
)
main = patch_function(
    main,
    "func copyTrimCropToTargets(settings model.Settings, tasks []*model.Task, idxs []int) int {",
    "if target.Status == model.StatusQueued || target.Status == model.StatusProcessing || target.Status == model.StatusPaused",
    "if target.IsLocked()",
    "trim crop locked guard",
)
main = patch_function(
    main,
    "func (a *application) copyTaskOptions() {",
    "if t.Status == model.StatusProcessing || t.Status == model.StatusPaused",
    "if t.IsLocked()",
    "copy options locked guard",
)
main = patch_function(
    main,
    "func (a *application) setSelectedQuickOption(id int) {",
    "if t.Status == model.StatusProcessing || t.Status == model.StatusPaused",
    "if t.IsLocked()",
    "quick option locked guard",
)

v420 = replace_function(v420, "func (a *application) v420RollbackQueued(ids map[int64]bool) {", '''func (a *application) v420RollbackQueued(ids map[int64]bool) {
	var releases []struct {
		path string
		id   int64
	}
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil || !ids[task.ID] || task.Status != model.StatusQueued {
			continue
		}
		if task.OutputPath != "" {
			releases = append(releases, struct {
				path string
				id   int64
			}{task.OutputPath, task.ID})
		}
		task.Status = model.StatusReady
		task.Queue = nil
		task.OutputPath = ""
		task.Progress = 0
	}
	a.mu.Unlock()
	for _, item := range releases {
		a.releaseOutput(item.path, item.id)
	}
}''')

append_marker = "\ta.runMu.Lock()\n\tif a.runTaskIDs == nil {"
append_insert = '''	if !a.v420ConfirmDiskSpace(a.v420OutputDir(runKind), ids, "新增任务磁盘空间预检") {
		a.v420RollbackQueued(ids)
		a.refreshAll()
		setText(a.hStatusText, "已取消加入队列；准备中任务保持可编辑。")
		return
	}
	a.runMu.Lock()
	if a.runTaskIDs == nil {'''
v420 = patch_function(v420, "func (a *application) v420AppendReadyToRun(only map[int64]bool) {", append_marker, append_insert, "append disk preflight")

v420 = replace_function(v420, "func (a *application) v420RemoveTaskByID(id int64) {", '''func (a *application) v420RemoveTaskByID(id int64) {
	a.mu.Lock()
	for i, task := range a.tasks {
		if task == nil || task.ID != id {
			continue
		}
		path := task.OutputPath
		a.tasks = append(a.tasks[:i], a.tasks[i+1:]...)
		if a.heldEditTaskID == id {
			a.heldEditTaskID = 0
		}
		a.mu.Unlock()
		// Conversion interruption removes its partial output before this method.
		// Generic list removal must never delete a completed output or an existing
		// collision target; it only releases the in-memory reservation.
		if path != "" {
			a.releaseOutput(path, id)
		}
		a.runMu.Lock()
		delete(a.runTaskIDs, id)
		delete(a.immediateRestarts, id)
		delete(a.holdRequests, id)
		delete(a.removeRequests, id)
		a.runMu.Unlock()
		a.saveSession()
		a.refreshAll()
		a.v420SignalQueue()
		return
	}
	a.mu.Unlock()
}''')

v420 = replace_function(v420, "func (a *application) v420OptionsFromRight(base model.TaskOptions, kind model.Kind, dirty map[int]bool) model.TaskOptions {", '''func (a *application) v420OptionsFromRight(base model.TaskOptions, kind model.Kind, dirty map[int]bool) model.TaskOptions {
	value := func(control uintptr) (string, bool) {
		text := comboText(control)
		return text, text != "" && text != "混合"
	}
	if dirty[IDC_TASK_RES] {
		if text, ok := value(a.hTaskRes); ok {
			if kind == model.KindImage {
				base.ImageSize = text
			} else {
				base.Resolution = text
			}
		}
	}
	if dirty[IDC_TASK_CODEC] {
		if text, ok := value(a.hTaskCodec); ok {
			if kind == model.KindImage {
				base.ImageFormat = text
			} else {
				base.Codec = text
			}
		}
	}
	if dirty[IDC_TASK_QUALITY] {
		if text, ok := value(a.hTaskQuality); ok {
			base.Quality = text
		}
	}
	if dirty[IDC_TASK_VOLUME] {
		if text, ok := value(a.hTaskVolume); ok {
			if kind == model.KindImage {
				base.ImageLimit = text
			} else {
				parseVolume(&base, text)
			}
		}
	}
	if dirty[IDC_TASK_ROTATION] {
		if text, ok := value(a.hTaskRotation); ok {
			base.Rotation = text
		}
	}
	base.FollowDefaults = false
	return base
}''')

v420 = replace_function(v420, "func (a *application) v420ApplyTaskOptions(defaults bool) {", '''func (a *application) v420ApplyTaskOptions(defaults bool) {
	// A held edit session is independent from list selection. The user may browse
	// other rows without losing the pending transaction.
	heldID := a.heldEditTaskID
	if heldID != 0 {
		a.mu.Lock()
		task, _ := a.findTaskByIDLocked(heldID)
		if task != nil && task.Status == model.StatusHeld {
			immediate := false
			if defaults {
				immediate, _ = workflow.CancelHeldEdit(task, time.Now())
			} else {
				dirty := a.rightDraftFields
				if len(dirty) == 0 {
					dirty = map[int]bool{IDC_TASK_RES: true, IDC_TASK_CODEC: true, IDC_TASK_QUALITY: true, IDC_TASK_VOLUME: true, IDC_TASK_ROTATION: true}
				}
				updated := a.v420OptionsFromRight(task.Options, task.Kind, dirty)
				immediate, _ = workflow.ApplyHeldOptions(task, updated, time.Now())
			}
			a.heldEditTaskID = 0
			a.rightDraftFields = make(map[int]bool)
			a.rightSelectionKey = ""
			a.mu.Unlock()
			if immediate {
				a.runMu.Lock()
				a.immediateRestarts[heldID] = true
				a.runMu.Unlock()
			}
			a.v420SignalQueue()
			a.saveSession()
			a.refreshAll()
			return
		}
		a.heldEditTaskID = 0
		a.mu.Unlock()
	}

	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	dirty := a.rightDraftFields
	changed, skipped := 0, 0
	a.mu.Lock()
	for _, idx := range idxs {
		if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
			continue
		}
		task := a.tasks[idx]
		if task.Status != model.StatusReady {
			skipped++
			continue
		}
		if defaults {
			task.Options = a.settings.DefaultOptions(task.Kind)
			changed++
			continue
		}
		if len(dirty) == 0 {
			continue
		}
		task.Options = a.v420OptionsFromRight(task.Options, task.Kind, dirty)
		changed++
	}
	a.rightDraftFields = make(map[int]bool)
	a.mu.Unlock()
	a.saveSession()
	a.refreshList()
	a.updateRightPanel()
	msg := fmt.Sprintf("已应用到 %d 个准备中任务。", changed)
	if skipped > 0 {
		msg += fmt.Sprintf(" 跳过 %d 个已锁定任务。", skipped)
	}
	setText(a.hStatusText, msg)
}''')

MAIN.write_text(main, encoding="utf-8")
V420.write_text(v420, encoding="utf-8")
HARDEN.write_text(harden, encoding="utf-8")
MODEL.write_text(model, encoding="utf-8")
print("v4.2.0 hardening applied")
