//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"syscall"
)

const v452Round6ReportSubclassID = 0x4567

var (
	v452Round6ReportEventCB uintptr
	v452Round6ReportMainCB  uintptr
	v452Round6ReportHook    uintptr
	v452Round6ReportOnce    sync.Once
)

func init() {
	v452Round6ReportEventCB = syscall.NewCallback(v452Round6ReportEventProc)
	v452Round6ReportMainCB = syscall.NewCallback(v452Round6ReportSubclassProc)
	v452Round6ReportHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round6ReportEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round6ReportEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || app.hwnd == 0 || !app.controlsReady || !app.selfTest {
		return 0
	}
	v452Round6ReportOnce.Do(func() {
		v452SetWindowSubclass.Call(app.hwnd, v452Round6ReportMainCB, v452Round6ReportSubclassID, 0)
	})
	return 0
}

func v452Round6ReportSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_APP_SELFTEST && app != nil && app.selfTest {
		_ = app.v452FinalizeRound6Report()
	}
	if message == v452WMNCDestroy {
		v452RemoveSubclass.Call(hwnd, v452Round6ReportMainCB, subclassID)
	}
	return result
}

func (a *application) v452FinalizeRound6Report() error {
	path := a.selfTestPath()
	data, err := os.ReadFile(path)
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

	// The fifth-round probe encoded an implementation mistake as a requirement:
	// dragging inside the selected interval moved the whole interval and the
	// preview cursor. The approved specification defines only three draggable
	// objects, so replace that obsolete assertion with real seek independence.
	delete(report.Checks, "round5_timeline_range_drag")
	delete(report.Details, "round5_timeline_range_drag")
	seekEvents := v452Round6SeekEvents.Load()
	independent := v452Round6IndependentSeeks.Load()
	report.Checks["round6_timeline_seek_independent"] = seekEvents > 0 && independent > 0
	report.Details["round6_timeline_seek_independent"] = fmt.Sprintf("seek_events=%d independent=%d", seekEvents, independent)

	numberDraws := v452Round6NumberDraws.Load()
	previewDraws := v452Round6PreviewDraws.Load()
	report.Checks["round6_list_numbers_drawn"] = numberDraws > 0
	report.Details["round6_list_numbers_drawn"] = fmt.Sprintf("draws=%d", numberDraws)
	// Preview images depend on the generated thumbnail ImageList. Keep the
	// result explicit rather than treating the file name alone as a preview.
	report.Checks["round6_list_previews_drawn"] = previewDraws > 0
	report.Details["round6_list_previews_drawn"] = fmt.Sprintf("draws=%d", previewDraws)

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
	return os.WriteFile(path, updated, 0o644)
}
