from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
MAIN = ROOT / "cmd" / "mediaworkbench" / "main_windows.go"
CONFIG = ROOT / "internal" / "config" / "config.go"
V420 = ROOT / "cmd" / "mediaworkbench" / "v420_windows.go"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_function(text: str, signature: str, next_signature: str, replacement: str, label: str) -> str:
    pattern = re.compile(rf"{re.escape(signature)}.*?(?=\n{re.escape(next_signature)})", re.S)
    out, count = pattern.subn(replacement.rstrip(), text, count=1)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 function block, found {count}")
    return out


main = MAIN.read_text(encoding="utf-8")
config = CONFIG.read_text(encoding="utf-8")
v420 = V420.read_text(encoding="utf-8")

# v420 helper imports.
v420 = replace_once(v420, '"time"\n', '"time"\n\t"unsafe"\n', "v420 unsafe import")

# New context-menu commands.
main = replace_once(
    main,
    "\tID_CTX_MOVE_BOTTOM           = 2225\n\tID_CTX_RES_4K",
    "\tID_CTX_MOVE_BOTTOM           = 2225\n\tID_CTX_HOLD_EDIT             = 2226\n\tID_CTX_REMOVE_SAFE           = 2227\n\tID_CTX_RES_4K",
    "context command ids",
)

# Runtime fields for dynamic queue and per-task interruption.
main = replace_once(
    main,
    "\thoverControl        uintptr\n\truntimeNotice       string\n",
    "\thoverControl        uintptr\n\truntimeNotice       string\n\tqueueWake           chan struct{}\n\tqueueSequence       atomic.Int64\n\ttaskCancels         map[int64]context.CancelFunc\n\tholdRequests        map[int64]bool\n\tremoveRequests      map[int64]bool\n\timmediateRestarts   map[int64]bool\n\theldEditTaskID      int64\n\trightDraftFields    map[int]bool\n\trightUpdating       bool\n",
    "application queue fields",
)
main = replace_once(
    main,
    "uiQueue: make(chan func(), 512), probeQueue:",
    "uiQueue: make(chan func(), 512), queueWake: make(chan struct{}, 64), taskCancels: make(map[int64]context.CancelFunc), holdRequests: make(map[int64]bool), removeRequests: make(map[int64]bool), immediateRestarts: make(map[int64]bool), rightDraftFields: make(map[int]bool), probeQueue:",
    "application queue initialization",
)

# WM_COMMAND must preserve the ComboBox notification code.
main = replace_once(
    main,
    "\tcase WM_COMMAND:\n\t\tapp.command(int(loWord(wParam)))\n\t\treturn 0",
    "\tcase WM_COMMAND:\n\t\tid := int(loWord(wParam))\n\t\tcode := int(hiWord(wParam))\n\t\tif app.v420HandleControlNotification(id, code) {\n\t\t\treturn 0\n\t\t}\n\t\tapp.command(id)\n\t\treturn 0",
    "WM_COMMAND notification routing",
)

# Clearer right editor and one global reset button.
main = replace_once(main, '"应用", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW', '"应用到选中", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW', "right apply label")
main = replace_once(main, '"跟随默认", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW', '"恢复选中默认", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW', "right default label")
main = replace_once(main, '"全部跟随默认", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW', '"全部恢复默认", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW', "global reset label")
main = replace_once(
    main,
    "for _, control := range []uintptr{a.hCodec, a.hQuality, a.hVolume, a.hRotation, a.hApplySelected, a.hAllDefault}",
    "for _, control := range []uintptr{a.hCodec, a.hQuality, a.hVolume, a.hRotation, a.hAllDefault}",
    "hide bottom apply",
)
main = replace_once(
    main,
    "\t\t\tmove(a.hApplySelected, x, row2, 116, 31)\n\t\t\tx += 123\n\t\t\tmove(a.hAllDefault, x, row2, w-x-8, 31)",
    "\t\t\tmove(a.hAllDefault, x, row2, w-x-8, 31)",
    "compact bottom reset layout",
)
main = replace_once(
    main,
    "\t\t\tmove(a.hApplySelected, x, barY, 122, 32)\n\t\t\tx += 130\n\t\t\tmove(a.hAllDefault, x, barY, 146, 32)",
    "\t\t\tmove(a.hAllDefault, x, barY, 146, 32)",
    "wide bottom reset layout",
)
main = replace_once(main, "+ 8 + 122 + 8 + 146)", "+ 8 + 146)", "wide fixed width")

# Total progress should be slightly taller than its text.
main = replace_once(main, "Top: rc.Top + 4, Right: rc.Right - 1, Bottom: rc.Bottom - 4", "Top: rc.Top + 2, Right: rc.Right - 1, Bottom: rc.Bottom - 2", "overall progress height")

# Clear, integer-sized status dots.
main = replace_once(main, "diameter := int32(11)", "diameter := int32(14)", "status dot diameter")
main = replace_once(
    main,
    "pen, _, _ := procCreatePen.Call(PS_SOLID, 1, dot)",
    "outline := mixColor(dot, colorRef(0, 0, 0), .24)\n\tpen, _, _ := procCreatePen.Call(PS_SOLID, 1, outline)",
    "status dot outline",
)

# Selected rows remain the background; bars are always drawn afterwards.
main = replace_function(
    main,
    "func drawProgressPill(hdc uintptr, rc rect, fraction float64, label string, selected, active bool) {",
    "func compressionColorPair",
    r'''func drawProgressPill(hdc uintptr, rc rect, fraction float64, label string, selected, active bool) {
	if selected {
		if active {
			brush, _, _ := procGetSysColorBrush.Call(COLOR_HIGHLIGHT)
			procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
		} else {
			fillSolid(hdc, rc, colorRef(240, 244, 249))
		}
	} else {
		fillSolid(hdc, rc, colorRef(255, 255, 255))
	}
	fraction = clamp01(fraction)
	bar := fullCellBarRect(rc)
	withRoundedClip(hdc, bar, 3, func() {
		fillSolid(hdc, bar, colorRef(247, 249, 252))
		if fraction > 0 {
			fill := bar
			fill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
			if fill.Right < fill.Left+3 {
				fill.Right = fill.Left + 3
			}
			drawHorizontalGradient(hdc, fill, colorRef(169, 204, 243), colorRef(76, 138, 220))
		}
	})
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(35, 51, 74))
}''',
    "persistent progress bar",
)
main = replace_function(
    main,
    "func drawCompressionPill(hdc uintptr, rc rect, task *model.Task, label string, selected, active bool) {",
    "func taskStatusColor",
    r'''func drawCompressionPill(hdc uintptr, rc rect, task *model.Task, label string, selected, active bool) {
	if selected {
		if active {
			brush, _, _ := procGetSysColorBrush.Call(COLOR_HIGHLIGHT)
			procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
		} else {
			fillSolid(hdc, rc, colorRef(240, 244, 249))
		}
	} else {
		fillSolid(hdc, rc, colorRef(255, 255, 255))
	}
	bar := fullCellBarRect(rc)
	withRoundedClip(hdc, bar, 3, func() {
		if task == nil || task.InputSize <= 0 || task.OutputSize <= 0 {
			fillSolid(hdc, bar, colorRef(247, 249, 252))
			return
		}
		visual := compressionVisualFor(task.InputSize, task.OutputSize)
		split := bar.Left + int32(float64(bar.Right-bar.Left)*visual.InputFraction)
		if split <= bar.Left {
			split = bar.Left + 1
		}
		if split >= bar.Right {
			split = bar.Right - 1
		}
		left := bar
		left.Right = split
		right := bar
		right.Left = split
		fillSolid(hdc, left, colorRef(247, 249, 251))
		start, finish := compressionColorPair(visual)
		drawHorizontalGradient(hdc, right, start, finish)
	})
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(35, 51, 70))
}''',
    "persistent compression bar",
)
main = replace_once(main, "\tcase model.StatusPaused:\n\t\treturn colorRef(197, 126, 16)", "\tcase model.StatusPaused:\n\t\treturn colorRef(197, 126, 16)\n\tcase model.StatusHeld:\n\t\treturn colorRef(172, 102, 31)", "held status color")
main = replace_once(main, "\tcase model.StatusQueued:\n\t\treturn 2\n\tcase model.StatusReady:", "\tcase model.StatusQueued:\n\t\treturn 2\n\tcase model.StatusHeld:\n\t\treturn 3\n\tcase model.StatusReady:", "held sort rank")

# Mode-specific output directory/history and labels.
main = replace_function(
    main,
    "func (a *application) refreshOutputHistory() {",
    "func (a *application) rememberOutputDirectory",
    '''func (a *application) refreshOutputHistory() {
	a.v420RefreshOutputHistory()
}''',
    "output history wrapper",
)
main = replace_function(
    main,
    "func (a *application) rememberOutputDirectory(path string) {",
    "func (a *application) openOutputMotherDir",
    '''func (a *application) rememberOutputDirectory(path string) {
	a.v420SetOutputDir(a.currentKind, path)
}''',
    "remember output wrapper",
)
main = replace_function(
    main,
    "func (a *application) openOutputMotherDir() {",
    "func (a *application) writeSettingsToUI",
    r'''func (a *application) openOutputMotherDir() {
	path := a.v420OutputDir(a.currentKind)
	if path == "" {
		messageBox(a.hwnd, "输出母目录", "请先选择输出母目录。", MB_OK|MB_ICONINFORMATION)
		return
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		messageBox(a.hwnd, "输出母目录", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	shellOpen(path)
}''',
    "open mode output dir",
)
main = replace_function(
    main,
    "func (a *application) writeSettingsToUI() {",
    "func (a *application) switchKind",
    r'''func (a *application) writeSettingsToUI() {
	a.rightUpdating = true
	defer func() { a.rightUpdating = false }()
	a.v420RefreshOutputHistory()
	if a.currentKind == model.KindImage {
		labels := []string{"尺寸", "格式", "质量", "大小", "旋转"}
		for i, label := range labels {
			setText(a.globalLabels[i], label)
			setText(a.rightLabels[i], label)
		}
		comboFill(a.hResolution, imageSizes(), a.settings.ImageSize)
		comboFill(a.hCodec, []string{"JPG", "PNG"}, a.settings.ImageFormat)
		comboFill(a.hQuality, []string{"高", "中", "低"}, a.settings.ImageQuality)
		comboFill(a.hVolume, []string{"不限", "约 500KB", "约 1MB", "约 2MB", "约 5MB"}, a.settings.ImageLimit)
	} else {
		labels := []string{"输出", "格式", "质量", "体积", "旋转"}
		for i, label := range labels {
			setText(a.globalLabels[i], label)
			setText(a.rightLabels[i], label)
		}
		comboFill(a.hResolution, videoResolutions(), a.settings.Resolution)
		comboFill(a.hCodec, []string{"H.265", "H.264"}, a.settings.Codec)
		comboFill(a.hQuality, []string{"高", "中", "低"}, a.settings.Quality)
		comboFill(a.hVolume, volumeModes(), volumeDisplay(a.settings))
	}
	comboFill(a.hRotation, rotations(), a.settings.Rotation)
	comboFill(a.hSpeedMode, speedModes(), a.settings.SpeedMode)
}''',
    "mode settings UI",
)
main = replace_function(
    main,
    "func (a *application) switchKind(kind model.Kind) {",
    "func (a *application) notify",
    r'''func (a *application) switchKind(kind model.Kind) {
	a.currentKind = kind
	a.writeSettingsToUI()
	a.refreshList()
	a.updateRightPanel()
	a.v420UpdateStartAction()
	for _, h := range []uintptr{a.hVideo, a.hImage} {
		procInvalidateRect.Call(h, 0, 1)
	}
}''',
    "mode switch",
)

# Folder picker respects current media output and active queue lock.
main = replace_function(
    main,
    "func (a *application) chooseFolder(add bool) {",
    "func chooseSingleFile",
    r'''func (a *application) chooseFolder(add bool) {
	title := "选择输出母目录"
	initial := a.v420OutputDir(a.currentKind)
	if add {
		title = "选择包含媒体文件的文件夹"
		initial = a.settings.LastInputDir
	} else if a.v420OutputLocked(a.currentKind) {
		setText(a.hStatusText, "当前活动队列已锁定输出母目录；停止队列后才能更换。")
		return
	}
	folder := chooseExplorerFolder(a.hwnd, title, initial)
	if folder == "" {
		return
	}
	if !add {
		if a.v420SetOutputDir(a.currentKind, folder) {
			a.v420RefreshOutputHistory()
			setText(a.hStatusText, "输出母目录已更换；准备中任务将使用新目录，已入队任务保持原快照。")
		}
		return
	}
	a.settings.LastInputDir = folder
	_ = config.Save(a.settings)
	setText(a.hStatusText, "正在扫描文件夹并自动分流视频与图片…")
	recursive := a.settings.IncludeSubdirs
	go func() {
		result, err := media.ListMixedFiles(folder, recursive)
		a.postUI(func() {
			if err != nil {
				setText(a.hStatusText, "扫描失败: "+err.Error())
				return
			}
			paths := append(append([]string{}, result.Videos...), result.Images...)
			videoAdded, imageAdded, duplicate := a.addPaths(paths, folder)
			msg := fmt.Sprintf("导入完成：视频 %d 个，图片 %d 个", videoAdded, imageAdded)
			if duplicate > 0 { msg += fmt.Sprintf("，重复 %d 个", duplicate) }
			if result.Unsupported > 0 { msg += fmt.Sprintf("，忽略不支持文件 %d 个", result.Unsupported) }
			if result.Unreadable > 0 { msg += fmt.Sprintf("，无法读取 %d 项", result.Unreadable) }
			a.showImportToast(msg)
		})
	}()
}''',
    "mode folder picker",
)

# New tasks copy the current explicit defaults.
main = replace_once(
    main,
    "Options: model.TaskOptions{FollowDefaults: true}, ThumbnailIndex: -1}",
    "Options: a.settings.DefaultOptions(kind), ThumbnailIndex: -1}",
    "materialize imported defaults",
)

# Global read no longer overwrites both modes with one directory.
main = replace_function(
    main,
    "func (a *application) readSettingsFromUI() {",
    "func volumeDisplay",
    r'''func (a *application) readSettingsFromUI() {
	path := strings.TrimSpace(getText(a.hOutputEdit))
	if path != "" && !a.v420OutputLocked(a.currentKind) {
		a.v420SetOutputDir(a.currentKind, path)
	}
	if a.currentKind == model.KindImage {
		a.settings.ImageSize = comboText(a.hResolution)
		a.settings.ImageFormat = comboText(a.hCodec)
		a.settings.ImageQuality = comboText(a.hQuality)
		a.settings.ImageLimit = comboText(a.hVolume)
	} else {
		a.settings.Resolution = comboText(a.hResolution)
		a.settings.Codec = comboText(a.hCodec)
		a.settings.Quality = comboText(a.hQuality)
		o := a.settings.DefaultOptions(model.KindVideo)
		parseVolume(&o, comboText(a.hVolume))
		a.settings.VolumeMode = o.VolumeMode
		a.settings.TargetSizeMB = o.TargetSizeMB
		a.settings.BitrateMbps = o.BitrateMbps
	}
	a.settings.Rotation = comboText(a.hRotation)
	a.settings.SpeedMode = comboText(a.hSpeedMode)
}''',
    "mode settings read",
)

# Start/append, persistent workers, and individual right editor.
main = replace_function(
    main,
    "func (a *application) startQueueFiltered(only map[int64]bool) {",
    "func (a *application) worker()",
    '''func (a *application) startQueueFiltered(only map[int64]bool) {
	a.v420StartQueueFiltered(only)
}''',
    "start queue delegate",
)
main = replace_function(
    main,
    "func (a *application) takeNext() (int64, *model.Task, model.Settings, bool) {",
    "func (a *application) outputUnavailable",
    '''func (a *application) takeNext() (int64, *model.Task, model.Settings, bool) {
	return a.v420TakeNext()
}''',
    "take next delegate",
)
main = replace_function(
    main,
    "func (a *application) applyTaskOptions(defaults bool) {",
    "func scaleCropValue",
    '''func (a *application) applyTaskOptions(defaults bool) {
	a.v420ApplyTaskOptions(defaults)
}''',
    "right editor delegate",
)

# Worker keeps the slot reserved while a processing task is held.
main = replace_once(
    main,
    "\t\t\ta.convertOne(id, t, settings)\n\t\t}()",
    "\t\t\ta.convertOne(id, t, settings)\n\t\t\tfor {\n\t\t\t\tnext, nextSettings, restart := a.v420WaitReservedRestart(id)\n\t\t\t\tif !restart { break }\n\t\t\t\ta.convertOne(id, next, nextSettings)\n\t\t\t}\n\t\t}()",
    "reserved worker loop",
)

# Each conversion gets its own cancellation context. Frozen output paths are authoritative.
main = replace_once(
    main,
    "\ta.runMu.Lock()\n\tgpuDisabled := a.gpuDisabledForRun\n\tctx := a.ctx\n\ta.runMu.Unlock()",
    "\ta.runMu.Lock()\n\tgpuDisabled := a.gpuDisabledForRun\n\tparentCtx := a.ctx\n\ta.runMu.Unlock()\n\tctx, taskCancel := context.WithCancel(parentCtx)\n\ta.v420RegisterTaskCancel(id, taskCancel)\n\tdefer func() { taskCancel(); a.v420UnregisterTaskCancel(id) }()",
    "per task context",
)
main = replace_once(
    main,
    "\tout, skip, err := media.ResolveAndReserveOutput(input, root, settings.OutputDir, kind, opts, settings, a.outputUnavailable, func(path string) bool {\n\t\treturn a.reserveOutput(path, id)\n\t})",
    "\tout := strings.TrimSpace(taskSnapshot.OutputPath)\n\tskip := false\n\tvar err error\n\tif out == \"\" {\n\t\toutputRoot := settings.OutputDirFor(kind)\n\t\tif taskSnapshot.Queue != nil && taskSnapshot.Queue.OutputRoot != \"\" { outputRoot = taskSnapshot.Queue.OutputRoot }\n\t\tout, skip, err = media.ResolveAndReserveOutput(input, root, outputRoot, kind, opts, settings, a.outputUnavailable, func(path string) bool { return a.reserveOutput(path, id) })\n\t}",
    "frozen output path",
)
main = replace_once(
    main,
    "\tif err != nil {\n\t\t_ = os.Remove(out)\n\t\tif ctx != nil && ctx.Err() != nil {",
    "\tif err != nil {\n\t\t_ = os.Remove(out)\n\t\tif a.v420CompleteInterruption(id) { return }\n\t\tif ctx != nil && ctx.Err() != nil {",
    "task interruption completion",
)

# Command routing.
main = replace_once(main, "\tcase IDC_REMOVE, ID_FILE_REMOVE, ID_CTX_REMOVE:\n\t\ta.removeSelected()", "\tcase IDC_REMOVE, ID_FILE_REMOVE, ID_CTX_REMOVE, ID_CTX_REMOVE_SAFE:\n\t\ta.v420RemoveSelectedSafely()", "safe remove routing")
main = replace_once(main, "\tcase IDC_TASK_APPLY, IDC_APPLY_SELECTED:\n\t\ta.applyTaskOptions(false)\n\tcase IDC_TASK_DEFAULT, IDC_ALL_DEFAULT, ID_EDIT_RESET:\n\t\ta.applyTaskOptions(true)", "\tcase IDC_TASK_APPLY:\n\t\ta.applyTaskOptions(false)\n\tcase IDC_TASK_DEFAULT, ID_EDIT_RESET:\n\t\ta.applyTaskOptions(true)\n\tcase IDC_ALL_DEFAULT:\n\t\ta.v420ResetReadyDefaults()\n\tcase ID_CTX_HOLD_EDIT:\n\t\ta.v420BeginHoldSelected()", "command editor routing")

# Right-click temporary operations.
main = replace_once(
    main,
    "\tappendMenu(m, MF_STRING, ID_CTX_COPY_TRIM_CROP, \"仅复制第一项的时长 / 画面裁剪\")\n\tappendMenu(m, MF_STRING, ID_CTX_READY, \"选中项跟随默认 / 退回准备中\")",
    "\tappendMenu(m, MF_STRING, ID_CTX_COPY_TRIM_CROP, \"仅复制第一项的时长 / 画面裁剪\")\n\ttemporary, _, _ := procCreatePopupMenu.Call()\n\teditFlags, removeFlags := a.v420ContextMenuFlags()\n\tappendMenu(temporary, editFlags, ID_CTX_HOLD_EDIT, \"搁置并修改参数\")\n\tappendMenu(temporary, removeFlags, ID_CTX_REMOVE_SAFE, \"从任务列表移除\")\n\tappendMenu(m, MF_POPUP, temporary, \"临时操作\")\n\tappendMenu(m, MF_STRING, ID_CTX_READY, \"恢复选中准备任务默认参数\")",
    "temporary context menu",
)
main = replace_once(main, 'appendMenu(m, MF_STRING, ID_CTX_REMOVE, "移除选中")', 'appendMenu(m, MF_STRING, ID_CTX_REMOVE_SAFE, "从任务列表移除")', "remove menu wording")

# refreshAll also maintains start/output lock UI.
main = replace_once(
    main,
    "func (a *application) refreshAll() {\n\ta.refreshList()\n\ta.refreshTotal()\n\ta.updateRightPanel()\n\ta.updateComponentStatus()\n}",
    "func (a *application) refreshAll() {\n\ta.refreshList()\n\ta.refreshTotal()\n\ta.updateRightPanel()\n\ta.updateComponentStatus()\n\ta.v420RefreshOutputHistory()\n\ta.v420UpdateStartAction()\n}",
    "refresh all queue UI",
)

# Right panel must not write programmatic ComboBox selections into draft state.
main = replace_once(
    main,
    "func (a *application) updateRightPanel() {\n\tt, _ := a.selectedTask()",
    "func (a *application) updateRightPanel() {\n\ta.rightUpdating = true\n\tdefer func() { a.rightUpdating = false }()\n\tt, _ := a.selectedTask()",
    "right panel updating guard",
)
main = replace_once(
    main,
    "\tsetText(a.hRightTitle, \"转换参数\")\n\tif t.Kind == model.KindImage {",
    "\tif t.Status == model.StatusHeld {\n\t\tsetText(a.hRightTitle, \"临时修改：\"+filepath.Base(t.Input))\n\t\tif t.Hold != nil && t.Hold.ReservedSlot { setText(a.hTaskApply, \"应用并立即重启\") } else { setText(a.hTaskApply, \"应用并归队\") }\n\t\tsetText(a.hTaskDefault, \"取消修改\")\n\t} else {\n\t\tsetText(a.hRightTitle, \"转换参数\")\n\t\tsetText(a.hTaskApply, \"应用到选中\")\n\t\tsetText(a.hTaskDefault, \"恢复选中默认\")\n\t}\n\tif t.Kind == model.KindImage {",
    "right held labels",
)

# Session restore cannot resurrect an active/held queue.
main = replace_once(main, "cp.Status == model.StatusProcessing || cp.Status == model.StatusQueued", "cp.Status == model.StatusProcessing || cp.Status == model.StatusQueued || cp.Status == model.StatusPaused || cp.Status == model.StatusHeld", "session save locked states")
main = replace_once(main, "t.Status == model.StatusProcessing || t.Status == model.StatusQueued || t.Status == model.StatusCancelled", "t.Status == model.StatusProcessing || t.Status == model.StatusQueued || t.Status == model.StatusPaused || t.Status == model.StatusHeld || t.Status == model.StatusCancelled", "session load locked states")

# Config migration keeps legacy image output and normalises independent histories.
config = replace_once(
    config,
    "\t\tif old.VideoOutput != \"\" {\n\t\t\ts.OutputDir = old.VideoOutput\n\t\t} else if old.Output != \"\" {\n\t\t\ts.OutputDir = old.Output\n\t\t}",
    "\t\tif old.VideoOutput != \"\" {\n\t\t\ts.OutputDir = old.VideoOutput\n\t\t} else if old.Output != \"\" {\n\t\t\ts.OutputDir = old.Output\n\t\t}\n\t\tif old.ImageOutput != \"\" {\n\t\t\ts.ImageOutputDir = old.ImageOutput\n\t\t}",
    "legacy image output migration",
)
config = replace_once(
    config,
    "\tif s.ImageFormat == \"\" {",
    "\tif s.ImageOutputDir == \"\" {\n\t\ts.ImageOutputDir = s.OutputDir\n\t}\n\tif len(s.RecentImageOutputDirs) == 0 && len(s.RecentOutputDirs) > 0 {\n\t\ts.RecentImageOutputDirs = append([]string(nil), s.RecentOutputDirs...)\n\t}\n\tif s.LastImageOutputDir == \"\" {\n\t\ts.LastImageOutputDir = s.ImageOutputDir\n\t}\n\tif s.ImageFormat == \"\" {",
    "normalize image output",
)

MAIN.write_text(main, encoding="utf-8")
CONFIG.write_text(config, encoding="utf-8")
V420.write_text(v420, encoding="utf-8")
print("v4.2.0 transform applied")
