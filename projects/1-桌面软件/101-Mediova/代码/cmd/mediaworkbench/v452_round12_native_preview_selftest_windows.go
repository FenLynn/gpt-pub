//go:build windows

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

const round12NativePreviewSubclassID = 0x45CC

type round12NativePreviewResult struct {
	checks  map[string]bool
	details map[string]string
}

var (
	round12NativePreviewEnabled      = v452Round5SelfTestRequested(os.Args[1:])
	round12NativePreviewEventCB      uintptr
	round12NativePreviewSubclassCB   uintptr
	round12NativePreviewHook         uintptr
	round12NativePreviewInstallOnce  sync.Once
	round12NativePreviewRunOnce      sync.Once
	round12NativePreviewStoredResult round12NativePreviewResult
)

func init() {
	if !round12NativePreviewEnabled {
		return
	}
	round12NativePreviewEventCB = syscall.NewCallback(round12NativePreviewEventProc)
	round12NativePreviewSubclassCB = syscall.NewCallback(round12NativePreviewSubclassProc)
	round12NativePreviewHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round12NativePreviewEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round12NativePreviewEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	round12NativePreviewInstallOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, round12NativePreviewSubclassCB, round12NativePreviewSubclassID, 0)
	})
	return 0
}

func round12NativePreviewSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		round12NativePreviewRunOnce.Do(func() {
			round12NativePreviewStoredResult = app.round12RunNativePreviewSelfTest()
		})
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		_ = app.round12PatchNativePreviewReport(round12NativePreviewStoredResult)
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, round12NativePreviewSubclassCB, subclassID)
	}
	return result
}

func (a *application) round12RunNativePreviewSelfTest() round12NativePreviewResult {
	result := round12NativePreviewResult{checks: map[string]bool{}, details: map[string]string{}}
	root, err := os.MkdirTemp("", "Mediova-round12-preview-native-")
	if err != nil {
		result.checks["round12_preview_fixture"] = false
		result.details["round12_preview_fixture"] = err.Error()
		return result
	}
	defer os.RemoveAll(root)

	ffmpeg, _, _, _, _ := a.componentSnapshot()
	videoPath := filepath.Join(root, "round12-preview-source.mp4")
	if err := v452Round5GenerateVideo(ffmpeg, videoPath); err != nil {
		result.checks["round12_preview_fixture"] = false
		result.details["round12_preview_fixture"] = err.Error()
		return result
	}
	result.checks["round12_preview_fixture"] = true

	targets := []float64{2.4, 0.25, 1.75, 0.60, 1.95, 1.10}
	hashes := make([]string, 0, len(targets))
	sequenceOK := true
	exactEndOK := false
	for index, target := range targets {
		output := filepath.Join(root, fmt.Sprintf("round12-preview-%02d.bmp", index))
		err := round12GenerateRecoveredPreview(context.Background(), ffmpeg, videoPath, output, target, 2.4, 30, "不旋转")
		data, readErr := os.ReadFile(output)
		ok := err == nil && readErr == nil && len(data) > 1024
		if !ok {
			sequenceOK = false
			if index == 0 {
				exactEndOK = false
			}
			result.details[fmt.Sprintf("round12_preview_target_%02d", index)] = fmt.Sprintf("target=%.3f generate=%v read=%v bytes=%d", target, err, readErr, len(data))
			continue
		}
		sum := sha256.Sum256(data)
		hash := hex.EncodeToString(sum[:])
		hashes = append(hashes, hash)
		if index == 0 {
			exactEndOK = true
		}
	}
	result.checks["round12_preview_exact_end_recovered"] = exactEndOK
	result.checks["round12_preview_sequence_recovered"] = sequenceOK && len(hashes) == len(targets)

	unique := map[string]bool{}
	for _, hash := range hashes {
		unique[hash] = true
	}
	result.checks["round12_preview_sequence_distinct"] = sequenceOK && len(unique) == len(targets)
	result.details["round12_preview_sequence"] = fmt.Sprintf("targets=%v unique=%d hashes=%v", targets, len(unique), hashes)

	cancelCtx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelErr := round12GenerateRecoveredPreview(cancelCtx, ffmpeg, videoPath, filepath.Join(root, "cancelled.bmp"), 0.8, 2.4, 30, "不旋转")
	result.checks["round12_preview_cancelled_request_rejected"] = errors.Is(cancelErr, context.Canceled)
	result.details["round12_preview_cancelled_request_rejected"] = fmt.Sprintf("error=%v", cancelErr)

	state := &round12TrimPreviewGuardState{generation: 7, ownSeq: 11, targetAt: 1.10}
	currentAccepted := round12OwnedPreviewCurrent(state, 7, 11, 1.10)
	staleGenerationRejected := !round12OwnedPreviewCurrent(state, 6, 11, 1.10)
	staleSeqRejected := !round12OwnedPreviewCurrent(state, 7, 10, 1.10)
	staleTargetRejected := !round12OwnedPreviewCurrent(state, 7, 11, 1.20)
	result.checks["round12_preview_stale_generation_rejected"] = currentAccepted && staleGenerationRejected && staleSeqRejected && staleTargetRejected
	result.details["round12_preview_stale_generation_rejected"] = fmt.Sprintf(
		"current=%v stale_generation=%v stale_seq=%v stale_target=%v",
		currentAccepted, staleGenerationRejected, staleSeqRejected, staleTargetRejected,
	)
	return result
}

func (a *application) round12PatchNativePreviewReport(result round12NativePreviewResult) error {
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
