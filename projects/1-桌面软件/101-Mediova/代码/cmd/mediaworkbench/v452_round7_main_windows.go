//go:build windows

package main

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"mediaworkbench/internal/config"
)

const (
	round7MainSubclassID = 0x4571
	round7WMInit         = 0x8000 + 0x527
	round7WMInitMenu     = 0x0117
	round7BI_RGB         = 0
	round7DIBRGBColors   = 0
	round7SRCCOPY        = 0x00CC0020
)

type round7BitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type round7BitmapInfo struct {
	Header round7BitmapInfoHeader
	Colors [1]uint32
}

type round7LampKey struct {
	Diameter int
	Lamp     uintptr
	Back     uintptr
}

var (
	round7MainEventCB      uintptr
	round7MainSubclassCB   uintptr
	round7MainEventHook    uintptr
	round7MainInstalled    atomic.Bool
	round7LampCache        sync.Map
	round7UnhookWinEvent   = user32.NewProc("UnhookWinEvent")
	round7ModifyMenu       = user32.NewProc("ModifyMenuW")
	round7StretchDIBits    = gdi32.NewProc("StretchDIBits")
	round7Polygon          = gdi32.NewProc("Polygon")
)

func init() {
	round7MainEventCB = syscall.NewCallback(round7MainEventProc)
	round7MainSubclassCB = syscall.NewCallback(round7MainSubclassProc)
	round7MainEventHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		round7MainEventCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func round7MainEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if round7MainInstalled.Load() || app == nil || app.hwnd == 0 || !app.controlsReady {
		return 0
	}
	ok, _, _ := v452SetWindowSubclass.Call(app.hwnd, round7MainSubclassCB, round7MainSubclassID, 0)
	if ok == 0 {
		return 0
	}
	round7MainInstalled.Store(true)
	procPostMessageW.Call(app.hwnd, round7WMInit, 0, 0)
	if round7MainEventHook != 0 {
		round7UnhookWinEvent.Call(round7MainEventHook)
		round7MainEventHook = 0
	}
	return 0
}

func round7MainSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	if app != nil && app.hwnd == hwnd {
		switch message {
		case round7WMInit:
			setText(app.hTrimCrop, "剪辑 / 画面")
			round7LayoutFooter(app)
			for _, control := range []uintptr{app.hFFStatus, app.hGPUStatus, app.hPotStatus, app.hConcurrencyStatus, app.hStart, app.hPause, app.hStop} {
				if control != 0 {
					procInvalidateRect.Call(control, 0, 1)
				}
			}
			return 0
		case WM_COMMAND:
			id := int(loWord(wParam))
			if id == IDC_TRIM_CROP || id == ID_CTX_TRIM {
				round7EditSelected(app)
				return 0
			}
		case WM_DRAWITEM:
			if lParam != 0 {
				dis := (*drawItemStruct)(unsafe.Pointer(lParam))
				if round7DrawStatusChip(app, dis) || round7DrawFooterButton(app, dis) {
					return 1
				}
			}
		case round7WMInitMenu:
			if wParam != 0 {
				round7ModifyMenu.Call(wParam, ID_CTX_TRIM, 0, ID_CTX_TRIM, uintptr(unsafe.Pointer(p("剪辑 / 画面..."))))
				round7ModifyMenu.Call(wParam, ID_CTX_COPY_TRIM_CROP, 0, ID_CTX_COPY_TRIM_CROP, uintptr(unsafe.Pointer(p("仅复制第一项的剪辑 / 画面设置"))))
			}
		}
	}

	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if app != nil && app.hwnd == hwnd {
		switch message {
		case WM_SIZE:
			round7LayoutFooter(app)
		case v452WMNCDestroy:
			v452RemoveSubclass.Call(hwnd, round7MainSubclassCB, subclassID)
		}
	}
	return result
}

func round7LayoutFooter(a *application) {
	if a == nil || a.hwnd == 0 || a.hStatusText == 0 || a.hStart == 0 || a.hPause == 0 || a.hStop == 0 {
		return
	}
	statusRect, ok := childClientRect(a.hStatusText, a.hwnd)
	if !ok {
		return
	}
	var client rect
	procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&client)))
	clientW := client.Right - client.Left
	if clientW <= 0 {
		return
	}
	margin := scaleDPI(8)
	gap := scaleDPI(8)
	startW := scaleDPI(132)
	pauseW := scaleDPI(118)
	stopW := scaleDPI(110)
	rowH := statusRect.Bottom - statusRect.Top
	if rowH < scaleDPI(34) {
		rowH = scaleDPI(36)
	}
	stopX := clientW - margin - stopW
	pauseX := stopX - gap - pauseW
	startX := pauseX - gap - startW
	statusW := startX - gap - margin
	if statusW < scaleDPI(220) {
		startW = scaleDPI(116)
		pauseW = scaleDPI(106)
		stopW = scaleDPI(100)
		stopX = clientW - margin - stopW
		pauseX = stopX - gap - pauseW
		startX = pauseX - gap - startW
		statusW = startX - gap - margin
	}
	if statusW < scaleDPI(120) {
		return
	}
	y := statusRect.Top
	procMoveWindow.Call(a.hStatusText, uintptr(margin), uintptr(y), uintptr(statusW), uintptr(rowH), 1)
	procMoveWindow.Call(a.hStart, uintptr(startX), uintptr(y), uintptr(startW), uintptr(rowH), 1)
	procMoveWindow.Call(a.hPause, uintptr(pauseX), uintptr(y), uintptr(pauseW), uintptr(rowH), 1)
	procMoveWindow.Call(a.hStop, uintptr(stopX), uintptr(y), uintptr(stopW), uintptr(rowH), 1)
}

func round7DrawStatusChip(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil {
		return false
	}
	if dis.HwndItem != a.hFFStatus && dis.HwndItem != a.hGPUStatus && dis.HwndItem != a.hPotStatus && dis.HwndItem != a.hConcurrencyStatus {
		return false
	}

	disabled := dis.ItemState&ODS_DISABLED != 0
	pressed := dis.ItemState&ODS_SELECTED != 0
	hover := a.hoverControl == dis.HwndItem
	back := colorRef(255, 255, 255)
	border := colorRef(235, 239, 244)
	if hover {
		back = colorRef(247, 250, 255)
		border = colorRef(207, 220, 238)
	}
	if pressed {
		back = colorRef(238, 244, 252)
	}
	if disabled {
		back = colorRef(247, 248, 250)
	}
	fillSolid(dis.HDC, dis.RcItem, back)
	drawRoundedBorder(dis.HDC, dis.RcItem, 4, border)

	ffmpeg, _, hardware, _, playerOK := a.componentSnapshot()
	lamp := colorRef(148, 158, 171)
	text := getText(dis.HwndItem)
	switch dis.HwndItem {
	case a.hFFStatus:
		text = "FFmpeg"
		if ffmpeg != "" {
			lamp = colorRef(24, 166, 86)
		} else {
			lamp = colorRef(205, 75, 62)
		}
	case a.hGPUStatus:
		text = "GPU"
		if hardware.Available {
			lamp = colorRef(225, 139, 22)
		}
	case a.hPotStatus:
		text = "PotPlayer"
		if playerOK {
			lamp = colorRef(79, 104, 210)
		}
	case a.hConcurrencyStatus:
		text = fmt.Sprintf("自动≤%d", config.NormalizeConcurrency(a.settings.Concurrency))
		lamp = colorRef(54, 113, 205)
	}
	if disabled {
		lamp = colorRef(174, 181, 190)
	}

	diameter := int(scaleDPI(15))
	if diameter < 12 {
		diameter = 12
	}
	lampX := int(dis.RcItem.Left + scaleDPI(7))
	lampY := int((dis.RcItem.Top+dis.RcItem.Bottom-int32(diameter))/2)
	round7DrawAALamp(dis.HDC, lampX, lampY, diameter, lamp, back)

	textRC := dis.RcItem
	textRC.Left = int32(lampX+diameter) + scaleDPI(7)
	textRC.Right -= scaleDPI(4)
	oldFont, _, _ := procSelectObject.Call(dis.HDC, uiFontSmall)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	textColor := colorRef(45, 55, 69)
	if disabled {
		textColor = colorRef(150, 157, 166)
	}
	procSetTextColor.Call(dis.HDC, textColor)
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	return true
}

func round7DrawFooterButton(a *application, dis *drawItemStruct) bool {
	if a == nil || dis == nil || (dis.HwndItem != a.hStart && dis.HwndItem != a.hPause && dis.HwndItem != a.hStop) {
		return false
	}
	disabled := dis.ItemState&ODS_DISABLED != 0
	pressed := dis.ItemState&ODS_SELECTED != 0
	back := colorRef(75, 122, 184)
	border := colorRef(55, 99, 160)
	if dis.HwndItem == a.hPause {
		back = colorRef(222, 139, 24)
		border = colorRef(190, 110, 12)
	} else if dis.HwndItem == a.hStop {
		back = colorRef(204, 66, 59)
		border = colorRef(175, 46, 41)
	}
	if pressed {
		back = round7BlendColor(back, colorRef(0, 0, 0), 0.12)
	}
	if disabled {
		back = colorRef(239, 242, 246)
		border = colorRef(207, 214, 223)
	}
	fillSolid(dis.HDC, dis.RcItem, back)
	drawRoundedBorder(dis.HDC, dis.RcItem, 5, border)

	iconColor := colorRef(255, 255, 255)
	textColor := colorRef(255, 255, 255)
	if disabled {
		iconColor = colorRef(132, 143, 156)
		textColor = colorRef(125, 136, 149)
	}
	iconCenterX := dis.RcItem.Left + scaleDPI(20)
	iconCenterY := (dis.RcItem.Top + dis.RcItem.Bottom) / 2
	switch dis.HwndItem {
	case a.hStart:
		// Right-facing triangle. The rejected build accidentally pointed left.
		points := [3]point{
			{X: iconCenterX - scaleDPI(4), Y: iconCenterY - scaleDPI(6)},
			{X: iconCenterX - scaleDPI(4), Y: iconCenterY + scaleDPI(6)},
			{X: iconCenterX + scaleDPI(6), Y: iconCenterY},
		}
		round7FillPolygon(dis.HDC, points[:], iconColor)
	case a.hPause:
		left := rect{Left: iconCenterX - scaleDPI(5), Top: iconCenterY - scaleDPI(6), Right: iconCenterX - scaleDPI(1), Bottom: iconCenterY + scaleDPI(6)}
		right := rect{Left: iconCenterX + scaleDPI(2), Top: iconCenterY - scaleDPI(6), Right: iconCenterX + scaleDPI(6), Bottom: iconCenterY + scaleDPI(6)}
		fillSolid(dis.HDC, left, iconColor)
		fillSolid(dis.HDC, right, iconColor)
	case a.hStop:
		square := rect{Left: iconCenterX - scaleDPI(5), Top: iconCenterY - scaleDPI(5), Right: iconCenterX + scaleDPI(5), Bottom: iconCenterY + scaleDPI(5)}
		fillSolid(dis.HDC, square, iconColor)
	}

	text := getText(dis.HwndItem)
	textRC := dis.RcItem
	textRC.Left += scaleDPI(34)
	textRC.Right -= scaleDPI(7)
	oldFont, _, _ := procSelectObject.Call(dis.HDC, uiFont)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	procSetTextColor.Call(dis.HDC, textColor)
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if oldFont != 0 {
		procSelectObject.Call(dis.HDC, oldFont)
	}
	return true
}

func round7FillPolygon(hdc uintptr, points []point, color uintptr) {
	if hdc == 0 || len(points) < 3 {
		return
	}
	brush, _, _ := procCreateSolidBrush.Call(color)
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	round7Polygon.Call(hdc, uintptr(unsafe.Pointer(&points[0])), uintptr(len(points)))
	procSelectObject.Call(hdc, oldPen)
	procSelectObject.Call(hdc, oldBrush)
	procDeleteObject.Call(pen)
	procDeleteObject.Call(brush)
}

func round7BlendColor(left, right uintptr, ratio float64) uintptr {
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	lr, lg, lb := float64(left&0xff), float64((left>>8)&0xff), float64((left>>16)&0xff)
	rr, rg, rb := float64(right&0xff), float64((right>>8)&0xff), float64((right>>16)&0xff)
	return colorRef(byte(lr+(rr-lr)*ratio), byte(lg+(rg-lg)*ratio), byte(lb+(rb-lb)*ratio))
}

func round7DrawAALamp(hdc uintptr, x, y, diameter int, lamp, back uintptr) {
	if hdc == 0 || diameter <= 0 {
		return
	}
	key := round7LampKey{Diameter: diameter, Lamp: lamp, Back: back}
	var pixels []byte
	if cached, ok := round7LampCache.Load(key); ok {
		pixels = cached.([]byte)
	} else {
		pixels = round7BuildLampPixels(diameter, lamp, back)
		round7LampCache.Store(key, pixels)
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

func round7BuildLampPixels(diameter int, lamp, back uintptr) []byte {
	if diameter <= 0 {
		return nil
	}
	pixels := make([]byte, diameter*diameter*4)
	lr, lg, lb := float64(lamp&0xff), float64((lamp>>8)&0xff), float64((lamp>>16)&0xff)
	br, bg, bb := float64(back&0xff), float64((back>>8)&0xff), float64((back>>16)&0xff)
	center := float64(diameter-1) / 2
	radius := float64(diameter)/2 - 0.65
	const samples = 4
	for py := 0; py < diameter; py++ {
		for px := 0; px < diameter; px++ {
			inside := 0
			for sy := 0; sy < samples; sy++ {
				for sx := 0; sx < samples; sx++ {
					x := float64(px) + (float64(sx)+0.5)/samples
					y := float64(py) + (float64(sy)+0.5)/samples
					dx, dy := x-(center+0.5), y-(center+0.5)
					if dx*dx+dy*dy <= radius*radius {
						inside++
					}
			}
			coverage := float64(inside) / float64(samples*samples)
			dx := (float64(px) - center) / radius
			dy := (float64(py) - center) / radius
			radial := math.Sqrt(dx*dx + dy*dy)
			shade := 0.84 + 0.18*math.Max(0, 1-radial)
			if radial > 0.78 {
				shade *= 0.78
			}
			hx, hy := dx+0.34, dy+0.34
			highlight := 0.23 * math.Exp(-(hx*hx+hy*hy)/0.075)
			r := math.Min(255, lr*shade+255*highlight)
			g := math.Min(255, lg*shade+255*highlight)
			b := math.Min(255, lb*shade+255*highlight)
			r = br + (r-br)*coverage
			g = bg + (g-bg)*coverage
			b = bb + (b-bb)*coverage
			offset := (py*diameter + px) * 4
			pixels[offset+0] = byte(math.Round(b))
			pixels[offset+1] = byte(math.Round(g))
			pixels[offset+2] = byte(math.Round(r))
			pixels[offset+3] = 255
		}
	}
	return pixels
}
