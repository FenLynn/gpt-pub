//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

const v452Round5ReportSubclassID = 0x4555

var (
	v452Round5ReportEventCB uintptr
	v452Round5ReportMainCB  uintptr
	v452Round5ReportHook    uintptr
	v452Round5ReportOnce    sync.Once
)

func init() {
	if !v452Round5Enabled {
		return
	}
	v452Round5ReportEventCB = syscall.NewCallback(v452Round5ReportEventProc)
	v452Round5ReportMainCB = syscall.NewCallback(v452Round5ReportSubclassProc)
	v452Round5ReportHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round5ReportEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round5ReportEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	v452Round5ReportOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, v452Round5ReportMainCB, v452Round5ReportSubclassID, 0)
	})
	return 0
}

func v452Round5ReportSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		_ = app.v452FinalizeRound5ToastReport()
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452Round5ReportMainCB, subclassID)
	}
	return result
}

func (a *application) v452FinalizeRound5ToastReport() error {
	reportPath := a.selfTestPath()
	data, err := os.ReadFile(reportPath)
	if err != nil {
		return err
	}
	var report selfTestReport
	if err := json.Unmarshal(data, &report); err != nil {
		return err
	}
	if report.Checks == nil {
		report.Checks = map[string]bool{}
	}
	if report.Details == nil {
		report.Details = map[string]string{}
	}
	path := filepath.Join(filepath.Dir(reportPath), "ui-preview", "Mediova-v4.5.2-round5-import-toast.png")
	file, openErr := os.Open(path)
	valid := false
	detail := ""
	if openErr == nil {
		config, decodeErr := png.DecodeConfig(file)
		_ = file.Close()
		if decodeErr == nil {
			info, statErr := os.Stat(path)
			size := int64(0)
			if statErr == nil {
				size = info.Size()
			}
			valid = statErr == nil && config.Width >= 300 && config.Height >= 60 && size >= 1000
			detail = fmt.Sprintf("png=%dx%d bytes=%d", config.Width, config.Height, size)
		} else {
			detail = decodeErr.Error()
		}
	} else {
		detail = openErr.Error()
	}
	report.Checks["round5_import_toast_screenshot"] = valid
	report.Details["round5_import_toast_screenshot"] = detail

	tries := v452CropSyncInstallTries.Load()
	parents := v452CropSyncParentsOK.Load()
	edits := v452CropSyncEditsOK.Load()
	intercepted := v452CropSyncIntercepted.Load()
	cbtCallbacks := v452CropSyncCBTCallbacks.Load()
	activations := v452CropSyncActivations.Load()
	snapshots := v452CropSyncSnapshots.Load()
	repairs := v452CropSyncRepairs.Load()
	report.Checks["round5_crop_cbt_hook_installed"] = v452CropSyncCBTHook.Load() != 0 && cbtCallbacks > 0
	report.Checks["round5_crop_sync_activation"] = activations >= 2
	report.Checks["round5_crop_sync_guard_installed"] = parents >= 2 && edits >= 8
	report.Checks["round5_crop_sync_guard_intercepted"] = intercepted > 0
	report.Checks["round5_crop_initial_state_repaired"] = snapshots >= 2 && repairs >= 2
	report.Details["round5_crop_sync_guard"] = fmt.Sprintf("cbt_hook=%d cbt_callbacks=%d activations=%d tries=%d parents=%d edits=%d intercepted=%d snapshots=%d repairs=%d", v452CropSyncCBTHook.Load(), cbtCallbacks, activations, tries, parents, edits, intercepted, snapshots, repairs)

	report.Passed = len(report.Checks) > 0
	for _, ok := range report.Checks {
		if !ok {
			report.Passed = false
			break
		}
	}
	updated, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(reportPath, updated, 0o644)
}
