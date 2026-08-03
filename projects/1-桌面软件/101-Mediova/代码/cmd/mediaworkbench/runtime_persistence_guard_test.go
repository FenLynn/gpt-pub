package main

import (
	"errors"
	"strings"
	"testing"
	"time"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

func TestPersistenceFailureNoticeDedupAndRecovery(t *testing.T) {
	var state persistenceNoticeState
	now := time.Date(2026, 8, 3, 16, 0, 0, 0, time.Local)
	err := errors.New("access denied")
	if !state.allowFailure("配置", "保存", err, now) {
		t.Fatal("first failure was suppressed")
	}
	if state.allowFailure("配置", "保存", err, now.Add(5*time.Second)) {
		t.Fatal("duplicate failure was not suppressed")
	}
	if !state.allowFailure("历史记录", "保存", err, now.Add(6*time.Second)) {
		t.Fatal("different persistence kind was suppressed")
	}
	if !state.allowFailure("配置", "保存", err, now.Add(runtimePersistenceDedupWindow)) {
		t.Fatal("failure after dedup window was suppressed")
	}
	if !state.markSuccess("配置") || state.markSuccess("配置") {
		t.Fatal("recovery state was not consumed exactly once")
	}
}

func TestPersistenceFailureTextIsActionableAndBounded(t *testing.T) {
	text := persistenceFailureText("任务会话", "保存", errors.New(strings.Repeat("磁盘已满 ", 80)))
	if !strings.Contains(text, "任务会话保存失败") ||
		!strings.Contains(text, "磁盘空间") ||
		!strings.Contains(text, "目录权限") ||
		!strings.Contains(text, "安全软件") {
		t.Fatalf("unexpected failure text: %q", text)
	}
	if len([]rune(text)) > 221 {
		t.Fatalf("failure text too long: %d", len([]rune(text)))
	}
	if got := persistenceRecoveryText("历史记录"); got != "历史记录保存已恢复，最新更改已经写入。" {
		t.Fatalf("unexpected recovery text: %q", got)
	}
}

func TestRuntimePersistenceFingerprintsChangeOnlyWithContent(t *testing.T) {
	settings := model.DefaultSettings()
	a := runtimeSettingsFingerprint(settings)
	b := runtimeSettingsFingerprint(settings)
	if a == "" || a != b {
		t.Fatalf("settings fingerprint unstable: %q %q", a, b)
	}
	settings.Codec = "H.264"
	if c := runtimeSettingsFingerprint(settings); c == a {
		t.Fatal("settings change did not change fingerprint")
	}

	task := &model.Task{ID: 1, Input: "a.mp4", Status: model.StatusReady}
	tasks := []*model.Task{task}
	first := runtimeTasksFingerprint(tasks)
	second := runtimeTasksFingerprint(tasks)
	if first == "" || first != second {
		t.Fatalf("task fingerprint unstable: %q %q", first, second)
	}
	task.Status = model.StatusDone
	task.FinishedAt = time.Now()
	if changed := runtimeTasksFingerprint(tasks); changed == first {
		t.Fatal("task change did not change fingerprint")
	}
}

func TestTerminalHistoryRecordAndMatching(t *testing.T) {
	now := time.Date(2026, 8, 3, 16, 20, 0, 0, time.Local)
	settings := model.DefaultSettings()
	task := &model.Task{
		ID:         9,
		Input:      `D:\输入\示例.mp4`,
		OutputPath: `D:\输出\示例.mp4`,
		Kind:       model.KindVideo,
		Status:     model.StatusDone,
		InputSize:  2000,
		OutputSize: 1000,
		Engine:     "CPU · H.265",
		StartedAt:  now.Add(-10 * time.Second),
		FinishedAt: now,
		Options: model.TaskOptions{
			FollowDefaults: false,
			Resolution:     "1080P",
			Codec:          "H.265",
			Quality:        "高",
			Rotation:       "自动",
		},
	}
	signature := terminalTaskSignature(task)
	if signature == "" || !strings.Contains(signature, "CPU · H.265") {
		t.Fatalf("missing terminal signature: %q", signature)
	}
	record := terminalTaskHistoryRecord(settings, task)
	if record.CompletedAt != now || record.DurationSecs != 10 ||
		record.Result != "转换完成 · CPU · H.265" {
		t.Fatalf("unexpected history record: %+v", record)
	}
	if !historyContainsTerminalTask([]media.HistoryRecord{record}, task) {
		t.Fatal("matching history record was not found")
	}
	record.CompletedAt = now.Add(-20 * time.Second)
	if historyContainsTerminalTask([]media.HistoryRecord{record}, task) {
		t.Fatal("stale history record incorrectly matched")
	}
	task.Status = model.StatusFailed
	task.Error = "encoder failed"
	task.OutputPath = ""
	failed := terminalTaskHistoryRecord(settings, task)
	if historyResultClass(failed.Result) != "failed" || !strings.Contains(failed.Result, "encoder failed") {
		t.Fatalf("unexpected failed history record: %+v", failed)
	}
}
