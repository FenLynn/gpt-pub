//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
	"mediaworkbench/internal/workflow"
)

func parseV420UIPreviewArgs(args []string) (bool, string) {
	mode := "video"
	for _, raw := range args {
		arg := strings.TrimSpace(raw)
		switch {
		case arg == "--ui-preview":
			return true, mode
		case strings.HasPrefix(arg, "--ui-preview="):
			value := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(arg, "--ui-preview=")))
			switch value {
			case "image", "held", "video":
				mode = value
			default:
				mode = "video"
			}
			return true, mode
		}
	}
	return false, mode
}

func previewQueue(options model.TaskOptions, root, path string, sequence int64) *model.QueueSnapshot {
	return &model.QueueSnapshot{Options: options, OutputRoot: root, OutputPath: path, ConflictPolicy: "自动编号", QueuedAt: time.Now().Add(-time.Minute), Sequence: sequence}
}

func (a *application) v420PopulateUIPreviewTasks() {
	now := time.Now()
	videoDefaults := a.settings.DefaultOptions(model.KindVideo)
	video4K := videoDefaults
	video4K.Resolution = "4K"
	videoH264 := videoDefaults
	videoH264.Codec = "H.264"
	videoTrimCrop := videoDefaults
	videoTrimCrop.TrimStart = 10
	videoTrimCrop.TrimEnd = 120
	videoTrimCrop.Crop = model.Crop{Enabled: true, X: 0, Y: 0, Width: 1280, Height: 1080}
	imageDefaults := a.settings.DefaultOptions(model.KindImage)
	imagePNG := imageDefaults
	imagePNG.ImageFormat = "PNG"
	imagePNG.ImageSize = "最大边 1920px"

	a.settings.SetOutputDirFor(model.KindVideo, `D:\Mediova输出\视频`)
	a.settings.SetOutputDirFor(model.KindImage, `D:\Mediova输出\图片`)
	videoOut := a.settings.OutputDirFor(model.KindVideo)
	imageOut := a.settings.OutputDirFor(model.KindImage)

	videoTasks := []*model.Task{
		{ID: a.nextID.Add(1), Input: `C:\手机备份\2026\宝宝\待处理_4K.MOV`, Root: `C:\手机备份`, Kind: model.KindVideo, Width: 3840, Height: 2160, Rotation: 90, Duration: 74.2, FPS: 29.97, InputSize: 428 * 1024 * 1024, Status: model.StatusReady, Options: video4K, ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `C:\手机备份\2026\旅行\等待队列.mp4`, Root: `C:\手机备份`, Kind: model.KindVideo, Width: 1920, Height: 1080, Duration: 86, FPS: 25, InputSize: 180 * 1024 * 1024, OutputPath: filepath.Join(videoOut, `2026\旅行\等待队列.mp4`), Status: model.StatusQueued, Options: videoDefaults, Queue: previewQueue(videoDefaults, videoOut, filepath.Join(videoOut, `2026\旅行\等待队列.mp4`), 2), ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `D:\相机\项目A\转换中.mp4`, Root: `D:\相机`, Kind: model.KindVideo, Width: 1920, Height: 1080, Duration: 182.6, FPS: 59.94, InputSize: 1538 * 1024 * 1024, OutputPath: filepath.Join(videoOut, `项目A\转换中.mp4`), OutputSize: 530 * 1024 * 1024, Status: model.StatusProcessing, Progress: 63.4, Engine: "CPU · H.265", Options: videoTrimCrop, Queue: previewQueue(videoTrimCrop, videoOut, filepath.Join(videoOut, `项目A\转换中.mp4`), 1), StartedAt: now.Add(-2 * time.Minute), ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `D:\相机\项目A\暂停任务.mp4`, Root: `D:\相机`, Kind: model.KindVideo, Width: 1920, Height: 1080, Duration: 96.4, FPS: 25, InputSize: 206 * 1024 * 1024, OutputPath: filepath.Join(videoOut, `项目A\暂停任务.mp4`), OutputSize: 31 * 1024 * 1024, Status: model.StatusPaused, Progress: 34.8, Engine: "已暂停", Options: videoH264, Queue: previewQueue(videoH264, videoOut, filepath.Join(videoOut, `项目A\暂停任务.mp4`), 3), ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `E:\归档\临时修改.mp4`, Root: `E:\归档`, Kind: model.KindVideo, Width: 1920, Height: 1080, Duration: 122, FPS: 30, InputSize: 320 * 1024 * 1024, Status: model.StatusHeld, Progress: 0, Engine: "搁置 · 等待修改", Options: videoDefaults, Queue: previewQueue(videoDefaults, videoOut, filepath.Join(videoOut, `临时修改.mp4`), 4), Hold: &model.HoldState{FromStatus: model.StatusProcessing, Original: videoDefaults, Queue: previewQueue(videoDefaults, videoOut, filepath.Join(videoOut, `临时修改.mp4`), 4), ReservedSlot: true, HeldAt: now.Add(-20 * time.Second)}, ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `E:\归档\已完成.mp4`, Root: `E:\归档`, Kind: model.KindVideo, Width: 1920, Height: 1080, Duration: 48.7, FPS: 30, InputSize: 56 * 1024 * 1024, OutputPath: filepath.Join(videoOut, `已完成.mp4`), OutputSize: 11 * 1024 * 1024, Status: model.StatusDone, Progress: 100, Engine: "NVIDIA NVENC", Options: videoDefaults, FinishedAt: now.Add(-4 * time.Minute), ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `E:\归档\失败任务.mp4`, Root: `E:\归档`, Kind: model.KindVideo, Width: 1280, Height: 720, Duration: 48.7, FPS: 30, InputSize: 31 * 1024 * 1024, OutputSize: 3 * 1024 * 1024, Status: model.StatusFailed, Progress: 18.2, Error: "输入文件尾部损坏，解码器无法继续读取。", FailureCategory: "源文件损坏", Options: videoDefaults, ThumbnailIndex: -1},
	}
	imageTasks := []*model.Task{
		{ID: a.nextID.Add(1), Input: `C:\图片备份\2026\宝宝\待压缩.jpg`, Root: `C:\图片备份`, Kind: model.KindImage, Width: 4032, Height: 3024, InputSize: 9 * 1024 * 1024, Status: model.StatusReady, Options: imageDefaults, ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `C:\图片备份\2026\截图\队列中.png`, Root: `C:\图片备份`, Kind: model.KindImage, Width: 1440, Height: 3200, InputSize: 7 * 1024 * 1024, OutputPath: filepath.Join(imageOut, `2026\截图\队列中.png`), Status: model.StatusQueued, Options: imagePNG, Queue: previewQueue(imagePNG, imageOut, filepath.Join(imageOut, `2026\截图\队列中.png`), 2), ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `D:\照片\旅行\转换中.jpg`, Root: `D:\照片`, Kind: model.KindImage, Width: 6000, Height: 4000, InputSize: 15 * 1024 * 1024, OutputPath: filepath.Join(imageOut, `旅行\转换中.jpg`), OutputSize: 5 * 1024 * 1024, Status: model.StatusProcessing, Progress: 45.6, Engine: "图片处理", Options: imageDefaults, Queue: previewQueue(imageDefaults, imageOut, filepath.Join(imageOut, `旅行\转换中.jpg`), 1), ThumbnailIndex: -1},
		{ID: a.nextID.Add(1), Input: `D:\照片\旅行\已完成.jpg`, Root: `D:\照片`, Kind: model.KindImage, Width: 4032, Height: 3024, InputSize: 6 * 1024 * 1024, OutputPath: filepath.Join(imageOut, `旅行\已完成.jpg`), OutputSize: 2 * 1024 * 1024, Status: model.StatusDone, Progress: 100, Engine: "JPG", Options: imageDefaults, FinishedAt: now.Add(-time.Minute), ThumbnailIndex: -1},
	}

	mode := strings.ToLower(strings.TrimSpace(a.uiPreviewMode))
	if mode == "image" {
		a.mu.Lock()
		a.tasks = imageTasks
		a.mu.Unlock()
		round12InstallPreviewThumbnails(a)
		a.switchKind(model.KindImage)
		return
	}
	if mode == "held" {
		held := videoTasks[4]
		videoTasks = append([]*model.Task{held}, append(videoTasks[:4], videoTasks[5:]...)...)
		a.heldEditTaskID = held.ID
	}
	a.mu.Lock()
	a.tasks = videoTasks
	a.mu.Unlock()
	round12InstallPreviewThumbnails(a)
	a.switchKind(model.KindVideo)
}

func (a *application) runV420DynamicQueueSelfTest(report *selfTestReport, root, seedVideo, ffprobe string) {
	if seedVideo == "" || ffprobe == "" || media.FileSize(seedVideo) <= 1024 {
		report.Checks["v420_dynamic_append"] = false
		report.Checks["v420_relative_output_tree"] = false
		report.Details["v420_dynamic_append"] = "seed video or ffprobe unavailable"
		return
	}
	sourceRoot := filepath.Join(root, "dynamic-source")
	firstDir := filepath.Join(sourceRoot, "第一批")
	secondDir := filepath.Join(sourceRoot, "追加批次")
	_ = os.MkdirAll(firstDir, 0o755)
	_ = os.MkdirAll(secondDir, 0o755)
	seed, err := os.ReadFile(seedVideo)
	if err != nil {
		report.Checks["v420_dynamic_append"] = false
		report.Details["v420_dynamic_append"] = err.Error()
		return
	}
	firstPath := filepath.Join(firstDir, "同名视频.mp4")
	secondPath := filepath.Join(secondDir, "同名视频.mp4")
	if err = os.WriteFile(firstPath, seed, 0o644); err == nil {
		err = os.WriteFile(secondPath, seed, 0o644)
	}
	if err != nil {
		report.Checks["v420_dynamic_append"] = false
		report.Details["v420_dynamic_append"] = err.Error()
		return
	}
	a.addPaths([]string{firstPath, secondPath}, sourceRoot)
	outputRoot := filepath.Join(root, "dynamic-output")
	a.settings.SetOutputDirFor(model.KindVideo, outputRoot)
	a.settings.UseGPU = false
	a.settings.SmartEngine = false
	a.settings.AutoConcurrency = false
	a.settings.Concurrency = 1
	a.settings.EstimateDiskSpace = false
	a.settings.SaveHistory = false
	a.settings.VerifyOutput = true
	a.settings.PreserveTimes = false
	a.settings.Resolution = "原尺寸"
	a.settings.Codec = "H.264"
	a.settings.Quality = "低"
	a.settings.VolumeMode = "质量优先"
	a.settings.Rotation = "自动"
	a.switchKind(model.KindVideo)

	var firstID, secondID int64
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil {
			continue
		}
		switch filepath.Clean(task.Input) {
		case filepath.Clean(firstPath):
			firstID = task.ID
		case filepath.Clean(secondPath):
			secondID = task.ID
		}
		if filepath.Clean(task.Input) == filepath.Clean(firstPath) || filepath.Clean(task.Input) == filepath.Clean(secondPath) {
			task.Status = model.StatusReady
			task.Options = a.settings.DefaultOptions(model.KindVideo)
			task.OutputPath = ""
			task.Queue = nil
			task.Hold = nil
		}
	}
	a.mu.Unlock()
	if firstID == 0 || secondID == 0 {
		report.Checks["v420_dynamic_append"] = false
		report.Details["v420_dynamic_append"] = fmt.Sprintf("first=%d second=%d", firstID, secondID)
		return
	}
	a.startQueueFiltered(map[int64]bool{firstID: true})
	a.v420AppendReadyToRun(map[int64]bool{secondID: true})
	done := make(chan struct{})
	go func() { a.workers.Wait(); close(done) }()
	completed := false
	select {
	case <-done:
		completed = true
	case <-time.After(120 * time.Second):
		a.runMu.Lock()
		cancel := a.cancel
		a.runMu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	var firstStatus, secondStatus model.Status
	var firstOut, secondOut string
	a.mu.Lock()
	if task, _ := a.findTaskByIDLocked(firstID); task != nil {
		firstStatus, firstOut = task.Status, task.OutputPath
	}
	if task, _ := a.findTaskByIDLocked(secondID); task != nil {
		secondStatus, secondOut = task.Status, task.OutputPath
	}
	a.mu.Unlock()
	report.Checks["v420_dynamic_append"] = completed && firstStatus == model.StatusDone && secondStatus == model.StatusDone && firstOut != secondOut
	expectedFirst := filepath.Join(outputRoot, "第一批", "同名视频.mp4")
	expectedSecond := filepath.Join(outputRoot, "追加批次", "同名视频.mp4")
	report.Checks["v420_relative_output_tree"] = filepath.Clean(firstOut) == filepath.Clean(expectedFirst) && filepath.Clean(secondOut) == filepath.Clean(expectedSecond)
	if !report.Checks["v420_dynamic_append"] || !report.Checks["v420_relative_output_tree"] {
		report.Details["v420_dynamic_append"] = fmt.Sprintf("completed=%v first=%s:%q second=%s:%q expected=%q/%q", completed, firstStatus, firstOut, secondStatus, secondOut, expectedFirst, expectedSecond)
	}
	for name, path := range map[string]string{"first": firstOut, "second": secondOut} {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		info, probeErr := media.ProbeContext(ctx, ffprobe, path)
		cancel()
		report.Checks["v420_dynamic_output_"+name] = probeErr == nil && info.Width > 0 && info.Duration > 0
	}
	a.resetSelfTestRunState()
}

func v420ResetReadyOptionsForSelfTest(tasks []*model.Task, settings model.Settings, kind model.Kind) int {
	return workflow.ResetReadyToDefaults(tasks, kind, settings)
}
