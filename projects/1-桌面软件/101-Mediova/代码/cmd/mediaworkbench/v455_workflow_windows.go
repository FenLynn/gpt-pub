//go:build windows

package main

import (
	"fmt"
	"html"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const (
	ID_V455_OUTPUT_PLAN = 2450 + iota
	ID_V455_IMPORT_INFO
	ID_V455_IMPORT_DUPLICATES
	ID_V455_IMPORT_CONVERTED
	ID_V455_RESULT_DONE
	ID_V455_RESULT_FAILED
	ID_V455_RESULT_SKIPPED
	ID_V455_RESULT_CANCELLED
	ID_V455_RESULT_WARNINGS
	ID_V455_RESULT_LARGER
	ID_V455_RESULT_REPORT
	ID_V455_FILTER_CLEAR
	ID_V455_SKIP_RECOGNIZED
	ID_V455_OPEN_PREVIOUS
	ID_V455_RECONVERT
	ID_V455_FOLDER_CLEAR
	ID_V455_IMPORT_VIDEO
	ID_V455_IMPORT_IMAGE
)

const (
	v455MBYesNoCancel = 3
	v455IDNo          = 7
)

type v455RecognitionStats struct {
	SuspectedDuplicate  int
	PreviouslyConverted int
}

type v455ImportOverview struct {
	Video, Image, Folders, ExactDuplicates   int
	SuspectedDuplicates, PreviouslyConverted int
	Unsupported, Unreadable, ScanErrors      int
}

func (v v455ImportOverview) totalAdded() int { return v.Video + v.Image }

func (v v455ImportOverview) text() string {
	parts := []string{fmt.Sprintf("视频 %d", v.Video), fmt.Sprintf("图片 %d", v.Image), fmt.Sprintf("目录 %d", v.Folders)}
	if v.ExactDuplicates > 0 {
		parts = append(parts, fmt.Sprintf("已存在 %d", v.ExactDuplicates))
	}
	if v.SuspectedDuplicates > 0 {
		parts = append(parts, fmt.Sprintf("疑似重复 %d", v.SuspectedDuplicates))
	}
	if v.PreviouslyConverted > 0 {
		parts = append(parts, fmt.Sprintf("此前已转换 %d", v.PreviouslyConverted))
	}
	if v.Unsupported > 0 {
		parts = append(parts, fmt.Sprintf("不支持 %d", v.Unsupported))
	}
	if v.Unreadable > 0 {
		parts = append(parts, fmt.Sprintf("不可读 %d", v.Unreadable))
	}
	if v.ScanErrors > 0 {
		parts = append(parts, fmt.Sprintf("扫描失败 %d", v.ScanErrors))
	}
	return strings.Join(parts, "，")
}

func (v *v455ImportOverview) add(other v455ImportOverview) {
	v.Video += other.Video
	v.Image += other.Image
	v.Folders += other.Folders
	v.ExactDuplicates += other.ExactDuplicates
	v.SuspectedDuplicates += other.SuspectedDuplicates
	v.PreviouslyConverted += other.PreviouslyConverted
	v.Unsupported += other.Unsupported
	v.Unreadable += other.Unreadable
	v.ScanErrors += other.ScanErrors
}

type v455BatchResult struct{ Done, Failed, Skipped, Cancelled, Warnings, Larger int }

type mapFolderSummary struct {
	Key     string `json:"key"`
	Path    string `json:"path"`
	Label   string `json:"label"`
	Total   int    `json:"total"`
	Video   int    `json:"video"`
	Image   int    `json:"image"`
	Located int    `json:"located"`
}

func v455CleanPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	return strings.ToLower(filepath.Clean(path))
}

func v455FileSignature(path string) string {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return ""
	}
	return strconv.FormatInt(info.Size(), 10) + ":" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
}

func v455HistoryIndex() map[string]media.HistoryRecord {
	result := make(map[string]media.HistoryRecord)
	for _, record := range media.LoadHistory() {
		if record.Status != model.StatusDone || strings.TrimSpace(record.Input) == "" {
			continue
		}
		key := v455CleanPath(record.Input)
		if old, ok := result[key]; !ok || record.CompletedAt.After(old.CompletedAt) {
			result[key] = record
		}
	}
	return result
}

func v455HistoryMatches(record media.HistoryRecord, path string, size int64) bool {
	if v455CleanPath(record.Input) != v455CleanPath(path) {
		return false
	}
	return record.InputSize <= 0 || size <= 0 || record.InputSize == size
}

func v455FolderSet(paths []string) int {
	folders := make(map[string]bool)
	for _, path := range paths {
		if _, ok := media.DetectKind(path); ok {
			folders[v455CleanPath(filepath.Dir(path))] = true
		}
	}
	delete(folders, "")
	return len(folders)
}

func (a *application) v455RememberImport(overview v455ImportOverview, recognition v455RecognitionStats) {
	if a == nil || a.selfTest {
		return
	}
	overview.SuspectedDuplicates += recognition.SuspectedDuplicate
	overview.PreviouslyConverted += recognition.PreviouslyConverted
	a.mu.Lock()
	a.lastImportOverview = overview
	a.lastRecognition = recognition
	a.statusCenterKind = "import"
	a.mu.Unlock()
}

func (a *application) v455LastRecognition() v455RecognitionStats {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.lastRecognition
}

func (a *application) v455SetBatchResult(tasks []model.Task) {
	result := v455BatchResult{}
	ids := make(map[int64]bool, len(tasks))
	for i := range tasks {
		t := &tasks[i]
		ids[t.ID] = true
		switch t.Status {
		case model.StatusDone:
			result.Done++
		case model.StatusFailed:
			result.Failed++
		case model.StatusSkipped:
			result.Skipped++
		case model.StatusCancelled:
			result.Cancelled++
		}
		if t.ValidationWarning != "" {
			result.Warnings++
		}
		if t.InputSize > 0 && t.OutputSize >= int64(float64(t.InputSize)*1.1) {
			result.Larger++
		}
	}
	a.mu.Lock()
	a.lastBatchResult = result
	a.lastBatchTaskIDs = ids
	a.statusCenterKind = "result"
	a.mu.Unlock()
}

func (a *application) v455TaskMatchesSpecial(t *model.Task) bool {
	a.mu.Lock()
	filter := a.specialTaskFilter
	a.mu.Unlock()
	return v455TaskMatchesSpecialFilter(t, filter)
}

func v455TaskMatchesSpecialFilter(t *model.Task, filter string) bool {
	switch filter {
	case "duplicate":
		return strings.TrimSpace(t.DuplicateOf) != ""
	case "converted":
		return t.PreviouslyConverted
	case "warning":
		return strings.TrimSpace(t.ValidationWarning) != ""
	default:
		return true
	}
}

func v455SelectComboBase(hwnd uintptr, wanted string) {
	count := int(send(hwnd, CB_GETCOUNT, 0, 0))
	for i := 0; i < count; i++ {
		buf := make([]uint16, 260)
		send(hwnd, CB_GETLBTEXT, uintptr(i), uintptr(unsafe.Pointer(&buf[0])))
		if statusFilterBase(syscall.UTF16ToString(buf)) == wanted {
			send(hwnd, CB_SETCURSEL, uintptr(i), 0)
			return
		}
	}
}

func (a *application) v455ClearTaskFilter() {
	a.mu.Lock()
	a.specialTaskFilter = ""
	a.specialTaskIDs = nil
	a.mu.Unlock()
	v455SelectComboBase(a.hFilter, statusFilterAll)
	v455SelectComboBase(a.hVolumeFilter, volumeFilterAll)
	a.refreshList()
	a.invalidateMapView()
}

func (a *application) v455SetStatusFilter(status, special, volume string) {
	a.mu.Lock()
	a.specialTaskFilter = special
	a.specialTaskIDs = nil
	a.mu.Unlock()
	v455SelectComboBase(a.hFilter, statusFilterAll)
	v455SelectComboBase(a.hVolumeFilter, volumeFilterAll)
	if status != "" {
		v455SelectComboBase(a.hFilter, status)
	}
	if volume != "" {
		v455SelectComboBase(a.hVolumeFilter, volume)
	}
	a.refreshList()
	a.invalidateMapView()
}

func (a *application) v455SetBatchFilter(status, special, volume string) {
	a.mu.Lock()
	ids := copyTaskIDSet(a.lastBatchTaskIDs)
	a.mu.Unlock()
	a.v455SetStatusFilter(status, special, volume)
	a.mu.Lock()
	a.specialTaskIDs = ids
	a.mu.Unlock()
	a.refreshList()
	a.invalidateMapView()
}

func (a *application) v455ShowStatusCenter() bool {
	if a == nil {
		return false
	}
	a.mu.Lock()
	kind, imp, result := a.statusCenterKind, a.lastImportOverview, a.lastBatchResult
	a.mu.Unlock()
	if kind == "" {
		return false
	}
	currentText := strings.TrimSpace(getText(a.hStatusText))
	if kind == "import" && !strings.HasPrefix(currentText, "导入完成：") && !strings.HasPrefix(currentText, "已自动分流：") && !strings.HasPrefix(currentText, "未加入新文件") {
		return false
	}
	if kind == "result" && !strings.HasPrefix(currentText, "队列处理结束。") {
		return false
	}
	m, _, _ := procCreatePopupMenu.Call()
	if m == 0 {
		return false
	}
	defer procDestroyMenu.Call(m)
	if kind == "import" {
		appendMenu(m, MF_STRING, ID_V455_IMPORT_INFO, "本次导入概览 · "+imp.text())
		appendMenu(m, MF_SEPARATOR, 0, "")
		appendMenu(m, MF_STRING, ID_V455_IMPORT_VIDEO, fmt.Sprintf("切换到本次视频工作区（新增 %d）", imp.Video))
		appendMenu(m, MF_STRING, ID_V455_IMPORT_IMAGE, fmt.Sprintf("切换到本次图片工作区（新增 %d）", imp.Image))
		appendMenu(m, MF_STRING, ID_V455_IMPORT_DUPLICATES, fmt.Sprintf("筛选疑似重复（%d）", imp.SuspectedDuplicates))
		appendMenu(m, MF_STRING, ID_V455_IMPORT_CONVERTED, fmt.Sprintf("筛选此前已转换（%d）", imp.PreviouslyConverted))
	} else {
		appendMenu(m, MF_STRING, ID_V455_RESULT_DONE, fmt.Sprintf("完成（%d）", result.Done))
		appendMenu(m, MF_STRING, ID_V455_RESULT_FAILED, fmt.Sprintf("失败（%d）", result.Failed))
		appendMenu(m, MF_STRING, ID_V455_RESULT_SKIPPED, fmt.Sprintf("跳过（%d）", result.Skipped))
		appendMenu(m, MF_STRING, ID_V455_RESULT_CANCELLED, fmt.Sprintf("停止（%d）", result.Cancelled))
		appendMenu(m, MF_STRING, ID_V455_RESULT_WARNINGS, fmt.Sprintf("校验警告（%d）", result.Warnings))
		appendMenu(m, MF_STRING, ID_V455_RESULT_LARGER, fmt.Sprintf("体积增加 >=1.1 倍（%d）", result.Larger))
		appendMenu(m, MF_SEPARATOR, 0, "")
		appendMenu(m, MF_STRING, ID_V455_RESULT_REPORT, "查看上次批次完整报告")
	}
	appendMenu(m, MF_SEPARATOR, 0, "")
	appendMenu(m, MF_STRING, ID_V455_FILTER_CLEAR, "清除结果筛选")
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(a.hwnd)
	cmd, _, _ := procTrackPopupMenu.Call(m, TPM_RIGHTBUTTON|TPM_RETURNCMD|TPM_NONOTIFY, uintptr(pt.X), uintptr(pt.Y), 0, a.hwnd, 0)
	procPostMessageW.Call(a.hwnd, WM_NULL, 0, 0)
	if cmd != 0 {
		a.command(int(cmd))
	}
	return true
}

func (a *application) v455HandleCommand(id int) bool {
	switch id {
	case ID_V455_OUTPUT_PLAN:
		path, _, err := a.v455WriteOutputPlan(nil)
		if err != nil {
			messageBox(a.hwnd, "输出计划", err.Error(), MB_OK|MB_ICONERROR)
		} else {
			shellOpen(path)
		}
		return true
	case ID_V455_IMPORT_INFO:
		a.mu.Lock()
		overview := a.lastImportOverview
		a.mu.Unlock()
		messageBox(a.hwnd, "本次导入概览", overview.text()+"\r\n\r\n带 GPS 的数量会在后台媒体信息读取完成后，实时反映到地图目录统计中。", MB_OK|MB_ICONINFORMATION)
		return true
	case ID_V455_IMPORT_DUPLICATES:
		a.v455SetStatusFilter("", "duplicate", "")
		return true
	case ID_V455_IMPORT_CONVERTED:
		a.v455SetStatusFilter("", "converted", "")
		return true
	case ID_V455_RESULT_DONE:
		a.v455SetBatchFilter(string(model.StatusDone), "", "")
		return true
	case ID_V455_RESULT_FAILED:
		a.v455SetBatchFilter(string(model.StatusFailed), "", "")
		return true
	case ID_V455_RESULT_SKIPPED:
		a.v455SetBatchFilter(string(model.StatusSkipped), "", "")
		return true
	case ID_V455_RESULT_CANCELLED:
		a.v455SetBatchFilter(string(model.StatusCancelled), "", "")
		return true
	case ID_V455_RESULT_WARNINGS:
		a.v455SetBatchFilter("", "warning", "")
		return true
	case ID_V455_RESULT_LARGER:
		a.v455SetBatchFilter("", "", volumeFilterLarger)
		return true
	case ID_V455_RESULT_REPORT:
		if a.lastSummaryPath != "" {
			shellOpen(a.lastSummaryPath)
		} else {
			messageBox(a.hwnd, "批次结果", "尚未生成批次报告。", MB_OK|MB_ICONINFORMATION)
		}
		return true
	case ID_V455_FILTER_CLEAR:
		a.v455ClearTaskFilter()
		return true
	case ID_V455_SKIP_RECOGNIZED:
		a.v455SkipRecognized()
		return true
	case ID_V455_OPEN_PREVIOUS:
		a.v455OpenPreviousOutput()
		return true
	case ID_V455_RECONVERT:
		a.v455ReconvertRecognized()
		return true
	case ID_V455_FOLDER_CLEAR:
		a.v455SetFolderFilter("", false)
		if runtime := mapRuntimeFor(a); runtime != nil {
			runtime.pushPoints(true)
		}
		return true
	case ID_V455_IMPORT_VIDEO:
		a.v455ClearTaskFilter()
		a.switchKind(model.KindVideo)
		return true
	case ID_V455_IMPORT_IMAGE:
		a.v455ClearTaskFilter()
		a.switchKind(model.KindImage)
		return true
	}
	return false
}

func (a *application) v455SkipRecognized() {
	idxs := a.selectedTaskIndices()
	changed := 0
	a.mu.Lock()
	for _, idx := range idxs {
		if idx < 0 || idx >= len(a.tasks) {
			continue
		}
		t := a.tasks[idx]
		if t != nil && t.Status == model.StatusReady && t.PreviouslyConverted && media.FileSize(t.PreviousOutput) > 0 {
			t.Status = model.StatusSkipped
			t.Progress = 100
			t.OutputPath = t.PreviousOutput
			t.Engine = "导入识别 · 使用历史输出"
			changed++
		}
	}
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
	setText(a.hStatusText, fmt.Sprintf("已跳过 %d 个存在历史输出的任务；源文件和历史输出均未改动。", changed))
}

func (a *application) v455OpenPreviousOutput() {
	idxs := a.selectedTaskIndices()
	path := ""
	a.mu.Lock()
	for _, idx := range idxs {
		if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil && media.FileSize(a.tasks[idx].PreviousOutput) > 0 {
			path = a.tasks[idx].PreviousOutput
			break
		}
	}
	a.mu.Unlock()
	if path == "" {
		messageBox(a.hwnd, "历史输出", "选中任务没有仍然存在的历史输出文件。", MB_OK|MB_ICONINFORMATION)
	} else {
		shellOpen(path)
	}
}

func (a *application) v455ReconvertRecognized() {
	idxs := a.selectedTaskIndices()
	changed := 0
	a.mu.Lock()
	for _, idx := range idxs {
		if idx < 0 || idx >= len(a.tasks) {
			continue
		}
		t := a.tasks[idx]
		if t != nil && !t.IsLocked() && (t.PreviouslyConverted || t.DuplicateOf != "") {
			t.PreviouslyConverted = false
			t.PreviousOutput = ""
			t.DuplicateOf = ""
			if t.Status == model.StatusSkipped {
				t.Status = model.StatusReady
				t.Progress = 0
				t.OutputPath = ""
			}
			changed++
		}
	}
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
	setText(a.hStatusText, fmt.Sprintf("已将 %d 个识别提示清除，任务将按当前参数正常转换。", changed))
}

func (a *application) v455TaskRecognitionDetails(task *model.Task) string {
	if task == nil {
		return ""
	}
	parts := []string{}
	if task.DuplicateOf != "" {
		parts = append(parts, "疑似重复："+task.DuplicateOf)
	}
	if task.PreviouslyConverted {
		text := "此前已转换"
		if task.PreviousOutput != "" {
			text += "：" + task.PreviousOutput
			if media.FileSize(task.PreviousOutput) <= 0 {
				text += "（输出已不存在）"
			}
		}
		parts = append(parts, text)
	}
	if len(parts) == 0 {
		return ""
	}
	return "\r\n\r\n导入识别：\r\n" + strings.Join(parts, "\r\n") + "\r\n可在右键“导入识别”中选择跳过、打开历史输出或仍然重新转换。"
}

func (a *application) currentMapFolders() []mapFolderSummary {
	if a == nil {
		return nil
	}
	groups := make(map[string]*mapFolderSummary)
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, task := range a.tasks {
		if task == nil {
			continue
		}
		key, label := mapFolderIdentity(task.Input)
		if key == "" {
			continue
		}
		item := groups[key]
		if item == nil {
			item = &mapFolderSummary{Key: key, Path: filepath.Dir(task.Input), Label: label}
			groups[key] = item
		}
		item.Total++
		if task.Kind == model.KindVideo {
			item.Video++
		} else {
			item.Image++
		}
		if task.Location.Valid() {
			item.Located++
		}
	}
	result := make([]mapFolderSummary, 0, len(groups))
	for _, item := range groups {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool { return strings.ToLower(result[i].Path) < strings.ToLower(result[j].Path) })
	return result
}

func v455PathInFolder(input, folder string, includeChildren bool) bool {
	dir, base := v455CleanPath(filepath.Dir(input)), v455CleanPath(folder)
	if base == "" {
		return true
	}
	if dir == base {
		return true
	}
	prefix := base
	separator := strings.ToLower(string(filepath.Separator))
	if !strings.HasSuffix(prefix, separator) {
		prefix += separator
	}
	return includeChildren && strings.HasPrefix(dir, prefix)
}

func (a *application) v455TaskMatchesFolder(t *model.Task) bool {
	a.mu.Lock()
	folder, include := a.folderFilterPath, a.folderIncludeSubdirs
	a.mu.Unlock()
	return t != nil && v455PathInFolder(t.Input, folder, include)
}

func (a *application) v455SetFolderFilter(key string, include bool) {
	path := ""
	for _, folder := range a.currentMapFolders() {
		if folder.Key == key {
			path = folder.Path
			break
		}
	}
	a.mu.Lock()
	a.folderFilterKey = key
	a.folderFilterPath = path
	a.folderIncludeSubdirs = include
	a.mu.Unlock()
	a.refreshList()
	a.updateRightPanel()
	if path == "" {
		setText(a.hStatusText, "已显示全部目录。")
	} else {
		word := "否"
		if include {
			word = "是"
		}
		setText(a.hStatusText, fmt.Sprintf("目录筛选：%s（含子目录：%s）；列表与地图已联动。", path, word))
	}
}

func (a *application) v455FolderAction(action string) {
	a.mu.Lock()
	folder, include := a.folderFilterPath, a.folderIncludeSubdirs
	a.mu.Unlock()
	if folder == "" {
		setText(a.hStatusText, "请先在地图顶部选择一个目录。")
		return
	}
	switch action {
	case "select":
		a.selectAll(true)
	case "source":
		shellOpen(folder)
	case "output":
		if dir := a.settings.OutputDirFor(a.currentKind); dir != "" {
			shellOpen(dir)
		}
	case "convert":
		original := a.currentKind
		for _, kind := range []model.Kind{model.KindVideo, model.KindImage} {
			ids := map[int64]bool{}
			a.mu.Lock()
			for _, t := range a.tasks {
				if t != nil && t.Kind == kind && t.Status == model.StatusReady && v455PathInFolder(t.Input, folder, include) {
					ids[t.ID] = true
				}
			}
			a.mu.Unlock()
			if len(ids) > 0 {
				a.switchKind(kind)
				a.startQueueFiltered(ids)
			}
		}
		if a.currentKind != original {
			a.switchKind(original)
		}
	}
}

type v455OutputPlanItem struct {
	Input, Output, Action, Settings, Note string
	Estimate                              int64
}

func (a *application) v455WriteOutputPlan(only map[int64]bool) (string, int, error) {
	type snapshot struct {
		task model.Task
		opts model.TaskOptions
	}
	items := []snapshot{}
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Kind == a.currentKind && task.Status == model.StatusReady && (only == nil || only[task.ID]) {
			items = append(items, snapshot{task: *task, opts: a.settings.EffectiveOptions(task)})
		}
	}
	a.mu.Unlock()
	if len(items) == 0 {
		return "", 0, fmt.Errorf("当前工作区没有准备中的任务")
	}
	outputRoot := a.v420OutputDir(a.currentKind)
	plans := make([]v455OutputPlanItem, 0, len(items))
	total := int64(0)
	for _, item := range items {
		out, skip, err := media.PlanOutputPath(item.task.Input, item.task.Root, outputRoot, item.task.Kind, item.opts, a.settings)
		action, note := "新建", "保留目录结构"
		probeSettings := a.settings
		probeSettings.ConflictPolicy = "覆盖已有"
		baseTarget, _, baseErr := media.PlanOutputPath(item.task.Input, item.task.Root, outputRoot, item.task.Kind, item.opts, probeSettings)
		baseExists := baseErr == nil && media.FileSize(baseTarget) > 0
		if skip {
			action = "跳过已有"
		}
		if err != nil {
			action, note = "错误", err.Error()
		}
		if !skip && baseExists {
			if a.settings.ConflictPolicy == "覆盖已有" {
				action = "校验后替换"
			} else {
				action = "自动编号"
			}
		}
		estimate := media.EstimateOutputBytes(&item.task, item.opts)
		total += estimate
		settingValues := taskOptionStrings(item.opts, item.task.Kind)
		plans = append(plans, v455OutputPlanItem{Input: item.task.Input, Output: out, Action: action, Settings: strings.Join(settingValues[:], " · "), Note: note, Estimate: estimate})
	}
	dir, err := config.Dir()
	if err != nil {
		return "", 0, err
	}
	path := filepath.Join(dir, "output-plan.html")
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mediova 输出计划</title><style>:root{font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:#243b53;background:#f6f8fb}*{box-sizing:border-box}body{margin:18px}h1{font-size:21px;margin:0}.sub{font-size:12px;color:#718096;margin:7px 0 14px}.tools{display:flex;gap:8px;margin-bottom:10px}.tools input{height:34px;width:min(620px,75vw);border:1px solid #cbd8e6;border-radius:6px;padding:0 10px}.wrap{overflow:auto;max-height:calc(100vh - 145px);background:#fff;border:1px solid #d9e2ec;border-radius:8px}table{border-collapse:collapse;min-width:1500px;width:100%;font-size:12px}th,td{border-bottom:1px solid #edf1f5;padding:8px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#f3f7fb;color:#486581}.path{min-width:330px;max-width:520px;word-break:break-all}.action{font-weight:600;color:#176ac1}details summary{cursor:pointer;color:#176ac1}</style></head><body>`)
	fmt.Fprintf(&b, `<h1>本次输出计划（%d）</h1><div class="sub">输出母目录：%s · 预计输出约 %s · 冲突策略：%s。此文件每次生成都会覆盖，不形成报告垃圾。</div><div class="tools"><input id="q" type="search" placeholder="搜索文件、目录、动作或参数"><span id="count"></span></div><div class="wrap"><table><thead><tr><th>#</th><th>输入</th><th>计划输出</th><th>动作</th><th>预计</th><th>参数 / 说明</th></tr></thead><tbody>`, len(plans), html.EscapeString(outputRoot), html.EscapeString(media.FormatBytes(total)), html.EscapeString(a.settings.ConflictPolicy))
	for i, plan := range plans {
		fmt.Fprintf(&b, `<tr><td>%d</td><td class="path">%s</td><td class="path">%s</td><td class="action">%s</td><td>%s</td><td><details><summary>%s</summary>%s</details></td></tr>`, i+1, html.EscapeString(plan.Input), html.EscapeString(plan.Output), html.EscapeString(plan.Action), html.EscapeString(media.FormatBytes(plan.Estimate)), html.EscapeString(plan.Settings), html.EscapeString(plan.Note))
	}
	b.WriteString(`</tbody></table></div><script>const q=document.getElementById('q'),c=document.getElementById('count');function f(){let n=0;document.querySelectorAll('tbody tr').forEach(r=>{const ok=!q.value||r.textContent.toLowerCase().includes(q.value.toLowerCase());r.hidden=!ok;if(ok)n++});c.textContent='显示 '+n+' 条'}q.oninput=f;f()</script></body></html>`)
	if err = os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		return "", 0, err
	}
	a.lastOutputPlanPath = path
	return path, len(plans), nil
}

func (a *application) v455ConfirmPlan(only map[int64]bool, summary string) bool {
	path, _, err := a.v455WriteOutputPlan(only)
	if err != nil {
		return true
	}
	answer := messageBox(a.hwnd, "批量处理预览", summary+"\r\n\r\n是：开始转换\r\n否：查看逐项输出计划（暂不开始）\r\n取消：返回", v455MBYesNoCancel|MB_ICONQUESTION)
	if answer == v455IDNo {
		shellOpen(path)
	}
	return answer == IDYES
}
