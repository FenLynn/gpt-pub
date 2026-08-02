from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAIN = ROOT / "cmd" / "mediaworkbench" / "main_windows.go"
RULES = ROOT / "cmd" / "mediaworkbench" / "ui_rules.go"
TESTS = ROOT / "cmd" / "mediaworkbench" / "ui_rules_test.go"
MANIFEST = ROOT / "SOURCE_FILES_SHA256.txt"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_regex(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


def patch_main() -> None:
    text = MAIN.read_text(encoding="utf-8")
    text = replace_once(text, 'const appVersion = "4.1.0"', 'const appVersion = "4.1.1"', "version")
    text = replace_once(text, 'if settings.UILayoutRevision < 410 {\n\t\tsettings.UILayoutRevision = 410', 'if settings.UILayoutRevision < 411 {\n\t\tsettings.UILayoutRevision = 411', "layout revision")
    text = replace_once(text, 'className := p("MediovaDesktop410")', 'className := p("MediovaDesktop411")', "window class")
    text = text.replace('iconFont = createUIFont("Segoe MDL2 Assets", -20, 400)', 'iconFont = createUIFont("Segoe MDL2 Assets", -18, 400)')

    toolbar = r'''func \(a \*application\) drawToolbarButton\(dis \*drawItemStruct\) bool \{.*?\n\}\n\nfunc \(a \*application\) secondaryButtonKind'''
    toolbar_replacement = r'''func (a *application) drawToolbarButton(dis *drawItemStruct) bool {
	if dis == nil {
		return false
	}
	icon, label, active, ok := a.toolbarButtonSpec(dis.HwndItem)
	if !ok {
		return false
	}
	pressed := dis.ItemState&ODS_SELECTED != 0
	disabled := dis.ItemState&ODS_DISABLED != 0
	hovered := a.hovered(dis.HwndItem)
	state := controlVisualState{Active: active, Hovered: hovered, Pressed: pressed, Disabled: disabled}
	treatment := toolbarSurfaceTreatment(state)

	canvas := colorRef(250, 251, 253)
	bg := canvas
	border := colorRef(242, 244, 247)
	iconColor := colorRef(48, 58, 72)
	textColor := colorRef(50, 60, 74)
	if treatment.Fill {
		bg = colorRef(241, 247, 254)
	}
	if treatment.Strength >= 2 {
		border = colorRef(151, 184, 222)
	}
	if treatment.Strength >= 3 {
		bg = colorRef(228, 240, 253)
		border = colorRef(102, 150, 207)
	}
	if active && !disabled {
		bg = colorRef(238, 246, 255)
		border = colorRef(112, 159, 216)
		iconColor = colorRef(22, 99, 186)
		textColor = colorRef(18, 88, 172)
	}
	if disabled {
		bg = canvas
		border = colorRef(246, 247, 249)
		iconColor = colorRef(171, 178, 188)
		textColor = colorRef(157, 164, 174)
	}

	rc := dis.RcItem
	fillSolid(dis.HDC, rc, canvas)
	inner := rect{Left: rc.Left + 2, Top: rc.Top + 2, Right: rc.Right - 2, Bottom: rc.Bottom - 2}
	if treatment.Fill {
		withRoundedClip(dis.HDC, inner, 4, func() { fillSolid(dis.HDC, inner, bg) })
	}
	if treatment.Border {
		drawRoundedBorder(dis.HDC, inner, 4, border)
	}
	if treatment.Accent {
		fillSolid(dis.HDC, rect{Left: inner.Left + 13, Top: inner.Bottom - 2, Right: inner.Right - 13, Bottom: inner.Bottom}, colorRef(37, 108, 201))
	}

	buttonW := rc.Right - rc.Left
	if buttonW < 54 {
		drawCenteredText(dis.HDC, icon, rc, iconFont, iconColor)
	} else {
		iconRC := rc
		iconRC.Top += 8
		iconRC.Bottom = iconRC.Top + 19
		drawCenteredText(dis.HDC, icon, iconRC, iconFont, iconColor)
		labelRC := rc
		labelRC.Top += 30
		labelRC.Bottom -= 5
		drawCenteredText(dis.HDC, label, labelRC, uiFontSmall, textColor)
	}
	return true
}

func (a *application) secondaryButtonKind'''
    text = replace_regex(text, toolbar, toolbar_replacement, "toolbar draw")

    secondary = r'''func \(a \*application\) drawSecondaryButton\(dis \*drawItemStruct\) bool \{.*?\n\}\n\nfunc colorParts'''
    secondary_replacement = r'''func (a *application) drawSecondaryButton(dis *drawItemStruct) bool {
	if dis == nil || dis.HwndItem == a.hStart || dis.HwndItem == a.hPause || dis.HwndItem == a.hStop {
		return false
	}
	label, ok := a.secondaryButtonKind(dis.HwndItem)
	if !ok {
		return false
	}
	pressed := dis.ItemState&ODS_SELECTED != 0
	disabled := dis.ItemState&ODS_DISABLED != 0
	hovered := a.hovered(dis.HwndItem)
	treatment := secondarySurfaceTreatment(controlVisualState{Hovered: hovered, Pressed: pressed, Disabled: disabled})
	canvas := colorRef(250, 251, 253)
	bg := canvas
	border := colorRef(238, 241, 245)
	textColor := colorRef(49, 59, 73)
	if treatment.Fill {
		bg = colorRef(241, 247, 254)
	}
	if treatment.Strength >= 2 {
		border = colorRef(153, 186, 222)
	}
	if treatment.Strength >= 3 {
		bg = colorRef(228, 240, 253)
		border = colorRef(111, 157, 211)
	}
	if disabled {
		bg = canvas
		border = colorRef(245, 246, 248)
		textColor = colorRef(166, 173, 183)
	}
	rc := dis.RcItem
	fillSolid(dis.HDC, rc, canvas)
	inner := rect{Left: rc.Left + 1, Top: rc.Top + 1, Right: rc.Right - 1, Bottom: rc.Bottom - 1}
	if treatment.Fill {
		withRoundedClip(dis.HDC, inner, 4, func() { fillSolid(dis.HDC, inner, bg) })
	}
	if treatment.Border {
		drawRoundedBorder(dis.HDC, inner, 4, border)
	}
	if dis.HwndItem == a.hRightToggle {
		drawChevron(dis.HDC, rc, !a.rightVisible, textColor)
		return true
	}
	glyph := secondaryButtonGlyph(dis.HwndItem)
	textRC := rc
	if glyph != "" && rc.Right-rc.Left >= 72 {
		iconRC := rc
		iconRC.Left += 7
		iconRC.Right = iconRC.Left + 19
		drawCenteredText(dis.HDC, glyph, iconRC, iconFont, textColor)
		textRC.Left += 19
	}
	drawCenteredText(dis.HDC, label, textRC, uiFontSmall, textColor)
	return true
}

func colorParts'''
    text = replace_regex(text, secondary, secondary_replacement, "secondary draw")

    overall = r'''func \(a \*application\) drawOverallProgress\(dis \*drawItemStruct\) bool \{.*?\n\}\n\nfunc \(a \*application\) drawDecoration'''
    overall_replacement = r'''func (a *application) drawOverallProgress(dis *drawItemStruct) bool {
	if dis == nil || dis.HwndItem != a.hProgress {
		return false
	}
	rc := dis.RcItem
	bar := rect{Left: rc.Left + 1, Top: rc.Top + 4, Right: rc.Right - 1, Bottom: rc.Bottom - 4}
	fraction := clamp01(a.overallProgress / 100)
	withRoundedClip(dis.HDC, bar, 4, func() {
		fillSolid(dis.HDC, bar, colorRef(248, 250, 252))
		if fraction > 0 {
			fill := bar
			fill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
			if fill.Right < fill.Left+4 {
				fill.Right = fill.Left + 4
			}
			if a.overallPaused {
				drawHorizontalGradient(dis.HDC, fill, colorRef(255, 229, 178), colorRef(225, 157, 43))
			} else {
				drawHorizontalGradient(dis.HDC, fill, colorRef(151, 196, 245), colorRef(58, 122, 214))
			}
		}
	})
	drawCenteredText(dis.HDC, a.overallText, bar, uiFontSmall, colorRef(42, 54, 70))
	return true
}

func (a *application) drawDecoration'''
    text = replace_regex(text, overall, overall_replacement, "overall progress")

    status = r'''func \(a \*application\) drawStatusChip\(dis \*drawItemStruct\) bool \{.*?\n\}\n\nfunc \(a \*application\) statusTextColor'''
    status_replacement = r'''func (a *application) drawStatusChip(dis *drawItemStruct) bool {
	if dis == nil {
		return false
	}
	var text string
	var dot uintptr
	switch dis.HwndItem {
	case a.hFFStatus:
		text = "FFmpeg"
		ffmpeg, _, _, _, _ := a.componentSnapshot()
		if ffmpeg != "" { dot = colorRef(26, 151, 78) } else { dot = colorRef(207, 73, 63) }
	case a.hGPUStatus:
		text = "GPU"
		_, _, hardware, _, _ := a.componentSnapshot()
		if hardware.Available { dot = colorRef(26, 151, 78) } else { dot = colorRef(211, 132, 26) }
	case a.hPotStatus:
		text = "PotPlayer"
		_, _, _, _, ok := a.componentSnapshot()
		if ok { dot = colorRef(26, 151, 78) } else { dot = colorRef(145, 154, 166) }
	case a.hConcurrencyStatus:
		text = a.concurrencyChipText()
		dot = colorRef(45, 112, 211)
	default:
		return false
	}
	rc := dis.RcItem
	pressed := dis.ItemState&ODS_SELECTED != 0
	hovered := a.hovered(dis.HwndItem)
	canvas := colorRef(250, 251, 253)
	fillSolid(dis.HDC, rc, canvas)
	if hovered || pressed {
		inner := rect{Left: rc.Left + 1, Top: rc.Top + 1, Right: rc.Right - 1, Bottom: rc.Bottom - 1}
		bg := colorRef(241, 247, 254)
		border := colorRef(157, 188, 223)
		if pressed { bg, border = colorRef(228, 240, 253), colorRef(112, 158, 212) }
		withRoundedClip(dis.HDC, inner, 4, func() { fillSolid(dis.HDC, inner, bg) })
		drawRoundedBorder(dis.HDC, inner, 4, border)
	}
	diameter := int32(11)
	dotLeft := rc.Left + 6
	dotTop := (rc.Top + rc.Bottom - diameter) / 2
	brush, _, _ := procCreateSolidBrush.Call(dot)
	oldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, dot)
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	procEllipse.Call(dis.HDC, uintptr(dotLeft), uintptr(dotTop), uintptr(dotLeft+diameter), uintptr(dotTop+diameter))
	procSelectObject.Call(dis.HDC, oldPen)
	procSelectObject.Call(dis.HDC, oldBrush)
	procDeleteObject.Call(pen)
	procDeleteObject.Call(brush)
	if rc.Right-rc.Left < 72 {
		switch dis.HwndItem {
		case a.hFFStatus: text = "FF"
		case a.hPotStatus: text = "Pot"
		case a.hConcurrencyStatus: text = fmt.Sprintf("并发%d", config.NormalizeConcurrency(a.settings.Concurrency))
		}
	}
	textRC := rc
	textRC.Left += 22
	textRC.Right -= 2
	old, _, _ := procSelectObject.Call(dis.HDC, uiFontSmall)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	procSetTextColor.Call(dis.HDC, colorRef(45, 55, 69))
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	if old != 0 { procSelectObject.Call(dis.HDC, old) }
	return true
}

func (a *application) statusTextColor'''
    text = replace_regex(text, status, status_replacement, "status chip")

    bars = r'''func fullCellBarRect\(rc rect\) rect \{.*?\n\}\n\nfunc taskStatusColor'''
    bars_replacement = r'''func fullCellBarRect(rc rect) rect {
	insets := listCellBarInsets()
	bar := rect{Left: rc.Left + insets.Horizontal, Top: rc.Top + insets.Vertical, Right: rc.Right - insets.Horizontal, Bottom: rc.Bottom - insets.Vertical}
	if bar.Bottom-bar.Top < insets.MinimumHeight {
		cy := (rc.Top + rc.Bottom) / 2
		bar.Top = cy - insets.MinimumHeight/2
		bar.Bottom = bar.Top + insets.MinimumHeight
	}
	return bar
}

func drawProgressPill(hdc uintptr, rc rect, fraction float64, label string, selected, active bool) {
	if selected {
		drawSelectedCell(hdc, rc, label, active)
		return
	}
	fraction = clamp01(fraction)
	bar := fullCellBarRect(rc)
	withRoundedClip(hdc, bar, 3, func() {
		fillSolid(hdc, bar, colorRef(250, 251, 253))
		if fraction > 0 {
			fill := bar
			fill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
			if fill.Right < fill.Left+3 { fill.Right = fill.Left + 3 }
			drawHorizontalGradient(hdc, fill, colorRef(169, 204, 243), colorRef(76, 138, 220))
		}
	})
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(39, 55, 78))
}

func compressionColorPair(visual compressionVisual) (uintptr, uintptr) {
	switch visual.Tone {
	case compressionYellow:
		return colorRef(255, 240, 188), colorRef(232, 181, 52)
	case compressionGreen:
		return mixColor(colorRef(220, 245, 228), colorRef(164, 222, 181), visual.Intensity),
			mixColor(colorRef(103, 190, 132), colorRef(30, 143, 76), visual.Intensity)
	case compressionRed:
		return mixColor(colorRef(255, 228, 224), colorRef(244, 178, 170), visual.Intensity),
			mixColor(colorRef(224, 91, 82), colorRef(182, 42, 38), visual.Intensity)
	default:
		return colorRef(248, 250, 252), colorRef(232, 236, 241)
	}
}

func drawCompressionPill(hdc uintptr, rc rect, task *model.Task, label string, selected, active bool) {
	if selected {
		drawSelectedCell(hdc, rc, label, active)
		return
	}
	bar := fullCellBarRect(rc)
	withRoundedClip(hdc, bar, 3, func() {
		if task == nil || task.InputSize <= 0 || task.OutputSize <= 0 {
			fillSolid(hdc, bar, colorRef(250, 251, 253))
			return
		}
		visual := compressionVisualFor(task.InputSize, task.OutputSize)
		split := bar.Left + int32(float64(bar.Right-bar.Left)*visual.InputFraction)
		if split <= bar.Left { split = bar.Left + 1 }
		if split >= bar.Right { split = bar.Right - 1 }
		left := bar
		left.Right = split
		right := bar
		right.Left = split
		fillSolid(hdc, left, colorRef(247, 249, 251))
		start, finish := compressionColorPair(visual)
		drawHorizontalGradient(hdc, right, start, finish)
	})
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(37, 52, 70))
}

func taskStatusColor'''
    text = replace_regex(text, bars, bars_replacement, "list bars")

    # Flat native themes for combo boxes. Keep Explorer on the search edit.
    text = text.replace('procSetWindowTheme.Call(a.hFilter, uintptr(unsafe.Pointer(p("Explorer"))), 0)', 'procSetWindowTheme.Call(a.hFilter, uintptr(unsafe.Pointer(p("CFD"))), 0)')
    text = text.replace('procSetWindowTheme.Call(a.hOutputEdit, uintptr(unsafe.Pointer(p("Explorer"))), 0)', 'procSetWindowTheme.Call(a.hOutputEdit, uintptr(unsafe.Pointer(p("CFD"))), 0)')
    text = text.replace('procSetWindowTheme.Call(h, uintptr(unsafe.Pointer(p("Explorer"))), 0)\n\t\tsend(h, WM_SETFONT, uiFontSmall, 1)', 'procSetWindowTheme.Call(h, uintptr(unsafe.Pointer(p("CFD"))), 0)\n\t\tsend(h, WM_SETFONT, uiFontSmall, 1)')

    text = replace_once(text, 'a.hVideo = createControl("BUTTON", "视频转换", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW|BS_DEFPUSHBUTTON, 8, 8, 86, 50', 'a.hVideo = createControl("BUTTON", "视频转换", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW|BS_DEFPUSHBUTTON, 8, 5, 86, 58', "video initial geometry")
    for label, old_x, width in [("图片压缩", 100, 86), ("添加文件", 194, 78), ("添加文件夹", 278, 88), ("移除", 372, 66), ("清空", 444, 66), ("全选", 516, 66), ("反选", 588, 66), ("源目录", 660, 76), ("输出目录", 742, 82)]:
        old = f'createControl("BUTTON", "{label}", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, {old_x}, 8, {width}, 50'
        new = f'createControl("BUTTON", "{label}", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, {old_x}, 5, {width}, 58'
        text = replace_once(text, old, new, f"{label} initial geometry")

    text = replace_once(text, 'return topBand{[]int32{92, 92, 84, 94, 66, 66, 66, 66, 80, 86}, 7, 290, 122, 206, 24}', 'return topBand{[]int32{92, 92, 84, 94, 66, 66, 66, 66, 80, 86}, 8, 282, 122, 206, 24}', "wide top band")
    text = replace_once(text, 'return topBand{[]int32{82, 82, 72, 80, 58, 58, 58, 58, 68, 72}, 6, 210, 104, 184, 24}', 'return topBand{[]int32{82, 82, 72, 80, 58, 58, 58, 58, 68, 72}, 7, 202, 104, 184, 24}', "medium top band")
    text = replace_once(text, 'return topBand{[]int32{66, 66, 56, 60, 48, 48, 48, 48, 54, 56}, 4, 160, 96, 168, 23}', 'return topBand{[]int32{66, 66, 56, 60, 48, 48, 48, 48, 54, 56}, 5, 152, 96, 168, 23}', "small top band")
    text = replace_once(text, 'return topBand{[]int32{48, 48, 42, 42, 40, 40, 40, 40, 42, 42}, 2, 120, 82, 142, 22}', 'return topBand{[]int32{48, 48, 42, 42, 40, 40, 40, 40, 42, 42}, 3, 112, 82, 142, 22}', "compact top band")
    text = replace_once(text, 'move(control, xTool, 7, band.toolWidths[i], 54)', 'move(control, xTool, 5, band.toolWidths[i], 58)', "toolbar layout geometry")
    text = replace_once(text, 'move(a.hToolbarDivider, xTool, 15, 1, 38)', 'move(a.hToolbarDivider, xTool, 14, 1, 40)', "toolbar divider")
    text = replace_once(text, 'toggleW := int32(26)\n\tif w < 1120 {\n\t\ttoggleW = 24\n\t}\n\ttoggleX := w - 8 - toggleW\n\tmove(a.hRightToggle, toggleX, 18, toggleW, 30)', 'toggleW := int32(22)\n\tif w < 1120 {\n\t\ttoggleW = 20\n\t}\n\ttoggleX := w - 8 - toggleW\n\tmove(a.hRightToggle, toggleX, 19, toggleW, 28)', "toggle geometry")

    text = replace_once(text, '\tcompactBottom := w < 1320\n', '\tcompactBottom := w < 1320\n\tbottomWidths := bottomParameterWidths()\n', "bottom width rules")
    text = text.replace('{{a.globalLabels[0], a.hResolution, 92}, {a.globalLabels[1], a.hCodec, 82}, {a.globalLabels[2], a.hQuality, 68}, {a.globalLabels[3], a.hVolume, 122}, {a.globalLabels[4], a.hRotation, 100}}', '{{a.globalLabels[0], a.hResolution, bottomWidths.Resolution}, {a.globalLabels[1], a.hCodec, bottomWidths.Codec}, {a.globalLabels[2], a.hQuality, bottomWidths.Quality}, {a.globalLabels[3], a.hVolume, bottomWidths.Volume}, {a.globalLabels[4], a.hRotation, bottomWidths.Rotation}}')
    text = text.replace('{{a.globalLabels[0], a.hResolution, 38, 92}, {a.globalLabels[1], a.hCodec, 34, 82}, {a.globalLabels[2], a.hQuality, 34, 68}, {a.globalLabels[3], a.hVolume, 34, 132}, {a.globalLabels[4], a.hRotation, 34, 104}}', '{{a.globalLabels[0], a.hResolution, 38, bottomWidths.Resolution}, {a.globalLabels[1], a.hCodec, 34, bottomWidths.Codec}, {a.globalLabels[2], a.hQuality, 34, bottomWidths.Quality}, {a.globalLabels[3], a.hVolume, 34, bottomWidths.Volume}, {a.globalLabels[4], a.hRotation, 34, bottomWidths.Rotation}}')
    text = replace_once(text, 'fixed := int32(38 + 92 + 7 + 34 + 82 + 7 + 34 + 68 + 7 + 34 + 132 + 7 + 34 + 104 + 8 + 122 + 8 + 146)', 'fixed := int32(38+bottomWidths.Resolution + 7 + 34+bottomWidths.Codec + 7 + 34+bottomWidths.Quality + 7 + 34+bottomWidths.Volume + 7 + 34+bottomWidths.Rotation + 8 + 122 + 8 + 146)', "bottom fixed width")

    # Initial widths use the same v4.1.1 width baseline before the first layout pass.
    text = replace_once(text, 'a.hResolution = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 760, 730, 96, 220', 'a.hResolution = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 760, 730, 84, 220', "resolution initial width")
    text = replace_once(text, 'a.hCodec = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 862, 730, 92, 180', 'a.hCodec = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 862, 730, 78, 180', "codec initial width")
    text = replace_once(text, 'a.hQuality = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 960, 730, 68, 180', 'a.hQuality = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 960, 730, 72, 180', "quality initial width")
    text = replace_once(text, 'a.hVolume = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1034, 730, 132, 240', 'a.hVolume = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1034, 730, 126, 240', "volume initial width")
    text = replace_once(text, 'a.hRotation = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1172, 730, 108, 260', 'a.hRotation = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1172, 730, 98, 260', "rotation initial width")

    MAIN.write_text(text, encoding="utf-8", newline="\n")


def patch_rules() -> None:
    text = RULES.read_text(encoding="utf-8")
    addition = r'''

type controlVisualState struct {
	Active   bool
	Hovered  bool
	Pressed  bool
	Disabled bool
}

type surfaceTreatment struct {
	Fill     bool
	Border   bool
	Accent   bool
	Strength int
}

// Default toolbar controls are transparent and separated only by a very faint
// line. The surface becomes visible on hover/press, while the selected mode
// keeps a restrained accent. This prevents the toolbar becoming a row of cards.
func toolbarSurfaceTreatment(state controlVisualState) surfaceTreatment {
	if state.Disabled {
		return surfaceTreatment{Border: true}
	}
	if state.Pressed {
		return surfaceTreatment{Fill: true, Border: true, Accent: state.Active, Strength: 3}
	}
	if state.Active {
		return surfaceTreatment{Fill: true, Border: true, Accent: true, Strength: 2}
	}
	if state.Hovered {
		return surfaceTreatment{Fill: true, Border: true, Strength: 2}
	}
	return surfaceTreatment{Border: true, Strength: 1}
}

func secondarySurfaceTreatment(state controlVisualState) surfaceTreatment {
	if state.Disabled {
		return surfaceTreatment{Border: true}
	}
	if state.Pressed {
		return surfaceTreatment{Fill: true, Border: true, Strength: 3}
	}
	if state.Hovered {
		return surfaceTreatment{Fill: true, Border: true, Strength: 2}
	}
	return surfaceTreatment{Border: true, Strength: 1}
}

type parameterWidthSet struct {
	Resolution int32
	Codec      int32
	Quality    int32
	Volume     int32
	Rotation   int32
}

func bottomParameterWidths() parameterWidthSet {
	return parameterWidthSet{Resolution: 84, Codec: 78, Quality: 72, Volume: 126, Rotation: 98}
}

type cellBarInsetSet struct {
	Horizontal    int32
	Vertical      int32
	MinimumHeight int32
}

func listCellBarInsets() cellBarInsetSet {
	return cellBarInsetSet{Horizontal: 1, Vertical: 5, MinimumHeight: 14}
}
'''
    if "type controlVisualState struct" in text:
        raise RuntimeError("ui rules already patched")
    RULES.write_text(text.rstrip() + addition + "\n", encoding="utf-8", newline="\n")


def patch_tests() -> None:
    text = TESTS.read_text(encoding="utf-8")
    addition = r'''

func TestToolbarDefaultIsTransparentAndHoverIsVisible(t *testing.T) {
	base := toolbarSurfaceTreatment(controlVisualState{})
	if base.Fill || !base.Border || base.Strength != 1 {
		t.Fatalf("default treatment=%+v", base)
	}
	hover := toolbarSurfaceTreatment(controlVisualState{Hovered: true})
	if !hover.Fill || !hover.Border || hover.Strength <= base.Strength {
		t.Fatalf("hover treatment=%+v base=%+v", hover, base)
	}
	active := toolbarSurfaceTreatment(controlVisualState{Active: true})
	if !active.Fill || !active.Accent || active.Strength < 2 {
		t.Fatalf("active treatment=%+v", active)
	}
}

func TestSecondaryDefaultIsTransparent(t *testing.T) {
	base := secondarySurfaceTreatment(controlVisualState{})
	if base.Fill || !base.Border || base.Strength != 1 {
		t.Fatalf("default treatment=%+v", base)
	}
	pressed := secondarySurfaceTreatment(controlVisualState{Pressed: true})
	if !pressed.Fill || pressed.Strength < 3 {
		t.Fatalf("pressed treatment=%+v", pressed)
	}
}

func TestBottomParameterWidthsArePurposeSized(t *testing.T) {
	w := bottomParameterWidths()
	if w.Resolution >= w.Volume || w.Quality <= 68 || w.Codec >= w.Rotation {
		t.Fatalf("unexpected widths=%+v", w)
	}
	if w.Volume > 132 || w.Rotation > 104 || w.Resolution > 88 {
		t.Fatalf("controls remain over-wide: %+v", w)
	}
}

func TestListCellBarUsesFullWidthWithFivePixelVerticalInset(t *testing.T) {
	insets := listCellBarInsets()
	if insets.Horizontal > 1 || insets.Vertical != 5 || insets.MinimumHeight != 14 {
		t.Fatalf("unexpected insets=%+v", insets)
	}
}
'''
    if "TestToolbarDefaultIsTransparentAndHoverIsVisible" in text:
        raise RuntimeError("ui tests already patched")
    TESTS.write_text(text.rstrip() + addition + "\n", encoding="utf-8", newline="\n")


def refresh_manifest() -> None:
    lines: list[str] = []
    for raw in MANIFEST.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        _, rel = raw.split("  ", 1)
        path = ROOT / rel
        if not path.is_file():
            raise RuntimeError(f"manifest source missing: {rel}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {rel}")
    MANIFEST.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    patch_main()
    patch_rules()
    patch_tests()
    refresh_manifest()
    print("Mediova v4.1.1 UI patch applied successfully")
