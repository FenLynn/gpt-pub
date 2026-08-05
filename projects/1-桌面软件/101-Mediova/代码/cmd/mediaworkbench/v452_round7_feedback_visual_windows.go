//go:build windows

package main

import (
	"fmt"
	"math"
	"unsafe"

	"mediaworkbench/internal/config"
)

func round7FeedbackDrawFlatToolbarButton(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil {
		return false
	}
	switch dis.HwndItem {
	case a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear,
		a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir:
	default:
		return false
	}
	icon, label, _, ok := a.toolbarButtonSpec(dis.HwndItem)
	if !ok {
		return false
	}
	disabled := dis.ItemState&ODS_DISABLED != 0
	pressed := dis.ItemState&ODS_SELECTED != 0
	hovered := a.hovered(dis.HwndItem)
	canvas := colorRef(250, 251, 253)
	fillSolid(dis.HDC, dis.RcItem, canvas)
	if hovered || pressed {
		bg := colorRef(241, 246, 252)
		if pressed {
			bg = colorRef(230, 239, 249)
		}
		inner := dis.RcItem
		inner.Left += 2
		inner.Top += 2
		inner.Right -= 2
		inner.Bottom -= 2
		fillSolid(dis.HDC, inner, bg)
	}
	color := colorRef(44, 57, 73)
	if disabled {
		color = colorRef(159, 167, 177)
	}
	iconRC := dis.RcItem
	iconRC.Top += scaleDPI(5)
	iconRC.Bottom = iconRC.Top + scaleDPI(23)
	oldFont, _, _ := procSelectObject.Call(dis.HDC, iconFont)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	procSetTextColor.Call(dis.HDC, color)
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(icon))), ^uintptr(0), uintptr(unsafe.Pointer(&iconRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	labelRC := dis.RcItem
	labelRC.Top += scaleDPI(29)
	labelRC.Bottom -= scaleDPI(3)
	oldFont, _, _ = procSelectObject.Call(dis.HDC, uiFontSmall)
	procSetTextColor.Call(dis.HDC, color)
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&labelRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	return true
}

func round7FeedbackDrawAllDefault(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil || dis.HwndItem != a.hAllDefault {
		return false
	}
	disabled := dis.ItemState&ODS_DISABLED != 0
	pressed := dis.ItemState&ODS_SELECTED != 0
	hovered := a.hovered(dis.HwndItem)
	canvas := colorRef(250, 251, 253)
	fillSolid(dis.HDC, dis.RcItem, canvas)
	if hovered || pressed {
		inner := dis.RcItem
		inner.Left++
		inner.Top++
		inner.Right--
		inner.Bottom--
		bg := colorRef(241, 246, 252)
		if pressed {
			bg = colorRef(230, 239, 249)
		}
		fillSolid(dis.HDC, inner, bg)
	}
	color := colorRef(55, 70, 88)
	if disabled {
		color = colorRef(163, 170, 180)
	}
	iconRC := dis.RcItem
	iconRC.Left += scaleDPI(6)
	iconRC.Right = iconRC.Left + scaleDPI(28)
	oldFont, _, _ := procSelectObject.Call(dis.HDC, uiFontTitle)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	procSetTextColor.Call(dis.HDC, color)
	resetIcon := "↺"
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(resetIcon))), ^uintptr(0), uintptr(unsafe.Pointer(&iconRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	textRC := dis.RcItem
	textRC.Left += scaleDPI(34)
	textRC.Right -= scaleDPI(6)
	oldFont, _, _ = procSelectObject.Call(dis.HDC, uiFontSmall)
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p("全部恢复默认"))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	return true
}

func round7FeedbackDrawStatusChip(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil {
		return false
	}
	if dis.HwndItem != a.hFFStatus && dis.HwndItem != a.hGPUStatus &&
		dis.HwndItem != a.hPotStatus && dis.HwndItem != a.hConcurrencyStatus {
		return false
	}
	disabled := dis.ItemState&ODS_DISABLED != 0
	pressed := dis.ItemState&ODS_SELECTED != 0
	hovered := a.hovered(dis.HwndItem)
	back := colorRef(250, 251, 253)
	if hovered || pressed {
		back = colorRef(242, 246, 251)
	}
	fillSolid(dis.HDC, dis.RcItem, back)

	ffmpeg, _, hardware, _, playerOK := a.componentSnapshot()
	lamp := colorRef(143, 153, 165)
	text := ""
	switch dis.HwndItem {
	case a.hFFStatus:
		text = "FFmpeg"
		if ffmpeg != "" {
			lamp = colorRef(25, 166, 87)
		} else {
			lamp = colorRef(205, 75, 62)
		}
	case a.hGPUStatus:
		text = "GPU"
		if hardware.Available {
			lamp = colorRef(226, 139, 22)
		}
	case a.hPotStatus:
		text = "PotPlayer"
		if playerOK {
			lamp = colorRef(76, 104, 210)
		}
	case a.hConcurrencyStatus:
		text = fmt.Sprintf("自动≤%d", config.NormalizeConcurrency(a.settings.Concurrency))
		lamp = colorRef(54, 113, 205)
	}
	if disabled {
		lamp = colorRef(177, 183, 191)
	}
	diameter := int(scaleDPI(13))
	if diameter < 11 {
		diameter = 11
	}
	x := int(dis.RcItem.Left + scaleDPI(7))
	y := int((dis.RcItem.Top + dis.RcItem.Bottom - int32(diameter)) / 2)
	round7FeedbackDrawFlatLamp(dis.HDC, x, y, diameter, lamp, back)

	textRC := dis.RcItem
	textRC.Left = int32(x+diameter) + scaleDPI(7)
	textRC.Right -= scaleDPI(4)
	color := colorRef(47, 58, 72)
	if disabled {
		color = colorRef(151, 158, 168)
	}
	oldFont, _, _ := procSelectObject.Call(dis.HDC, uiFontSmall)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	procSetTextColor.Call(dis.HDC, color)
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	return true
}

func round7FeedbackDrawFlatLamp(hdc uintptr, x, y, diameter int, lamp, back uintptr) {
	if hdc == 0 || diameter <= 0 {
		return
	}
	key := round7FeedbackLampKey{diameter: diameter, lamp: lamp, back: back}
	var pixels []byte
	if cached, ok := round7FeedbackLampCache.Load(key); ok {
		pixels = cached.([]byte)
	} else {
		pixels = round7FeedbackBuildFlatLampPixels(diameter, lamp, back)
		round7FeedbackLampCache.Store(key, pixels)
	}
	if len(pixels) == 0 {
		return
	}
	info := round7BitmapInfo{Header: round7BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(round7BitmapInfoHeader{})),
		Width:       int32(diameter),
		Height:      -int32(diameter),
		Planes:      1,
		BitCount:    32,
		Compression: round7BI_RGB,
		SizeImage:   uint32(len(pixels)),
	}}
	round7StretchDIBits.Call(
		hdc,
		uintptr(x), uintptr(y), uintptr(diameter), uintptr(diameter),
		0, 0, uintptr(diameter), uintptr(diameter),
		uintptr(unsafe.Pointer(&pixels[0])), uintptr(unsafe.Pointer(&info)),
		round7DIBRGBColors, round7SRCCOPY,
	)
}

func round7FeedbackBuildFlatLampPixels(diameter int, lamp, back uintptr) []byte {
	if diameter <= 0 {
		return nil
	}
	pixels := make([]byte, diameter*diameter*4)
	lr, lg, lb := float64(lamp&0xff), float64((lamp>>8)&0xff), float64((lamp>>16)&0xff)
	br, bg, bb := float64(back&0xff), float64((back>>8)&0xff), float64((back>>16)&0xff)
	center := float64(diameter) / 2
	radius := float64(diameter)/2 - 0.45
	const samples = 8
	for py := 0; py < diameter; py++ {
		for px := 0; px < diameter; px++ {
			inside := 0
			for sy := 0; sy < samples; sy++ {
				for sx := 0; sx < samples; sx++ {
					fx := float64(px) + (float64(sx)+0.5)/samples
					fy := float64(py) + (float64(sy)+0.5)/samples
					dx, dy := fx-center, fy-center
					if dx*dx+dy*dy <= radius*radius {
						inside++
					}
				}
			}
			coverage := float64(inside) / float64(samples*samples)
			r := br + (lr-br)*coverage
			g := bg + (lg-bg)*coverage
			b := bb + (lb-bb)*coverage
			offset := (py*diameter + px) * 4
			pixels[offset+0] = byte(math.Round(b))
			pixels[offset+1] = byte(math.Round(g))
			pixels[offset+2] = byte(math.Round(r))
			pixels[offset+3] = 255
		}
	}
	return pixels
}
