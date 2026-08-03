package workflow

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"mediaworkbench/internal/model"
)

func TestRecoverTasksResetsTransientStateAndKeepsFrozenSettings(t *testing.T) {
	queue := &model.QueueSnapshot{Options: model.TaskOptions{Resolution: "720P", Codec: "H.265"}, OutputRoot: `D:\Frozen`, OutputPath: `D:\Frozen\partial.mp4`, ConflictPolicy: "自动编号", Sequence: 7}
	task := &model.Task{ID: 1, Input: "exists.mp4", Kind: model.KindVideo, Status: model.StatusProcessing, Progress: 73, OutputPath: queue.OutputPath, OutputSize: 1234, Engine: "GPU", Queue: queue, StartedAt: time.Now()}
	summary := RecoverTasks([]*model.Task{task}, func(string) bool { return true })
	if summary.Reset != 1 || summary.Frozen != 1 || task.Status != model.StatusReady || task.Progress != 0 {
		t.Fatalf("transient recovery mismatch: summary=%+v task=%+v", summary, task)
	}
	if task.Options.Resolution != "720P" || task.Queue == nil || task.Queue.OutputRoot != `D:\Frozen` || task.Queue.OutputPath != "" || task.Queue.ConflictPolicy != "自动编号" {
		t.Fatalf("frozen snapshot was not preserved safely: %+v", task)
	}
	if task.OutputPath != "" || task.OutputSize != 0 || task.Engine != "" || !task.StartedAt.IsZero() {
		t.Fatalf("transient runtime state remained: %+v", task)
	}
}

func TestRecoverTasksKeepsFinalResultsAndMarksMissingInput(t *testing.T) {
	done := &model.Task{Input: "done.mp4", Status: model.StatusDone, OutputPath: "done-out.mp4", Progress: 100}
	missing := &model.Task{Input: "missing.mp4", Status: model.StatusQueued, Progress: 40}
	summary := RecoverTasks([]*model.Task{done, missing}, func(path string) bool { return path == "done.mp4" })
	if done.Status != model.StatusDone || done.OutputPath != "done-out.mp4" || summary.Completed != 1 {
		t.Fatalf("completed result changed: %+v summary=%+v", done, summary)
	}
	if missing.Status != model.StatusFailed || missing.FailureCategory != "源文件缺失" || summary.Missing != 1 {
		t.Fatalf("missing source not explicit: %+v summary=%+v", missing, summary)
	}
}

func TestDecodeLegacyAndEnvelope(t *testing.T) {
	legacy, isLegacy, err := DecodeSession([]byte(`[ {"id":1,"input":"a.mp4","status":"准备中"} ]`))
	if err != nil || !isLegacy || len(legacy.Tasks) != 1 {
		t.Fatalf("legacy decode failed: env=%+v legacy=%v err=%v", legacy, isLegacy, err)
	}
	envelope := NewSessionEnvelope(legacy.Tasks, "4.5.0", false, "autosave", time.Now())
	data, err := os.ReadFile(writeEnvelopeForTest(t, envelope))
	if err != nil {
		t.Fatal(err)
	}
	decoded, isLegacy, err := DecodeSession(data)
	if err != nil || isLegacy || decoded.Schema != SessionSchema || decoded.Version != "4.5.0" {
		t.Fatalf("envelope decode failed: env=%+v legacy=%v err=%v", decoded, isLegacy, err)
	}
}

func writeEnvelopeForTest(t *testing.T, envelope SessionEnvelope) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "session.json")
	if err := SaveSessionAtomic(path, envelope); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSaveSessionAtomicKeepsBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	first := NewSessionEnvelope([]*model.Task{{Input: "first.mp4", Status: model.StatusReady}}, "4.5.0", false, "first", time.Now())
	second := NewSessionEnvelope([]*model.Task{{Input: "second.mp4", Status: model.StatusReady}}, "4.5.0", true, "second", time.Now())
	if err := SaveSessionAtomic(path, first); err != nil {
		t.Fatal(err)
	}
	if err := SaveSessionAtomic(path, second); err != nil {
		t.Fatal(err)
	}
	backup, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatal(err)
	}
	decoded, _, err := DecodeSession(backup)
	if err != nil || decoded.Reason != "first" {
		t.Fatalf("backup mismatch: env=%+v err=%v", decoded, err)
	}
}

func TestRecoveryStressThousandsOfTasks(t *testing.T) {
	const total = 2500
	tasks := make([]*model.Task, 0, total)
	for i := 0; i < total; i++ {
		status := model.StatusQueued
		if i%5 == 0 {
			status = model.StatusDone
		}
		tasks = append(tasks, &model.Task{ID: int64(i + 1), Input: "exists", Kind: model.KindImage, Status: status, Progress: 63, Queue: &model.QueueSnapshot{Options: model.TaskOptions{ImageSize: "最大边 1000px"}, OutputRoot: "out", ConflictPolicy: "自动编号", Sequence: int64(i + 1)}})
	}
	summary := RecoverTasks(tasks, func(string) bool { return true })
	if summary.Total != total || summary.Completed != 500 || summary.Reset != 2000 || summary.Frozen != 2000 {
		t.Fatalf("stress recovery counts mismatch: %+v", summary)
	}
	for _, task := range tasks {
		if task.Status != model.StatusDone && (task.Status != model.StatusReady || task.Progress != 0 || task.Queue == nil || task.Queue.OutputPath != "") {
			t.Fatalf("stress task not normalized: %+v", task)
		}
	}
}
