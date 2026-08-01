//go:build windows

package main

import (
	"syscall"
	"unicode/utf16"
	"unsafe"
)

const (
	WM_CREATE                    = 0x0001
	WM_DESTROY                   = 0x0002
	WM_SIZE                      = 0x0005
	WM_GETMINMAXINFO             = 0x0024
	WM_DPICHANGED                = 0x02E0
	WM_SETFOCUS                  = 0x0007
	WM_CLOSE                     = 0x0010
	WM_COMMAND                   = 0x0111
	WM_KEYDOWN                   = 0x0100
	WM_TIMER                     = 0x0113
	WM_NCHITTEST                 = 0x0084
	WM_HSCROLL                   = 0x0114
	WM_NOTIFY                    = 0x004E
	WM_SETFONT                   = 0x0030
	WM_SETREDRAW                 = 0x000B
	WM_DROPFILES                 = 0x0233
	WM_CONTEXTMENU               = 0x007B
	WM_USER                      = 0x0400
	WM_APP                       = 0x8000
	WM_SETICON                   = 0x0080
	WM_SHOWWINDOW                = 0x0018
	WM_APP_REFRESH               = WM_APP + 1
	WM_APP_ROW                   = WM_APP + 2
	WM_APP_DONE                  = WM_APP + 3
	WM_APP_PROBE                 = WM_APP + 4
	WM_APP_TRAY                  = WM_APP + 5
	WM_APP_STATUS                = WM_APP + 6
	WM_APP_UI                    = WM_APP + 7
	WM_APP_SELFTEST              = WM_APP + 8
	WM_LBUTTONDOWN               = 0x0201
	WM_LBUTTONUP                 = 0x0202
	WM_MOUSEMOVE                 = 0x0200
	WM_PAINT                     = 0x000F
	WM_ERASEBKGND                = 0x0014
	WM_DRAWITEM                  = 0x002B
	WM_CTLCOLOREDIT              = 0x0133
	WM_CTLCOLORSTATIC            = 0x0138
	SW_SHOW                      = 5
	SW_HIDE                      = 0
	SW_RESTORE                   = 9
	SW_SHOWNOACTIVATE            = 4
	WS_OVERLAPPEDWINDOW          = 0x00CF0000
	WS_POPUP                     = 0x80000000
	WS_VISIBLE                   = 0x10000000
	WS_CHILD                     = 0x40000000
	WS_TABSTOP                   = 0x00010000
	WS_BORDER                    = 0x00800000
	WS_VSCROLL                   = 0x00200000
	WS_HSCROLL                   = 0x00100000
	WS_CLIPCHILDREN              = 0x02000000
	WS_EX_CLIENTEDGE             = 0x00000200
	WS_EX_DLGMODALFRAME          = 0x00000001
	WS_EX_TOOLWINDOW             = 0x00000080
	WS_EX_TOPMOST                = 0x00000008
	WS_EX_NOACTIVATE             = 0x08000000
	BS_PUSHBUTTON                = 0
	BS_AUTOCHECKBOX              = 3
	BS_DEFPUSHBUTTON             = 1
	BS_OWNERDRAW                 = 0xB
	ODS_SELECTED                 = 0x0001
	ODS_DISABLED                 = 0x0004
	SS_LEFT                      = 0
	SS_CENTER                    = 1
	SS_NOTIFY                    = 0x100
	SS_BITMAP                    = 0x000E
	SS_OWNERDRAW                 = 0x000D
	ES_AUTOHSCROLL               = 0x0080
	ES_MULTILINE                 = 0x0004
	ES_AUTOVSCROLL               = 0x0040
	ES_READONLY                  = 0x0800
	ES_NUMBER                    = 0x2000
	CBS_DROPDOWNLIST             = 3
	LVS_REPORT                   = 1
	LVS_SHOWSELALWAYS            = 8
	LVS_SINGLESEL                = 4
	LVS_EX_FULLROWSELECT         = 0x20
	LVS_EX_GRIDLINES             = 1
	LVS_EX_DOUBLEBUFFER          = 0x10000
	LVS_EX_INFOTIP               = 0x400
	LVM_FIRST                    = 0x1000
	LVM_SETBKCOLOR               = LVM_FIRST + 1
	LVM_INSERTCOLUMNW            = LVM_FIRST + 97
	LVM_INSERTITEMW              = LVM_FIRST + 77
	LVM_GETITEMW                 = LVM_FIRST + 75
	LVM_SETITEMW                 = LVM_FIRST + 76
	LVM_SETITEMTEXTW             = LVM_FIRST + 116
	LVM_DELETEALLITEMS           = LVM_FIRST + 9
	LVM_GETNEXTITEM              = LVM_FIRST + 12
	LVM_SETITEMSTATE             = LVM_FIRST + 43
	LVM_SETEXTENDEDLISTVIEWSTYLE = LVM_FIRST + 54
	LVM_SETIMAGELIST             = LVM_FIRST + 3
	LVM_GETITEMCOUNT             = LVM_FIRST + 4
	LVM_GETITEMRECT              = LVM_FIRST + 14
	LVM_GETHEADER                = LVM_FIRST + 31
	LVM_GETITEMSTATE             = LVM_FIRST + 44
	LVM_GETSUBITEMRECT           = LVM_FIRST + 56
	LVM_GETCOLUMNWIDTH           = LVM_FIRST + 29
	LVM_SETCOLUMNWIDTH           = LVM_FIRST + 30
	LVM_SETTEXTCOLOR             = LVM_FIRST + 36
	LVM_SETTEXTBKCOLOR           = LVM_FIRST + 38
	LVM_ENSUREVISIBLE            = LVM_FIRST + 19
	LVM_REDRAWITEMS              = LVM_FIRST + 21
	LVIF_TEXT                    = 1
	LVIF_IMAGE                   = 2
	LVSIL_SMALL                  = 1
	LVIR_BOUNDS                  = 0
	ILC_MASK                     = 0x0001
	ILC_COLOR32                  = 0x0020
	LVCF_FMT                     = 1
	LVCF_WIDTH                   = 2
	LVCF_TEXT                    = 4
	LVCFMT_LEFT                  = 0
	LVNI_SELECTED                = 2
	LVIS_SELECTED                = 2
	LVIS_FOCUSED                 = 1
	NM_FIRST                     = ^uint32(0) - 0
	NM_DBLCLK                    = ^uint32(2) - 0
	NM_RCLICK                    = ^uint32(4) - 0
	NM_CUSTOMDRAW                = ^uint32(11) - 0
	CDDS_PREPAINT                = 0x00000001
	CDDS_ITEMPREPAINT            = 0x00010001
	CDDS_SUBITEM                 = 0x00020000
	CDRF_DODEFAULT               = 0x00000000
	CDRF_SKIPDEFAULT             = 0x00000004
	CDRF_NOTIFYITEMDRAW          = 0x00000020
	CDRF_NOTIFYSUBITEMDRAW       = 0x00000020
	CDIS_SELECTED                = 0x0001
	LVN_FIRST                    = ^uint32(99) - 0
	LVN_ITEMCHANGED              = LVN_FIRST - 1
	LVN_COLUMNCLICK              = LVN_FIRST - 8
	PBM_SETRANGE32               = 0x0406
	PBM_SETBARCOLOR              = WM_USER + 9
	PBM_SETBKCOLOR               = 0x2001
	PBM_SETPOS                   = 0x0402
	PBM_SETSTATE                 = 0x0410
	PBST_NORMAL                  = 1
	PBST_ERROR                   = 2
	PBST_PAUSED                  = 3
	TBM_GETPOS                   = WM_USER
	TBM_SETRANGE                 = WM_USER + 6
	TBM_SETPOS                   = WM_USER + 5
	TBM_SETTICFREQ               = WM_USER + 20
	CB_ADDSTRING                 = 0x0143
	CB_GETCURSEL                 = 0x0147
	CB_SETCURSEL                 = 0x014E
	CB_GETLBTEXT                 = 0x0148
	CB_RESETCONTENT              = 0x014B
	EM_SETCUEBANNER              = 0x1501
	EM_SETMARGINS                = 0x00D3
	EC_LEFTMARGIN                = 0x0001
	EC_RIGHTMARGIN               = 0x0002
	VK_BACK                      = 0x08
	VK_RETURN                    = 0x0D
	VK_ESCAPE                    = 0x1B
	VK_SPACE                     = 0x20
	VK_DELETE                    = 0x2E
	VK_CONTROL                   = 0x11
	VK_SHIFT                     = 0x10
	BM_GETCHECK                  = 0x00F0
	BM_SETCHECK                  = 0x00F1
	BST_CHECKED                  = 1
	OFN_EXPLORER                 = 0x00080000
	OFN_FILEMUSTEXIST            = 0x00001000
	OFN_PATHMUSTEXIST            = 0x00000800
	OFN_ALLOWMULTISELECT         = 0x00000200
	OFN_HIDEREADONLY             = 4
	BIF_RETURNONLYFSDIRS         = 1
	BIF_NEWDIALOGSTYLE           = 0x40
	FOS_PICKFOLDERS              = 0x00000020
	FOS_FORCEFILESYSTEM          = 0x00000040
	FOS_PATHMUSTEXIST            = 0x00000800
	FOS_DONTADDTORECENT          = 0x02000000
	SIGDN_FILESYSPATH            = 0x80058000
	COINIT_APARTMENTTHREADED     = 0x2
	COINIT_DISABLE_OLE1DDE       = 0x4
	MB_OK                        = 0
	MB_OKCANCEL                  = 1
	MB_YESNO                     = 4
	MB_ICONINFORMATION           = 0x40
	MB_ICONERROR                 = 0x10
	MB_ICONQUESTION              = 0x20
	MB_ICONWARNING               = 0x30
	IDYES                        = 6
	IDOK                         = 1
	COLOR_WINDOW                 = 5
	COLOR_HIGHLIGHT              = 13
	COLOR_HIGHLIGHTTEXT          = 14
	COLOR_BTNFACE                = 15
	DEFAULT_GUI_FONT             = 17
	MF_STRING                    = 0
	MF_POPUP                     = 0x10
	MF_SEPARATOR                 = 0x800
	MF_CHECKED                   = 8
	MF_GRAYED                    = 1
	MF_BYCOMMAND                 = 0
	TPM_RIGHTBUTTON              = 2
	TPM_RETURNCMD                = 0x100
	TPM_NONOTIFY                 = 0x80
	NIM_ADD                      = 0
	NIM_MODIFY                   = 1
	NIM_DELETE                   = 2
	NIM_SETVERSION               = 4
	NOTIFYICON_VERSION_4         = 4
	NIF_MESSAGE                  = 1
	NIF_ICON                     = 2
	NIF_TIP                      = 4
	NIF_INFO                     = 0x10
	NIIF_INFO                    = 1
	IMAGE_BITMAP                 = 0
	IMAGE_ICON                   = 1
	LR_LOADFROMFILE              = 0x10
	LR_CREATEDIBSECTION          = 0x2000
	SRCCOPY                      = 0x00CC0020
	COLORONCOLOR                 = 3
	HALFTONE                     = 4
	PS_SOLID                     = 0
	NULL_BRUSH                   = 5
	TRANSPARENT                  = 1
	DT_LEFT                      = 0x00000000
	DT_CENTER                    = 0x00000001
	DT_VCENTER                   = 0x00000004
	DT_SINGLELINE                = 0x00000020
	CF_UNICODETEXT               = 13
	GMEM_MOVEABLE                = 0x0002
	LR_DEFAULTSIZE               = 0x40
	ICON_SMALL                   = 0
	ICON_BIG                     = 1
	HTCAPTION                    = 2
	SPI_GETWORKAREA              = 0x0030
	SWP_NOSIZE                   = 0x0001
	SWP_NOMOVE                   = 0x0002
	SWP_NOZORDER                 = 0x0004
	SWP_NOACTIVATE               = 0x0010
	RDW_INVALIDATE               = 0x0001
	RDW_ERASE                    = 0x0004
	RDW_ALLCHILDREN              = 0x0080
	RDW_UPDATENOW                = 0x0100
	HWND_TOPMOST                 = ^uintptr(0)
)

const (
	TIMER_SELF_TEST uintptr = 0x3520
)

var (
	user32                            = syscall.NewLazyDLL("user32.dll")
	kernel32                          = syscall.NewLazyDLL("kernel32.dll")
	comctl32                          = syscall.NewLazyDLL("comctl32.dll")
	comdlg32                          = syscall.NewLazyDLL("comdlg32.dll")
	shell32                           = syscall.NewLazyDLL("shell32.dll")
	ole32                             = syscall.NewLazyDLL("ole32.dll")
	gdi32                             = syscall.NewLazyDLL("gdi32.dll")
	uxtheme                           = syscall.NewLazyDLL("uxtheme.dll")
	procRegisterClassExW              = user32.NewProc("RegisterClassExW")
	procCreateWindowExW               = user32.NewProc("CreateWindowExW")
	procDefWindowProcW                = user32.NewProc("DefWindowProcW")
	procShowWindow                    = user32.NewProc("ShowWindow")
	procUpdateWindow                  = user32.NewProc("UpdateWindow")
	procGetMessageW                   = user32.NewProc("GetMessageW")
	procTranslateMessage              = user32.NewProc("TranslateMessage")
	procDispatchMessageW              = user32.NewProc("DispatchMessageW")
	procPostQuitMessage               = user32.NewProc("PostQuitMessage")
	procDestroyWindow                 = user32.NewProc("DestroyWindow")
	procMoveWindow                    = user32.NewProc("MoveWindow")
	procSendMessageW                  = user32.NewProc("SendMessageW")
	procPostMessageW                  = user32.NewProc("PostMessageW")
	procSetWindowTextW                = user32.NewProc("SetWindowTextW")
	procGetWindowTextW                = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW          = user32.NewProc("GetWindowTextLengthW")
	procEnableWindow                  = user32.NewProc("EnableWindow")
	procMessageBoxW                   = user32.NewProc("MessageBoxW")
	procLoadCursorW                   = user32.NewProc("LoadCursorW")
	procLoadIconW                     = user32.NewProc("LoadIconW")
	procRegisterWindowMessageW        = user32.NewProc("RegisterWindowMessageW")
	procSetProcessDpiAwarenessContext = user32.NewProc("SetProcessDpiAwarenessContext")
	procGetDpiForSystem               = user32.NewProc("GetDpiForSystem")
	procGetDpiForWindow               = user32.NewProc("GetDpiForWindow")
	procCreateMenu                    = user32.NewProc("CreateMenu")
	procCreatePopupMenu               = user32.NewProc("CreatePopupMenu")
	procAppendMenuW                   = user32.NewProc("AppendMenuW")
	procSetMenu                       = user32.NewProc("SetMenu")
	procDrawMenuBar                   = user32.NewProc("DrawMenuBar")
	procTrackPopupMenu                = user32.NewProc("TrackPopupMenu")
	procGetCursorPos                  = user32.NewProc("GetCursorPos")
	procSetForegroundWindow           = user32.NewProc("SetForegroundWindow")
	procSetWindowPos                  = user32.NewProc("SetWindowPos")
	procDrawTextW                     = user32.NewProc("DrawTextW")
	procFrameRect                     = user32.NewProc("FrameRect")
	procGetSysColorBrush              = user32.NewProc("GetSysColorBrush")
	procGetSysColor                   = user32.NewProc("GetSysColor")
	procSystemParametersInfoW         = user32.NewProc("SystemParametersInfoW")
	procSetTimer                      = user32.NewProc("SetTimer")
	procKillTimer                     = user32.NewProc("KillTimer")
	procIsWindowVisible               = user32.NewProc("IsWindowVisible")
	procLoadImageW                    = user32.NewProc("LoadImageW")
	procBeginPaint                    = user32.NewProc("BeginPaint")
	procEndPaint                      = user32.NewProc("EndPaint")
	procInvalidateRect                = user32.NewProc("InvalidateRect")
	procRedrawWindow                  = user32.NewProc("RedrawWindow")
	procFillRect                      = user32.NewProc("FillRect")
	procGetClientRect                 = user32.NewProc("GetClientRect")
	procGetWindowRect                 = user32.NewProc("GetWindowRect")
	procMapWindowPoints               = user32.NewProc("MapWindowPoints")
	procSetFocus                      = user32.NewProc("SetFocus")
	procGetFocus                      = user32.NewProc("GetFocus")
	procGetKeyState                   = user32.NewProc("GetKeyState")
	procSetCapture                    = user32.NewProc("SetCapture")
	procReleaseCapture                = user32.NewProc("ReleaseCapture")
	procIsWindow                      = user32.NewProc("IsWindow")
	procOpenClipboard                 = user32.NewProc("OpenClipboard")
	procEmptyClipboard                = user32.NewProc("EmptyClipboard")
	procSetClipboardData              = user32.NewProc("SetClipboardData")
	procCloseClipboard                = user32.NewProc("CloseClipboard")
	procGetModuleHandleW              = kernel32.NewProc("GetModuleHandleW")
	procGlobalAlloc                   = kernel32.NewProc("GlobalAlloc")
	procGlobalLock                    = kernel32.NewProc("GlobalLock")
	procGlobalUnlock                  = kernel32.NewProc("GlobalUnlock")
	procGlobalFree                    = kernel32.NewProc("GlobalFree")
	procGetStockObject                = gdi32.NewProc("GetStockObject")
	procCreateCompatibleDC            = gdi32.NewProc("CreateCompatibleDC")
	procDeleteDC                      = gdi32.NewProc("DeleteDC")
	procSelectObject                  = gdi32.NewProc("SelectObject")
	procDeleteObject                  = gdi32.NewProc("DeleteObject")
	procStretchBlt                    = gdi32.NewProc("StretchBlt")
	procSetStretchBltMode             = gdi32.NewProc("SetStretchBltMode")
	procCreatePen                     = gdi32.NewProc("CreatePen")
	procCreateSolidBrush              = gdi32.NewProc("CreateSolidBrush")
	procSaveDC                        = gdi32.NewProc("SaveDC")
	procRestoreDC                     = gdi32.NewProc("RestoreDC")
	procCreateRoundRectRgn            = gdi32.NewProc("CreateRoundRectRgn")
	procSelectClipRgn                 = gdi32.NewProc("SelectClipRgn")
	procCreateFontW                   = gdi32.NewProc("CreateFontW")
	procSetTextColor                  = gdi32.NewProc("SetTextColor")
	procSetBkMode                     = gdi32.NewProc("SetBkMode")
	procRectangle                     = gdi32.NewProc("Rectangle")
	procEllipse                       = gdi32.NewProc("Ellipse")
	procMoveToEx                      = gdi32.NewProc("MoveToEx")
	procLineTo                        = gdi32.NewProc("LineTo")
	procRoundRect                     = gdi32.NewProc("RoundRect")
	procGetObjectW                    = gdi32.NewProc("GetObjectW")
	procSetWindowTheme                = uxtheme.NewProc("SetWindowTheme")
	procInitCommonControlsEx          = comctl32.NewProc("InitCommonControlsEx")
	procImageListCreate               = comctl32.NewProc("ImageList_Create")
	procImageListAdd                  = comctl32.NewProc("ImageList_Add")
	procImageListDestroy              = comctl32.NewProc("ImageList_Destroy")
	procGetOpenFileNameW              = comdlg32.NewProc("GetOpenFileNameW")
	procSHBrowseForFolderW            = shell32.NewProc("SHBrowseForFolderW")
	procSHGetPathFromIDListW          = shell32.NewProc("SHGetPathFromIDListW")
	procSHCreateItemFromParsingName   = shell32.NewProc("SHCreateItemFromParsingName")
	procDragAcceptFiles               = shell32.NewProc("DragAcceptFiles")
	procDragQueryFileW                = shell32.NewProc("DragQueryFileW")
	procDragFinish                    = shell32.NewProc("DragFinish")
	procShellExecuteW                 = shell32.NewProc("ShellExecuteW")
	procShellNotifyIconW              = shell32.NewProc("Shell_NotifyIconW")
	procCoTaskMemFree                 = ole32.NewProc("CoTaskMemFree")
	procCoInitializeEx                = ole32.NewProc("CoInitializeEx")
	procCoUninitialize                = ole32.NewProc("CoUninitialize")
	procCoCreateInstance              = ole32.NewProc("CoCreateInstance")
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type drawItemStruct struct {
	CtlType    uint32
	CtlID      uint32
	ItemID     uint32
	ItemAction uint32
	ItemState  uint32
	HwndItem   uintptr
	HDC        uintptr
	RcItem     rect
	ItemData   uintptr
}

type point struct{ X, Y int32 }

type minMaxInfo struct {
	Reserved     point
	MaxSize      point
	MaxPosition  point
	MinTrackSize point
	MaxTrackSize point
}
type paintStruct struct {
	Hdc         uintptr
	Erase       int32
	RcPaint     rect
	Restore     int32
	IncUpdate   int32
	RgbReserved [32]byte
}
type bitmapInfo struct {
	Type       int32
	Width      int32
	Height     int32
	WidthBytes int32
	Planes     uint16
	BitsPixel  uint16
	Bits       uintptr
}
type msg struct {
	HWnd           uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Pt             point
	Private        uint32
}
type rect struct{ Left, Top, Right, Bottom int32 }
type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}
type initCommonControlsEx struct{ DwSize, DwICC uint32 }
type lvColumn struct {
	Mask       uint32
	Fmt        int32
	Cx         int32
	PszText    *uint16
	CchTextMax int32
	ISubItem   int32
	IImage     int32
	IOrder     int32
	CxMin      int32
	CxDefault  int32
	CxIdeal    int32
}
type lvItem struct {
	Mask             uint32
	IItem, ISubItem  int32
	State, StateMask uint32
	PszText          *uint16
	CchTextMax       int32
	IImage           int32
	LParam           uintptr
	IIndent          int32
	IGroupId         int32
	CColumns         uint32
	PuColumns        *uint32
	PiColFmt         *int32
	IGroup           int32
}
type nmhdr struct {
	HwndFrom uintptr
	IdFrom   uintptr
	Code     uint32
}
type nmListView struct {
	Hdr                            nmhdr
	IItem, IItemSub                int32
	UNewState, UOldState, UChanged uint32
	PtAction                       point
	LParam                         uintptr
}
type nmCustomDraw struct {
	Hdr        nmhdr
	DrawStage  uint32
	HDC        uintptr
	Rc         rect
	ItemSpec   uintptr
	ItemState  uint32
	ItemLParam uintptr
}
type nmListViewCustomDraw struct {
	NMCD        nmCustomDraw
	ClrText     uint32
	ClrTextBk   uint32
	ISubItem    int32
	ItemType    uint32
	ClrFace     uintptr
	IIconEffect int32
	IIconPhase  int32
	IPartID     int32
	IStateID    int32
	RcText      rect
	Align       uint32
}
type openFileName struct {
	LStructSize                    uint32
	HwndOwner, HInstance           uintptr
	LpstrFilter, LpstrCustomFilter *uint16
	NMaxCustFilter, NFilterIndex   uint32
	LpstrFile                      *uint16
	NMaxFile                       uint32
	LpstrFileTitle                 *uint16
	NMaxFileTitle                  uint32
	LpstrInitialDir                *uint16
	LpstrTitle                     *uint16
	Flags                          uint32
	NFileOffset, NFileExtension    uint16
	LpstrDefExt                    *uint16
	LCustData, LpfnHook            uintptr
	LpTemplateName                 *uint16
	PvReserved                     uintptr
	DwReserved, FlagsEx            uint32
}
type browseInfo struct {
	HwndOwner, PidlRoot       uintptr
	PszDisplayName, LpszTitle *uint16
	UlFlags                   uint32
	Lpfn, LParam              uintptr
	IImage                    int32
}
type notifyIconData struct {
	CbSize               uint32
	HWnd                 uintptr
	UID                  uint32
	UFlags               uint32
	UCallbackMessage     uint32
	HIcon                uintptr
	SzTip                [128]uint16
	DwState, DwStateMask uint32
	SzInfo               [256]uint16
	UVersion             uint32
	SzInfoTitle          [64]uint16
	DwInfoFlags          uint32
	GuidItem             [16]byte
	HBalloonIcon         uintptr
}

var uiFontSmall, uiFont, uiFontBold, uiFontTitle, iconFont, uiCanvasBrush, uiSurfaceBrush uintptr

func p(s string) *uint16 {
	v, _ := syscall.UTF16PtrFromString(s)
	return v
}

// utf16Multi keeps embedded NUL separators required by Win32 file-dialog
// filter strings. syscall.StringToUTF16 intentionally panics on embedded NULs.
func utf16Multi(s string) []uint16 {
	v := utf16.Encode([]rune(s))
	if len(v) == 0 || v[len(v)-1] != 0 {
		v = append(v, 0)
	}
	return v
}

func colorRef(r, g, b byte) uintptr { return uintptr(uint32(r) | uint32(g)<<8 | uint32(b)<<16) }

func utf16PtrString(ptr *uint16) string {
	if ptr == nil {
		return ""
	}
	words := make([]uint16, 0, 260)
	base := uintptr(unsafe.Pointer(ptr))
	for i := 0; i < 32768; i++ {
		ch := *(*uint16)(unsafe.Pointer(base + uintptr(i*2)))
		if ch == 0 {
			break
		}
		words = append(words, ch)
	}
	return syscall.UTF16ToString(words)
}

func createUIFont(face string, height int32, weight int32) uintptr {
	height = scaleDPI(height)
	r, _, _ := procCreateFontW.Call(uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(p(face))))
	return r
}
func loWord(v uintptr) uint16 { return uint16(v & 0xffff) }
func hiWord(v uintptr) uint16 { return uint16((v >> 16) & 0xffff) }
func send(hwnd uintptr, m uint32, wp, lp uintptr) uintptr {
	r, _, _ := procSendMessageW.Call(hwnd, uintptr(m), wp, lp)
	return r
}
func setText(hwnd uintptr, s string) { procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(p(s)))) }
func getText(hwnd uintptr) string {
	n, _, _ := procGetWindowTextLengthW.Call(hwnd)
	buf := make([]uint16, n+1)
	if len(buf) > 0 {
		procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), n+1)
	}
	return syscall.UTF16ToString(buf)
}
func messageBox(hwnd uintptr, title, text string, flags uintptr) int {
	r, _, _ := procMessageBoxW.Call(hwnd, uintptr(unsafe.Pointer(p(text))), uintptr(unsafe.Pointer(p(title))), flags)
	return int(r)
}
func createControlEx(ex uint32, class, text string, style uint32, x, y, w, h int32, parent uintptr, id int) uintptr {
	r, _, _ := procCreateWindowExW.Call(uintptr(ex), uintptr(unsafe.Pointer(p(class))), uintptr(unsafe.Pointer(p(text))), uintptr(style), uintptr(x), uintptr(y), uintptr(w), uintptr(h), parent, uintptr(id), 0, 0)
	font := uiFont
	if font == 0 {
		font, _, _ = procGetStockObject.Call(DEFAULT_GUI_FONT)
	}
	send(r, WM_SETFONT, font, 1)
	return r
}
func createControl(class, text string, style uint32, x, y, w, h int32, parent uintptr, id int) uintptr {
	return createControlEx(0, class, text, style, x, y, w, h, parent, id)
}
func move(hwnd uintptr, x, y, w, h int32) {
	x, y, w, h = scaleDPI(x), scaleDPI(y), scaleDPI(w), scaleDPI(h)
	procMoveWindow.Call(hwnd, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 1)
}
func enable(hwnd uintptr, v bool) {
	n := uintptr(0)
	if v {
		n = 1
	}
	procEnableWindow.Call(hwnd, n)
}
func show(hwnd uintptr, v bool) {
	cmd := uintptr(SW_HIDE)
	if v {
		cmd = SW_SHOW
	}
	procShowWindow.Call(hwnd, cmd)
}
func appendMenu(menu uintptr, flags uintptr, id uintptr, text string) {
	procAppendMenuW.Call(menu, flags, id, uintptr(unsafe.Pointer(p(text))))
}
func setCheck(menu uintptr, id int, checked bool) {
	flags := uintptr(MF_BYCOMMAND)
	if checked {
		flags |= MF_CHECKED
	}
	user32.NewProc("CheckMenuItem").Call(menu, uintptr(id), flags)
}
func setClipboardText(hwnd uintptr, text string) bool {
	if r, _, _ := procOpenClipboard.Call(hwnd); r == 0 {
		return false
	}
	defer procCloseClipboard.Call()
	procEmptyClipboard.Call()
	words := syscall.StringToUTF16(text)
	size := uintptr(len(words) * 2)
	h, _, _ := procGlobalAlloc.Call(GMEM_MOVEABLE, size)
	if h == 0 {
		return false
	}
	ptr, _, _ := procGlobalLock.Call(h)
	if ptr == 0 {
		procGlobalFree.Call(h)
		return false
	}
	dst := unsafe.Slice((*uint16)(unsafe.Pointer(ptr)), len(words))
	copy(dst, words)
	procGlobalUnlock.Call(h)
	if r, _, _ := procSetClipboardData.Call(CF_UNICODETEXT, h); r == 0 {
		procGlobalFree.Call(h)
		return false
	}
	return true
}

func shellOpen(path string) {
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(p("open"))), uintptr(unsafe.Pointer(p(path))), 0, 0, 1)
}
