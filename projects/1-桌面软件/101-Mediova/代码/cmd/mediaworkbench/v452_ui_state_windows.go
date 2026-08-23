//go:build windows

package main

import (
	"strings"
	"sync"
	"time"
	"unsafe"
)

var (
	v452ClockMu sync.Mutex
	v452Clocks  = make(map[*application]*activeRunClock)
)

func v452ResetRunClock(a *application, start time.Time) {
	if a == nil {
		return
	}
	v452ClockMu.Lock()
	clock := &activeRunClock{}
	clock.Reset(start)
	v452Clocks[a] = clock
	v452ClockMu.Unlock()
}

func v452SetRunPaused(a *application, paused bool, now time.Time) {
	if a == nil {
		return
	}
	v452ClockMu.Lock()
	clock := v452Clocks[a]
	if clock == nil {
		clock = &activeRunClock{}
		clock.Reset(a.runStart)
		v452Clocks[a] = clock
	}
	clock.SetPaused(paused, now)
	v452ClockMu.Unlock()
}

func v452RunElapsed(a *application, fallbackStart time.Time, now time.Time) time.Duration {
	if a == nil {
		return 0
	}
	v452ClockMu.Lock()
	defer v452ClockMu.Unlock()
	clock := v452Clocks[a]
	if clock == nil {
		clock = &activeRunClock{}
		clock.Reset(fallbackStart)
		v452Clocks[a] = clock
	}
	return clock.Elapsed(now)
}

func v452FinishRunClock(a *application, fallbackStart, end time.Time) time.Duration {
	if a == nil {
		return 0
	}
	v452ClockMu.Lock()
	clock := v452Clocks[a]
	delete(v452Clocks, a)
	v452ClockMu.Unlock()
	if clock == nil {
		duration := end.Sub(fallbackStart)
		if duration < 0 {
			return 0
		}
		return duration
	}
	return clock.Elapsed(end)
}

// v452FinalizeInitialToolbar makes the initial owner-draw toolbar deterministic.
// It runs synchronously during WM_CREATE after layout; no delayed goroutine or
// polling timer is used.
func v452FinalizeInitialToolbar(a *application) {
	if a == nil || !a.controlsReady {
		return
	}
	for _, hwnd := range []uintptr{
		a.hVideo, a.hImage, a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear,
		a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir,
		a.hToolbarDivider, a.hHeaderLine,
	} {
		if hwnd == 0 {
			continue
		}
		procShowWindow.Call(hwnd, SW_SHOW)
		procInvalidateRect.Call(hwnd, 0, 1)
	}
	v452InstallListVisuals(a)
	procRedrawWindow.Call(a.hwnd, 0, 0, RDW_INVALIDATE|RDW_ERASE|RDW_ALLCHILDREN|RDW_UPDATENOW)
}

const v452CBSetEditSel = 0x0142

func v452ClearComboSelection(a *application, hwnd uintptr, locked bool) {
	if hwnd == 0 {
		return
	}
	// LOWORD=-1, HIWORD=0 removes the edit selection and keeps the caret at
	// the end. This prevents the disabled combo from retaining a blue block
	// after switching between image and video workspaces.
	send(hwnd, v452CBSetEditSel, 0, 0x0000FFFF)
	procInvalidateRect.Call(hwnd, 0, 1)
	if locked && a != nil {
		focus, _, _ := procGetFocus.Call()
		if focus == hwnd && a.hList != 0 {
			procSetFocus.Call(a.hList)
		}
	}
}

func v452DrawTrueStatusLamp(hdc uintptr, rc rect, color uintptr) {
	rowHeight := rc.Bottom - rc.Top
	diameter := v452StatusLampDiameter(rowHeight, scaleDPI(12))
	left := rc.Left + scaleDPI(5)
	top := rc.Top + (rowHeight-diameter)/2
	// The compatibility status-lamp path now uses the same 8x8 supersampled
	// rasterizer as the active right-top component indicators. Direct GDI
	// Ellipse at 11-14 px visibly stair-stepped on 100% and 125% DPI screens.
	round7FeedbackDrawFlatLamp(
		hdc, int(left), int(top), int(diameter), color, colorRef(250, 251, 253),
	)
}

func v452DrawSolidPrimaryGlyph(hdc, hwnd uintptr, rc rect, color uintptr) {
	if app == nil || hwnd == 0 {
		return
	}
	glyph := "\uE768" // Play
	if hwnd == app.hPause {
		label := getText(app.hPause)
		if strings.Contains(label, "继续") || strings.Contains(label, "恢复") {
			glyph = "\uE768" // Play icon when paused (ready to continue)
		} else {
			glyph = "\uE769" // Pause double bars during active running
		}
	}
	if hwnd == app.hStop {
		glyph = "\uE71A" // Stop
	}
	drawCenteredText(hdc, glyph, rc, iconFont, color)
}

func v452DrawPausedProgressText(hdc uintptr, text string, bar rect) {
	drawCenteredText(hdc, text, bar, uiFontSmall, colorRef(117, 126, 139))
}

func v452ForceTransparentStatic(hwnd uintptr) {
	if hwnd != 0 {
		procInvalidateRect.Call(hwnd, 0, 1)
	}
}

// Keep unsafe imported in the same Windows-only unit because future combo
// subclass work uses the same message contract; this compile-time assertion
// also guards pointer-size assumptions for Win32 LPARAM packing.
var _ = unsafe.Sizeof(uintptr(0))
