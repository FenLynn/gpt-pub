//go:build windows

package main

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
	"mediaworkbench/internal/workflow"
)

func copyTaskIDSet(src map[int64]bool) map[int64]bool {
	out := make(map[int64]bool, len(src))
	for id, value := range src {
		if value {
			out[id] = true
		}
	}
	return out
}

func (a *application) v420ConfirmDiskSpace(outputRoot string, ids map[int64]bool, title string) bool {
	if !a.settings.EstimateDiskSpace || len(ids) == 0 {
		return true
	}
	need := a.estimateRunBytes(ids)
	if need <= 0 {
		return true
	}
	free, err := media.AvailableDiskBytes(outputRoot)
	if err != nil {
		return true
	}
	required := uint64(float64(need)*1.15) + 256*1024*1024
	if free >= required {
		return true
	}
	msg := fmt.Sprintf("预计新增输出约 %s，建议至少保留 %s；当前可用空间 %s。\r\n\r\n是否继续？", media.FormatBytes(need), media.FormatBytes(int64(required)), media.FormatBytes(int64(free)))
	return messageBox(a.hwnd, title, msg, MB_YESNO|MB_ICONWARNING) == IDYES
}

func (a *application) v420TogglePause() {
	a.runMu.Lock()
	if !a.running {
		a.runMu.Unlock()
		return
	}
	a.paused = !a.paused
	paused := a.paused
	controller := a.controller
	runIDs := copyTaskIDSet(a.runTaskIDs)
	if !paused {
		a.pauseCond.Broadcast()
	}
	a.runMu.Unlock()

	var controlErr error
	if controller != nil {
		if paused {
			controlErr = controller.Pause()
		} else {
			controlErr = controller.Resume()
		}
	}
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil || !runIDs[task.ID] {
			continue
		}
		if paused && task.Status == model.StatusProcessing {
			task.Status = model.StatusPaused
		} else if !paused && task.Status == model.StatusPaused {
			task.Status = model.StatusProcessing
		}
	}
	a.mu.Unlock()
	if paused {
		setText(a.hPause, "继续")
		msg := "队列与正在运行的 FFmpeg 进程均已暂停；搁置任务仍可编辑。"
		if controlErr != nil {
			msg = "队列已暂停，但个别 FFmpeg 进程暂停失败：" + short(controlErr.Error(), 180)
		}
		setText(a.hStatusText, msg)
	} else {
		setText(a.hPause, "暂停")
		msg := "队列与 FFmpeg 进程已继续。"
		if controlErr != nil {
			msg = "队列已继续，但个别 FFmpeg 进程恢复失败：" + short(controlErr.Error(), 180)
		}
		setText(a.hStatusText, msg)
		a.v420SignalQueue()
	}
	procPostMessageW.Call(a.hwnd, WM_APP_REFRESH, 0, 0)
}

func (a *application) v420StopQueue() {
	a.runMu.Lock()
	if !a.running {
		a.runMu.Unlock()
		return
	}
	a.running = false
	a.paused = false
	controller := a.controller
	cancel := a.cancel
	runIDs := copyTaskIDSet(a.runTaskIDs)
	if cancel != nil {
		cancel()
	}
	a.pauseCond.Broadcast()
	a.runMu.Unlock()
	if controller != nil {
		_ = controller.Resume()
	}

	type stoppedTask struct {
		task model.Task
		opts model.TaskOptions
	}
	var stopped []stoppedTask
	var returnReady []int64
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil || !runIDs[task.ID] {
			continue
		}
		if task.Status == model.StatusHeld {
			if workflow.StopRunReturnsHeldToReady(task, a.settings) {
				returnReady = append(returnReady, task.ID)
			}
			continue
		}
		if task.Status == model.StatusReady || task.Status == model.StatusQueued || task.Status == model.StatusProcessing || task.Status == model.StatusPaused {
			opts := a.settings.EffectiveOptions(task)
			task.Status = model.StatusCancelled
			task.Error = "已停止"
			task.Engine = "已停止"
			task.FinishedAt = time.Now()
			stopped = append(stopped, stoppedTask{task: *task, opts: opts})
		}
	}
	a.heldEditTaskID = 0
	a.rightDraftFields = make(map[int]bool)
	a.rightSelectionKey = ""
	a.mu.Unlock()

	a.runMu.Lock()
	for _, id := range returnReady {
		delete(a.runTaskIDs, id)
		delete(a.immediateRestarts, id)
		delete(a.holdRequests, id)
		delete(a.removeRequests, id)
	}
	a.runMu.Unlock()
	for i := range stopped {
		item := stopped[i]
		a.appendTaskHistory(&item.task, item.opts, "已停止")
	}
	setText(a.hStatusText, fmt.Sprintf("正在停止队列；%d 个搁置任务已退回准备中，未提交草稿已丢弃。", len(returnReady)))
	a.saveSession()
	procPostMessageW.Call(a.hwnd, WM_APP_REFRESH, 0, 0)
}

func taskOptionStrings(options model.TaskOptions, kind model.Kind) [5]string {
	if kind == model.KindImage {
		return [5]string{options.ImageSize, options.ImageFormat, options.Quality, options.ImageLimit, options.Rotation}
	}
	return [5]string{options.Resolution, options.Codec, options.Quality, optionsVolumeDisplay(options), options.Rotation}
}

func sharedOptionValue(values [][5]string, index int) (string, bool) {
	if len(values) == 0 {
		return "", false
	}
	value := values[0][index]
	for i := 1; i < len(values); i++ {
		if values[i][index] != value {
			return "混合", true
		}
	}
	return value, false
}

func comboValuesWithMixed(values []string, mixed bool) []string {
	if !mixed {
		return values
	}
	out := make([]string, 0, len(values)+1)
	out = append(out, "混合")
	out = append(out, values...)
	return out
}

func comboFillStable(hwnd uintptr, values []string, selected string, preserveDraft bool) {
	if hwnd == 0 || preserveDraft {
		return
	}
	if comboText(hwnd) == selected {
		count := int(send(hwnd, CB_GETCOUNT, 0, 0))
		if count == len(values) {
			return
		}
	}
	comboFill(hwnd, values, selected)
}

func rightSelectionKey(tasks []*model.Task, heldID int64) string {
	if heldID != 0 {
		return fmt.Sprintf("held:%d", heldID)
	}
	ids := make([]int64, 0, len(tasks))
	for _, task := range tasks {
		if task != nil {
			ids = append(ids, task.ID)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, fmt.Sprint(id))
	}
	return strings.Join(parts, ",")
}

func (a *application) v420SelectedTaskSnapshots() []*model.Task {
	idxs := a.selectedTaskIndices()
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]*model.Task, 0, len(idxs))
	for _, idx := range idxs {
		if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
			continue
		}
		copy := *a.tasks[idx]
		out = append(out, &copy)
	}
	return out
}

func (a *application) v420HeldTaskSnapshot() *model.Task {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.heldEditTaskID == 0 {
		return nil
	}
	task, _ := a.findTaskByIDLocked(a.heldEditTaskID)
	if task == nil || task.Status != model.StatusHeld {
		return nil
	}
	copy := *task
	return &copy
}

func (a *application) v420UpdateRightPanel() {
	a.rightUpdating = true
	defer func() { a.rightUpdating = false }()

	held := a.v420HeldTaskSnapshot()
	selected := a.v420SelectedTaskSnapshots()
	if held != nil {
		selected = []*model.Task{held}
	}
	key := rightSelectionKey(selected, func() int64 {
		if held != nil {
			return held.ID
		}
		return 0
	}())
	selectionChanged := key != a.rightSelectionKey
	if selectionChanged {
		a.rightSelectionKey = key
		a.rightDraftFields = make(map[int]bool)
	}
	preserveDraft := !selectionChanged && len(a.rightDraftFields) > 0
	if len(selected) == 0 {
		setText(a.hRightTitle, "转换参数")
		setText(a.hDetails, "选择一个或多个准备中任务后，可在这里编辑个体参数。已入队任务需通过右键“临时操作”安全搁置后才能修改。")
		for _, h := range []uintptr{a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation, a.hTaskApply, a.hTaskDefault} {
			enable(h, false)
		}
		return
	}

	kind := selected[0].Kind
	var editable []*model.Task
	locked := 0
	for _, task := range selected {
		if task == nil || task.Kind != kind {
			continue
		}
		if task.Status == model.StatusReady || task.Status == model.StatusHeld {
			editable = append(editable, task)
		} else {
			locked++
		}
	}
	canEdit := len(editable) > 0 && (held != nil || locked == 0 || len(editable) > 0)
	values := make([][5]string, 0, len(editable))
	for _, task := range editable {
		values = append(values, taskOptionStrings(a.settings.EffectiveOptions(task), task.Kind))
	}
	if len(values) == 0 {
		values = append(values, taskOptionStrings(a.settings.EffectiveOptions(selected[0]), kind))
	}
	v0, m0 := sharedOptionValue(values, 0)
	v1, m1 := sharedOptionValue(values, 1)
	v2, m2 := sharedOptionValue(values, 2)
	v3, m3 := sharedOptionValue(values, 3)
	v4, m4 := sharedOptionValue(values, 4)
	if kind == model.KindImage {
		comboFillStable(a.hTaskRes, comboValuesWithMixed(imageSizes(), m0), v0, preserveDraft)
		comboFillStable(a.hTaskCodec, comboValuesWithMixed([]string{"JPG", "PNG"}, m1), v1, preserveDraft)
		comboFillStable(a.hTaskVolume, comboValuesWithMixed([]string{"不限", "约 500KB", "约 1MB", "约 2MB", "约 5MB"}, m3), v3, preserveDraft)
	} else {
		comboFillStable(a.hTaskRes, comboValuesWithMixed(videoResolutions(), m0), v0, preserveDraft)
		comboFillStable(a.hTaskCodec, comboValuesWithMixed([]string{"H.265", "H.264"}, m1), v1, preserveDraft)
		comboFillStable(a.hTaskVolume, comboValuesWithMixed(volumeModes(), m3), v3, preserveDraft)
	}
	comboFillStable(a.hTaskQuality, comboValuesWithMixed([]string{"高", "中", "低"}, m2), v2, preserveDraft)
	comboFillStable(a.hTaskRotation, comboValuesWithMixed(rotations(), m4), v4, preserveDraft)
	for _, h := range []uintptr{a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation} {
		enable(h, canEdit)
	}
	enable(a.hTaskApply, canEdit)
	enable(a.hTaskDefault, canEdit)

	if held != nil {
		setText(a.hRightTitle, "临时修改："+filepath.Base(held.Input))
		if held.Hold != nil && held.Hold.ReservedSlot {
			setText(a.hTaskApply, "应用并立即重启")
			setText(a.hDetails, fmt.Sprintf("原状态：%s\r\n当前任务已安全搁置并保留一个并发名额。修改后会从 0%% 重新转换；源文件不会改变。", held.Hold.FromStatus))
		} else {
			setText(a.hTaskApply, "应用并归队")
			setText(a.hDetails, "该队列任务已临时取出。修改后恢复原相对顺序；原位置已过去时进入当前等待队列最前端。")
		}
		setText(a.hTaskDefault, "取消修改")
		return
	}
	setText(a.hTaskApply, "应用到选中")
	setText(a.hTaskDefault, "恢复选中默认")
	if len(selected) > 1 {
		setText(a.hRightTitle, fmt.Sprintf("批量参数 · %d 项", len(selected)))
		details := fmt.Sprintf("准备中可编辑：%d 个", len(editable))
		if locked > 0 {
			details += fmt.Sprintf("\r\n已锁定并跳过：%d 个。锁定任务只能单个通过右键临时修改；可以多选安全移除。", locked)
		}
		details += "\r\n\r\n不同值显示为“混合”。只有你实际改动的字段会在点击“应用到选中”后写入。"
		setText(a.hDetails, details)
		return
	}
	task := selected[0]
	if task.IsLocked() {
		setText(a.hRightTitle, "参数已锁定")
		setText(a.hDetails, fmt.Sprintf("任务：%s\r\n状态：%s\r\n\r\n该任务已入队，底部默认和普通个体编辑均不会改变它。请右键选择“临时操作”。", filepath.Base(task.Input), task.Status))
		return
	}
	opts := a.settings.EffectiveOptions(task)
	setText(a.hRightTitle, "转换参数")
	setText(a.hDetails, fmt.Sprintf("源文件：%s\r\n\r\n源信息：%d×%d · %.2f FPS · %s\r\n状态：%s\r\n输出设置：%s · %s · %s · %s · %s", task.Input, task.Width, task.Height, task.FPS, media.FormatBytes(task.InputSize), task.Status, taskOptionStrings(opts, task.Kind)[0], taskOptionStrings(opts, task.Kind)[1], taskOptionStrings(opts, task.Kind)[2], taskOptionStrings(opts, task.Kind)[3], taskOptionStrings(opts, task.Kind)[4]))
}

func (a *application) v420ResetRunMaps() {
	a.taskCancels = make(map[int64]context.CancelFunc)
	a.holdRequests = make(map[int64]bool)
	a.removeRequests = make(map[int64]bool)
	a.immediateRestarts = make(map[int64]bool)
}

func (a *application) v420SaveSettings() {
	_ = config.Save(a.settings)
}
