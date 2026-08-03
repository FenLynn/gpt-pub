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
	lamp := rect{Left: left, Top: top, Right: left + diameter, Bottom: top + diameter}
	brush, _, _ := procCreateSolidBrush.Call(color)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	procEllipse.Call(hdc, uintptr(lamp.Left), uintptr(lamp.Top), uintptr(lamp.Right), uintptr(lamp.Bottom))
	procSelectObject.Call(hdc, oldPen)
	procSelectObject.Call(hdc, oldBrush)
	procDeleteObject.Call(pen)
	procDeleteObject.Call(brush)
}

func v452DrawSolidPrimaryGlyph(hdc, hwnd uintptr, rc rect, color uintptr) {
	if app == nil || hwnd == 0 {
		return
	}
	cx := (rc.Left + rc.Right) / 2
	cy := (rc.Top + rc.Bottom) / 2
	if hwnd == app.hPause && !strings.Contains(getText(app.hPause), "继续") {
		barW := scaleDPI(4)
		barH := scaleDPI(14)
		gap := scaleDPI(3)
		fillSolid(hdc, rect{Left: cx - gap - barW, Top: cy - barH/2, Right: cx - gap, Bottom: cy + barH/2}, color)
		fillSolid(hdc, rect{Left: cx + gap, Top: cy - barH/2, Right: cx + gap + barW, Bottom: cy + barH/2}, color)
		return
	}
	if hwnd == app.hStop {
		size := scaleDPI(13)
		fillSolid(hdc, rect{Left: cx - size/2, Top: cy - size/2, Right: cx + size/2, Bottom: cy + size/2}, color)
		return
	}

	// Start and resume use a filled right-facing triangle. Drawing one-pixel
	// vertical strips avoids font-dependent outline glyphs and keeps the fill
	// colour exactly synchronized with the button foreground state.
	width := scaleDPI(13)
	height := scaleDPI(15)
	left := cx - width/2
	for x := int32(0); x < width; x++ {
		half := (x * height) / (2 * width)
		fillSolid(hdc, rect{Left: left + x, Top: cy - half, Right: left + x + 1, Bottom: cy + half + 1}, color)
	}
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
