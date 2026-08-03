package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const runtimePersistenceDedupWindow = 30 * time.Second

type persistenceNoticeState struct {
	LastKey     string
	LastAt      time.Time
	FailedKinds map[string]bool
}

func normalizePersistencePart(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func persistenceFailureKey(kind, operation string, err error) string {
	message := ""
	if err != nil {
		message = normalizePersistencePart(err.Error())
	}
	return strings.Join([]string{
		normalizePersistencePart(kind),
		normalizePersistencePart(operation),
		message,
	}, "|")
}

func (s *persistenceNoticeState) allowFailure(kind, operation string, err error, now time.Time) bool {
	if s.FailedKinds == nil {
		s.FailedKinds = make(map[string]bool)
	}
	s.FailedKinds[kind] = true
	key := persistenceFailureKey(kind, operation, err)
	if key == s.LastKey && !s.LastAt.IsZero() && now.Sub(s.LastAt) < runtimePersistenceDedupWindow {
		return false
	}
	s.LastKey = key
	s.LastAt = now
	return true
}

func (s *persistenceNoticeState) markSuccess(kind string) bool {
	if s.FailedKinds == nil || !s.FailedKinds[kind] {
		return false
	}
	delete(s.FailedKinds, kind)
	return true
}

func compactPersistenceText(value string, limit int) string {
	value = normalizePersistencePart(value)
	runes := []rune(value)
	if limit > 0 && len(runes) > limit {
		return string(runes[:limit]) + "…"
	}
	return value
}

func persistenceFailureText(kind, operation string, err error) string {
	kind = normalizePersistencePart(kind)
	if kind == "" {
		kind = "数据"
	}
	operation = normalizePersistencePart(operation)
	if operation == "" {
		operation = "保存"
	}
	detail := "未知错误"
	if err != nil {
		detail = compactPersistenceText(err.Error(), 96)
	}
	return compactPersistenceText(
		fmt.Sprintf("%s%s失败：%s。软件仍可继续运行，请检查磁盘空间、目录权限或安全软件占用。", kind, operation, detail),
		220,
	)
}

func persistenceRecoveryText(kind string) string {
	kind = normalizePersistencePart(kind)
	if kind == "" {
		kind = "数据"
	}
	return compactPersistenceText(kind+"保存已恢复，最新更改已经写入。", 220)
}

func hashPersistenceValue(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func runtimeSettingsFingerprint(settings model.Settings) string {
	return hashPersistenceValue(settings)
}

func runtimeTasksFingerprint(tasks []*model.Task) string {
	stable := make([]*model.Task, 0, len(tasks))
	for _, task := range tasks {
		if task == nil {
			continue
		}
		copy := *task
		// Progress is intentionally volatile and not useful for restart recovery.
		// Ignoring it prevents the guard from rewriting session.json every timer
		// tick while a conversion is running.
		copy.Progress = 0
		stable = append(stable, &copy)
	}
	return hashPersistenceValue(stable)
}

func terminalTaskSignature(task *model.Task) string {
	if task == nil {
		return ""
	}
	switch task.Status {
	case model.StatusDone, model.StatusFailed, model.StatusSkipped, model.StatusCancelled:
	default:
		return ""
	}
	return fmt.Sprintf(
		"%d|%s|%d|%s|%d|%s|%s",
		task.ID,
		task.Status,
		task.FinishedAt.UnixNano(),
		filepath.Clean(task.OutputPath),
		task.OutputSize,
		normalizePersistencePart(task.Engine),
		normalizePersistencePart(task.Error),
	)
}

func historyResultClass(value string) string {
	value = strings.TrimSpace(value)
	switch {
	case strings.Contains(value, "失败"):
		return "failed"
	case strings.Contains(value, "跳过"):
		return "skipped"
	case strings.Contains(value, "停止"):
		return "cancelled"
	case strings.Contains(value, "完成"):
		return "done"
	default:
		return "other"
	}
}

func terminalTaskResult(task *model.Task) string {
	if task == nil {
		return ""
	}
	switch task.Status {
	case model.StatusDone:
		result := "转换完成"
		if engine := normalizePersistencePart(task.Engine); engine != "" {
			result += " · " + engine
		}
		if warning := normalizePersistencePart(task.ValidationWarning); warning != "" {
			result += " · 校验警告: " + warning
		}
		return result
	case model.StatusFailed:
		result := "转换失败"
		if detail := normalizePersistencePart(task.Error); detail != "" {
			result += " · " + compactPersistenceText(detail, 300)
		}
		return result
	case model.StatusSkipped:
		return "已跳过"
	case model.StatusCancelled:
		return "已停止"
	default:
		return ""
	}
}

func terminalTaskHistoryRecord(settings model.Settings, task *model.Task) media.HistoryRecord {
	if task == nil {
		return media.HistoryRecord{}
	}
	options := settings.EffectiveOptions(task)
	resolution, codec := options.Resolution, options.Codec
	if task.Kind == model.KindImage {
		resolution, codec = options.ImageSize, options.ImageFormat
	}
	completedAt := task.FinishedAt
	if completedAt.IsZero() {
		completedAt = time.Now()
	}
	duration := 0.0
	if !task.StartedAt.IsZero() {
		duration = completedAt.Sub(task.StartedAt).Seconds()
		if duration < 0 {
			duration = 0
		}
	}
	return media.HistoryRecord{
		CompletedAt:  completedAt,
		Input:        task.Input,
		Output:       task.OutputPath,
		InputSize:    task.InputSize,
		OutputSize:   task.OutputSize,
		Resolution:   resolution,
		Codec:        codec,
		Quality:      options.Quality,
		Rotation:     options.Rotation,
		Engine:       task.Engine,
		DurationSecs: duration,
		Result:       terminalTaskResult(task),
	}
}

func historyContainsTerminalTask(records []media.HistoryRecord, task *model.Task) bool {
	if task == nil {
		return false
	}
	targetClass := historyResultClass(terminalTaskResult(task))
	for _, record := range records {
		if !strings.EqualFold(filepath.Clean(record.Input), filepath.Clean(task.Input)) {
			continue
		}
		if filepath.Clean(record.Output) != filepath.Clean(task.OutputPath) {
			continue
		}
		if historyResultClass(record.Result) != targetClass {
			continue
		}
		if task.FinishedAt.IsZero() || record.CompletedAt.IsZero() {
			return true
		}
		delta := record.CompletedAt.Sub(task.FinishedAt)
		if delta < 0 {
			delta = -delta
		}
		if delta <= 15*time.Second {
			return true
		}
	}
	return false
}
