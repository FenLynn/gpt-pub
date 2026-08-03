package workflow

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"mediaworkbench/internal/model"
)

const SessionSchema = 2

type SessionEnvelope struct {
	Schema        int           `json:"schema"`
	Version       string        `json:"version"`
	SavedAt       time.Time     `json:"saved_at"`
	CleanShutdown bool          `json:"clean_shutdown"`
	Reason        string        `json:"reason"`
	Tasks         []*model.Task `json:"tasks"`
}

type RecoverySummary struct {
	Total      int
	Ready      int
	Reset      int
	Missing    int
	Completed  int
	Skipped    int
	Failed     int
	Frozen     int
	Legacy     bool
	BackupUsed bool
}

func cloneQueue(src *model.QueueSnapshot) *model.QueueSnapshot {
	if src == nil {
		return nil
	}
	cp := *src
	return &cp
}

func cloneHold(src *model.HoldState) *model.HoldState {
	if src == nil {
		return nil
	}
	cp := *src
	cp.Queue = cloneQueue(src.Queue)
	return &cp
}

func CloneTask(src *model.Task) *model.Task {
	if src == nil {
		return nil
	}
	cp := *src
	cp.Queue = cloneQueue(src.Queue)
	cp.Hold = cloneHold(src.Hold)
	cp.ThumbnailIndex = -1
	return &cp
}

func NewSessionEnvelope(tasks []*model.Task, version string, clean bool, reason string, now time.Time) SessionEnvelope {
	items := make([]*model.Task, 0, len(tasks))
	for _, task := range tasks {
		if task != nil {
			items = append(items, CloneTask(task))
		}
	}
	return SessionEnvelope{Schema: SessionSchema, Version: version, SavedAt: now, CleanShutdown: clean, Reason: reason, Tasks: items}
}

func DecodeSession(data []byte) (SessionEnvelope, bool, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return SessionEnvelope{}, false, errors.New("empty session snapshot")
	}
	if trimmed[0] == '[' {
		var tasks []*model.Task
		if err := json.Unmarshal(trimmed, &tasks); err != nil {
			return SessionEnvelope{}, true, err
		}
		return SessionEnvelope{Schema: 1, Version: "legacy", Tasks: tasks}, true, nil
	}
	var envelope SessionEnvelope
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return SessionEnvelope{}, false, err
	}
	if envelope.Schema <= 0 || envelope.Tasks == nil {
		return SessionEnvelope{}, false, errors.New("invalid session envelope")
	}
	if envelope.Schema > SessionSchema {
		return SessionEnvelope{}, false, fmt.Errorf("unsupported session schema %d", envelope.Schema)
	}
	return envelope, false, nil
}

func SaveSessionAtomic(path string, envelope SessionEnvelope) error {
	if path == "" {
		return errors.New("empty session path")
	}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	bak := path + ".bak"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.Remove(bak)
	if _, statErr := os.Stat(path); statErr == nil {
		if err := os.Rename(path, bak); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	} else if !os.IsNotExist(statErr) {
		_ = os.Remove(tmp)
		return statErr
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Rename(bak, path)
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func resetTransientTask(task *model.Task) {
	if task.Hold != nil {
		if task.Hold.Queue != nil {
			task.Queue = cloneQueue(task.Hold.Queue)
		}
		task.Options = task.Hold.Original
	} else if task.Queue != nil {
		task.Options = task.Queue.Options
	}
	if task.Queue != nil {
		task.Queue.OutputPath = ""
	}
	task.Status = model.StatusReady
	task.Progress = 0
	task.OutputPath = ""
	task.OutputSize = 0
	task.Error = ""
	task.FailureCategory = ""
	task.ValidationWarning = ""
	task.Engine = ""
	task.Hold = nil
	task.StartedAt = time.Time{}
	task.FinishedAt = time.Time{}
}

func RecoverTasks(tasks []*model.Task, exists func(string) bool) RecoverySummary {
	if exists == nil {
		exists = func(path string) bool { _, err := os.Stat(path); return err == nil }
	}
	var summary RecoverySummary
	for _, task := range tasks {
		if task == nil {
			continue
		}
		summary.Total++
		task.ThumbnailIndex = -1
		if !exists(task.Input) {
			task.Status = model.StatusFailed
			task.Progress = 0
			task.OutputPath = ""
			task.OutputSize = 0
			task.Engine = ""
			task.Hold = nil
			task.Error = "恢复失败：源文件不存在或已移动: " + task.Input
			task.FailureCategory = "源文件缺失"
			task.ValidationWarning = ""
			task.StartedAt = time.Time{}
			task.FinishedAt = time.Time{}
			summary.Missing++
			continue
		}
		switch task.Status {
		case model.StatusProcessing, model.StatusQueued, model.StatusPaused, model.StatusHeld, model.StatusCancelled:
			if task.Queue != nil || (task.Hold != nil && task.Hold.Queue != nil) {
				summary.Frozen++
			}
			resetTransientTask(task)
			summary.Reset++
			summary.Ready++
		case model.StatusReady:
			if task.Queue != nil {
				task.Options = task.Queue.Options
				task.Queue.OutputPath = ""
				summary.Frozen++
			}
			summary.Ready++
		case model.StatusDone:
			summary.Completed++
		case model.StatusSkipped:
			summary.Skipped++
		case model.StatusFailed:
			summary.Failed++
		default:
			task.Status = model.StatusReady
			task.Progress = 0
			summary.Reset++
			summary.Ready++
		}
	}
	return summary
}

func RecoveryNotice(summary RecoverySummary, envelope SessionEnvelope) string {
	mode := "正常退出快照"
	if summary.Legacy {
		mode = "旧版会话"
	} else if !envelope.CleanShutdown {
		mode = "异常中断快照"
	}
	backup := ""
	if summary.BackupUsed {
		backup = "，主快照损坏，已使用备份"
	}
	return fmt.Sprintf("已恢复%s%s：总计 %d，准备 %d，从 0%% 重新处理 %d，源文件缺失 %d，完成结果保留 %d。", mode, backup, summary.Total, summary.Ready, summary.Reset, summary.Missing, summary.Completed+summary.Skipped)
}
