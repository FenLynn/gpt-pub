//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"mediaworkbench/internal/media"
)

const round12ThumbnailQualitySelfTestSubclassID = 0x45CE

type round12ThumbnailQualitySelfTestResult struct {
	checks  map[string]bool
	details map[string]string
}

var (
	round12ThumbnailQualitySelfTestEnabled      = v452Round5SelfTestRequested(os.Args[1:])
	round12ThumbnailQualitySelfTestEventCB      uintptr
	round12ThumbnailQualitySelfTestSubclassCB   uintptr
	round12ThumbnailQualitySelfTestHook         uintptr
	round12ThumbnailQualitySelfTestInstallOnce  sync.Once
	round12ThumbnailQualitySelfTestRunOnce      sync.Once
	round12ThumbnailQualitySelfTestStoredResult round12ThumbnailQualitySelfTestResult
)

func init() {
	if !round12ThumbnailQualitySelfTestEnabled {
		return
	}
	round12ThumbnailQualitySelfTestEventCB = syscall.NewCallback(round12ThumbnailQualitySelfTestEventProc)
	round12ThumbnailQualitySelfTestSubclassCB = syscall.NewCallback(round12ThumbnailQualitySelfTestSubclassProc)
	round12ThumbnailQualitySelfTestHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round12ThumbnailQualitySelfTestEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round12ThumbnailQualitySelfTestEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	round12ThumbnailQualitySelfTestInstallOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, round12ThumbnailQualitySelfTestSubclassCB, round12ThumbnailQualitySelfTestSubclassID, 0)
	})
	return 0
}

func round12ThumbnailQualitySelfTestSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	// Preserve all inherited self-test timing first. In particular, the legacy
	// dynamic append test owns the conversion workers and must finish before
	// this Round12 FFmpeg-heavy black-frame fixture starts. Running this check
	// before DefSubclassProc could steal CPU/encoder time and turn an unrelated
	// queue completion assertion into a timing failure.
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		round12ThumbnailQualitySelfTestRunOnce.Do(func() {
			round12ThumbnailQualitySelfTestStoredResult = app.round12RunThumbnailQualitySelfTest()
		})
		_ = app.round12PatchThumbnailQualitySelfTestReport(round12ThumbnailQualitySelfTestStoredResult)
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12ThumbnailQualitySelfTestSubclassCB, subclassID)
	}
	return result
}

func round12GenerateBlackIntroThumbnailFixture(ffmpeg, output string) error {
	if ffmpeg == "" {
		return fmt.Errorf("ffmpeg unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(
		ctx,
		ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=1.3",
		"-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2.7",
		"-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
		"-map", "[v]",
		"-c:v", "libx264",
		"-pix_fmt", "yuv420p",
		output,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: round12CreateNoWindow}
	combined, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, string(combined))
	}
	if media.FileSize(output) < 1024 {
		return fmt.Errorf("black-intro fixture is empty")
	}
	return nil
}

func (a *application) round12RunThumbnailQualitySelfTest() round12ThumbnailQualitySelfTestResult {
	result := round12ThumbnailQualitySelfTestResult{checks: map[string]bool{}, details: map[string]string{}}
	root, err := os.MkdirTemp("", "Mediova-round12-thumbnail-quality-")
	if err != nil {
		result.checks["round12_thumbnail_black_intro_fixture"] = false
		result.details["round12_thumbnail_black_intro_fixture"] = err.Error()
		return result
	}
	defer os.RemoveAll(root)

	ffmpeg, _, _, _, _ := a.componentSnapshot()
	videoPath := filepath.Join(root, "black-intro.mp4")
	err = round12GenerateBlackIntroThumbnailFixture(ffmpeg, videoPath)
	result.checks["round12_thumbnail_black_intro_fixture"] = err == nil
	if err != nil {
		result.details["round12_thumbnail_black_intro_fixture"] = err.Error()
		return result
	}

	earlyPath := filepath.Join(root, "early-black.bmp")
	earlyCtx, earlyCancel := context.WithTimeout(context.Background(), 15*time.Second)
	earlyErr := media.GenerateThumbnailBMP(earlyCtx, ffmpeg, videoPath, earlyPath, 0.20, "自动", 86, 48)
	earlyCancel()
	earlyQuality, qualityErr := round12ThumbnailQualityForBMP(earlyPath)
	earlyBlack := earlyErr == nil && qualityErr == nil && round12ThumbnailNearBlack(earlyQuality)
	result.checks["round12_thumbnail_black_sample_detected"] = earlyBlack
	result.details["round12_thumbnail_black_sample_detected"] = fmt.Sprintf(
		"generate=%v quality=%v mean=%.3f bright=%.5f sampled=%d",
		earlyErr, qualityErr, earlyQuality.MeanLuma, earlyQuality.BrightRatio, earlyQuality.Sampled,
	)

	smartPath := filepath.Join(root, "smart.bmp")
	info := media.ProbeInfo{Width: 640, Height: 360, Duration: 4.0, FPS: 30}
	smartCtx, smartCancel := context.WithTimeout(context.Background(), 30*time.Second)
	selectedAt, selectedQuality, smartErr := round12GenerateSmartThumbnailBMP(
		smartCtx, ffmpeg, videoPath, smartPath, info, 86, 48,
	)
	smartCancel()
	selectedNonBlack := smartErr == nil && selectedQuality.Sampled > 0 && !round12ThumbnailNearBlack(selectedQuality)
	advanced := smartErr == nil && selectedAt > 1.30
	result.checks["round12_thumbnail_retry_selected_nonblack"] = selectedNonBlack
	result.checks["round12_thumbnail_retry_advanced_time"] = advanced
	result.details["round12_thumbnail_retry_selected_nonblack"] = fmt.Sprintf(
		"error=%v selected_at=%.3f mean=%.3f bright=%.5f sampled=%d near_black=%v",
		smartErr,
		selectedAt,
		selectedQuality.MeanLuma,
		selectedQuality.BrightRatio,
		selectedQuality.Sampled,
		round12ThumbnailNearBlack(selectedQuality),
	)
	result.details["round12_thumbnail_retry_advanced_time"] = fmt.Sprintf("selected_at=%.3f", selectedAt)
	round12ConsumeApprovedDarkThumbnailFallback(smartPath)
	return result
}

func (a *application) round12PatchThumbnailQualitySelfTestReport(result round12ThumbnailQualitySelfTestResult) error {
	path := a.selfTestPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var report map[string]any
	if err := json.Unmarshal(data, &report); err != nil {
		return err
	}
	checks, _ := report["checks"].(map[string]any)
	if checks == nil {
		checks = map[string]any{}
		report["checks"] = checks
	}
	details, _ := report["details"].(map[string]any)
	if details == nil {
		details = map[string]any{}
		report["details"] = details
	}
	for name, ok := range result.checks {
		checks[name] = ok
	}
	for name, detail := range result.details {
		details[name] = detail
	}
	passed := len(checks) > 0
	for _, raw := range checks {
		ok, valid := raw.(bool)
		if !valid || !ok {
			passed = false
			break
		}
	}
	report["passed"] = passed
	updated, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, updated, 0o644)
}
