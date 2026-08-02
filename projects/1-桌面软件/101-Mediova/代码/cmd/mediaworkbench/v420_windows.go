//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
	"mediaworkbench/internal/workflow"
)

const cbnSelChange = 1

func (a *application) v420OutputDir(kind model.Kind) string {
	return strings.TrimSpace(a.settings.OutputDirFor(kind))
}

func (a *application) v420OutputLocked(kind model.Kind) bool {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	return a.running && a.runKind == kind
}

func (a *application) v420SetOutputDir(kind model.Kind, path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	if a.v420OutputLocked(kind) {
		setText(a.hStatusText, "当前活动队列已锁定输出母目录；停止队列后才能更换。")
		return false
	}
	a.settings.SetOutputDirFor(kind, path)
	recent := rememberRecentDirectory(path, a.settings.RecentOutputDirsFor(kind), 10)
	a.settings.SetRecentOutputDirsFor(kind, recent)
	_ = config.Save(a.settings)
	return true
}

func (a *application) v420RefreshOutputHistory() {
	if a == nil || a.hOutputEdit == 0 {
		return
	}
	kind := a.currentKind
	current := strings.TrimSpace(a.settings.OutputDirFor(kind))
	send(a.hOutputEdit, CB_RESETCONTENT, 0, 0)
	for _, path := range a.settings.RecentOutputDirsFor(kind) {
		send(a.hOutputEdit, CB_ADDSTRING, 0, uintptr(unsafeStringPointer(path)))
	}
	setText(a.hOutputEdit, current)
	enable(a.hOutputEdit, !a.v420OutputLocked(kind))
	enable(a.hOutputPick, !a.v420OutputLocked(kind))
}

// unsafeStringPointer centralises the short-lived UTF-16 pointer used by
// SendMessage. The backing allocation is retained by p for the duration of the call.
func unsafeStringPointer(s string) unsafe.Pointer { return unsafe.Pointer(p(s)) }

func (a *application) v420HandleControlNotification(id, code int) bool {
	if code != cbnSelChange {
		return false
	}
	switch id {
	case IDC_RESOLUTION, IDC_CODEC, IDC_QUALITY, IDC_VOLUME, IDC_ROTATION:
		a.v420ApplyGlobalControl(id)
		return true
	case IDC_TASK_RES, IDC_TASK_CODEC, IDC_TASK_QUALITY, IDC_TASK_VOLUME, IDC_TASK_ROTATION:
		if !a.rightUpdating {
			if a.rightDraftFields == nil {
				a.rightDraftFields = make(map[int]bool)
			}
			a.rightDraftFields[id] = true
		}
		return true
	case IDC_OUTPUT_EDIT:
		path := strings.TrimSpace(getText(a.hOutputEdit))
		if path != "" {
			a.v420SetOutputDir(a.currentKind, path)
		}
		return true
	}
	return false
}

func (a *application) v420ApplyGlobalControl(id int) {
	kind := a.currentKind
	var field workflow.DefaultField
	switch id {
	case IDC_RESOLUTION:
		field = workflow.FieldResolution
		if kind == model.KindImage {
			a.settings.ImageSize = comboText(a.hResolution)
		} else {
			a.settings.Resolution = comboText(a.hResolution)
		}
	case IDC_CODEC:
		field = workflow.FieldCodec
		if kind == model.KindImage {
			a.settings.ImageFormat = comboText(a.hCodec)
		} else {
			a.settings.Codec = comboText(a.hCodec)
		}
	case IDC_QUALITY:
		field = workflow.FieldQuality
		if kind == model.KindImage {
			a.settings.ImageQuality = comboText(a.hQuality)
		} else {
			a.settings.Quality = comboText(a.hQuality)
		}
	case IDC_VOLUME:
		field = workflow.FieldVolume
		if kind == model.KindImage {
			a.settings.ImageLimit = comboText(a.hVolume)
		} else {
			o := a.settings.DefaultOptions(model.KindVideo)
			parseVolume(&o, comboText(a.hVolume))
			a.settings.VolumeMode = o.VolumeMode
			a.settings.TargetSizeMB = o.TargetSizeMB
			a.settings.BitrateMbps = o.BitrateMbps
		}
	case IDC_ROTATION:
		field = workflow.FieldRotation
		a.settings.Rotation = comboText(a.hRotation)
	default:
		return
	}
	a.mu.Lock()
	changed := workflow.ApplyGlobalField(a.tasks, kind, a.settings, field)
	a.mu.Unlock()
	_ = config.Save(a.settings)
	a.saveSession()
	a.refreshList()
	a.updateRightPanel()
	setText(a.hStatusText, fmt.Sprintf("默认参数已更新，并立即应用到 %d 个准备中任务；已入队任务保持不变。", changed))
	a.v420UpdateStartAction()
}

func (a *application) v420ResetReadyDefaults() {
	a.mu.Lock()
	changed := workflow.ResetReadyToDefaults(a.tasks, a.currentKind, a.settings)
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
	setText(a.hStatusText, fmt.Sprintf("已将 %d 个准备中任务恢复为当前默认参数。", changed))
}

func (a *application) v420ReadyCount(kind model.Kind) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	count := 0
	for _, task := range a.tasks {
		if task != nil && task.Kind == kind && task.Status == model.StatusReady {
			count++
		}
	}
	return count
}

func (a *application) v420UpdateStartAction() {
	if a == nil || a.hStart == 0 {
		return
	}
	a.runMu.Lock()
	running, runKind := a.running, a.runKind
	a.runMu.Unlock()
	ready := a.v420ReadyCount(a.currentKind)
	if running {
		if a.currentKind == runKind {
			setText(a.hStart, "加入队列")
			enable(a.hStart, ready > 0)
		} else {
			setText(a.hStart, "等待当前队列")
			enable(a.hStart, false)
		}
		return
	}
	if a.currentKind == model.KindImage {
		setText(a.hStart, "开始压缩")
	} else {
		setText(a.hStart, "开始转换")
	}
	enable(a.hStart, ready > 0)
}

func (a *application) v420SignalQueue() {
	if a.queueWake == nil {
		return
	}
	select {
	case a.queueWake <- struct{}{}:
	default:
	}
}

func (a *application) v420PrepareReadyBatch(kind model.Kind, only map[int64]bool) (map[int64]bool, int, []string) {
	ids := make(map[int64]bool)
	outputRoot := a.v420OutputDir(kind)
	if outputRoot == "" {
		return ids, 0, []string{"未设置输出母目录"}
	}
	settings := a.settings
	type candidate struct {
		id    int64
		input string
		root  string
		kind  model.Kind
		opts  model.TaskOptions
	}
	var candidates []candidate
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil || task.Kind != kind || task.Status != model.StatusReady || (only != nil && !only[task.ID]) {
			continue
		}
		workflow.MaterializeReadyOptions(task, settings)
		candidates = append(candidates, candidate{id: task.ID, input: task.Input, root: task.Root, kind: task.Kind, opts: task.Options})
	}
	a.mu.Unlock()
	var problems []string
	skipped := 0
	for _, item := range candidates {
		out, skip, err := media.ResolveAndReserveOutput(item.input, item.root, outputRoot, item.kind, item.opts, settings, a.outputUnavailable, func(path string) bool {
			return a.reserveOutput(path, item.id)
		})
		if err != nil {
			problems = append(problems, filepath.Base(item.input)+": "+err.Error())
			continue
		}
		if skip {
			a.mu.Lock()
			if task, _ := a.findTaskByIDLocked(item.id); task != nil && task.Status == model.StatusReady {
				task.Status = model.StatusSkipped
				task.OutputPath = out
				task.Progress = 100
				task.Engine = "跳过已有文件"
				task.FinishedAt = time.Now()
				skipped++
			}
			a.mu.Unlock()
			continue
		}
		a.mu.Lock()
		task, _ := a.findTaskByIDLocked(item.id)
		if task == nil || task.Status != model.StatusReady {
			a.mu.Unlock()
			a.releaseOutput(out, item.id)
			continue
		}
		task.OutputPath = out
		seq := a.queueSequence.Add(1)
		if err := workflow.FreezeForQueue(task, settings, outputRoot, seq, time.Now()); err != nil {
			a.mu.Unlock()
			a.releaseOutput(out, item.id)
			problems = append(problems, filepath.Base(item.input)+": "+err.Error())
			continue
		}
		task.Queue.OutputPath = out
		ids[item.id] = true
		a.mu.Unlock()
	}
	return ids, skipped, problems
}

func (a *application) v420RollbackQueued(ids map[int64]bool) {
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil || !ids[task.ID] || task.Status != model.StatusQueued {
			continue
		}
		path := task.OutputPath
		task.Status = model.StatusReady
		task.Queue = nil
		task.OutputPath = ""
		task.Progress = 0
		if path != "" {
			go a.releaseOutput(path, task.ID)
		}
	}
	a.mu.Unlock()
}

func (a *application) v420AppendReadyToRun(only map[int64]bool) {
	a.runMu.Lock()
	if !a.running {
		a.runMu.Unlock()
		return
	}
	runKind := a.runKind
	a.runMu.Unlock()
	if err := workflow.CanAppendToActiveQueue(runKind, a.currentKind); err != nil {
		setText(a.hStatusText, "当前只运行一种媒体；可继续准备另一模式，待当前队列完成后再开始。")
		return
	}
	ids, skipped, problems := a.v420PrepareReadyBatch(runKind, only)
	if len(ids) == 0 {
		msg := "没有可加入的准备中任务。"
		if skipped > 0 {
			msg = fmt.Sprintf("没有新任务入队；%d 个任务因输出已存在而跳过。", skipped)
		}
		if len(problems) > 0 {
			msg += " " + strings.Join(problems, "；")
		}
		setText(a.hStatusText, msg)
		a.refreshAll()
		return
	}
	a.runMu.Lock()
	if a.runTaskIDs == nil {
		a.runTaskIDs = make(map[int64]bool)
	}
	for id := range ids {
		a.runTaskIDs[id] = true
		if a.runOnly != nil {
			a.runOnly[id] = true
		}
	}
	a.runMu.Unlock()
	for range ids {
		a.v420SignalQueue()
	}
	a.saveSession()
	a.refreshAll()
	msg := fmt.Sprintf("已向当前队列加入 %d 个任务。", len(ids))
	if skipped > 0 {
		msg += fmt.Sprintf(" 另有 %d 个输出已存在而跳过。", skipped)
	}
	if len(problems) > 0 {
		msg += " 部分任务未加入：" + strings.Join(problems, "；")
	}
	setText(a.hStatusText, msg)
}

func (a *application) v420StartQueueFiltered(only map[int64]bool) {
	a.runMu.Lock()
	running := a.running
	a.runMu.Unlock()
	if running {
		a.v420AppendReadyToRun(only)
		return
	}
	a.readSettingsFromUI()
	runKind := a.currentKind
	outputRoot := a.v420OutputDir(runKind)
	if outputRoot == "" {
		messageBox(a.hwnd, "输出母目录", "请先选择当前模式的输出母目录。", MB_OK|MB_ICONINFORMATION)
		return
	}
	ff, fp, ok := media.FindFFmpeg(a.ffmpeg)
	if !ok {
		messageBox(a.hwnd, "缺少 FFmpeg", "请通过 FFmpeg 菜单选择组件目录；同目录必须有 ffmpeg.exe 与 ffprobe.exe。", MB_OK|MB_ICONERROR)
		return
	}
	a.ffmpeg, a.ffprobe = ff, fp
	controller := media.NewProcessController()
	ctx, cancel := context.WithCancel(media.WithProcessController(context.Background(), controller))
	a.runMu.Lock()
	a.running = true
	a.paused = false
	a.runKind = runKind
	a.runStart = time.Now()
	a.timeEnd = time.Time{}
	a.ctx, a.cancel = ctx, cancel
	a.controller = controller
	a.gpuDisabledForRun = false
	a.runOnly = nil
	a.runTaskIDs = make(map[int64]bool)
	a.reservedOutputs = make(map[string]int64)
	a.taskCancels = make(map[int64]context.CancelFunc)
	a.holdRequests = make(map[int64]bool)
	a.removeRequests = make(map[int64]bool)
	a.immediateRestarts = make(map[int64]bool)
	a.runMu.Unlock()

	ids, skipped, problems := a.v420PrepareReadyBatch(runKind, only)
	if len(ids) == 0 {
		cancel()
		a.runMu.Lock()
		a.running = false
		a.ctx = nil
		a.cancel = nil
		a.controller = nil
		a.runTaskIDs = nil
		a.reservedOutputs = make(map[string]int64)
		a.runMu.Unlock()
		msg := "当前工作区没有准备中的任务。"
		if skipped > 0 {
			msg = fmt.Sprintf("%d 个任务因输出已存在而跳过，没有任务需要运行。", skipped)
		}
		if len(problems) > 0 {
			msg += " " + strings.Join(problems, "；")
		}
		messageBox(a.hwnd, "任务队列", msg, MB_OK|MB_ICONINFORMATION)
		a.refreshAll()
		return
	}
	a.runMu.Lock()
	for id := range ids {
		a.runTaskIDs[id] = true
	}
	a.runMu.Unlock()

	if a.settings.EstimateDiskSpace {
		_ = os.MkdirAll(outputRoot, 0o755)
		need := a.estimateRunBytes(ids)
		if free, err := media.AvailableDiskBytes(outputRoot); err == nil && need > 0 {
			required := uint64(float64(need)*1.15) + 256*1024*1024
			if free < required {
				msg := fmt.Sprintf("预计本次输出约 %s，建议至少保留 %s；当前可用空间 %s。\r\n\r\n是否继续？", media.FormatBytes(need), media.FormatBytes(int64(required)), media.FormatBytes(int64(free)))
				if messageBox(a.hwnd, "磁盘空间预检", msg, MB_YESNO|MB_ICONWARNING) != IDYES {
					a.v420RollbackQueued(ids)
					cancel()
					a.runMu.Lock()
					a.running = false
					a.ctx = nil
					a.cancel = nil
					a.controller = nil
					a.runTaskIDs = nil
					a.runMu.Unlock()
					a.refreshAll()
					return
				}
			}
		}
	}

	workers := a.recommendedWorkers(runKind, ids)
	if workers < 1 {
		workers = 1
	}
	if workers > config.MaxConcurrency() {
		workers = config.MaxConcurrency()
	}
	enable(a.hPause, true)
	enable(a.hStop, true)
	setText(a.hPause, "暂停")
	procSetTimer.Call(a.hwnd, TIMER_MAIN_CLOCK, 1000, 0)
	a.saveSession()
	for i := 0; i < workers; i++ {
		a.workers.Add(1)
		go a.worker()
	}
	go func() {
		a.workers.Wait()
		if !a.selfTest {
			procPostMessageW.Call(a.hwnd, WM_APP_DONE, 0, 0)
		}
	}()
	msg := fmt.Sprintf("开始处理 %d 个任务 · 实际并发 %d。转换期间可继续添加并加入同类型任务。", len(ids), workers)
	if skipped > 0 {
		msg += fmt.Sprintf(" 已跳过已有输出 %d 个。", skipped)
	}
	if len(problems) > 0 {
		msg += " 部分任务未加入：" + strings.Join(problems, "；")
	}
	setText(a.hStatusText, msg)
	a.refreshAll()
}

func (a *application) v420TakeNext() (int64, *model.Task, model.Settings, bool) {
	for {
		a.runMu.Lock()
		for a.running && a.paused {
			a.pauseCond.Wait()
		}
		running, ctx, runKind := a.running, a.ctx, a.runKind
		runIDs := make(map[int64]bool, len(a.runTaskIDs))
		for id := range a.runTaskIDs {
			runIDs[id] = true
		}
		a.runMu.Unlock()
		if !running || ctx == nil || ctx.Err() != nil {
			return 0, nil, model.Settings{}, false
		}
		pending := false
		a.mu.Lock()
		for _, pinnedOnly := range []bool{true, false} {
			for _, task := range a.tasks {
				if task == nil || !runIDs[task.ID] || task.Kind != runKind || task.Pinned != pinnedOnly {
					continue
				}
				if task.Status == model.StatusQueued {
					task.Status = model.StatusProcessing
					task.StartedAt = time.Now()
					task.FinishedAt = time.Time{}
					task.Progress = 0
					task.Engine = "准备编码"
					snapshot := *task
					settings := a.settings
					if task.Queue != nil {
						settings.ConflictPolicy = task.Queue.ConflictPolicy
					}
					a.mu.Unlock()
					a.postTaskRow(task.ID)
					return task.ID, &snapshot, settings, true
				}
				switch task.Status {
				case model.StatusProcessing, model.StatusPaused, model.StatusHeld:
					pending = true
				}
			}
		}
		a.mu.Unlock()
		if !pending {
			return 0, nil, model.Settings{}, false
		}
		select {
		case <-ctx.Done():
			return 0, nil, model.Settings{}, false
		case <-a.queueWake:
		case <-time.After(120 * time.Millisecond):
		}
	}
}

func (a *application) v420RegisterTaskCancel(id int64, cancel context.CancelFunc) {
	a.runMu.Lock()
	if a.taskCancels == nil {
		a.taskCancels = make(map[int64]context.CancelFunc)
	}
	a.taskCancels[id] = cancel
	a.runMu.Unlock()
}

func (a *application) v420UnregisterTaskCancel(id int64) {
	a.runMu.Lock()
	delete(a.taskCancels, id)
	a.runMu.Unlock()
}

func (a *application) v420RequestHold(id int64) bool {
	a.runMu.Lock()
	cancel := a.taskCancels[id]
	if cancel == nil {
		a.runMu.Unlock()
		return false
	}
	if a.holdRequests == nil {
		a.holdRequests = make(map[int64]bool)
	}
	a.holdRequests[id] = true
	a.runMu.Unlock()
	cancel()
	return true
}

func (a *application) v420RequestRemove(id int64) bool {
	a.runMu.Lock()
	cancel := a.taskCancels[id]
	if cancel == nil {
		a.runMu.Unlock()
		return false
	}
	if a.removeRequests == nil {
		a.removeRequests = make(map[int64]bool)
	}
	a.removeRequests[id] = true
	a.runMu.Unlock()
	cancel()
	return true
}

func (a *application) v420CompleteInterruption(id int64) bool {
	a.runMu.Lock()
	remove := a.removeRequests[id]
	hold := a.holdRequests[id]
	delete(a.removeRequests, id)
	delete(a.holdRequests, id)
	a.runMu.Unlock()
	if !remove && !hold {
		return false
	}
	if remove {
		a.postUI(func() { a.v420RemoveTaskByID(id) })
		return true
	}
	a.mu.Lock()
	task, _ := a.findTaskByIDLocked(id)
	if task != nil {
		task.OutputPath = ""
		task.OutputSize = 0
		task.Progress = 0
		task.Error = ""
		task.Engine = ""
		_ = workflow.HoldForEdit(task, time.Now())
		a.heldEditTaskID = id
	}
	a.mu.Unlock()
	a.postUI(func() {
		a.refreshAll()
		setText(a.hStatusText, "任务已安全搁置；修改后点击“应用并立即重启”，将从 0% 重新转换。")
	})
	a.v420SignalQueue()
	return true
}

func (a *application) v420WaitReservedRestart(id int64) (*model.Task, model.Settings, bool) {
	for {
		a.runMu.Lock()
		running, paused, ctx := a.running, a.paused, a.ctx
		immediate := a.immediateRestarts[id]
		a.runMu.Unlock()
		if !running || ctx == nil || ctx.Err() != nil {
			return nil, model.Settings{}, false
		}
		if paused {
			select {
			case <-ctx.Done():
				return nil, model.Settings{}, false
			case <-a.queueWake:
			case <-time.After(120 * time.Millisecond):
			}
			continue
		}
		a.mu.Lock()
		task, _ := a.findTaskByIDLocked(id)
		if task == nil {
			a.mu.Unlock()
			return nil, model.Settings{}, false
		}
		if immediate && task.Status == model.StatusQueued {
			task.Status = model.StatusProcessing
			task.StartedAt = time.Now()
			task.Progress = 0
			snapshot := *task
			settings := a.settings
			a.mu.Unlock()
			a.runMu.Lock()
			delete(a.immediateRestarts, id)
			a.runMu.Unlock()
			a.postTaskRow(id)
			return &snapshot, settings, true
		}
		waiting := task.Status == model.StatusHeld && task.Hold != nil && task.Hold.ReservedSlot
		a.mu.Unlock()
		if !waiting {
			return nil, model.Settings{}, false
		}
		select {
		case <-ctx.Done():
			return nil, model.Settings{}, false
		case <-a.queueWake:
		case <-time.After(120 * time.Millisecond):
		}
	}
}

func (a *application) v420BeginHoldSelected() {
	idxs := a.selectedTaskIndices()
	if len(idxs) != 1 {
		setText(a.hStatusText, "锁定任务只能一次修改一个；多选时可批量移除。")
		return
	}
	a.mu.Lock()
	if idxs[0] < 0 || idxs[0] >= len(a.tasks) {
		a.mu.Unlock()
		return
	}
	task := a.tasks[idxs[0]]
	if task == nil || !task.CanHoldForEdit() {
		a.mu.Unlock()
		setText(a.hStatusText, "该任务当前不能进入临时修改状态。")
		return
	}
	if a.heldEditTaskID != 0 && a.heldEditTaskID != task.ID {
		a.mu.Unlock()
		setText(a.hStatusText, "请先应用、取消或移除当前搁置任务。")
		return
	}
	id, status := task.ID, task.Status
	if status == model.StatusQueued {
		_ = workflow.HoldForEdit(task, time.Now())
		a.heldEditTaskID = id
		a.mu.Unlock()
		a.refreshAll()
		setText(a.hStatusText, "队列任务已搁置；修改后点击“应用并归队”。")
		return
	}
	task.Engine = "正在安全搁置…"
	a.mu.Unlock()
	if !a.v420RequestHold(id) {
		setText(a.hStatusText, "无法定位该任务的转换进程，未执行搁置。")
		return
	}
	a.postTaskRow(id)
	setText(a.hStatusText, "正在停止该任务并清理未完成输出…")
}

func (a *application) v420RemoveTaskByID(id int64) {
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
		if path != "" {
			_ = os.Remove(path)
			a.releaseOutput(path, id)
		}
		a.runMu.Lock()
		delete(a.runTaskIDs, id)
		delete(a.immediateRestarts, id)
		a.runMu.Unlock()
		a.saveSession()
		a.refreshAll()
		a.v420SignalQueue()
		return
	}
	a.mu.Unlock()
}

func (a *application) v420RemoveSelectedSafely() {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	type selected struct {
		id     int64
		status model.Status
	}
	var items []selected
	a.mu.Lock()
	for _, idx := range idxs {
		if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil {
			items = append(items, selected{id: a.tasks[idx].ID, status: a.tasks[idx].Status})
		}
	}
	a.mu.Unlock()
	if len(items) == 0 {
		return
	}
	queued, processing := 0, 0
	for _, item := range items {
		if item.status == model.StatusQueued || item.status == model.StatusHeld {
			queued++
		}
		if item.status == model.StatusProcessing || item.status == model.StatusPaused {
			processing++
		}
	}
	if queued+processing > 0 {
		msg := fmt.Sprintf("将从任务列表移除 %d 个任务，其中队列/搁置 %d 个、转换/暂停 %d 个。\r\n转换进程会先安全停止，未完成输出会清理。\r\n不会删除任何源文件。", len(items), queued, processing)
		if messageBox(a.hwnd, "从任务列表移除", msg, MB_YESNO|MB_ICONWARNING) != IDYES {
			return
		}
	}
	for _, item := range items {
		if item.status == model.StatusProcessing || item.status == model.StatusPaused {
			if a.v420RequestRemove(item.id) {
				continue
			}
		}
		a.v420RemoveTaskByID(item.id)
	}
}

func (a *application) v420OptionsFromRight(base model.TaskOptions, kind model.Kind, dirty map[int]bool) model.TaskOptions {
	if dirty[IDC_TASK_RES] {
		if kind == model.KindImage {
			base.ImageSize = comboText(a.hTaskRes)
		} else {
			base.Resolution = comboText(a.hTaskRes)
		}
	}
	if dirty[IDC_TASK_CODEC] {
		if kind == model.KindImage {
			base.ImageFormat = comboText(a.hTaskCodec)
		} else {
			base.Codec = comboText(a.hTaskCodec)
		}
	}
	if dirty[IDC_TASK_QUALITY] {
		base.Quality = comboText(a.hTaskQuality)
	}
	if dirty[IDC_TASK_VOLUME] {
		if kind == model.KindImage {
			base.ImageLimit = comboText(a.hTaskVolume)
		} else {
			parseVolume(&base, comboText(a.hTaskVolume))
		}
	}
	if dirty[IDC_TASK_ROTATION] {
		base.Rotation = comboText(a.hTaskRotation)
	}
	base.FollowDefaults = false
	return base
}

func (a *application) v420ApplyTaskOptions(defaults bool) {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	a.mu.Lock()
	if len(idxs) == 1 && idxs[0] >= 0 && idxs[0] < len(a.tasks) {
		task := a.tasks[idxs[0]]
		if task != nil && task.Status == model.StatusHeld {
			id := task.ID
			if defaults {
				immediate, err := workflow.CancelHeldEdit(task, time.Now())
				if err == nil && immediate {
					a.runMu.Lock()
					a.immediateRestarts[id] = true
					a.runMu.Unlock()
				}
			} else {
				dirty := a.rightDraftFields
				if len(dirty) == 0 {
					dirty = map[int]bool{IDC_TASK_RES: true, IDC_TASK_CODEC: true, IDC_TASK_QUALITY: true, IDC_TASK_VOLUME: true, IDC_TASK_ROTATION: true}
				}
				updated := a.v420OptionsFromRight(task.Options, task.Kind, dirty)
				immediate, err := workflow.ApplyHeldOptions(task, updated, time.Now())
				if err == nil && immediate {
					a.runMu.Lock()
					a.immediateRestarts[id] = true
					a.runMu.Unlock()
				}
			}
			a.heldEditTaskID = 0
			a.rightDraftFields = make(map[int]bool)
			a.mu.Unlock()
			a.v420SignalQueue()
			a.saveSession()
			a.refreshAll()
			return
		}
	}
	dirty := a.rightDraftFields
	changed, skipped := 0, 0
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
}
