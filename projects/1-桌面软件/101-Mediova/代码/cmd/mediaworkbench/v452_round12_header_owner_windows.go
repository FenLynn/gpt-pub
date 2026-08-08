//go:build windows

package main

import "unsafe"

const round12CDISHot = 0x0040

var (
	round12HeaderTopSeparator   = colorRef(207, 214, 223)
	round12HeaderBackground     = colorRef(245, 246, 248)
	round12HeaderHotBackground  = colorRef(248, 250, 252)
	round12HeaderDownBackground = colorRef(231, 243, 255)
	round12HeaderText           = colorRef(28, 39, 52)
)

// round12DrawHeaderItemTop keeps the native Header in charge of hit testing,
// column resizing and click/sort notifications, while Round12 owns the final
// item pixels. Native pressed bevels used to replace the whole top edge of the
// active column; drawing the item ourselves makes all states share one border
// geometry without changing Header interaction semantics.
func round12DrawHeaderItemTop(cd *nmCustomDraw) uintptr {
	if cd == nil {
		return CDRF_DODEFAULT
	}
	switch cd.DrawStage {
	case CDDS_PREPAINT:
		return CDRF_NOTIFYITEMDRAW
	case CDDS_ITEMPREPAINT:
		cell := cd.Rc
		if cd.HDC == 0 || cell.Right <= cell.Left || cell.Bottom <= cell.Top {
			return CDRF_SKIPDEFAULT
		}

		background := round12HeaderBackground
		if cd.ItemState&CDIS_SELECTED != 0 {
			background = round12HeaderDownBackground
		} else if cd.ItemState&round12CDISHot != 0 {
			background = round12HeaderHotBackground
		}
		fillSolid(cd.HDC, cell, background)

		fillSolid(cd.HDC, rect{
			Left: cell.Left, Top: cell.Top,
			Right: cell.Right, Bottom: cell.Top + 1,
		}, round12HeaderTopSeparator)
		fillSolid(cd.HDC, rect{
			Left: cell.Right - 1, Top: cell.Top + 1,
			Right: cell.Right, Bottom: cell.Bottom,
		}, round12HeaderTopSeparator)

		index := int(cd.ItemSpec)
		if index >= 0 && index < len(round12Columns) {
			textRect := cell
			textRect.Left += scaleDPI(8)
			textRect.Right -= scaleDPI(5)
			old, _, _ := procSelectObject.Call(cd.HDC, uiFontBold)
			procSetBkMode.Call(cd.HDC, TRANSPARENT)
			procSetTextColor.Call(cd.HDC, round12HeaderText)
			label := round12Columns[index].name
			procDrawTextW.Call(
				cd.HDC,
				uintptr(unsafe.Pointer(p(label))),
				^uintptr(0),
				uintptr(unsafe.Pointer(&textRect)),
				DT_LEFT|DT_VCENTER|DT_SINGLELINE,
			)
			if old != 0 {
				procSelectObject.Call(cd.HDC, old)
			}
		}
		return CDRF_SKIPDEFAULT
	}
	return CDRF_DODEFAULT
}
