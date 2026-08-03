//go:build windows

package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"mediaworkbench/internal/model"
	"mediaworkbench/internal/workflow"
)

func (a *application) v452DirectoryTarget(output bool) string {
	if a == nil {
		return ""
	}
	selected := a.selectedTaskIDsSnapshot()
	a.mu.Lock()
	tasks := make([]*model.Task, 0, len(a.tasks))
	for _, task := range a.tasks {
		if task == nil {
			continue
		}
		copy := *task
		if task.Queue != nil {
			queueCopy := *task.Queue
			copy.Queue = &queueCopy
		}
		tasks = append(tasks, &copy)
	}
	settings := a.settings
	a.mu.Unlock()
	return v452ResolveTaskDirectory(tasks, selected, a.currentKind, output, directoryFallback{
		LastInputDir:       settings.LastInputDir,
		LastImageInputDir:  settings.LastImageInputDir,
		LastOutputDir:      settings.LastOutputDir,
		LastImageOutputDir: settings.LastImageOutputDir,
		OutputDir:          settings.OutputDir,
		ImageOutputDir:     settings.ImageOutputDir,
	})
}

func (a *application) v452OpenTaskDirectory(output bool) {
	path := strings.TrimSpace(a.v452DirectoryTarget(output))
	if path == "" {
		title := "原目录"
		if output {
			title = "输出目录"
		}
		messageBox(a.hwnd, title, "当前没有可打开的目录。", MB_OK|MB_ICONINFORMATION)
		return
	}
	if output {
		if err := os.MkdirAll(path, 0o755); err != nil {
			messageBox(a.hwnd, "输出目录", err.Error(), MB_OK|MB_ICONERROR)
			return
		}
	}
	shellOpen(path)
}

func (a *application) v452ExitQueueFlags() uintptr {
	if a == nil {
		return MF_STRING | MF_GRAYED
	}
	selected := a.selectedTaskIDsSnapshot()
	a.mu.Lock()
	eligible := workflow.CanExitQueuedSelection(a.tasks, selected)
	a.mu.Unlock()
	if eligible {
		return MF_STRING
	}
	return MF_STRING | MF_GRAYED
}

func (a *application) v452ExitSelectedQueue() {
	selected := a.selectedTaskIDsSnapshot()
	if len(selected) == 0 {
		return
	}
	a.mu.Lock()
	result := workflow.ExitQueuedForEdit(a.tasks, selected, time.Now())
	for _, task := range a.tasks {
		if task != nil && selected[task.ID] && task.Status == model.StatusHeld {
			task.Progress = 0
			task.Error = ""
			task.OutputSize = 0
		}
	}
	a.mu.Unlock()
	if result.Exited == 0 {
		setText(a.hStatusText, "选中任务中没有可退出的等待队列任务；转换中或暂停任务需使用安全搁置。")
		return
	}
	a.saveSession()
	a.refreshAll()
	a.v420SignalQueue()
	msg := fmt.Sprintf("已将 %d 个任务退出队列并转为搁置，可逐个修改后归队。", result.Exited)
	if result.Skipped > 0 {
		msg += fmt.Sprintf(" 跳过 %d 个非等待队列任务。", result.Skipped)
	}
	setText(a.hStatusText, msg)
}

func (a *application) v452ActivateHeldSelected() bool {
	idxs := a.selectedTaskIndices()
	if len(idxs) != 1 {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	idx := idxs[0]
	if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
		return false
	}
	task := a.tasks[idx]
	if task.Status != model.StatusHeld || task.Hold == nil {
		return false
	}
	if a.heldEditTaskID != 0 && a.heldEditTaskID != task.ID {
		setText(a.hStatusText, "请先应用、取消或移除当前正在修改的搁置任务。")
		return true
	}
	a.heldEditTaskID = task.ID
	a.rightDraftFields = make(map[int]bool)
	a.rightSelectionKey = ""
	return true
}
