//go:build windows

package main

const (
	round12CDDSItemPostPaint   = 0x00010002
	round12CDRFNotifyPostPaint = 0x00000010
)

var round12HeaderTopSeparator = colorRef(207, 214, 223)

// round12DrawHeaderItemTop keeps the native Header in charge of captions,
// hover/pressed feedback, column resizing and hit testing. Round12 only owns
// the one-pixel top edge after the native item paint has finished. This avoids
// the native pressed bevel erasing the top edge of whichever column is active.
func round12DrawHeaderItemTop(cd *nmCustomDraw) uintptr {
	if cd == nil {
		return CDRF_DODEFAULT
	}
	switch cd.DrawStage {
	case CDDS_PREPAINT:
		return CDRF_NOTIFYITEMDRAW
	case CDDS_ITEMPREPAINT:
		return round12CDRFNotifyPostPaint
	case round12CDDSItemPostPaint:
		cell := cd.Rc
		if cd.HDC != 0 && cell.Right > cell.Left && cell.Bottom > cell.Top {
			fillSolid(cd.HDC, rect{
				Left:   cell.Left,
				Top:    cell.Top,
				Right:  cell.Right,
				Bottom: cell.Top + 1,
			}, round12HeaderTopSeparator)
		}
	}
	return CDRF_DODEFAULT
}
