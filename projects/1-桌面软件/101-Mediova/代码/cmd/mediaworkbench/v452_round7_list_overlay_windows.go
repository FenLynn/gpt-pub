//go:build windows

package main

const (
	round7LVMGetColumnWidth = 0x101D
	round7WMPrint           = 0x0317
	round7WMPrintClient     = 0x0318
)

var (
	round7ListGetDC      = user32.NewProc("GetDC")
	round7ListReleaseDC  = user32.NewProc("ReleaseDC")
	round7ImageListDraw  = comctl32.NewProc("ImageList_Draw")
	round7ImageListCount = comctl32.NewProc("ImageList_GetImageCount")
)

// round7DrawListOverlay is retained only because the final list subclass still
// calls the inherited hook. Round 12 moved all cell painting into the native
// NM_CUSTOMDRAW path; drawing here would repaint selected rows after custom
// draw and recreate mixed blue/white selection surfaces.
func round7DrawListOverlay(a *application, hdc uintptr) {}
