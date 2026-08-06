//go:build windows

package main

import (
	"sync/atomic"

	"mediaworkbench/internal/model"
)

var round12PreviewInstalled atomic.Bool

func round12InstallPreviewThumbnails(a *application) {
	if a == nil || !a.uiPreview || a.hList == 0 || a.hImageList == 0 || round12PreviewInstalled.Load() {
		return
	}
	a.mu.Lock()
	if len(a.tasks) == 0 {
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()
	hdc, _, _ := round7ListGetDC.Call(a.hList)
	if hdc == 0 {
		return
	}
	defer round7ListReleaseDC.Call(a.hList, hdc)
	memDC, _, _ := procCreateCompatibleDC.Call(hdc)
	if memDC == 0 {
		return
	}
	defer procDeleteDC.Call(memDC)
	backgrounds := []uintptr{colorRef(205, 225, 247), colorRef(225, 235, 211), colorRef(224, 215, 241), colorRef(248, 229, 190), colorRef(237, 218, 203), colorRef(207, 237, 221), colorRef(244, 211, 211)}
	a.mu.Lock()
	defer a.mu.Unlock()
	for index, task := range a.tasks {
		if task == nil {
			continue
		}
		bmp, _, _ := round7FeedbackCreateCompatibleBmp.Call(hdc, 86, 48)
		if bmp == 0 {
			continue
		}
		old, _, _ := procSelectObject.Call(memDC, bmp)
		canvas := rect{Left: 0, Top: 0, Right: 86, Bottom: 48}
		background := backgrounds[index%len(backgrounds)]
		fillSolid(memDC, canvas, background)
		fillSolid(memDC, rect{Left: 0, Top: 34, Right: 86, Bottom: 48}, mixColor(background, colorRef(255, 255, 255), .45))
		label := "视频"
		if task.Kind == model.KindImage {
			label = "图片"
		}
		drawCenteredText(memDC, label, canvas, uiFontSmall, colorRef(54, 73, 95))
		if old != 0 {
			procSelectObject.Call(memDC, old)
		}
		imageIndex, _, _ := procImageListAdd.Call(a.hImageList, bmp, 0)
		procDeleteObject.Call(bmp)
		if int32(imageIndex) >= 0 {
			task.ThumbnailIndex = int(int32(imageIndex))
		}
	}
	round12PreviewInstalled.Store(true)
	procInvalidateRect.Call(a.hList, 0, 1)
}
