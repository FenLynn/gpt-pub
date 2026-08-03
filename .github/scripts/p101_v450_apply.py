from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

ROOT = Path.cwd()
PROJECT = ROOT / "projects/1-桌面软件/101-Mediova"
CODE = PROJECT / "代码"
MAIN = CODE / "cmd/mediaworkbench/main_windows.go"
MODEL = CODE / "internal/model/model.go"
QUEUE = CODE / "internal/workflow/queue.go"
CONTRACT = CODE / "cmd/mediaworkbench/v422_source_contract_test.go"
HASHES = CODE / "SOURCE_FILES_SHA256.txt"
BUILD_422 = CODE / "build_v4.2.2.ps1"
BUILD_450 = CODE / "build_v4.5.0.ps1"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:140]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def refresh_hashes(extra: list[str]) -> None:
    paths: set[str] = set(extra)
    for line in HASHES.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            paths.add(parts[1])
    rows: list[str] = []
    for rel in sorted(paths):
        path = CODE / rel
        if not path.is_file():
            raise SystemExit(f"hash source path missing: {rel}")
        rows.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {rel}")
    HASHES.write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")


replace_once(MAIN, 'const appVersion = "4.4.0"', 'const appVersion = "4.5.0"')
replace_once(CONTRACT, 'const appVersion = "4.4.0"', 'const appVersion = "4.5.0"')
replace_once(
    MAIN,
    '''\t"mediaworkbench/internal/model"\n)''',
    '''\t"mediaworkbench/internal/model"\n\t"mediaworkbench/internal/workflow"\n)''',
)

replace_once(
    MODEL,
    '''\t\tif t.Queue != nil {\n\t\t\treturn t.Queue.Options\n\t\t}''',
    '''\t\tif t.Queue != nil && t.Status != StatusReady {\n\t\t\treturn t.Queue.Options\n\t\t}''',
)

replace_once(
    QUEUE,
    '''\tMaterializeReadyOptions(task, settings)\n\ttask.Options.FollowDefaults = false\n\ttask.Queue = &model.QueueSnapshot{\n\t\tOptions:        task.Options,\n\t\tOutputRoot:     outputRoot,\n\t\tOutputPath:     task.OutputPath,\n\t\tConflictPolicy: settings.ConflictPolicy,''',
    '''\trecoveredQueue := task.Queue\n\tMaterializeReadyOptions(task, settings)\n\ttask.Options.FollowDefaults = false\n\tconflictPolicy := settings.ConflictPolicy\n\toutputPath := task.OutputPath\n\tif recoveredQueue != nil {\n\t\tif recoveredQueue.OutputRoot != "" {\n\t\t\toutputRoot = recoveredQueue.OutputRoot\n\t\t}\n\t\tif recoveredQueue.ConflictPolicy != "" {\n\t\t\tconflictPolicy = recoveredQueue.ConflictPolicy\n\t\t}\n\t\t// A pre-crash output can be partial. Force conflict-safe path resolution\n\t\t// while retaining the frozen root, options and conflict policy.\n\t\toutputPath = ""\n\t}\n\ttask.Queue = &model.QueueSnapshot{\n\t\tOptions:        task.Options,\n\t\tOutputRoot:     outputRoot,\n\t\tOutputPath:     outputPath,\n\t\tConflictPolicy: conflictPolicy,''',
)

write(
    CODE / "internal/workflow/recovery.go",
    '''package workflow

import (
\t"bytes"
\t"encoding/json"
\t"errors"
\t"fmt"
\t"os"
\t"path/filepath"
\t"time"

\t"mediaworkbench/internal/model"
)

const SessionSchema = 2

type SessionEnvelope struct {
\tSchema        int           `json:"schema"`
\tVersion       string        `json:"version"`
\tSavedAt       time.Time     `json:"saved_at"`
\tCleanShutdown bool          `json:"clean_shutdown"`
\tReason        string        `json:"reason"`
\tTasks         []*model.Task `json:"tasks"`
}

type RecoverySummary struct {
\tTotal       int
\tReady       int
\tReset       int
\tMissing     int
\tCompleted   int
\tSkipped     int
\tFailed      int
\tFrozen      int
\tLegacy      bool
\tBackupUsed  bool
}

func cloneQueue(src *model.QueueSnapshot) *model.QueueSnapshot {
\tif src == nil {
\t\treturn nil
\t}
\tcp := *src
\treturn &cp
}

func cloneHold(src *model.HoldState) *model.HoldState {
\tif src == nil {
\t\treturn nil
\t}
\tcp := *src
\tcp.Queue = cloneQueue(src.Queue)
\treturn &cp
}

func CloneTask(src *model.Task) *model.Task {
\tif src == nil {
\t\treturn nil
\t}
\tcp := *src
\tcp.Queue = cloneQueue(src.Queue)
\tcp.Hold = cloneHold(src.Hold)
\tcp.ThumbnailIndex = -1
\treturn &cp
}

func NewSessionEnvelope(tasks []*model.Task, version string, clean bool, reason string, now time.Time) SessionEnvelope {
\titems := make([]*model.Task, 0, len(tasks))
\tfor _, task := range tasks {
\t\tif task != nil {
\t\t\titems = append(items, CloneTask(task))
\t\t}
\t}
\treturn SessionEnvelope{Schema: SessionSchema, Version: version, SavedAt: now, CleanShutdown: clean, Reason: reason, Tasks: items}
}

func DecodeSession(data []byte) (SessionEnvelope, bool, error) {
\ttrimmed := bytes.TrimSpace(data)
\tif len(trimmed) == 0 {
\t\treturn SessionEnvelope{}, false, errors.New("empty session snapshot")
\t}
\tif trimmed[0] == '[' {
\t\tvar tasks []*model.Task
\t\tif err := json.Unmarshal(trimmed, &tasks); err != nil {
\t\t\treturn SessionEnvelope{}, true, err
\t\t}
\t\treturn SessionEnvelope{Schema: 1, Version: "legacy", Tasks: tasks}, true, nil
\t}
\tvar envelope SessionEnvelope
\tif err := json.Unmarshal(trimmed, &envelope); err != nil {
\t\treturn SessionEnvelope{}, false, err
\t}
\tif envelope.Schema <= 0 || envelope.Tasks == nil {
\t\treturn SessionEnvelope{}, false, errors.New("invalid session envelope")
\t}
\tif envelope.Schema > SessionSchema {
\t\treturn SessionEnvelope{}, false, fmt.Errorf("unsupported session schema %d", envelope.Schema)
\t}
\treturn envelope, false, nil
}

func SaveSessionAtomic(path string, envelope SessionEnvelope) error {
\tif path == "" {
\t\treturn errors.New("empty session path")
\t}
\tdata, err := json.MarshalIndent(envelope, "", "  ")
\tif err != nil {
\t\treturn err
\t}
\tdata = append(data, '\n')
\tif err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
\t\treturn err
\t}
\ttmp := path + ".tmp"
\tbak := path + ".bak"
\tfile, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
\tif err != nil {
\t\treturn err
\t}
\tif _, err = file.Write(data); err == nil {
\t\terr = file.Sync()
\t}
\tcloseErr := file.Close()
\tif err == nil {
\t\terr = closeErr
\t}
\tif err != nil {
\t\t_ = os.Remove(tmp)
\t\treturn err
\t}
\t_ = os.Remove(bak)
\tif _, statErr := os.Stat(path); statErr == nil {
\t\tif err := os.Rename(path, bak); err != nil {
\t\t\t_ = os.Remove(tmp)
\t\t\treturn err
\t\t}
\t} else if !os.IsNotExist(statErr) {
\t\t_ = os.Remove(tmp)
\t\treturn statErr
\t}
\tif err := os.Rename(tmp, path); err != nil {
\t\t_ = os.Rename(bak, path)
\t\t_ = os.Remove(tmp)
\t\treturn err
\t}
\treturn nil
}

func resetTransientTask(task *model.Task) {
\tif task.Hold != nil {
\t\tif task.Hold.Queue != nil {
\t\t\ttask.Queue = cloneQueue(task.Hold.Queue)
\t\t}
\t\ttask.Options = task.Hold.Original
\t} else if task.Queue != nil {
\t\ttask.Options = task.Queue.Options
\t}
\tif task.Queue != nil {
\t\ttask.Queue.OutputPath = ""
\t}
\ttask.Status = model.StatusReady
\ttask.Progress = 0
\ttask.OutputPath = ""
\ttask.OutputSize = 0
\ttask.Error = ""
\ttask.FailureCategory = ""
\ttask.ValidationWarning = ""
\ttask.Engine = ""
\ttask.Hold = nil
\ttask.StartedAt = time.Time{}
\ttask.FinishedAt = time.Time{}
}

func RecoverTasks(tasks []*model.Task, exists func(string) bool) RecoverySummary {
\tif exists == nil {
\t\texists = func(path string) bool { _, err := os.Stat(path); return err == nil }
\t}
\tvar summary RecoverySummary
\tfor _, task := range tasks {
\t\tif task == nil {
\t\t\tcontinue
\t\t}
\t\tsummary.Total++
\t\ttask.ThumbnailIndex = -1
\t\tif !exists(task.Input) {
\t\t\ttask.Status = model.StatusFailed
\t\t\ttask.Progress = 0
\t\t\ttask.OutputPath = ""
\t\t\ttask.OutputSize = 0
\t\t\ttask.Engine = ""
\t\t\ttask.Hold = nil
\t\t\ttask.Error = "恢复失败：源文件不存在或已移动: " + task.Input
\t\t\ttask.FailureCategory = "源文件缺失"
\t\t\ttask.ValidationWarning = ""
\t\t\ttask.StartedAt = time.Time{}
\t\t\ttask.FinishedAt = time.Time{}
\t\t\tsummary.Missing++
\t\t\tcontinue
\t\t}
\t\tswitch task.Status {
\t\tcase model.StatusProcessing, model.StatusQueued, model.StatusPaused, model.StatusHeld, model.StatusCancelled:
\t\t\tif task.Queue != nil || (task.Hold != nil && task.Hold.Queue != nil) {
\t\t\t\tsummary.Frozen++
\t\t\t}
\t\t\tresetTransientTask(task)
\t\t\tsummary.Reset++
\t\t\tsummary.Ready++
\t\tcase model.StatusReady:
\t\t\tif task.Queue != nil {
\t\t\t\ttask.Options = task.Queue.Options
\t\t\t\ttask.Queue.OutputPath = ""
\t\t\t\tsummary.Frozen++
\t\t\t}
\t\t\tsummary.Ready++
\t\tcase model.StatusDone:
\t\t\tsummary.Completed++
\t\tcase model.StatusSkipped:
\t\t\tsummary.Skipped++
\t\tcase model.StatusFailed:
\t\t\tsummary.Failed++
\t\tdefault:
\t\t\ttask.Status = model.StatusReady
\t\t\ttask.Progress = 0
\t\t\tsummary.Reset++
\t\t\tsummary.Ready++
\t\t}
\t}
\treturn summary
}

func RecoveryNotice(summary RecoverySummary, envelope SessionEnvelope) string {
\tmode := "正常退出快照"
\tif summary.Legacy {
\t\tmode = "旧版会话"
\t} else if !envelope.CleanShutdown {
\t\tmode = "异常中断快照"
\t}
\tbackup := ""
\tif summary.BackupUsed {
\t\tbackup = "，主快照损坏，已使用备份"
\t}
\treturn fmt.Sprintf("已恢复%s%s：总计 %d，准备 %d，从 0%% 重新处理 %d，源文件缺失 %d，完成结果保留 %d。", mode, backup, summary.Total, summary.Ready, summary.Reset, summary.Missing, summary.Completed+summary.Skipped)
}
''',
)

write(
    CODE / "internal/workflow/recovery_test.go",
    '''package workflow

import (
\t"os"
\t"path/filepath"
\t"testing"
\t"time"

\t"mediaworkbench/internal/model"
)

func TestRecoverTasksResetsTransientStateAndKeepsFrozenSettings(t *testing.T) {
\tqueue := &model.QueueSnapshot{Options: model.TaskOptions{Resolution: "720P", Codec: "H.265"}, OutputRoot: `D:\\Frozen`, OutputPath: `D:\\Frozen\\partial.mp4`, ConflictPolicy: "自动编号", Sequence: 7}
\ttask := &model.Task{ID: 1, Input: "exists.mp4", Kind: model.KindVideo, Status: model.StatusProcessing, Progress: 73, OutputPath: queue.OutputPath, OutputSize: 1234, Engine: "GPU", Queue: queue, StartedAt: time.Now()}
\tsummary := RecoverTasks([]*model.Task{task}, func(string) bool { return true })
\tif summary.Reset != 1 || summary.Frozen != 1 || task.Status != model.StatusReady || task.Progress != 0 {
\t\tt.Fatalf("transient recovery mismatch: summary=%+v task=%+v", summary, task)
\t}
\tif task.Options.Resolution != "720P" || task.Queue == nil || task.Queue.OutputRoot != `D:\\Frozen` || task.Queue.OutputPath != "" || task.Queue.ConflictPolicy != "自动编号" {
\t\tt.Fatalf("frozen snapshot was not preserved safely: %+v", task)
\t}
\tif task.OutputPath != "" || task.OutputSize != 0 || task.Engine != "" || !task.StartedAt.IsZero() {
\t\tt.Fatalf("transient runtime state remained: %+v", task)
\t}
}

func TestRecoverTasksKeepsFinalResultsAndMarksMissingInput(t *testing.T) {
\tdone := &model.Task{Input: "done.mp4", Status: model.StatusDone, OutputPath: "done-out.mp4", Progress: 100}
\tmissing := &model.Task{Input: "missing.mp4", Status: model.StatusQueued, Progress: 40}
\tsummary := RecoverTasks([]*model.Task{done, missing}, func(path string) bool { return path == "done.mp4" })
\tif done.Status != model.StatusDone || done.OutputPath != "done-out.mp4" || summary.Completed != 1 {
\t\tt.Fatalf("completed result changed: %+v summary=%+v", done, summary)
\t}
\tif missing.Status != model.StatusFailed || missing.FailureCategory != "源文件缺失" || summary.Missing != 1 {
\t\tt.Fatalf("missing source not explicit: %+v summary=%+v", missing, summary)
\t}
}

func TestDecodeLegacyAndEnvelope(t *testing.T) {
\tlegacy, isLegacy, err := DecodeSession([]byte(`[ {"id":1,"input":"a.mp4","status":"准备中"} ]`))
\tif err != nil || !isLegacy || len(legacy.Tasks) != 1 {
\t\tt.Fatalf("legacy decode failed: env=%+v legacy=%v err=%v", legacy, isLegacy, err)
\t}
\tenvelope := NewSessionEnvelope(legacy.Tasks, "4.5.0", false, "autosave", time.Now())
\tdata, err := os.ReadFile(writeEnvelopeForTest(t, envelope))
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tdecoded, isLegacy, err := DecodeSession(data)
\tif err != nil || isLegacy || decoded.Schema != SessionSchema || decoded.Version != "4.5.0" {
\t\tt.Fatalf("envelope decode failed: env=%+v legacy=%v err=%v", decoded, isLegacy, err)
\t}
}

func writeEnvelopeForTest(t *testing.T, envelope SessionEnvelope) string {
\tt.Helper()
\tpath := filepath.Join(t.TempDir(), "session.json")
\tif err := SaveSessionAtomic(path, envelope); err != nil {
\t\tt.Fatal(err)
\t}
\treturn path
}

func TestSaveSessionAtomicKeepsBackup(t *testing.T) {
\tpath := filepath.Join(t.TempDir(), "session.json")
\tfirst := NewSessionEnvelope([]*model.Task{{Input: "first.mp4", Status: model.StatusReady}}, "4.5.0", false, "first", time.Now())
\tsecond := NewSessionEnvelope([]*model.Task{{Input: "second.mp4", Status: model.StatusReady}}, "4.5.0", true, "second", time.Now())
\tif err := SaveSessionAtomic(path, first); err != nil {
\t\tt.Fatal(err)
\t}
\tif err := SaveSessionAtomic(path, second); err != nil {
\t\tt.Fatal(err)
\t}
\tbackup, err := os.ReadFile(path + ".bak")
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tdecoded, _, err := DecodeSession(backup)
\tif err != nil || decoded.Reason != "first" {
\t\tt.Fatalf("backup mismatch: env=%+v err=%v", decoded, err)
\t}
}

func TestRecoveryStressThousandsOfTasks(t *testing.T) {
\tconst total = 2500
\ttasks := make([]*model.Task, 0, total)
\tfor i := 0; i < total; i++ {
\t\tstatus := model.StatusQueued
\t\tif i%5 == 0 {
\t\t\tstatus = model.StatusDone
\t\t}
\t\ttasks = append(tasks, &model.Task{ID: int64(i + 1), Input: "exists", Kind: model.KindImage, Status: status, Progress: 63, Queue: &model.QueueSnapshot{Options: model.TaskOptions{ImageSize: "最大边 1000px"}, OutputRoot: "out", ConflictPolicy: "自动编号", Sequence: int64(i + 1)}})
\t}
\tsummary := RecoverTasks(tasks, func(string) bool { return true })
\tif summary.Total != total || summary.Completed != 500 || summary.Reset != 2000 || summary.Frozen != 2000 {
\t\tt.Fatalf("stress recovery counts mismatch: %+v", summary)
\t}
\tfor _, task := range tasks {
\t\tif task.Status != model.StatusDone && (task.Status != model.StatusReady || task.Progress != 0 || task.Queue == nil || task.Queue.OutputPath != "") {
\t\t\tt.Fatalf("stress task not normalized: %+v", task)
\t\t}
\t}
}
''',
)

main_text = MAIN.read_text(encoding="utf-8")
start_anchor = "func (a *application) saveSession() {"
end_anchor = "\nfunc (a *application) addTray()"
if main_text.count(start_anchor) != 1 or main_text.count(end_anchor) != 1:
    raise SystemExit(f"session function anchors start={main_text.count(start_anchor)} end={main_text.count(end_anchor)}")
start = main_text.index(start_anchor)
end = main_text.index(end_anchor, start)
new_session_functions = r'''func (a *application) saveSession() {
\ta.saveSessionEnvelope(false, "autosave")
}

func (a *application) saveSessionClean() {
\ta.saveSessionEnvelope(true, "clean_exit")
}

func (a *application) saveSessionEnvelope(clean bool, reason string) {
\tif !a.settings.RestoreSession {
\t\treturn
\t}
\tpath, err := config.SessionPath()
\tif err != nil {
\t\treturn
\t}
\ta.mu.Lock()
\tenvelope := workflow.NewSessionEnvelope(a.tasks, appVersion, clean, reason, time.Now())
\ta.mu.Unlock()
\tif err := workflow.SaveSessionAtomic(path, envelope); err != nil {
\t\ta.runtimeNotice = "会话快照保存失败：" + short(err.Error(), 160)
\t}
}

func (a *application) loadSession() {
\tif !a.settings.RestoreSession {
\t\treturn
\t}
\tpath, err := config.SessionPath()
\tif err != nil {
\t\treturn
\t}
\tdata, err := os.ReadFile(path)
\tbackupUsed := false
\tif err != nil {
\t\tif os.IsNotExist(err) {
\t\t\treturn
\t\t}
\t\tdata, err = os.ReadFile(path + ".bak")
\t\tbackupUsed = err == nil
\t}
\tif err != nil {
\t\ta.runtimeNotice = "会话快照读取失败：" + short(err.Error(), 160)
\t\treturn
\t}
\tenvelope, legacy, decodeErr := workflow.DecodeSession(data)
\tif decodeErr != nil && !backupUsed {
\t\tif backup, backupErr := os.ReadFile(path + ".bak"); backupErr == nil {
\t\t\tif decoded, oldFormat, err := workflow.DecodeSession(backup); err == nil {
\t\t\t\tenvelope, legacy, decodeErr, backupUsed = decoded, oldFormat, nil, true
\t\t\t}
\t\t}
\t}
\tif decodeErr != nil {
\t\ta.runtimeNotice = "会话快照损坏且无法恢复：" + short(decodeErr.Error(), 160)
\t\treturn
\t}
\tsummary := workflow.RecoverTasks(envelope.Tasks, func(path string) bool {
\t\t_, err := os.Stat(path)
\t\treturn err == nil
\t})
\tsummary.Legacy = legacy
\tsummary.BackupUsed = backupUsed
\tloadedIDs := make([]int64, 0, len(envelope.Tasks))
\ta.mu.Lock()
\tfor _, task := range envelope.Tasks {
\t\tif task == nil {
\t\t\tcontinue
\t\t}
\t\tif task.ID == 0 {
\t\t\ttask.ID = a.nextID.Add(1)
\t\t}
\t\ta.tasks = append(a.tasks, task)
\t\tif task.Status != model.StatusFailed {
\t\t\tloadedIDs = append(loadedIDs, task.ID)
\t\t}
\t}
\ta.mu.Unlock()
\ta.runtimeNotice = workflow.RecoveryNotice(summary, envelope)
\t_, ffprobe, _, _, _ := a.componentSnapshot()
\tif ffprobe != "" {
\t\tfor _, id := range loadedIDs {
\t\t\ta.queueProbe(id)
\t\t}
\t}
}
'''.replace("\\t", "\t")
MAIN.write_text(main_text[:start] + new_session_functions + main_text[end:], encoding="utf-8", newline="\n")

replace_once(
    MAIN,
    '''\t\tapp.stopQueue()\n\t\tapp.readSettingsFromUI()\n\t\t_ = config.Save(app.settings)\n\t\tapp.saveSession()\n\t\tapp.removeTray()''',
    '''\t\tapp.stopQueue()\n\t\tapp.readSettingsFromUI()\n\t\t_ = config.Save(app.settings)\n\t\tapp.saveSessionClean()\n\t\tapp.removeTray()''',
)

write(
    CODE / "cmd/mediaworkbench/v450_source_contract_test.go",
    '''package main

import (
\t"os"
\t"strings"
\t"testing"
)

func TestV450RecoverySourceContracts(t *testing.T) {
\tmain, err := os.ReadFile("main_windows.go")
\tif err != nil {
\t\tt.Fatal(err)
\t}
\ts := string(main)
\tfor _, want := range []string{"workflow.NewSessionEnvelope", "workflow.SaveSessionAtomic", "workflow.DecodeSession", "workflow.RecoverTasks", "saveSessionClean", `path + ".bak"`} {
\t\tif !strings.Contains(s, want) {
\t\t\tt.Fatalf("missing v4.5.0 recovery contract %q", want)
\t\t}
\t}
\tif strings.Contains(s, "cp.Status = model.StatusReady") {
\t\tt.Fatal("legacy save-time status rewriting returned")
\t}
}
''',
)

build_text = BUILD_422.read_text(encoding="utf-8")
if build_text.count('4.2.2') < 2:
    raise SystemExit("v4.2.2 build template identity missing")
BUILD_450.write_text(build_text.replace("4.2.2", "4.5.0"), encoding="utf-8", newline="\n")

write(
    PROJECT / "Mediova_v4.5.0_版本说明.md",
    '''# Mediova v4.5.0 版本说明（候选）

v4.5.0 完成长队列会话恢复与可靠性收口，是本轮连续开发的最终目标版本。

## 会话恢复协议

- 会话文件升级为 schema 2 包络，记录版本、保存时间、保存原因和是否正常退出。
- 兼容 v4.4 及更早的旧任务数组格式。
- 保存采用同目录临时文件、同步落盘、主文件/`.bak` 轮换；主快照损坏时自动尝试备份。
- 运行中、队列中、暂停、搁置和已停止任务恢复为准备中，并明确从文件开头 0% 重新处理。
- 冻结的任务参数、输出母目录和冲突策略保留；可能是半成品的输出路径、进度、引擎、错误和运行时间清除。
- 完成、跳过和失败结果保持原状态，不伪造成功或重新执行。
- 源文件缺失时明确标记失败，不删除或修改任何媒体。
- 启动状态栏显示恢复来源、恢复数量、重新处理数量、缺失数量和保留的完成结果。

## 压力与边界

- 新增 2500 项混合状态恢复压力测试。
- 验证冻结快照、旧格式兼容、备份轮换、缺失源文件和最终结果保持。
- 不实现帧级断点续转；FFmpeg 中断任务始终按文件级边界从 0% 重新开始。

正式候选还需经过长期 CI 更新、实验准入、Windows 稳定候选、正式主线、轻量 Release 和文档收口。
''',
)

replace_once(
    PROJECT / "工作记录.md",
    "### v4.5.0｜长队列恢复与可靠性\n\n- 增强异常退出后的会话恢复和任务历史；\n- 明确文件级恢复边界，不伪装帧级断点续转；\n- 加强数百视频、数千图片、动态追加和混合失败场景压力测试；\n- 优化日志、失败原因和可重试任务筛选。",
    "### v4.5.0｜长队列恢复与可靠性\n\n候选实现已完成：版本化会话包络、主文件/备份轮换、旧格式兼容、冻结快照恢复、文件级 0% 重启、缺失源文件标记和 2500 项压力测试已进入代码；待长期 CI、稳定候选、正式主线和轻量 Release 完成后收口。",
)

subprocess.run(["gofmt", "-w", str(MAIN), str(MODEL), str(QUEUE), str(CONTRACT), str(CODE / "internal/workflow/recovery.go"), str(CODE / "internal/workflow/recovery_test.go"), str(CODE / "cmd/mediaworkbench/v450_source_contract_test.go")], check=True)
refresh_hashes([
    "build_v4.5.0.ps1",
    "internal/workflow/recovery.go",
    "internal/workflow/recovery_test.go",
    "cmd/mediaworkbench/v450_source_contract_test.go",
])
subprocess.run(["sha256sum", "-c", "SOURCE_FILES_SHA256.txt"], cwd=CODE, check=True)
subprocess.run(["go", "test", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "test", "-race", "-count=1", "./..."], cwd=CODE, check=True)
subprocess.run(["go", "vet", "-unsafeptr=false", "./..."], cwd=CODE, check=True)
env = {**os.environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"}
subprocess.run(["go", "test", "-c", "./cmd/mediaworkbench", "-o", "/tmp/Mediova_v450_tests.exe"], cwd=CODE, env=env, check=True)
subprocess.run(["go", "build", "-buildvcs=false", "-trimpath", "-ldflags=-H=windowsgui -s -w", "-o", "/tmp/Mediova_v450.exe", "./cmd/mediaworkbench"], cwd=CODE, env=env, check=True)
print("P101 Mediova v4.5.0 passed portable gates")
