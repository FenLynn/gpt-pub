//go:build windows

package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"html"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

const appVersion = "4.2.1"

var taskbarCreatedMessage uint32
var uiDPI uint32 = 96

//go:embed assets/icon.ico
var embeddedIcon []byte

const (
	IDC_TAB_VIDEO             = 1001
	IDC_TAB_IMAGE             = 1002
	IDC_ADD_FILES             = 1010
	IDC_ADD_FOLDER            = 1011
	IDC_REMOVE                = 1012
	IDC_CLEAR                 = 1013
	IDC_SELECT_ALL            = 1014
	IDC_INVERT                = 1015
	IDC_SOURCE_DIR            = 1016
	IDC_OUTPUT_DIR            = 1017
	IDC_LIST                  = 1020
	IDC_SEARCH                = 1021
	IDC_FILTER                = 1022
	IDC_OUTPUT_EDIT           = 1030
	IDC_OUTPUT_BROWSE         = 1031
	IDC_OUTPUT_PICK           = 1032
	IDC_RESOLUTION            = 1040
	IDC_CODEC                 = 1041
	IDC_QUALITY               = 1042
	IDC_VOLUME                = 1043
	IDC_ROTATION              = 1044
	IDC_SPEED_MODE            = 1047
	IDC_SMART_PLAN            = 1048
	IDC_ALL_DEFAULT           = 1046
	IDC_START                 = 1050
	IDC_PAUSE                 = 1051
	IDC_STOP                  = 1052
	IDC_TASK_RES              = 1060
	IDC_TASK_CODEC            = 1061
	IDC_TASK_QUALITY          = 1062
	IDC_TASK_VOLUME           = 1063
	IDC_TASK_ROTATION         = 1064
	IDC_TASK_APPLY            = 1065
	IDC_TASK_DEFAULT          = 1066
	IDC_PREVIEW               = 1067
	IDC_TRIM_CROP             = 1068
	IDC_SINGLE_OUTPUT         = 1069
	IDC_RETRY                 = 1070
	IDC_RIGHT_TOGGLE          = 1071
	ID_FILE_ADD               = 2001
	ID_FILE_FOLDER            = 2002
	ID_FILE_REMOVE            = 2003
	ID_FILE_CLEAR             = 2004
	ID_FILE_SOURCE            = 2005
	ID_FILE_OUTPUT            = 2006
	ID_FILE_EXIT              = 2007
	ID_FILE_EXPORT_TASKS      = 2008
	ID_FILE_EXPORT_QUEUE_JSON = 2009
	ID_FILE_IMPORT_QUEUE_JSON = 2014
	ID_EDIT_SELECT_ALL        = 2010
	ID_EDIT_INVERT            = 2011
	ID_EDIT_RESET             = 2012
	ID_EDIT_RETRY_FAILED      = 2013
	ID_EDIT_CLEAN_DONE        = 2015
	ID_EDIT_CLEAN_PROBLEMS    = 2016
	ID_EDIT_CLEAN_FINISHED    = 2017
	ID_FFMPEG_STATUS          = 2020
	ID_GPU_STATUS             = 2025
	ID_GPU_BENCHMARK          = 2027
	ID_FFMPEG_SELECT          = 2021
	ID_FFMPEG_OPEN            = 2022
	ID_FFMPEG_DOWNLOAD_GYAN   = 2023
	ID_FFMPEG_DOWNLOAD_GITHUB = 2024
	ID_FFMPEG_IMPORT_ZIP      = 2026
	ID_PLAYER_STATUS          = 2030
	ID_PLAYER_AUTO            = 2031
	ID_PLAYER_SELECT          = 2032
	ID_PLAYER_DEFAULT         = 2033
	ID_PLAYER_OPEN            = 2034
	ID_SET_RECURSIVE          = 2040
	ID_SET_CONCURRENCY_AUTO   = 2043
	ID_CONCURRENCY_STATUS     = 2049
	ID_SET_CONCURRENCY_BASE   = 2400
	ID_SET_GPU                = 2050
	ID_SET_CLEAR_META         = 2051
	ID_SET_UPSCALE            = 2052
	ID_SET_EXACT_SIZE         = 2053
	ID_SET_FILENAME_KEEP      = 2054
	ID_SET_FILENAME_SUFFIX    = 2055
	ID_SET_CONFLICT_NUMBER    = 2056
	ID_SET_CONFLICT_SKIP      = 2057
	ID_SET_CONFLICT_OVERWRITE = 2058
	ID_SET_SESSION            = 2059
	ID_SET_HISTORY            = 2060
	ID_SET_NOTIFY             = 2061
	ID_SET_OPEN_DONE          = 2062
	ID_SET_CONFIG_DIR         = 2063
	ID_SET_RESET              = 2064
	ID_SET_GPU_FALLBACK       = 2065
	ID_SET_PRESERVE_TIMES     = 2066
	ID_SET_VERIFY_OUTPUT      = 2067
	ID_SET_THUMB_CACHE        = 2068
	ID_SET_ESTIMATE_SPACE     = 2069
	ID_PRESET_1080            = 2070
	ID_PRESET_720             = 2071
	ID_PRESET_ORIGINAL        = 2072
	ID_PRESET_4K              = 2073
	ID_PRESET_CUSTOM1         = 2074
	ID_PRESET_CUSTOM2         = 2075
	ID_PRESET_CUSTOM3         = 2076
	ID_PRESET_SAVE1           = 2077
	ID_PRESET_SAVE2           = 2078
	ID_PRESET_SAVE3           = 2079
	ID_PRESET_CLEAR           = 2080
	ID_PRESET_EXPORT          = 2081
	ID_PRESET_IMPORT          = 2082
	ID_SET_PORTABLE_MODE      = 2083
	ID_SET_SMART_COPY         = 2084
	ID_SET_AUDIO_AAC          = 2085
	ID_SET_AUDIO_COPY         = 2086
	ID_SET_AUDIO_MUTE         = 2087
	ID_SET_SUBTITLE_NONE      = 2088
	ID_SET_SUBTITLE_TEXT      = 2089
	ID_VIEW_RIGHT             = 2090
	ID_VIEW_FLOATING          = 2091
	ID_VIEW_SIMPLE            = 2092
	ID_VIEW_PERFORMANCE       = 2093
	ID_VIEW_RESET_COLUMNS     = 2094
	ID_HISTORY_VIEW           = 2100
	ID_HISTORY_CLEAR          = 2101
	ID_HISTORY_LAST_SUMMARY   = 2102
	ID_HELP_ABOUT             = 2110
	ID_HELP_DIAGNOSTICS       = 2111
	ID_CTX_PLAY_SOURCE        = 2200
	ID_CTX_PLAY_OUTPUT        = 2201
	ID_CTX_DUAL               = 2202
	ID_CTX_TRIM               = 2203
	ID_CTX_ROTATION_PREVIEW   = 2204
	ID_CTX_COMPARE_IMAGE      = 2205
	ID_CTX_COMPARE_VIDEO      = 2206
	ID_CTX_COPY_TASK          = 2207
	ID_CTX_RETRY              = 2208
	ID_CTX_READY              = 2209
	ID_CTX_OPEN_SOURCE        = 2210
	ID_CTX_OPEN_OUTPUT        = 2211
	ID_CTX_REMOVE             = 2212
	ID_CTX_COPY_COMMAND       = 2213
	ID_CTX_PIN                = 2214
	ID_CTX_MOVE_UP            = 2215
	ID_CTX_MOVE_DOWN          = 2216
	ID_CTX_JUMP_RUNNING       = 2217
	ID_CTX_ERROR_DETAILS      = 2218
	ID_CTX_TECH_REPORT        = 2219
	ID_CTX_COPY_SOURCE        = 2220
	ID_CTX_COPY_OUTPUT        = 2221
	ID_CTX_OPEN_OUTPUT_FILE   = 2222
	ID_CTX_COPY_TRIM_CROP     = 2223
	ID_CTX_MOVE_TOP           = 2224
	ID_CTX_MOVE_BOTTOM        = 2225
	ID_CTX_HOLD_EDIT          = 2226
	ID_CTX_REMOVE_SAFE        = 2227
	ID_CTX_RES_4K             = 2300
	ID_CTX_RES_1080           = 2301
	ID_CTX_RES_720            = 2302
	ID_CTX_RES_480            = 2303
	ID_CTX_RES_ORIGINAL       = 2304
	ID_CTX_CODEC_265          = 2310
	ID_CTX_CODEC_264          = 2311
	ID_CTX_CODEC_JPG          = 2312
	ID_CTX_CODEC_PNG          = 2313
	ID_CTX_QUALITY_HIGH       = 2320
	ID_CTX_QUALITY_MEDIUM     = 2321
	ID_CTX_QUALITY_LOW        = 2322
	ID_CTX_ROT_AUTO           = 2330
	ID_CTX_ROT_RIGHT          = 2331
	ID_CTX_ROT_LEFT           = 2332
	ID_CTX_ROT_180            = 2333
	ID_CTX_ROT_HFLIP          = 2334
	ID_CTX_ROT_VFLIP          = 2335
	ID_TRAY_OPEN              = 3001
	ID_TRAY_FLOATING          = 3002
	ID_TRAY_EXIT              = 3003
)

type application struct {
	hwnd                                                                                                                                                                       uintptr
	menuMain, menuSettings, menuView, menuConcurrency                                                                                                                          uintptr
	hIcon                                                                                                                                                                      uintptr
	hVideo, hImage, hAddFiles, hAddFolder, hRemove, hClear, hSelectAll, hInvert, hSourceDir, hOutputDir                                                                        uintptr
	hSearch, hFilter, hList, hToolbarDivider, hHeaderLine                                                                                                                      uintptr
	hRightTitle, hTaskRes, hTaskCodec, hTaskQuality, hTaskVolume, hTaskRotation, hTaskApply, hTaskDefault, hPreview, hTrimCrop, hSingleOutput, hRetry, hDetails, hDetailsFrame uintptr
	rightLabels, globalLabels                                                                                                                                                  []uintptr
	hOutputEdit, hOutputBrowse, hOutputPick, hResolution, hCodec, hQuality, hSpeedMode, hVolume, hRotation, hAllDefault, hSmartPlan                                            uintptr
	hProgress, hProgressText, hStatusText, hStart, hPause, hStop                                                                                                               uintptr
	hFFStatus, hGPUStatus, hPotStatus, hConcurrencyStatus, hRightToggle                                                                                                        uintptr
	hImageList                                                                                                                                                                 uintptr
	hFloating, hFloatingProgress, hFloatingText, hFloatingClose                                                                                                                uintptr
	hToast, hToastTitle, hToastText, hToastClose                                                                                                                               uintptr
	hImportToast, hImportToastText, hImportToastClose                                                                                                                          uintptr

	mu                  sync.Mutex
	componentMu         sync.RWMutex
	tasks               []*model.Task
	visible             []int
	sortActive          bool
	sortColumn          int
	sortDescending      bool
	pendingSelection    map[int64]bool
	concurrencyCommands map[int]int
	nextID              atomic.Int64
	currentKind         model.Kind
	settings            model.Settings
	ffmpeg, ffprobe     string
	hardware            media.Hardware
	player              string
	playerOK            bool
	rightVisible        bool
	overallProgress     float64
	overallText         string
	overallPaused       bool
	hoverControl        uintptr
	runtimeNotice       string
	queueWake           chan struct{}
	queueSequence       atomic.Int64
	taskCancels         map[int64]context.CancelFunc
	holdRequests        map[int64]bool
	removeRequests      map[int64]bool
	immediateRestarts   map[int64]bool
	heldEditTaskID      int64
	rightDraftFields    map[int]bool
	rightUpdating       bool
	rightSelectionKey   string

	runMu                 sync.Mutex
	running, paused       bool
	runKind               model.Kind
	controller            *media.ProcessController
	gpuDisabledForRun     bool
	ctx                   context.Context
	cancel                context.CancelFunc
	pauseCond             *sync.Cond
	runStart, timeEnd     time.Time
	runOnly               map[int64]bool
	runTaskIDs            map[int64]bool
	reservedOutputs       map[string]int64
	uiQueue               chan func()
	probeQueue            chan int64
	thumbnailQueue        chan thumbnailJob
	probeQueueDropped     atomic.Int64
	thumbnailQueueDropped atomic.Int64
	workers               sync.WaitGroup
	exiting               bool
	trayAdded             bool
	closeHintShown        bool
	lastSummaryPath       string
	benchmarkRunning      atomic.Bool
	controlsReady         bool
	initializing          bool
	selfTest              bool
	selfTestOutput        string
	outputIntegrityHook   func(string)
	uiPreview             bool
	uiPreviewMode         string
}

var app *application

func (a *application) componentSnapshot() (string, string, media.Hardware, string, bool) {
	a.componentMu.RLock()
	defer a.componentMu.RUnlock()
	return a.ffmpeg, a.ffprobe, a.hardware, a.player, a.playerOK
}

func (a *application) postUI(fn func()) {
	if fn == nil || a == nil || a.hwnd == 0 {
		return
	}
	select {
	case a.uiQueue <- fn:
		procPostMessageW.Call(a.hwnd, WM_APP_UI, 0, 0)
	default:
		// The queue should never fill during normal use. Avoid blocking an FFmpeg
		// progress reader; a full refresh will still reconcile all controls.
		procPostMessageW.Call(a.hwnd, WM_APP_REFRESH, 0, 0)
	}
}

func (a *application) drainUIQueue() {
	for {
		select {
		case fn := <-a.uiQueue:
			if fn != nil {
				fn()
			}
		default:
			return
		}
	}
}

func (a *application) findTaskByIDLocked(id int64) (*model.Task, int) {
	for i, t := range a.tasks {
		if t != nil && t.ID == id {
			return t, i
		}
	}
	return nil, -1
}

func (a *application) taskIndexByID(id int64) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, i := a.findTaskByIDLocked(id)
	return i
}

func (a *application) postTaskRow(id int64) {
	procPostMessageW.Call(a.hwnd, WM_APP_ROW, uintptr(id), 0)
}

func normalizeOutputKey(path string) string {
	return strings.ToLower(filepath.Clean(path))
}

func (a *application) reserveOutput(path string, taskID int64) bool {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	if a.reservedOutputs == nil {
		a.reservedOutputs = make(map[string]int64)
	}
	key := normalizeOutputKey(path)
	if owner, exists := a.reservedOutputs[key]; exists && owner != taskID {
		return false
	}
	a.reservedOutputs[key] = taskID
	return true
}

func (a *application) releaseOutput(path string, taskID int64) {
	if path == "" {
		return
	}
	a.runMu.Lock()
	key := normalizeOutputKey(path)
	if a.reservedOutputs[key] == taskID {
		delete(a.reservedOutputs, key)
	}
	a.runMu.Unlock()
}

func main() {
	resetStartupLog()
	writeStartupStage("main_enter")
	defer func() {
		if r := recover(); r != nil {
			writeStartupStage("main_panic: " + fmt.Sprint(r))
			writeCrash(r)
			messageBox(0, "Mediova异常", "程序发生异常，诊断信息已写入 crash.log。\r\n启动阶段记录："+startupLogPath()+"\r\n\r\n"+fmt.Sprint(r), MB_OK|MB_ICONERROR)
		}
	}()
	runtime.LockOSThread()
	writeStartupStage("os_thread_locked")
	if hr, _, _ := procCoInitializeEx.Call(0, COINIT_APARTMENTTHREADED|COINIT_DISABLE_OLE1DDE); int32(hr) >= 0 {
		defer procCoUninitialize.Call()
	}
	writeStartupStage("com_initialized")
	procSetProcessDpiAwarenessContext.Call(^uintptr(3))
	if dpi, _, _ := procGetDpiForSystem.Call(); dpi >= 96 && dpi <= 768 {
		uiDPI = uint32(dpi)
	}
	uiFontSmall = createUIFont("Microsoft YaHei UI", -14, 400)
	uiFont = createUIFont("Microsoft YaHei UI", -16, 400)
	uiFontBold = createUIFont("Microsoft YaHei UI", -16, 550)
	uiFontTitle = createUIFont("Microsoft YaHei UI", -18, 600)
	iconFont = createUIFont("Segoe MDL2 Assets", -18, 400)
	uiCanvasBrush, _, _ = procCreateSolidBrush.Call(colorRef(250, 251, 253))
	uiSurfaceBrush, _, _ = procCreateSolidBrush.Call(colorRef(250, 251, 253))
	writeStartupStage("fonts_created")
	defer func() {
		for _, f := range []uintptr{uiFontSmall, uiFont, uiFontBold, uiFontTitle, iconFont, uiCanvasBrush, uiSurfaceBrush} {
			if f != 0 {
				procDeleteObject.Call(f)
			}
		}
	}()
	icc := initCommonControlsEx{DwSize: uint32(unsafe.Sizeof(initCommonControlsEx{})), DwICC: 0x1 | 0x10 | 0x4000}
	procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))
	writeStartupStage("common_controls_initialized")
	config.MigrateLegacyTransientData()
	runtimeMigrated, runtimeMigrationErr := config.MigrateLegacyRuntimeComponents()
	selfTest, selfTestOutput := parseSelfTestArgs(os.Args[1:])
	uiPreview, uiPreviewMode := parseUIPreviewArgs(os.Args[1:])
	settings := config.Load()
	settings.FFmpegPath = config.NormalizeConfiguredFFmpegPath(settings.FFmpegPath)
	if settings.UILayoutRevision < 420 {
		settings.UILayoutRevision = 420
		settings.RightPanelVisible = true
		settings.ShowPerformanceStats = false
		settings.TaskColumnWidths = nil
		config.Save(settings)
	}
	writeStartupStage("settings_loaded")
	// Never benchmark or enumerate codecs during startup. Older v3.5.1
	// configurations may still contain auto_benchmark=true; force it off.
	settings.AutoBenchmark = false
	if selfTest || uiPreview {
		settings = model.DefaultSettings()
		settings.RestoreSession = false
		settings.AutoBenchmark = false
		settings.NotifyOnDone = false
		settings.OpenOutputOnDone = false
	}
	app = &application{currentKind: model.KindVideo, settings: settings, rightVisible: settings.RightPanelVisible, uiPreview: uiPreview, uiPreviewMode: uiPreviewMode, reservedOutputs: make(map[string]int64), pendingSelection: make(map[int64]bool), concurrencyCommands: make(map[int]int), uiQueue: make(chan func(), 512), queueWake: make(chan struct{}, 64), taskCancels: make(map[int64]context.CancelFunc), holdRequests: make(map[int64]bool), removeRequests: make(map[int64]bool), immediateRestarts: make(map[int64]bool), rightDraftFields: make(map[int]bool), probeQueue: make(chan int64, 16384), thumbnailQueue: make(chan thumbnailJob, 8192), selfTest: selfTest, selfTestOutput: selfTestOutput, hardware: media.Hardware{Detail: "启动时不自动测试 GPU；默认使用 CPU。可在 FFmpeg 菜单中手动测速。"}}
	if runtimeMigrationErr != nil {
		app.runtimeNotice = "旧 FFmpeg 组件未能复制到 Runtime，已保留旧位置继续兼容：" + short(runtimeMigrationErr.Error(), 160)
	} else if runtimeMigrated {
		app.runtimeNotice = "旧 FFmpeg 组件已安全复制到透明 Runtime；旧组件仍保留。"
	}
	app.pauseCond = sync.NewCond(&app.runMu)
	app.startBackgroundWorkers()
	app.nextID.Store(time.Now().UnixNano())
	writeStartupStage("application_created")
	app.ffmpeg, app.ffprobe, _ = media.FindFFmpeg(app.settings.FFmpegPath)
	app.player, app.playerOK, _ = media.DetectPotPlayer(app.settings.PlayerPath)
	writeStartupStage("components_discovered")
	hInst, _, _ := procGetModuleHandleW.Call(0)
	className := p("MediovaDesktop420")
	app.hIcon = loadEmbeddedIcon()
	if r, _, _ := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(p("TaskbarCreated")))); r != 0 {
		taskbarCreatedMessage = uint32(r)
	}
	wc := wndClassEx{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: syscall.NewCallback(wndProc), HInstance: hInst, HIcon: app.hIcon, HIconSm: app.hIcon, HCursor: func() uintptr { r, _, _ := procLoadCursorW.Call(0, 32512); return r }(), HbrBackground: uiCanvasBrush, LpszClassName: className}
	if r, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		writeStartupStage("register_main_class_failed")
		messageBox(0, "错误", "无法注册窗口类。\r\n启动记录："+startupLogPath(), MB_OK|MB_ICONERROR)
		return
	}
	writeStartupStage("main_class_registered")
	if !registerAuxWindowClasses(hInst, app.hIcon) {
		writeStartupStage("register_aux_classes_failed")
		messageBox(0, "错误", "无法注册悬浮进度与通知窗口。\r\n启动记录："+startupLogPath(), MB_OK|MB_ICONERROR)
		return
	}
	writeStartupStage("aux_classes_registered")
	if app.settings.ThumbnailCache {
		go media.CleanupThumbnailCache(1200, 90*24*time.Hour)
	}
	title := fmt.Sprintf("Mediova  v%s", appVersion)
	writeStartupStage("create_window_begin")
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(p(title))), WS_OVERLAPPEDWINDOW|WS_CLIPCHILDREN, uintptr(scaleDPI(80)), uintptr(scaleDPI(50)), uintptr(scaleDPI(1650)), uintptr(scaleDPI(930)), 0, 0, hInst, 0)
	if hwnd == 0 {
		writeStartupStage("create_window_failed")
		messageBox(0, "启动失败", "主窗口创建失败。\r\n请查看："+startupLogPath()+"\r\n以及软件数据目录中的 crash.log。", MB_OK|MB_ICONERROR)
		return
	}
	writeStartupStage("create_window_success")
	app.hwnd = hwnd
	send(hwnd, WM_SETICON, ICON_BIG, app.hIcon)
	send(hwnd, WM_SETICON, ICON_SMALL, app.hIcon)
	procShowWindow.Call(hwnd, SW_SHOW)
	procUpdateWindow.Call(hwnd)
	writeStartupStage("message_loop_start")
	var m msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		if app.handleShortcutMessage(&m) {
			continue
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	writeStartupStage("message_loop_end")
}

// shortcutAction is intentionally pure so the key mapping can be regression-tested
// without synthesizing keyboard input on the CI desktop.
func shortcutAction(key uintptr, ctrl, shift, listFocused, searchFocused bool) int {
	if ctrl {
		switch key {
		case 'F':
			return -1 // focus search
		case 'O':
			if shift {
				return ID_FILE_FOLDER
			}
			return ID_FILE_ADD
		case 'A':
			if listFocused && !searchFocused {
				return ID_EDIT_SELECT_ALL
			}
		}
	}
	if key == VK_DELETE && listFocused {
		return ID_FILE_REMOVE
	}
	if key == VK_ESCAPE {
		return -2 // clear search/filter
	}
	return 0
}

func keyDown(vk uintptr) bool {
	r, _, _ := procGetKeyState.Call(vk)
	return int16(r&0xffff) < 0
}

func (a *application) handleShortcutMessage(m *msg) bool {
	if a == nil || m == nil || m.Message != WM_KEYDOWN || a.hwnd == 0 {
		return false
	}
	focus, _, _ := procGetFocus.Call()
	listFocused := focus == a.hList
	searchFocused := focus == a.hSearch
	action := shortcutAction(m.WParam, keyDown(VK_CONTROL), keyDown(VK_SHIFT), listFocused, searchFocused)
	switch action {
	case -1:
		procSetFocus.Call(a.hSearch)
		return true
	case -2:
		search := strings.TrimSpace(getText(a.hSearch))
		filter := comboText(a.hFilter)
		if search == "" && (filter == "" || filter == "全部状态") {
			return false
		}
		setText(a.hSearch, "")
		send(a.hFilter, CB_SETCURSEL, 0, 0)
		a.refreshList()
		setText(a.hStatusText, "已清除搜索与状态筛选。")
		return true
	case 0:
		return false
	default:
		a.command(action)
		return true
	}
}

func loadEmbeddedIcon() uintptr {
	dir, err := config.TempDir()
	if err == nil {
		path := filepath.Join(dir, "mediova_icon.ico")
		if os.WriteFile(path, embeddedIcon, 0o644) == nil {
			if r, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(path))), IMAGE_ICON, 0, 0, LR_LOADFROMFILE|LR_DEFAULTSIZE); r != 0 {
				return r
			}
		}
	}
	// A tray icon is essential because closing the main window only hides it.
	// Fall back to the system application icon if the embedded icon cannot be
	// materialized (for example because the temporary directory is read-only).
	r, _, _ := procLoadIconW.Call(0, 32512) // IDI_APPLICATION
	return r
}

//go:nocheckptr
func wndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) (result uintptr) {
	defer func() {
		if r := recover(); r != nil {
			writeCrashContext(fmt.Sprintf("window message 0x%04X", message), r)
			if app != nil && app.hStatusText != 0 {
				setText(app.hStatusText, "本次操作发生异常，已拦截并写入 crash.log；程序可继续使用。")
			}
			if message == WM_CREATE {
				result = ^uintptr(0)
			} else {
				result = 0
			}
		}
	}()
	switch message {
	case WM_CREATE:
		writeStartupStage("wm_create_begin")
		app.hwnd = hwnd
		app.initializing = true
		app.initMenus()
		writeStartupStage("wm_create_menus_initialized")
		app.initControls()
		writeStartupStage("wm_create_controls_initialized")
		if err := app.validateCriticalControls(); err != nil {
			app.writeSelfTestFailure("control_initialization", err)
			if !app.selfTest {
				messageBox(hwnd, "启动失败", "关键界面控件创建失败：\r\n"+err.Error(), MB_OK|MB_ICONERROR)
			}
			return ^uintptr(0)
		}
		writeStartupStage("wm_create_controls_validated")
		app.controlsReady = true
		app.initializing = false
		var rc rect
		if r, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); r != 0 {
			app.layout(rc.Right-rc.Left, rc.Bottom-rc.Top)
		}
		writeStartupStage("wm_create_layout_complete")
		if app.selfTest {
			procSetTimer.Call(hwnd, TIMER_SELF_TEST, 350, 0)
		} else if app.uiPreview {
			app.populateUIPreviewTasks()
			app.refreshAll()
			selectedState := lvItem{State: LVIS_SELECTED | LVIS_FOCUSED, StateMask: LVIS_SELECTED | LVIS_FOCUSED}
			send(app.hList, LVM_SETITEMSTATE, 0, uintptr(unsafe.Pointer(&selectedState)))
			app.updateRightPanel()
			setText(app.hStatusText, "界面视觉基线：示例任务已载入，仅用于自动截图。")
			writeStartupStage("ui_preview_ready")
		} else {
			app.addTray()
			writeStartupStage("wm_create_tray_added")
			app.loadSession()
			writeStartupStage("wm_create_session_loaded")
			app.refreshAll()
			writeStartupStage("wm_create_refresh_complete")
			// Deliberately do not run FFmpeg encoder/decoder or GPU detection here.
			// The main window must become usable immediately even when a bundled
			// FFmpeg build or graphics driver is broken. Detection is manual only.
			readyText := fmt.Sprintf("就绪。检测到 %d 个逻辑处理器，并发上限 %d；启动时未运行编码器、解码器或 GPU 测试。", config.LogicalProcessorCount(), config.MaxConcurrency())
			if app.runtimeNotice != "" {
				readyText += " " + app.runtimeNotice
			}
			setText(app.hStatusText, readyText)
			app.updateComponentStatus()
		}
		writeStartupStage("wm_create_done")
		return 0
	case WM_GETMINMAXINFO:
		if lParam != 0 {
			info := (*minMaxInfo)(unsafe.Pointer(lParam))
			info.MinTrackSize = point{X: scaleDPI(980), Y: scaleDPI(700)}
		}
		return 0
	case WM_DPICHANGED:
		newDPI := uint32(hiWord(wParam))
		if newDPI < 96 {
			newDPI = 96
		}
		if newDPI > 768 {
			newDPI = 768
		}
		uiDPI = newDPI
		app.recreateFontsForDPI()
		if lParam != 0 {
			r := (*rect)(unsafe.Pointer(lParam))
			procSetWindowPos.Call(hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), SWP_NOZORDER|SWP_NOACTIVATE)
		}
		var rc rect
		if ok, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); ok != 0 {
			app.layout(rc.Right-rc.Left, rc.Bottom-rc.Top)
		}
		return 0
	case WM_SIZE:
		app.layout(int32(loWord(lParam)), int32(hiWord(lParam)))
		return 0
	case WM_SETCURSOR:
		app.updateHoverControl(wParam)
	case WM_COMMAND:
		id := int(loWord(wParam))
		code := int(hiWord(wParam))
		if app.v420HandleControlNotification(id, code) {
			return 0
		}
		app.command(id)
		return 0
	case WM_NOTIFY:
		return app.notify((*nmhdr)(unsafe.Pointer(lParam)))
	case WM_DRAWITEM:
		dis := (*drawItemStruct)(unsafe.Pointer(lParam))
		if app.drawOverallProgress(dis) || app.drawDecoration(dis) || app.drawPrimaryButton(dis) || app.drawToolbarButton(dis) || app.drawSecondaryButton(dis) || app.drawStatusChip(dis) {
			return 1
		}
	case WM_CTLCOLOREDIT:
		procSetTextColor.Call(wParam, colorRef(45, 55, 69))
		if uiSurfaceBrush != 0 {
			return uiSurfaceBrush
		}
	case WM_CTLCOLORSTATIC:
		color := colorRef(55, 65, 81)
		if statusColor, ok := app.statusTextColor(lParam); ok {
			color = statusColor
		}
		procSetBkMode.Call(wParam, TRANSPARENT)
		procSetTextColor.Call(wParam, color)
		if uiCanvasBrush != 0 {
			return uiCanvasBrush
		}
	case WM_CONTEXTMENU:
		if wParam == app.hList {
			app.showContextMenu()
		}
		return 0
	case WM_DROPFILES:
		app.handleDrop(wParam)
		return 0
	case WM_TIMER:
		switch wParam {
		case TIMER_MAIN_CLOCK:
			app.refreshTotal()
			return 0
		case TIMER_TRAY_RETRY:
			if !app.trayAdded {
				app.addTray()
			}
			return 0
		case TIMER_IMPORT_CLOSE:
			app.hideImportToast()
			return 0
		case TIMER_SELF_TEST:
			procKillTimer.Call(hwnd, TIMER_SELF_TEST)
			app.runSelfTest()
			return 0
		}
	case WM_APP_REFRESH:
		app.refreshAll()
		return 0
	case WM_APP_ROW:
		app.updateTaskRowByID(int64(wParam))
		app.refreshTotal()
		return 0
	case WM_APP_DONE:
		app.finishRun()
		return 0
	case WM_APP_PROBE:
		app.updateTaskRowByID(int64(wParam))
		app.updateRightPanel()
		return 0
	case WM_APP_STATUS:
		app.updateComponentStatus()
		return 0
	case WM_APP_UI:
		app.drainUIQueue()
		return 0
	case WM_APP_SELFTEST:
		// Self-test shutdown must not enter the interactive close path, which
		// saves sessions, updates the tray and can race with queue completion.
		writeStartupStage("self_test_exit_begin")
		procDestroyWindow.Call(hwnd)
		return 0
	case WM_APP_TRAY:
		app.trayEvent(lParam)
		return 0
	case WM_CLOSE:
		if !app.exiting {
			if !app.trayAdded {
				app.addTray()
				if !app.trayAdded {
					messageBox(hwnd, "系统托盘", "无法创建系统托盘图标，主窗口不会隐藏。请稍后重试。", MB_OK|MB_ICONERROR)
					return 0
				}
			}
			show(hwnd, false)
			if !app.closeHintShown {
				app.closeHintShown = true
				app.notifyBalloon("Mediova仍在运行", "主窗口已隐藏。程序只能从右下角托盘菜单真正退出。")
			}
			return 0
		}
		app.stopQueue()
		app.readSettingsFromUI()
		_ = config.Save(app.settings)
		app.saveSession()
		app.removeTray()
		procDestroyWindow.Call(hwnd)
		return 0
	case WM_DESTROY:
		procKillTimer.Call(hwnd, TIMER_MAIN_CLOCK)
		procKillTimer.Call(hwnd, TIMER_TRAY_RETRY)
		procKillTimer.Call(hwnd, TIMER_IMPORT_CLOSE)
		if app != nil && app.hFloating != 0 {
			procDestroyWindow.Call(app.hFloating)
		}
		if app != nil && app.hToast != 0 {
			procDestroyWindow.Call(app.hToast)
		}
		if app != nil && app.hImageList != 0 {
			procImageListDestroy.Call(app.hImageList)
			app.hImageList = 0
		}
		procPostQuitMessage.Call(0)
		return 0
	}
	if taskbarCreatedMessage != 0 && message == taskbarCreatedMessage {
		// Explorer/taskbar restart removes all notification icons. Re-add the
		// icon immediately so the application can still be restored and exited.
		app.trayAdded = false
		app.addTray()
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func (a *application) toolbarButtonSpec(hwnd uintptr) (icon, label string, active bool, ok bool) {
	// Segoe MDL2 Assets ships with Windows 10/11 and is rendered as scalable
	// vector outlines. It stays crisp at 100%-175% DPI, unlike the former
	// one-pixel hand-drawn glyphs.
	switch hwnd {
	case a.hVideo:
		return "\uE768", "视频转换", a.currentKind == model.KindVideo, true // Play
	case a.hImage:
		return "\uE722", "图片压缩", a.currentKind == model.KindImage, true // Camera
	case a.hAddFiles:
		return "\uE710", "添加文件", false, true // Add
	case a.hAddFolder:
		return "\uE838", "添加文件夹", false, true // OpenFolder
	case a.hRemove:
		return "\uE738", "移除", false, true // Remove
	case a.hClear:
		return "\uE74D", "清空", false, true // Delete
	case a.hSelectAll:
		return "\uE762", "全选", false, true // MultiSelect
	case a.hInvert:
		return "\uE8AB", "反选", false, true // Switch
	case a.hSourceDir:
		return "\uE74A", "源目录", false, true // Up
	case a.hOutputDir:
		return "\uE74B", "输出目录", false, true // Down
	default:
		return "", "", false, false
	}
}

func (a *application) isHoverableControl(hwnd uintptr) bool {
	if a == nil || hwnd == 0 {
		return false
	}
	switch hwnd {
	case a.hVideo, a.hImage, a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear,
		a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir,
		a.hFFStatus, a.hGPUStatus, a.hPotStatus, a.hConcurrencyStatus, a.hRightToggle,
		a.hTaskApply, a.hTaskDefault, a.hPreview, a.hTrimCrop, a.hSingleOutput, a.hRetry,
		a.hOutputBrowse, a.hOutputPick, a.a.hAllDefault, a.hSmartPlan,
		a.hStart, a.hPause, a.hStop:
		return true
	default:
		return false
	}
}

func (a *application) updateHoverControl(hwnd uintptr) {
	next := uintptr(0)
	if a.isHoverableControl(hwnd) {
		next = hwnd
	}
	if next == a.hoverControl {
		return
	}
	old := a.hoverControl
	a.hoverControl = next
	if old != 0 {
		procInvalidateRect.Call(old, 0, 1)
	}
	if next != 0 {
		procInvalidateRect.Call(next, 0, 1)
	}
}

func (a *application) hovered(hwnd uintptr) bool {
	return a != nil && hwnd != 0 && a.hoverControl == hwnd
}

func drawCenteredText(hdc uintptr, text string, rc rect, font, color uintptr) {
	old, _, _ := procSelectObject.Call(hdc, font)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, color)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
	if old != 0 {
		procSelectObject.Call(hdc, old)
	}
}

func drawGDIline(hdc uintptr, x1, y1, x2, y2 int32) {
	procMoveToEx.Call(hdc, uintptr(x1), uintptr(y1), 0)
	procLineTo.Call(hdc, uintptr(x2), uintptr(y2))
}

func (a *application) drawToolbarGlyph(hdc, hwnd uintptr, rc rect, color uintptr) {
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	hollow, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldBrush, _, _ := procSelectObject.Call(hdc, hollow)
	cx := (rc.Left + rc.Right) / 2
	cy := (rc.Top + rc.Bottom) / 2
	left, top := cx-7, cy-6
	right, bottom := cx+7, cy+6

	switch hwnd {
	case a.hVideo:
		procRoundRect.Call(hdc, uintptr(left), uintptr(top+1), uintptr(right), uintptr(bottom-1), 4, 4)
		drawGDIline(hdc, cx-2, cy-4, cx+5, cy)
		drawGDIline(hdc, cx+5, cy, cx-2, cy+4)
		drawGDIline(hdc, cx-2, cy+4, cx-2, cy-4)
	case a.hImage:
		procRoundRect.Call(hdc, uintptr(left), uintptr(top), uintptr(right), uintptr(bottom), 3, 3)
		procEllipse.Call(hdc, uintptr(left+3), uintptr(top+3), uintptr(left+7), uintptr(top+7))
		drawGDIline(hdc, left+3, bottom-3, cx-2, cy)
		drawGDIline(hdc, cx-2, cy, cx+2, cy+4)
		drawGDIline(hdc, cx+2, cy+4, right-3, top+5)
	case a.hAddFiles:
		procRectangle.Call(hdc, uintptr(left+2), uintptr(top+2), uintptr(right-4), uintptr(bottom))
		drawGDIline(hdc, right-5, top-2, right-5, top+7)
		drawGDIline(hdc, right-9, top+2, right-1, top+2)
	case a.hAddFolder:
		drawGDIline(hdc, left, top+3, left+7, top+3)
		drawGDIline(hdc, left+7, top+3, left+10, top+6)
		drawGDIline(hdc, left+10, top+6, right, top+6)
		drawGDIline(hdc, right, top+6, right, bottom)
		drawGDIline(hdc, right, bottom, left, bottom)
		drawGDIline(hdc, left, bottom, left, top+3)
		drawGDIline(hdc, cx+4, cy-1, cx+4, cy+7)
		drawGDIline(hdc, cx, cy+3, cx+8, cy+3)
	case a.hRemove:
		drawGDIline(hdc, left+3, cy, right-3, cy)
	case a.hClear:
		drawGDIline(hdc, left+4, top+2, right-4, bottom-2)
		drawGDIline(hdc, right-4, top+2, left+4, bottom-2)
	case a.hSelectAll:
		procRectangle.Call(hdc, uintptr(left+1), uintptr(top), uintptr(right-1), uintptr(bottom))
		drawGDIline(hdc, left+5, cy, cx-1, bottom-4)
		drawGDIline(hdc, cx-1, bottom-4, right-4, top+4)
	case a.hInvert:
		drawGDIline(hdc, left+1, cy-4, right-3, cy-4)
		drawGDIline(hdc, right-3, cy-4, right-7, cy-8)
		drawGDIline(hdc, left+3, cy+4, right-1, cy+4)
		drawGDIline(hdc, left+3, cy+4, left+7, cy+8)
	case a.hSourceDir:
		procRectangle.Call(hdc, uintptr(left), uintptr(top+2), uintptr(right-3), uintptr(bottom))
		drawGDIline(hdc, cx, cy+3, right, top-2)
		drawGDIline(hdc, right, top-2, right, top+5)
		drawGDIline(hdc, right, top-2, right-7, top-2)
	case a.hOutputDir:
		procRectangle.Call(hdc, uintptr(left), uintptr(top), uintptr(right-3), uintptr(bottom-2))
		drawGDIline(hdc, cx, cy-3, right, bottom+2)
		drawGDIline(hdc, right, bottom+2, right, bottom-5)
		drawGDIline(hdc, right, bottom+2, right-7, bottom+2)
	}

	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

func (a *application) drawPrimaryButton(dis *drawItemStruct) bool {
	if dis == nil || (dis.HwndItem != a.hStart && dis.HwndItem != a.hPause && dis.HwndItem != a.hStop) {
		return false
	}
	pressed := dis.ItemState&ODS_SELECTED != 0
	disabled := dis.ItemState&ODS_DISABLED != 0
	hovered := a.hovered(dis.HwndItem)
	bg, border := colorRef(31, 111, 213), colorRef(23, 96, 190)
	if dis.HwndItem == a.hPause {
		bg, border = colorRef(218, 143, 28), colorRef(191, 119, 18)
	} else if dis.HwndItem == a.hStop {
		bg, border = colorRef(202, 73, 67), colorRef(176, 57, 52)
	}
	textColor := colorRef(255, 255, 255)
	if hovered && !disabled {
		bg = mixColor(bg, colorRef(255, 255, 255), .10)
		border = mixColor(border, colorRef(255, 255, 255), .06)
	}
	if pressed && !disabled {
		bg = mixColor(bg, colorRef(0, 0, 0), .13)
		border = bg
	}
	if disabled {
		bg = colorRef(232, 235, 240)
		border = colorRef(218, 223, 230)
		textColor = colorRef(145, 153, 164)
	}
	rc := dis.RcItem
	brush, _, _ := procCreateSolidBrush.Call(bg)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, border)
	oldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	procRoundRect.Call(dis.HDC, uintptr(rc.Left+1), uintptr(rc.Top+1), uintptr(rc.Right-1), uintptr(rc.Bottom-1), 7, 7)
	procSelectObject.Call(dis.HDC, oldBrush)
	procSelectObject.Call(dis.HDC, oldPen)
	procDeleteObject.Call(brush)
	procDeleteObject.Call(pen)

	glyph := "\uE768"
	if dis.HwndItem != a.hStart {
		glyph = secondaryButtonGlyph(dis.HwndItem)
	}
	iconRC := rc
	iconRC.Left += 9
	iconRC.Right = iconRC.Left + 22
	drawCenteredText(dis.HDC, glyph, iconRC, iconFont, textColor)
	textRC := rc
	textRC.Left += 22
	drawCenteredText(dis.HDC, getText(dis.HwndItem), textRC, uiFontBold, textColor)
	return true
}

func (a *application) drawToolbarButton(dis *drawItemStruct) bool {
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

func (a *application) secondaryButtonKind(hwnd uintptr) (string, bool) {
	switch hwnd {
	case a.hTaskApply, a.hTaskDefault, a.hPreview, a.hTrimCrop, a.hSingleOutput, a.hRetry,
		a.hOutputBrowse, a.hOutputPick, a.a.hAllDefault, a.hSmartPlan, a.hPause, a.hStop, a.hRightToggle:
		return getText(hwnd), true
	default:
		return "", false
	}
}

func drawChevron(hdc uintptr, rc rect, right bool, color uintptr) {
	pen, _, _ := procCreatePen.Call(PS_SOLID, 2, color)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	cx := (rc.Left + rc.Right) / 2
	cy := (rc.Top + rc.Bottom) / 2
	if right {
		drawGDIline(hdc, cx-3, cy-6, cx+3, cy)
		drawGDIline(hdc, cx+3, cy, cx-3, cy+6)
	} else {
		drawGDIline(hdc, cx+3, cy-6, cx-3, cy)
		drawGDIline(hdc, cx-3, cy, cx+3, cy+6)
	}
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

func drawFolderGlyph(hdc uintptr, rc rect, color uintptr) {
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	hollow, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldBrush, _, _ := procSelectObject.Call(hdc, hollow)
	x := rc.Left + 11
	y := (rc.Top+rc.Bottom)/2 - 6
	drawGDIline(hdc, x, y+3, x+6, y+3)
	drawGDIline(hdc, x+6, y+3, x+9, y+6)
	drawGDIline(hdc, x+9, y+6, x+20, y+6)
	drawGDIline(hdc, x+20, y+6, x+20, y+15)
	drawGDIline(hdc, x+20, y+15, x, y+15)
	drawGDIline(hdc, x, y+15, x, y+3)
	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

func secondaryButtonGlyph(hwnd uintptr) string {
	if app == nil {
		return ""
	}
	switch hwnd {
	case app.hOutputBrowse, app.hOutputPick:
		return "\uE838" // OpenFolder
	case app.hPause:
		if strings.Contains(getText(app.hPause), "继续") {
			return "\uE768" // Play
		}
		return "\uE769" // Pause
	case app.hStop:
		return "\uE71A" // Stop
	case app.hTaskApply:
		return "\uE73E" // CheckMark
	case app.hTaskDefault:
		return "\uE7A7" // Undo
	case app.hAllDefault:
		return "\uE72C" // Refresh / restore defaults
	case app.hPreview:
		return "\uE890" // View
	case app.hTrimCrop:
		return "\uE7A8" // Crop
	case app.hSingleOutput:
		return "\uE896" // Download
	case app.hRetry:
		return "\uE72C" // Refresh
	case app.hSmartPlan:
		return "\uE734" // FavoriteStar
	}
	return ""
}

func (a *application) drawSecondaryButton(dis *drawItemStruct) bool {
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

func colorParts(c uintptr) (uint8, uint8, uint8) {
	return uint8(c & 0xff), uint8((c >> 8) & 0xff), uint8((c >> 16) & 0xff)
}

func mixColor(a, b uintptr, t float64) uintptr {
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	ar, ag, ab := colorParts(a)
	br, bg, bb := colorParts(b)
	lerp := func(x, y uint8) uint8 { return uint8(float64(x) + (float64(y)-float64(x))*t + .5) }
	return colorRef(lerp(ar, br), lerp(ag, bg), lerp(ab, bb))
}

func fillSolid(hdc uintptr, rc rect, color uintptr) {
	if rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return
	}
	brush, _, _ := procCreateSolidBrush.Call(color)
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
	procDeleteObject.Call(brush)
}

func drawHorizontalGradient(hdc uintptr, rc rect, start, end uintptr) {
	width := rc.Right - rc.Left
	if width <= 0 || rc.Bottom <= rc.Top {
		return
	}
	step := int32(2)
	for x := int32(0); x < width; x += step {
		right := x + step
		if right > width {
			right = width
		}
		t := 0.0
		if width > 1 {
			t = float64(x) / float64(width-1)
		}
		fillSolid(hdc, rect{Left: rc.Left + x, Top: rc.Top, Right: rc.Left + right, Bottom: rc.Bottom}, mixColor(start, end, t))
	}
}

func withRoundedClip(hdc uintptr, rc rect, radius int32, draw func()) {
	saved, _, _ := procSaveDC.Call(hdc)
	rgn, _, _ := procCreateRoundRectRgn.Call(uintptr(rc.Left), uintptr(rc.Top), uintptr(rc.Right+1), uintptr(rc.Bottom+1), uintptr(radius), uintptr(radius))
	procSelectClipRgn.Call(hdc, rgn)
	draw()
	procDeleteObject.Call(rgn)
	procRestoreDC.Call(hdc, saved)
}

func drawRoundedBorder(hdc uintptr, rc rect, radius int32, color uintptr) {
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	hollow, _, _ := procGetStockObject.Call(NULL_BRUSH)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	oldBrush, _, _ := procSelectObject.Call(hdc, hollow)
	procRoundRect.Call(hdc, uintptr(rc.Left), uintptr(rc.Top), uintptr(rc.Right), uintptr(rc.Bottom), uintptr(radius), uintptr(radius))
	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(pen)
}

func (a *application) drawOverallProgress(dis *drawItemStruct) bool {
	if dis == nil || dis.HwndItem != a.hProgress {
		return false
	}
	rc := dis.RcItem
	bar := rect{Left: rc.Left + 1, Top: rc.Top + 2, Right: rc.Right - 1, Bottom: rc.Bottom - 2}
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

func (a *application) drawDecoration(dis *drawItemStruct) bool {
	if dis == nil {
		return false
	}
	switch dis.HwndItem {
	case a.hToolbarDivider:
		fillSolid(dis.HDC, dis.RcItem, colorRef(235, 238, 242))
		return true
	case a.hHeaderLine:
		fillSolid(dis.HDC, dis.RcItem, colorRef(226, 230, 236))
		return true
	case a.hDetailsFrame:
		fillSolid(dis.HDC, dis.RcItem, colorRef(250, 251, 253))
		return true
	}
	return false
}

func drawActionGlyph(hdc, hwnd uintptr, rc rect, color uintptr) bool {
	cx := rc.Left + 16
	cy := (rc.Top + rc.Bottom) / 2
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, color)
	old, _, _ := procSelectObject.Call(hdc, pen)
	drawn := true
	switch hwnd {
	case app.hTaskApply:
		drawGDIline(hdc, cx-5, cy, cx-1, cy+4)
		drawGDIline(hdc, cx-1, cy+4, cx+6, cy-5)
	case app.hTaskDefault, app.hAllDefault:
		procEllipse.Call(hdc, uintptr(cx-6), uintptr(cy-6), uintptr(cx+6), uintptr(cy+6))
		drawGDIline(hdc, cx+3, cy-6, cx+7, cy-6)
		drawGDIline(hdc, cx+7, cy-6, cx+7, cy-2)
	case app.hPreview:
		procEllipse.Call(hdc, uintptr(cx-7), uintptr(cy-4), uintptr(cx+7), uintptr(cy+4))
		procEllipse.Call(hdc, uintptr(cx-2), uintptr(cy-2), uintptr(cx+2), uintptr(cy+2))
	case app.hTrimCrop:
		drawGDIline(hdc, cx-6, cy-5, cx-6, cy+4)
		drawGDIline(hdc, cx-6, cy+4, cx+4, cy+4)
		drawGDIline(hdc, cx+6, cy+5, cx+6, cy-4)
		drawGDIline(hdc, cx+6, cy-4, cx-4, cy-4)
	case app.hSingleOutput:
		drawGDIline(hdc, cx, cy-7, cx, cy+3)
		drawGDIline(hdc, cx-4, cy-1, cx, cy+3)
		drawGDIline(hdc, cx, cy+3, cx+4, cy-1)
		drawGDIline(hdc, cx-6, cy+7, cx+6, cy+7)
	case app.hRetry:
		procEllipse.Call(hdc, uintptr(cx-6), uintptr(cy-6), uintptr(cx+6), uintptr(cy+6))
		drawGDIline(hdc, cx-7, cy-5, cx-2, cy-5)
		drawGDIline(hdc, cx-7, cy-5, cx-7, cy)
	default:
		drawn = false
	}
	procSelectObject.Call(hdc, old)
	procDeleteObject.Call(pen)
	return drawn
}

func (a *application) drawStatusChip(dis *drawItemStruct) bool {
	if dis == nil {
		return false
	}
	var text string
	var dot uintptr
	switch dis.HwndItem {
	case a.hFFStatus:
		text = "FFmpeg"
		ffmpeg, _, _, _, _ := a.componentSnapshot()
		if ffmpeg != "" {
			dot = colorRef(26, 151, 78)
		} else {
			dot = colorRef(207, 73, 63)
		}
	case a.hGPUStatus:
		text = "GPU"
		_, _, hardware, _, _ := a.componentSnapshot()
		if hardware.Available {
			dot = colorRef(26, 151, 78)
		} else {
			dot = colorRef(211, 132, 26)
		}
	case a.hPotStatus:
		text = "PotPlayer"
		_, _, _, _, ok := a.componentSnapshot()
		if ok {
			dot = colorRef(26, 151, 78)
		} else {
			dot = colorRef(145, 154, 166)
		}
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
		if pressed {
			bg, border = colorRef(228, 240, 253), colorRef(112, 158, 212)
		}
		withRoundedClip(dis.HDC, inner, 4, func() { fillSolid(dis.HDC, inner, bg) })
		drawRoundedBorder(dis.HDC, inner, 4, border)
	}
	diameter := scaleDPI(14)
	dotLeft := rc.Left + scaleDPI(6)
	dotTop := (rc.Top + rc.Bottom - diameter) / 2
	brush, _, _ := procCreateSolidBrush.Call(dot)
	oldBrush, _, _ := procSelectObject.Call(dis.HDC, brush)
	outline := mixColor(dot, colorRef(0, 0, 0), .24)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, outline)
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	procEllipse.Call(dis.HDC, uintptr(dotLeft), uintptr(dotTop), uintptr(dotLeft+diameter), uintptr(dotTop+diameter))
	procSelectObject.Call(dis.HDC, oldPen)
	procSelectObject.Call(dis.HDC, oldBrush)
	procDeleteObject.Call(pen)
	procDeleteObject.Call(brush)
	if rc.Right-rc.Left < 72 {
		switch dis.HwndItem {
		case a.hFFStatus:
			text = "FF"
		case a.hPotStatus:
			text = "Pot"
		case a.hConcurrencyStatus:
			text = fmt.Sprintf("并发%d", config.NormalizeConcurrency(a.settings.Concurrency))
		}
	}
	textRC := rc
	textRC.Left += scaleDPI(22)
	textRC.Right -= scaleDPI(2)
	old, _, _ := procSelectObject.Call(dis.HDC, uiFontSmall)
	procSetBkMode.Call(dis.HDC, TRANSPARENT)
	procSetTextColor.Call(dis.HDC, colorRef(45, 55, 69))
	procDrawTextW.Call(dis.HDC, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	if old != 0 {
		procSelectObject.Call(dis.HDC, old)
	}
	return true
}

func (a *application) statusTextColor(hwnd uintptr) (uintptr, bool) {
	ffmpeg, _, hardware, _, playerOK := a.componentSnapshot()
	switch hwnd {
	case a.hFFStatus:
		if ffmpeg != "" {
			return colorRef(16, 137, 71), true
		}
		return colorRef(190, 67, 55), true
	case a.hGPUStatus:
		if hardware.Available {
			return colorRef(16, 137, 71), true
		}
		return colorRef(196, 115, 0), true
	case a.hPotStatus:
		if playerOK {
			return colorRef(16, 137, 71), true
		}
		return colorRef(116, 126, 139), true
	default:
		return 0, false
	}
}

func (a *application) initMenus() {
	main, _, _ := procCreateMenu.Call()
	a.menuMain = main
	file, _, _ := procCreatePopupMenu.Call()
	appendMenu(file, MF_STRING, ID_FILE_ADD, "添加视频/图片...")
	appendMenu(file, MF_STRING, ID_FILE_FOLDER, "添加文件夹...")
	appendMenu(file, MF_SEPARATOR, 0, "")
	appendMenu(file, MF_STRING, ID_FILE_REMOVE, "移除选中")
	appendMenu(file, MF_STRING, ID_FILE_CLEAR, "清空列表")
	appendMenu(file, MF_SEPARATOR, 0, "")
	appendMenu(file, MF_STRING, ID_FILE_SOURCE, "打开源文件夹")
	appendMenu(file, MF_STRING, ID_FILE_OUTPUT, "打开输出文件夹")
	appendMenu(file, MF_STRING, ID_FILE_EXPORT_TASKS, "导出当前工作区任务清单 CSV")
	appendMenu(file, MF_STRING, ID_FILE_EXPORT_QUEUE_JSON, "导出当前工作区任务队列 JSON")
	appendMenu(file, MF_STRING, ID_FILE_IMPORT_QUEUE_JSON, "导入任务队列 JSON...")
	appendMenu(file, MF_SEPARATOR, 0, "")
	appendMenu(file, MF_STRING, ID_FILE_EXIT, "隐藏到系统托盘")
	edit, _, _ := procCreatePopupMenu.Call()
	appendMenu(edit, MF_STRING, ID_EDIT_SELECT_ALL, "全选")
	appendMenu(edit, MF_STRING, ID_EDIT_INVERT, "反选")
	appendMenu(edit, MF_STRING, ID_EDIT_RESET, "恢复选中任务默认参数")
	appendMenu(edit, MF_SEPARATOR, 0, "")
	appendMenu(edit, MF_STRING, ID_EDIT_RETRY_FAILED, "重新准备当前工作区的失败 / 停止任务")
	appendMenu(edit, MF_SEPARATOR, 0, "")
	appendMenu(edit, MF_STRING, ID_EDIT_CLEAN_DONE, "移除当前工作区已完成任务")
	appendMenu(edit, MF_STRING, ID_EDIT_CLEAN_PROBLEMS, "移除失败 / 跳过 / 停止任务")
	appendMenu(edit, MF_STRING, ID_EDIT_CLEAN_FINISHED, "清理当前工作区全部已结束任务")
	ff, _, _ := procCreatePopupMenu.Call()
	appendMenu(ff, MF_STRING, ID_FFMPEG_STATUS, "组件状态与路径...")
	appendMenu(ff, MF_STRING, ID_FFMPEG_SELECT, "选择本地 FFmpeg 文件夹...")
	appendMenu(ff, MF_STRING, ID_FFMPEG_IMPORT_ZIP, "导入已下载的 ZIP 组件包...")
	appendMenu(ff, MF_STRING, ID_FFMPEG_OPEN, "打开当前组件目录")
	appendMenu(ff, MF_STRING, ID_GPU_BENCHMARK, "运行本机编码器速度测试...")
	appendMenu(ff, MF_SEPARATOR, 0, "")
	appendMenu(ff, MF_STRING, ID_FFMPEG_DOWNLOAD_GYAN, "从 Gyan.dev 下载")
	appendMenu(ff, MF_STRING, ID_FFMPEG_DOWNLOAD_GITHUB, "从 GitHub 下载")
	player, _, _ := procCreatePopupMenu.Call()
	appendMenu(player, MF_STRING, ID_PLAYER_STATUS, "PotPlayer 状态与路径...")
	appendMenu(player, MF_STRING|MF_CHECKED, ID_PLAYER_AUTO, "自动检测 PotPlayer")
	appendMenu(player, MF_STRING, ID_PLAYER_SELECT, "手动指定 PotPlayer 程序...")
	appendMenu(player, MF_STRING, ID_PLAYER_DEFAULT, "使用 Windows 默认播放器")
	appendMenu(player, MF_STRING, ID_PLAYER_OPEN, "打开 PotPlayer 所在文件夹")
	settings, _, _ := procCreatePopupMenu.Call()
	a.menuSettings = settings
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_RECURSIVE, "添加文件夹时包含子文件夹")
	conc, _, _ := procCreatePopupMenu.Call()
	a.menuConcurrency = conc
	logicalProcessors := config.LogicalProcessorCount()
	concurrencyLimit := config.MaxConcurrency()
	appendMenu(conc, MF_STRING|MF_CHECKED, ID_SET_CONCURRENCY_AUTO, fmt.Sprintf("自动智能并发（%d 逻辑处理器，上限 %d）", logicalProcessors, concurrencyLimit))
	appendMenu(conc, MF_SEPARATOR, 0, "")
	for _, workers := range config.ConcurrencyChoices() {
		id := ID_SET_CONCURRENCY_BASE + workers
		a.concurrencyCommands[id] = workers
		label := fmt.Sprintf("%d 个并行任务", workers)
		if workers == concurrencyLimit {
			label += "（本机上限）"
		}
		appendMenu(conc, MF_STRING, uintptr(id), label)
	}
	appendMenu(settings, MF_POPUP, conc, "并行任务")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_GPU, "视频编码优先使用 GPU")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_GPU_FALLBACK, "GPU 失败自动回退 CPU")
	appendMenu(settings, MF_STRING, ID_SET_CLEAR_META, "清除 GPS 和设备元数据")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_PRESERVE_TIMES, "保留拍摄日期与文件时间")
	appendMenu(settings, MF_STRING, ID_SET_UPSCALE, "允许放大小分辨率视频")
	appendMenu(settings, MF_STRING, ID_SET_EXACT_SIZE, "目标体积使用两遍精确编码（仅 CPU）")
	appendMenu(settings, MF_STRING, ID_SET_SMART_COPY, "原尺寸且无需处理时智能复制视频流")
	audio, _, _ := procCreatePopupMenu.Call()
	appendMenu(audio, MF_STRING|MF_CHECKED, ID_SET_AUDIO_AAC, "AAC 192k（默认兼容）")
	appendMenu(audio, MF_STRING, ID_SET_AUDIO_COPY, "复制原音频流")
	appendMenu(audio, MF_STRING, ID_SET_AUDIO_MUTE, "静音输出")
	appendMenu(settings, MF_POPUP, audio, "音频处理")
	subtitle, _, _ := procCreatePopupMenu.Call()
	appendMenu(subtitle, MF_STRING|MF_CHECKED, ID_SET_SUBTITLE_NONE, "不保留字幕")
	appendMenu(subtitle, MF_STRING, ID_SET_SUBTITLE_TEXT, "保留文本字幕并转为 MP4 字幕")
	appendMenu(settings, MF_POPUP, subtitle, "字幕处理")
	name, _, _ := procCreatePopupMenu.Call()
	appendMenu(name, MF_STRING|MF_CHECKED, ID_SET_FILENAME_KEEP, "保持原文件名")
	appendMenu(name, MF_STRING, ID_SET_FILENAME_SUFFIX, "添加规格后缀")
	appendMenu(settings, MF_POPUP, name, "输出文件命名")
	conf, _, _ := procCreatePopupMenu.Call()
	appendMenu(conf, MF_STRING|MF_CHECKED, ID_SET_CONFLICT_NUMBER, "自动编号")
	appendMenu(conf, MF_STRING, ID_SET_CONFLICT_SKIP, "跳过已有")
	appendMenu(conf, MF_STRING, ID_SET_CONFLICT_OVERWRITE, "覆盖已有")
	appendMenu(settings, MF_POPUP, conf, "同名文件处理")
	appendMenu(settings, MF_SEPARATOR, 0, "")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_SESSION, "恢复任务会话")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_HISTORY, "保存最近转换记录")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_NOTIFY, "完成后显示 30 秒摘要通知")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_VERIFY_OUTPUT, "转换完成后自动校验输出")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_THUMB_CACHE, "启用缩略图磁盘缓存")
	appendMenu(settings, MF_STRING|MF_CHECKED, ID_SET_ESTIMATE_SPACE, "转换前估算磁盘空间")
	appendMenu(settings, MF_STRING, ID_SET_OPEN_DONE, "完成后打开输出文件夹")
	appendMenu(settings, MF_SEPARATOR, 0, "")
	appendMenu(settings, MF_STRING, ID_SET_PORTABLE_MODE, "切换便携模式（重启生效）")
	appendMenu(settings, MF_STRING, ID_SET_CONFIG_DIR, "打开配置、会话与历史目录")
	appendMenu(settings, MF_STRING, ID_SET_RESET, "恢复默认设置")
	preset, _, _ := procCreatePopupMenu.Call()
	appendMenu(preset, MF_STRING, ID_PRESET_1080, "手机视频 1080P · H.265 · 高 · 自动旋转")
	appendMenu(preset, MF_STRING, ID_PRESET_720, "小体积 720P · H.265 · 低 · 自动旋转")
	appendMenu(preset, MF_STRING, ID_PRESET_ORIGINAL, "原尺寸仅转正 · H.265 · 高 · 自动旋转")
	appendMenu(preset, MF_STRING, ID_PRESET_4K, "高质量 4K · H.265 · 高 · 自动旋转")
	appendMenu(preset, MF_SEPARATOR, 0, "")
	appendMenu(preset, MF_STRING, ID_PRESET_CUSTOM1, "自定义方案 1")
	appendMenu(preset, MF_STRING, ID_PRESET_CUSTOM2, "自定义方案 2")
	appendMenu(preset, MF_STRING, ID_PRESET_CUSTOM3, "自定义方案 3")
	appendMenu(preset, MF_SEPARATOR, 0, "")
	appendMenu(preset, MF_STRING, ID_PRESET_SAVE1, "保存当前参数到自定义方案 1")
	appendMenu(preset, MF_STRING, ID_PRESET_SAVE2, "保存当前参数到自定义方案 2")
	appendMenu(preset, MF_STRING, ID_PRESET_SAVE3, "保存当前参数到自定义方案 3")
	appendMenu(preset, MF_STRING, ID_PRESET_CLEAR, "清空全部自定义方案")
	appendMenu(preset, MF_SEPARATOR, 0, "")
	appendMenu(preset, MF_STRING, ID_PRESET_EXPORT, "导出自定义方案...")
	appendMenu(preset, MF_STRING, ID_PRESET_IMPORT, "导入自定义方案...")
	view, _, _ := procCreatePopupMenu.Call()
	a.menuView = view
	appendMenu(view, MF_STRING|MF_CHECKED, ID_VIEW_RIGHT, "显示右侧任务详情")
	appendMenu(view, MF_STRING|MF_CHECKED, ID_VIEW_FLOATING, "转换时显示桌面悬浮进度条")
	appendMenu(view, MF_STRING|MF_CHECKED, ID_VIEW_SIMPLE, "简洁模式（隐藏高级参数）")
	appendMenu(view, MF_STRING|MF_CHECKED, ID_VIEW_PERFORMANCE, "显示速度与体积统计")
	appendMenu(view, MF_SEPARATOR, 0, "")
	appendMenu(view, MF_STRING, ID_VIEW_RESET_COLUMNS, "恢复任务列表默认列宽")
	history, _, _ := procCreatePopupMenu.Call()
	appendMenu(history, MF_STRING, ID_HISTORY_VIEW, "查看最近转换记录...")
	appendMenu(history, MF_STRING, ID_HISTORY_LAST_SUMMARY, "查看上次任务总结...")
	appendMenu(history, MF_STRING, ID_HISTORY_CLEAR, "清空转换记录")
	help, _, _ := procCreatePopupMenu.Call()
	appendMenu(help, MF_STRING, ID_HELP_DIAGNOSTICS, "生成诊断报告...")
	appendMenu(help, MF_SEPARATOR, 0, "")
	appendMenu(help, MF_STRING, ID_HELP_ABOUT, "关于")
	appendMenu(main, MF_POPUP, file, "文件")
	appendMenu(main, MF_POPUP, edit, "编辑")
	appendMenu(main, MF_POPUP, ff, "FFmpeg")
	appendMenu(main, MF_POPUP, player, "播放器")
	appendMenu(main, MF_POPUP, settings, "设置")
	appendMenu(main, MF_POPUP, preset, "快速方案")
	appendMenu(main, MF_POPUP, view, "视图")
	appendMenu(main, MF_POPUP, history, "历史记录")
	appendMenu(main, MF_POPUP, help, "帮助")
	procSetMenu.Call(a.hwnd, main)
	a.syncMenuChecks()
}

func (a *application) syncMenuChecks() {
	setCheck(a.menuSettings, ID_SET_RECURSIVE, a.settings.IncludeSubdirs)
	setCheck(a.menuSettings, ID_SET_GPU, a.settings.UseGPU)
	setCheck(a.menuSettings, ID_SET_GPU_FALLBACK, a.settings.GPUFallback)
	setCheck(a.menuSettings, ID_SET_CLEAR_META, a.settings.ClearMetadata)
	setCheck(a.menuSettings, ID_SET_PRESERVE_TIMES, a.settings.PreserveTimes)
	setCheck(a.menuSettings, ID_SET_UPSCALE, a.settings.AllowUpscale)
	setCheck(a.menuSettings, ID_SET_EXACT_SIZE, a.settings.ExactTargetSize)
	setCheck(a.menuSettings, ID_SET_SESSION, a.settings.RestoreSession)
	setCheck(a.menuSettings, ID_SET_HISTORY, a.settings.SaveHistory)
	setCheck(a.menuSettings, ID_SET_NOTIFY, a.settings.NotifyOnDone)
	setCheck(a.menuSettings, ID_SET_VERIFY_OUTPUT, a.settings.VerifyOutput)
	setCheck(a.menuSettings, ID_SET_THUMB_CACHE, a.settings.ThumbnailCache)
	setCheck(a.menuSettings, ID_SET_ESTIMATE_SPACE, a.settings.EstimateDiskSpace)
	setCheck(a.menuSettings, ID_SET_SMART_COPY, a.settings.SmartStreamCopy)
	setCheck(a.menuSettings, ID_SET_AUDIO_AAC, a.settings.AudioMode == "AAC 192k")
	setCheck(a.menuSettings, ID_SET_AUDIO_COPY, a.settings.AudioMode == "复制音频")
	setCheck(a.menuSettings, ID_SET_AUDIO_MUTE, a.settings.AudioMode == "静音")
	setCheck(a.menuSettings, ID_SET_SUBTITLE_NONE, a.settings.SubtitleMode == "不保留字幕")
	setCheck(a.menuSettings, ID_SET_SUBTITLE_TEXT, a.settings.SubtitleMode == "保留文本字幕")
	setCheck(a.menuSettings, ID_SET_OPEN_DONE, a.settings.OpenOutputOnDone)
	setCheck(a.menuConcurrency, ID_SET_CONCURRENCY_AUTO, a.settings.AutoConcurrency)
	for id, workers := range a.concurrencyCommands {
		setCheck(a.menuConcurrency, id, !a.settings.AutoConcurrency && workers == config.NormalizeConcurrency(a.settings.Concurrency))
	}
	setCheck(a.menuSettings, ID_SET_FILENAME_KEEP, a.settings.FilenameMode == "保持原文件名")
	setCheck(a.menuSettings, ID_SET_FILENAME_SUFFIX, a.settings.FilenameMode == "添加规格后缀")
	setCheck(a.menuSettings, ID_SET_CONFLICT_NUMBER, a.settings.ConflictPolicy == "自动编号")
	setCheck(a.menuSettings, ID_SET_CONFLICT_SKIP, a.settings.ConflictPolicy == "跳过已有")
	setCheck(a.menuSettings, ID_SET_CONFLICT_OVERWRITE, a.settings.ConflictPolicy == "覆盖已有")
	setCheck(a.menuView, ID_VIEW_RIGHT, a.rightVisible)
	setCheck(a.menuView, ID_VIEW_FLOATING, a.settings.ShowFloatingBar)
	setCheck(a.menuView, ID_VIEW_SIMPLE, a.settings.InterfaceMode == "简洁")
	setCheck(a.menuView, ID_VIEW_PERFORMANCE, a.settings.ShowPerformanceStats)
}

var taskListColumns = []struct {
	name  string
	width int
}{
	// The default widths reproduce the v2.8.4 visual rhythm at a 1512 px window.
	// Extra width is distributed by distributeDefaultTaskColumns instead of
	// leaving a blank strip or forcing a horizontal scrollbar.
	{"文件 / 预览", 290}, {"分辨率", 105}, {"方向", 74}, {"输出分辨率", 120}, {"质量", 60},
	{"旋转", 94}, {"体积", 96}, {"压缩后", 140}, {"进度", 105}, {"状态", 124},
}

func normalizedTaskColumnWidths(widths []int) []int {
	result := make([]int, len(taskListColumns))
	for i, c := range taskListColumns {
		w := c.width
		if i < len(widths) && widths[i] >= 45 && widths[i] <= 900 {
			w = widths[i]
		}
		result[i] = w
	}
	return result
}

func (a *application) currentTaskColumnWidths() []int {
	if a == nil || a.hList == 0 {
		return normalizedTaskColumnWidths(nil)
	}
	widths := make([]int, len(taskListColumns))
	for i := range widths {
		w := int(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(i), 0))
		if w < 45 || w > 900 {
			w = taskListColumns[i].width
		}
		widths[i] = w
	}
	return widths
}

func (a *application) applyTaskColumnWidths(widths []int) {
	for i, w := range normalizedTaskColumnWidths(widths) {
		send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(i), uintptr(w))
	}
}

func (a *application) resetTaskColumnWidths() {
	a.settings.TaskColumnWidths = normalizedTaskColumnWidths(nil)
	a.applyTaskColumnWidths(a.settings.TaskColumnWidths)
	a.saveSettings()
	setText(a.hStatusText, "任务列表列宽已恢复默认值。")
}

func (a *application) initControls() {
	// Top toolbar: native desktop density, small line icons and quiet surfaces.
	a.hVideo = createControl("BUTTON", "视频转换", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW|BS_DEFPUSHBUTTON, 8, 5, 86, 58, a.hwnd, IDC_TAB_VIDEO)
	a.hImage = createControl("BUTTON", "图片压缩", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 100, 5, 86, 58, a.hwnd, IDC_TAB_IMAGE)
	a.hToolbarDivider = createControl("STATIC", "", WS_CHILD|WS_VISIBLE|SS_OWNERDRAW, 191, 14, 1, 38, a.hwnd, 0)
	a.hAddFiles = createControl("BUTTON", "添加文件", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 194, 5, 78, 58, a.hwnd, IDC_ADD_FILES)
	a.hAddFolder = createControl("BUTTON", "添加文件夹", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 278, 5, 88, 58, a.hwnd, IDC_ADD_FOLDER)
	a.hRemove = createControl("BUTTON", "移除", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 372, 5, 66, 58, a.hwnd, IDC_REMOVE)
	a.hClear = createControl("BUTTON", "清空", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 444, 5, 66, 58, a.hwnd, IDC_CLEAR)
	a.hSelectAll = createControl("BUTTON", "全选", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 516, 5, 66, 58, a.hwnd, IDC_SELECT_ALL)
	a.hInvert = createControl("BUTTON", "反选", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 588, 5, 66, 58, a.hwnd, IDC_INVERT)
	a.hSourceDir = createControl("BUTTON", "源目录", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 660, 5, 76, 58, a.hwnd, IDC_SOURCE_DIR)
	a.hOutputDir = createControl("BUTTON", "输出目录", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 742, 5, 82, 58, a.hwnd, IDC_OUTPUT_DIR)

	a.hSearch = createControlEx(0, "EDIT", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|WS_BORDER|ES_AUTOHSCROLL, 930, 18, 320, 30, a.hwnd, IDC_SEARCH)
	procSetWindowTheme.Call(a.hSearch, uintptr(unsafe.Pointer(p("Explorer"))), 0)
	send(a.hSearch, EM_SETCUEBANNER, 1, uintptr(unsafe.Pointer(p("搜索文件名、路径或状态"))))
	a.hFilter = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL, 1260, 17, 126, 220, a.hwnd, IDC_FILTER)
	procSetWindowTheme.Call(a.hFilter, uintptr(unsafe.Pointer(p("CFD"))), 0)
	comboFill(a.hFilter, []string{"全部状态", "准备中", "队列中", "转换中", "暂停", "完成", "失败", "已跳过", "已停止"}, "全部状态")

	// Status chips are owner drawn so their dots remain visible and text never clips.
	a.hFFStatus = createControl("BUTTON", "FFmpeg", WS_CHILD|WS_VISIBLE|BS_OWNERDRAW, 1394, 18, 92, 30, a.hwnd, ID_FFMPEG_STATUS)
	a.hGPUStatus = createControl("BUTTON", "GPU", WS_CHILD|WS_VISIBLE|BS_OWNERDRAW, 1490, 18, 72, 30, a.hwnd, ID_GPU_STATUS)
	a.hPotStatus = createControl("BUTTON", "PotPlayer", WS_CHILD|WS_VISIBLE|BS_OWNERDRAW, 1566, 18, 112, 30, a.hwnd, ID_PLAYER_STATUS)
	a.hConcurrencyStatus = createControl("BUTTON", "自动并发", WS_CHILD|WS_VISIBLE|BS_OWNERDRAW, 1682, 18, 96, 30, a.hwnd, ID_CONCURRENCY_STATUS)
	a.hRightToggle = createControl("BUTTON", "", WS_CHILD|WS_VISIBLE|BS_OWNERDRAW, 1782, 18, 32, 30, a.hwnd, IDC_RIGHT_TOGGLE)

	// Task list deliberately keeps one clear border and no grid-line style.
	a.hList = createControlEx(WS_EX_CLIENTEDGE, "SysListView32", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|LVS_REPORT|LVS_SHOWSELALWAYS, 8, 68, 1380, 650, a.hwnd, IDC_LIST)
	send(a.hList, WM_SETFONT, uiFontSmall, 1)
	send(a.hList, LVM_SETEXTENDEDLISTVIEWSTYLE, 0, LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_INFOTIP)
	procSetWindowTheme.Call(a.hList, uintptr(unsafe.Pointer(p(""))), uintptr(unsafe.Pointer(p(""))))
	header := send(a.hList, LVM_GETHEADER, 0, 0)
	if header != 0 {
		procSetWindowTheme.Call(header, uintptr(unsafe.Pointer(p("ItemsView"))), 0)
		send(header, WM_SETFONT, uiFont, 1)
	}
	send(a.hList, LVM_SETBKCOLOR, 0, colorRef(255, 255, 255))
	send(a.hList, LVM_SETTEXTBKCOLOR, 0, colorRef(255, 255, 255))
	send(a.hList, LVM_SETTEXTCOLOR, 0, colorRef(52, 61, 74))
	a.hImageList, _, _ = procImageListCreate.Call(86, 48, ILC_COLOR32, 32, 32)
	if a.hImageList != 0 {
		send(a.hList, LVM_SETIMAGELIST, LVSIL_SMALL, a.hImageList)
	}
	widths := normalizedTaskColumnWidths(a.settings.TaskColumnWidths)
	for i, c := range taskListColumns {
		q := p(c.name)
		col := lvColumn{Mask: LVCF_TEXT | LVCF_WIDTH | LVCF_FMT, Fmt: LVCFMT_LEFT, Cx: int32(widths[i]), PszText: q}
		send(a.hList, LVM_INSERTCOLUMNW, uintptr(i), uintptr(unsafe.Pointer(&col)))
	}
	a.hHeaderLine = createControl("STATIC", "", WS_CHILD|WS_VISIBLE|SS_OWNERDRAW, 9, 95, 100, 1, a.hwnd, 0)

	// Retained only for compatibility; import feedback is routed to the bottom status line.
	a.hImportToast = createControl("STATIC", "", WS_CHILD, 0, 0, 0, 0, a.hwnd, 0)

	// Right panel follows the compact v2.8.4 arrangement, without card backgrounds.
	a.hRightTitle = createControl("STATIC", "尚未选择任务", WS_CHILD|WS_VISIBLE, 1400, 72, 250, 28, a.hwnd, 0)
	send(a.hRightTitle, WM_SETFONT, uiFontTitle, 1)
	labels := []string{"输出", "格式", "质量", "体积", "旋转"}
	for i, text := range labels {
		h := createControl("STATIC", text, WS_CHILD|WS_VISIBLE|SS_LEFT, 1400, int32(112+i*38), 42, 24, a.hwnd, 0)
		send(h, WM_SETFONT, uiFontSmall, 1)
		a.rightLabels = append(a.rightLabels, h)
	}
	a.hTaskRes = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1444, 108, 205, 200, a.hwnd, IDC_TASK_RES)
	a.hTaskCodec = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1444, 146, 205, 180, a.hwnd, IDC_TASK_CODEC)
	a.hTaskQuality = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1444, 184, 205, 180, a.hwnd, IDC_TASK_QUALITY)
	a.hTaskVolume = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1444, 222, 205, 220, a.hwnd, IDC_TASK_VOLUME)
	a.hTaskRotation = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1444, 260, 205, 240, a.hwnd, IDC_TASK_ROTATION)
	for _, h := range []uintptr{a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation} {
		procSetWindowTheme.Call(h, uintptr(unsafe.Pointer(p("CFD"))), 0)
		send(h, WM_SETFONT, uiFontSmall, 1)
	}
	comboFill(a.hTaskRes, videoResolutions(), "1080P")
	comboFill(a.hTaskCodec, []string{"H.265", "H.264"}, "H.265")
	comboFill(a.hTaskQuality, []string{"高", "中", "低"}, "高")
	comboFill(a.hTaskVolume, volumeModes(), "质量优先")
	comboFill(a.hTaskRotation, rotations(), "自动")
	a.hTaskApply = createControl("BUTTON", "应用到选中", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1400, 302, 120, 30, a.hwnd, IDC_TASK_APPLY)
	a.hTaskDefault = createControl("BUTTON", "恢复选中默认", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1528, 302, 121, 30, a.hwnd, IDC_TASK_DEFAULT)
	a.hPreview = createControl("BUTTON", "预览", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1400, 338, 120, 30, a.hwnd, IDC_PREVIEW)
	a.hTrimCrop = createControl("BUTTON", "时长 / 画面", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1528, 338, 121, 30, a.hwnd, IDC_TRIM_CROP)
	a.hSingleOutput = createControl("BUTTON", "单独输出", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1400, 374, 120, 30, a.hwnd, IDC_SINGLE_OUTPUT)
	a.hRetry = createControl("BUTTON", "重试失败", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1528, 374, 121, 30, a.hwnd, IDC_RETRY)
	a.hDetailsFrame = createControl("STATIC", "", WS_CHILD|WS_VISIBLE|SS_OWNERDRAW, 1400, 414, 249, 300, a.hwnd, 0)
	a.hDetails = createControl("EDIT", "选择一个或多个任务后，可在这里查看源信息、输出设置和警告，并只修改选中项。\r\n\r\n支持 Ctrl/Shift 多选、右键菜单和双击预览。", WS_CHILD|WS_VISIBLE|ES_MULTILINE|ES_AUTOVSCROLL|ES_READONLY, 1408, 422, 233, 284, a.hwnd, 0)
	send(a.hDetails, WM_SETFONT, uiFontSmall, 1)
	send(a.hDetails, EM_SETMARGINS, EC_LEFTMARGIN|EC_RIGHTMARGIN, uintptr(8|(8<<16)))

	// Bottom control strip mirrors v2.8.4: one output row, one progress row, one status row.
	a.hOutputBrowse = createControl("BUTTON", "输出母目录", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 8, 730, 116, 32, a.hwnd, IDC_OUTPUT_BROWSE)
	a.hOutputEdit = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWN|CBS_AUTOHSCROLL|WS_VSCROLL, 130, 730, 560, 240, a.hwnd, IDC_OUTPUT_EDIT)
	a.hOutputPick = createControl("BUTTON", "浏览", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 696, 730, 72, 32, a.hwnd, IDC_OUTPUT_PICK)
	send(a.hOutputEdit, WM_SETFONT, uiFont, 1)
	procSetWindowTheme.Call(a.hOutputEdit, uintptr(unsafe.Pointer(p("CFD"))), 0)
	a.refreshOutputHistory()
	for _, text := range []string{"输出", "格式", "质量", "体积", "旋转"} {
		h := createControl("STATIC", text, WS_CHILD|WS_VISIBLE|SS_CENTER, 0, 0, 34, 28, a.hwnd, 0)
		send(h, WM_SETFONT, uiFontSmall, 1)
		a.globalLabels = append(a.globalLabels, h)
	}
	a.hResolution = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 760, 730, 84, 220, a.hwnd, IDC_RESOLUTION)
	a.hCodec = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 862, 730, 78, 180, a.hwnd, IDC_CODEC)
	a.hQuality = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 960, 730, 72, 180, a.hwnd, IDC_QUALITY)
	a.hSpeedMode = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1034, 730, 92, 180, a.hwnd, IDC_SPEED_MODE)
	a.hVolume = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1034, 730, 126, 240, a.hwnd, IDC_VOLUME)
	a.hRotation = createControl("COMBOBOX", "", WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST, 1172, 730, 98, 260, a.hwnd, IDC_ROTATION)
	for _, h := range []uintptr{a.hResolution, a.hCodec, a.hQuality, a.hSpeedMode, a.hVolume, a.hRotation} {
		procSetWindowTheme.Call(h, uintptr(unsafe.Pointer(p("CFD"))), 0)
		send(h, WM_SETFONT, uiFontSmall, 1)
	}
	comboFill(a.hResolution, videoResolutions(), a.settings.Resolution)
	comboFill(a.hCodec, []string{"H.265", "H.264"}, a.settings.Codec)
	comboFill(a.hQuality, []string{"高", "中", "低"}, a.settings.Quality)
	comboFill(a.hSpeedMode, speedModes(), a.settings.SpeedMode)
	comboFill(a.hVolume, volumeModes(), a.settings.VolumeMode)
	comboFill(a.hRotation, rotations(), a.settings.Rotation)
	a.hAllDefault = createControl("BUTTON", "全部恢复默认", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1424, 730, 124, 32, a.hwnd, IDC_ALL_DEFAULT)
	a.hSmartPlan = createControl("BUTTON", "智能方案", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1286, 730, 132, 32, a.hwnd, IDC_SMART_PLAN)

	a.hProgress = createControl("STATIC", "", WS_CHILD|WS_VISIBLE|SS_OWNERDRAW, 8, 770, 1572, 22, a.hwnd, 0)
	a.hProgressText = createControl("STATIC", "", WS_CHILD, 0, 0, 0, 0, a.hwnd, 0)
	a.overallText = "已完成 0/0 · 总进度 0.0%"
	a.hStatusText = createControl("STATIC", "就绪。", WS_CHILD|WS_VISIBLE, 8, 798, 1120, 30, a.hwnd, 0)
	send(a.hStatusText, WM_SETFONT, uiFontSmall, 1)
	a.hStart = createControl("BUTTON", "开始转换", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1210, 796, 140, 36, a.hwnd, IDC_START)
	a.hPause = createControl("BUTTON", "暂停", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1358, 796, 108, 36, a.hwnd, IDC_PAUSE)
	a.hStop = createControl("BUTTON", "停止", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW, 1474, 796, 108, 36, a.hwnd, IDC_STOP)
	enable(a.hPause, false)
	enable(a.hStop, false)
	procDragAcceptFiles.Call(a.hwnd, 1)
	a.updateComponentStatus()
	a.switchKind(model.KindVideo)
}

func videoResolutions() []string { return []string{"4K", "1080P", "720P", "480P", "原尺寸"} }
func speedModes() []string       { return []string{"极速", "均衡", "高质量"} }
func imageSizes() []string {
	return []string{"保持原尺寸", "最大边 3840px", "最大边 2560px", "最大边 1920px", "最大边 1280px", "最大边 1000px"}
}
func rotations() []string {
	return []string{"自动", "0°", "90°右转", "90°左转", "180°", "左右翻转", "上下翻转"}
}
func volumeModes() []string {
	return []string{"质量优先", "目标体积 50MB", "目标体积 100MB", "目标体积 200MB", "目标体积 500MB", "码率 1Mbps", "码率 2Mbps", "码率 5Mbps", "码率 10Mbps", "码率 20Mbps"}
}

func comboFill(hwnd uintptr, values []string, selected string) {
	send(hwnd, CB_RESETCONTENT, 0, 0)
	pick := 0
	for i, s := range values {
		send(hwnd, CB_ADDSTRING, 0, uintptr(unsafe.Pointer(p(s))))
		if s == selected {
			pick = i
		}
	}
	send(hwnd, CB_SETCURSEL, uintptr(pick), 0)
}
func comboText(hwnd uintptr) string {
	i := int(send(hwnd, CB_GETCURSEL, 0, 0))
	if i < 0 {
		return ""
	}
	buf := make([]uint16, 260)
	send(hwnd, CB_GETLBTEXT, uintptr(i), uintptr(unsafe.Pointer(&buf[0])))
	return syscall.UTF16ToString(buf)
}

func scaleDPIValue(v int32, dpi uint32) int32 {
	if dpi < 1 {
		dpi = 96
	}
	if v < 0 {
		return -scaleDPIValue(-v, dpi)
	}
	return int32((int64(v)*int64(dpi) + 48) / 96)
}

func scaleDPI(v int32) int32 { return scaleDPIValue(v, uiDPI) }

func unscaleDPI(v int32) int32 {
	if uiDPI < 1 {
		return v
	}
	return int32((int64(v)*96 + int64(uiDPI)/2) / int64(uiDPI))
}

func (a *application) recreateFontsForDPI() {
	old := []uintptr{uiFontSmall, uiFont, uiFontBold, uiFontTitle, iconFont}
	uiFontSmall = createUIFont("Microsoft YaHei UI", -14, 400)
	uiFont = createUIFont("Microsoft YaHei UI", -16, 400)
	uiFontBold = createUIFont("Microsoft YaHei UI", -16, 550)
	uiFontTitle = createUIFont("Microsoft YaHei UI", -18, 600)
	iconFont = createUIFont("Segoe MDL2 Assets", -18, 400)
	for _, h := range old {
		if h != 0 {
			procDeleteObject.Call(h)
		}
	}
	if a == nil || !a.controlsReady {
		return
	}
	all := []uintptr{a.hVideo, a.hImage, a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear, a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir, a.hSearch, a.hFilter, a.hList, a.hFFStatus, a.hGPUStatus, a.hPotStatus, a.hConcurrencyStatus, a.hRightToggle, a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation, a.hTaskApply, a.hTaskDefault, a.hPreview, a.hTrimCrop, a.hSingleOutput, a.hRetry, a.hDetails, a.hOutputEdit, a.hOutputBrowse, a.hOutputPick, a.hResolution, a.hCodec, a.hQuality, a.hSpeedMode, a.hVolume, a.hRotation, a.a.hAllDefault, a.hSmartPlan, a.hStatusText, a.hStart, a.hPause, a.hStop}
	for _, h := range all {
		if h != 0 {
			send(h, WM_SETFONT, uiFont, 1)
		}
	}
	for _, h := range append(append([]uintptr{}, a.rightLabels...), a.globalLabels...) {
		if h != 0 {
			send(h, WM_SETFONT, uiFontSmall, 1)
		}
	}
	for _, h := range []uintptr{a.hList, a.hDetails, a.hStatusText} {
		if h != 0 {
			send(h, WM_SETFONT, uiFontSmall, 1)
		}
	}
	if a.hRightTitle != 0 {
		send(a.hRightTitle, WM_SETFONT, uiFontTitle, 1)
	}
	if a.hList != 0 {
		if header := send(a.hList, LVM_GETHEADER, 0, 0); header != 0 {
			send(header, WM_SETFONT, uiFont, 1)
		}
	}
}

func childClientRect(hwnd, parent uintptr) (rect, bool) {
	var r rect
	if hwnd == 0 || parent == 0 {
		return r, false
	}
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
		return r, false
	}
	pts := (*[2]point)(unsafe.Pointer(&r))
	procMapWindowPoints.Call(0, parent, uintptr(unsafe.Pointer(&pts[0])), 2)
	return r, true
}

func rectsOverlap(a, b rect) bool {
	return a.Left < b.Right && a.Right > b.Left && a.Top < b.Bottom && a.Bottom > b.Top
}

func (a *application) validateCurrentLayout(clientW, clientH int32) error {
	toolbar := []uintptr{a.hVideo, a.hImage, a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear, a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir}
	controls := append(append([]uintptr{}, toolbar...), a.hSearch, a.hFilter, a.hFFStatus, a.hGPUStatus, a.hPotStatus, a.hConcurrencyStatus, a.hRightToggle)
	rects := make(map[uintptr]rect, len(controls))
	for i, h := range controls {
		r, ok := childClientRect(h, a.hwnd)
		if !ok {
			return fmt.Errorf("top control %d missing", i)
		}
		if r.Left < 0 || r.Top < 0 || r.Right > clientW || r.Bottom > clientH {
			return fmt.Errorf("top control %d outside client: %+v", i, r)
		}
		rects[h] = r
	}
	for i := 1; i < len(toolbar); i++ {
		if rectsOverlap(rects[toolbar[i-1]], rects[toolbar[i]]) {
			return fmt.Errorf("toolbar buttons overlap: %d %+v %+v", i, rects[toolbar[i-1]], rects[toolbar[i]])
		}
	}
	if rects[a.hOutputDir].Right > rects[a.hSearch].Left {
		return fmt.Errorf("toolbar enters search area: toolbar=%+v search=%+v", rects[a.hOutputDir], rects[a.hSearch])
	}
	if rectsOverlap(rects[a.hSearch], rects[a.hFilter]) {
		return fmt.Errorf("search and filter overlap: %+v %+v", rects[a.hSearch], rects[a.hFilter])
	}
	for _, left := range []uintptr{a.hSearch, a.hFilter} {
		for _, right := range []uintptr{a.hFFStatus, a.hGPUStatus, a.hPotStatus, a.hConcurrencyStatus, a.hRightToggle} {
			if rectsOverlap(rects[left], rects[right]) {
				return fmt.Errorf("top controls overlap: %+v %+v", rects[left], rects[right])
			}
		}
	}
	for _, pair := range [][2]uintptr{{a.hFFStatus, a.hGPUStatus}, {a.hPotStatus, a.hConcurrencyStatus}, {a.hFFStatus, a.hPotStatus}, {a.hGPUStatus, a.hConcurrencyStatus}} {
		if rectsOverlap(rects[pair[0]], rects[pair[1]]) {
			return fmt.Errorf("status grid overlaps: %+v %+v", rects[pair[0]], rects[pair[1]])
		}
	}
	ff, gpu := rects[a.hFFStatus], rects[a.hGPUStatus]
	pot, concurrency := rects[a.hPotStatus], rects[a.hConcurrencyStatus]
	if ff.Top != gpu.Top || pot.Top != concurrency.Top || ff.Left != pot.Left || gpu.Left != concurrency.Left || pot.Top <= ff.Bottom {
		return fmt.Errorf("status controls are not a 2x2 grid: ff=%+v gpu=%+v pot=%+v concurrency=%+v", ff, gpu, pot, concurrency)
	}
	progress, ok := childClientRect(a.hProgress, a.hwnd)
	if !ok {
		return fmt.Errorf("overall progress missing")
	}
	for _, h := range []uintptr{a.hStart, a.hPause, a.hStop} {
		r, ok := childClientRect(h, a.hwnd)
		if !ok {
			return fmt.Errorf("action control missing")
		}
		if rectsOverlap(progress, r) {
			return fmt.Errorf("progress overlaps action: %+v %+v", progress, r)
		}
		if r.Right > clientW || r.Bottom > clientH {
			return fmt.Errorf("action outside client: %+v", r)
		}
	}
	openButton, openOK := childClientRect(a.hOutputBrowse, a.hwnd)
	edit, editOK := childClientRect(a.hOutputEdit, a.hwnd)
	pickButton, pickOK := childClientRect(a.hOutputPick, a.hwnd)
	if !openOK || !editOK || !pickOK || rectsOverlap(openButton, edit) || rectsOverlap(edit, pickButton) || openButton.Right > edit.Left || edit.Right > pickButton.Left {
		return fmt.Errorf("output mother directory controls overlap: open=%+v edit=%+v pick=%+v", openButton, edit, pickButton)
	}
	return nil
}

func distributeDefaultTaskColumns(listW int32) []int {
	widths := normalizedTaskColumnWidths(nil)
	usable := int(listW) - 4
	total := 0
	for _, w := range widths {
		total += w
	}
	delta := usable - total
	if delta > 0 {
		first := delta * 65 / 100
		compression := delta * 15 / 100
		status := delta - first - compression
		widths[0] += first
		widths[7] += compression
		widths[9] += status
	} else if delta < 0 {
		need := -delta
		for _, spec := range []struct{ idx, min int }{{0, 210}, {9, 88}, {7, 112}, {8, 86}, {3, 92}, {1, 84}} {
			room := widths[spec.idx] - spec.min
			if room <= 0 {
				continue
			}
			take := room
			if take > need {
				take = need
			}
			widths[spec.idx] -= take
			need -= take
			if need == 0 {
				break
			}
		}
	}
	return widths
}

type topBand struct {
	toolWidths                                               []int32
	toolGap, searchTarget, filterW, statusGridW, statusCellH int32
}

func topBandForWidth(w int32) topBand {
	switch {
	case w >= 1500:
		return topBand{[]int32{92, 92, 84, 94, 66, 66, 66, 66, 80, 86}, 8, 282, 122, 206, 24}
	case w >= 1320:
		return topBand{[]int32{82, 82, 72, 80, 58, 58, 58, 58, 68, 72}, 7, 202, 104, 184, 24}
	case w >= 1120:
		return topBand{[]int32{66, 66, 56, 60, 48, 48, 48, 48, 54, 56}, 5, 152, 96, 168, 23}
	default:
		return topBand{[]int32{48, 48, 42, 42, 40, 40, 40, 40, 42, 42}, 3, 112, 82, 142, 22}
	}
}

func toolbarRightEdge(band topBand) int32 {
	x := int32(8)
	for i, width := range band.toolWidths {
		x += width + band.toolGap
		if i == 1 {
			x += 6
		}
	}
	return x
}

func (a *application) layout(w, h int32) {
	w = unscaleDPI(w)
	h = unscaleDPI(h)
	if a == nil || !a.controlsReady || a.initializing || a.hList == 0 || a.hOutputEdit == 0 || a.hProgress == 0 {
		return
	}
	if len(a.globalLabels) < 5 || len(a.rightLabels) < 5 || w < 900 || h < 620 {
		return
	}

	send(a.hwnd, WM_SETREDRAW, 0, 0)
	defer func() {
		send(a.hwnd, WM_SETREDRAW, 1, 0)
		procSetWindowPos.Call(a.hHeaderLine, 0, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)
		procRedrawWindow.Call(a.hwnd, 0, 0, RDW_INVALIDATE|RDW_ERASE|RDW_ALLCHILDREN|RDW_UPDATENOW)
	}()

	top := int32(68)
	band := topBandForWidth(w)

	toolHandles := []uintptr{a.hVideo, a.hImage, a.hAddFiles, a.hAddFolder, a.hRemove, a.hClear, a.hSelectAll, a.hInvert, a.hSourceDir, a.hOutputDir}
	xTool := int32(8)
	for i, control := range toolHandles {
		move(control, xTool, 5, band.toolWidths[i], 58)
		xTool += band.toolWidths[i] + band.toolGap
		if i == 1 {
			move(a.hToolbarDivider, xTool, 14, 1, 40)
			xTool += 6
		}
	}

	toggleW := int32(22)
	if w < 1120 {
		toggleW = 20
	}
	toggleX := w - 8 - toggleW
	move(a.hRightToggle, toggleX, 19, toggleW, 28)
	gridGap := int32(4)
	gridX := toggleX - 7 - band.statusGridW
	cellW := (band.statusGridW - gridGap) / 2
	row1 := int32(7)
	row2 := row1 + band.statusCellH + 3
	move(a.hFFStatus, gridX, row1, cellW, band.statusCellH)
	move(a.hGPUStatus, gridX+cellW+gridGap, row1, cellW, band.statusCellH)
	move(a.hPotStatus, gridX, row2, cellW, band.statusCellH)
	move(a.hConcurrencyStatus, gridX+cellW+gridGap, row2, cellW, band.statusCellH)

	filterX := gridX - 8 - band.filterW
	move(a.hFilter, filterX, 19, band.filterW, 220)
	searchRight := filterX - 7
	searchLeft := xTool + 8
	searchW := band.searchTarget
	available := searchRight - searchLeft
	if searchW > available {
		searchW = available
	}
	if searchW < 90 {
		searchW = 90
		searchLeft = searchRight - searchW
	}
	move(a.hSearch, searchRight-searchW, 19, searchW, 30)

	compactBottom := w < 1320
	bottomWidths := bottomParameterWidths()
	bottomBar := int32(126)
	if compactBottom {
		bottomBar = 164
	}
	rightW := int32(0)
	if a.rightVisible {
		rightW = 264
		if w < 1180 {
			rightW = 238
		}
	}
	listW := w - rightW - 24
	if listW < 520 {
		listW = 520
	}
	listH := h - top - bottomBar
	if listH < 260 {
		listH = 260
	}
	move(a.hList, 8, top, listW, listH)
	move(a.hHeaderLine, 9, top+28, listW-2, 2)
	if len(a.settings.TaskColumnWidths) == 0 {
		a.applyTaskColumnWidths(distributeDefaultTaskColumns(listW))
	}
	show(a.hImportToast, false)

	rightX := 16 + listW
	rightControls := append([]uintptr{a.hRightTitle, a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation, a.hTaskApply, a.hTaskDefault, a.hPreview, a.hTrimCrop, a.hSingleOutput, a.hRetry, a.hDetailsFrame, a.hDetails}, a.rightLabels...)
	for _, control := range rightControls {
		show(control, a.rightVisible)
	}
	if a.rightVisible {
		move(a.hRightTitle, rightX+2, top+4, rightW-14, 29)
		rowY := top + 40
		rowStep := int32(38)
		for i, label := range a.rightLabels {
			move(label, rightX+8, rowY+int32(i)*rowStep+4, 44, 24)
		}
		for i, combo := range []uintptr{a.hTaskRes, a.hTaskCodec, a.hTaskQuality, a.hTaskVolume, a.hTaskRotation} {
			move(combo, rightX+60, rowY+int32(i)*rowStep, rightW-74, 220)
		}
		actionY := rowY + 5*rowStep + 6
		buttonW := (rightW - 22) / 2
		move(a.hTaskApply, rightX+2, actionY, buttonW, 31)
		move(a.hTaskDefault, rightX+buttonW+10, actionY, buttonW, 31)
		move(a.hPreview, rightX+2, actionY+38, buttonW, 31)
		move(a.hTrimCrop, rightX+buttonW+10, actionY+38, buttonW, 31)
		move(a.hSingleOutput, rightX+2, actionY+76, buttonW, 31)
		move(a.hRetry, rightX+buttonW+10, actionY+76, buttonW, 31)
		detailsY := actionY + 114
		detailsH := top + listH - detailsY
		if detailsH < 90 {
			detailsH = 90
		}
		move(a.hDetailsFrame, rightX+2, detailsY, rightW-14, detailsH)
		move(a.hDetails, rightX+10, detailsY+8, rightW-30, detailsH-16)
	}

	barY := top + listH + 7
	simple := a.settings.InterfaceMode == "简洁"
	for _, control := range []uintptr{a.hCodec, a.hQuality, a.hVolume, a.hRotation, a.hAllDefault} {
		show(control, !simple)
	}
	for _, label := range a.globalLabels {
		show(label, !simple)
	}
	show(a.hSpeedMode, simple)
	show(a.hSmartPlan, simple)

	if compactBottom {
		move(a.hOutputBrowse, 8, barY, 116, 32)
		move(a.hOutputEdit, 130, barY, w-204, 32)
		move(a.hOutputPick, w-66, barY, 58, 32)
		x := int32(8)
		row2 := barY + 38
		if simple {
			for _, item := range []struct {
				h  uintptr
				wd int32
			}{{a.hResolution, 104}, {a.hSpeedMode, 92}, {a.hSmartPlan, 118}} {
				move(item.h, x, row2, item.wd, 31)
				x += item.wd + 7
			}
		} else {
			pairs := []struct {
				label, combo uintptr
				wd           int32
			}{{a.globalLabels[0], a.hResolution, bottomWidths.Resolution}, {a.globalLabels[1], a.hCodec, bottomWidths.Codec}, {a.globalLabels[2], a.hQuality, bottomWidths.Quality}, {a.globalLabels[3], a.hVolume, bottomWidths.Volume}, {a.globalLabels[4], a.hRotation, bottomWidths.Rotation}}
			for _, pair := range pairs {
				move(pair.label, x, row2+4, 38, 24)
				x += 38
				move(pair.combo, x, row2, pair.wd, 31)
				x += pair.wd + 6
			}
			move(a.hAllDefault, x, row2, minInt32(124, w-x-8), 31)
		}
		move(a.hProgress, 8, barY+76, w-16, 24)
		move(a.hStatusText, 8, barY+110, w-332, 34)
		move(a.hStart, w-324, barY+107, 116, 38)
		move(a.hPause, w-200, barY+107, 88, 38)
		move(a.hStop, w-104, barY+107, 88, 38)
	} else {
		move(a.hOutputBrowse, 8, barY, 116, 32)
		fixed := int32(38 + bottomWidths.Resolution + 7 + 34 + bottomWidths.Codec + 7 + 34 + bottomWidths.Quality + 7 + 34 + bottomWidths.Volume + 7 + 34 + bottomWidths.Rotation + 8 + 124)
		editW := w - 8 - 116 - 6 - 60 - 8 - fixed - 8
		if simple {
			editW = w - 8 - 116 - 6 - 60 - 8 - (106 + 7 + 92 + 7 + 122) - 8
		}
		if editW < 210 {
			editW = 210
		}
		move(a.hOutputEdit, 130, barY, editW, 32)
		move(a.hOutputPick, 136+editW, barY, 60, 32)
		x := int32(204) + editW
		if simple {
			for _, item := range []struct {
				h  uintptr
				wd int32
			}{{a.hResolution, 106}, {a.hSpeedMode, 92}, {a.hSmartPlan, 122}} {
				move(item.h, x, barY, item.wd, 32)
				x += item.wd + 7
			}
		} else {
			pairs := []struct {
				label, combo   uintptr
				labelW, comboW int32
			}{{a.globalLabels[0], a.hResolution, 38, bottomWidths.Resolution}, {a.globalLabels[1], a.hCodec, 34, bottomWidths.Codec}, {a.globalLabels[2], a.hQuality, 34, bottomWidths.Quality}, {a.globalLabels[3], a.hVolume, 34, bottomWidths.Volume}, {a.globalLabels[4], a.hRotation, 34, bottomWidths.Rotation}}
			for _, pair := range pairs {
				move(pair.label, x, barY+4, pair.labelW, 24)
				x += pair.labelW
				move(pair.combo, x, barY, pair.comboW, 32)
				x += pair.comboW + 7
			}
			move(a.hAllDefault, x, barY, 124, 32)
		}
		move(a.hProgress, 8, barY+40, w-16, 24)
		move(a.hStatusText, 8, barY+72, w-356, 34)
		move(a.hStart, w-348, barY+69, 116, 38)
		move(a.hPause, w-224, barY+69, 88, 38)
		move(a.hStop, w-128, barY+69, 88, 38)
	}
}
func (a *application) command(id int) {
	if workers, ok := a.concurrencyCommands[id]; ok {
		a.settings.AutoConcurrency = false
		a.settings.Concurrency = config.NormalizeConcurrency(workers)
		a.saveSettings()
		a.updateComponentStatus()
		setText(a.hStatusText, fmt.Sprintf("已设置手动并发 %d；本机检测到 %d 个逻辑处理器，上限 %d。", a.settings.Concurrency, config.LogicalProcessorCount(), config.MaxConcurrency()))
		return
	}
	switch id {
	case IDC_TAB_VIDEO:
		a.switchKind(model.KindVideo)
	case IDC_TAB_IMAGE:
		a.switchKind(model.KindImage)
	case ID_CONCURRENCY_STATUS:
		a.showConcurrencyMenu()
	case IDC_RIGHT_TOGGLE:
		a.rightVisible = !a.rightVisible
		a.settings.RightPanelVisible = a.rightVisible
		a.saveSettings()
		a.syncMenuChecks()
		var rc rect
		if r, _, _ := procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&rc))); r != 0 {
			a.layout(rc.Right-rc.Left, rc.Bottom-rc.Top)
		}
		procInvalidateRect.Call(a.hwnd, 0, 1)
	case IDC_ADD_FILES, ID_FILE_ADD:
		a.chooseFiles(false)
	case IDC_ADD_FOLDER, ID_FILE_FOLDER:
		a.chooseFolder(true)
	case IDC_IMPORT_CLOSE:
		a.hideImportToast()
	case IDC_REMOVE, ID_FILE_REMOVE, ID_CTX_REMOVE, ID_CTX_REMOVE_SAFE:
		a.v420RemoveSelectedSafely()
	case IDC_CLEAR, ID_FILE_CLEAR:
		a.clearCurrent()
	case IDC_SELECT_ALL, ID_EDIT_SELECT_ALL:
		a.selectAll(true)
	case IDC_INVERT, ID_EDIT_INVERT:
		a.invertSelection()
	case IDC_SOURCE_DIR, ID_FILE_SOURCE, ID_CTX_OPEN_SOURCE:
		a.openSelectedDir(false)
	case IDC_OUTPUT_DIR, ID_FILE_OUTPUT, ID_CTX_OPEN_OUTPUT:
		a.openSelectedDir(true)
	case IDC_OUTPUT_BROWSE:
		a.openOutputMotherDir()
	case IDC_OUTPUT_PICK:
		a.chooseFolder(false)
	case IDC_START:
		a.startQueue()
	case IDC_PAUSE:
		a.togglePause()
	case IDC_STOP:
		a.stopQueue()
	case IDC_SMART_PLAN:
		a.applySmartPlan()
	case IDC_TASK_APPLY:
		a.applyTaskOptions(false)
	case IDC_TASK_DEFAULT, ID_EDIT_RESET:
		a.applyTaskOptions(true)
	case IDC_ALL_DEFAULT:
		a.v420ResetReadyDefaults()
	case ID_CTX_HOLD_EDIT:
		a.v420BeginHoldSelected()
	case ID_EDIT_RETRY_FAILED:
		a.retryRecoverableWorkspace()
	case ID_EDIT_CLEAN_DONE:
		a.cleanupCurrentWorkspace("done")
	case ID_EDIT_CLEAN_PROBLEMS:
		a.cleanupCurrentWorkspace("problems")
	case ID_EDIT_CLEAN_FINISHED:
		a.cleanupCurrentWorkspace("finished")
	case IDC_PREVIEW, ID_CTX_PLAY_SOURCE:
		a.playSelected(false)
	case ID_CTX_PLAY_OUTPUT:
		a.playSelected(true)
	case IDC_TRIM_CROP, ID_CTX_TRIM:
		a.editTrimCrop()
	case IDC_SINGLE_OUTPUT:
		a.singleOutput()
	case IDC_RETRY, ID_CTX_RETRY:
		a.retrySelected()
	case ID_CTX_DUAL:
		a.dualCompare()
	case ID_CTX_COMPARE_IMAGE:
		a.compareImage()
	case ID_CTX_COMPARE_VIDEO:
		a.compareVideo()
	case ID_CTX_ROTATION_PREVIEW:
		a.rotationPreview()
	case ID_CTX_COPY_TASK:
		a.copyTaskOptions()
	case ID_CTX_COPY_TRIM_CROP:
		a.copyTrimCropOptions()
	case ID_CTX_READY:
		a.returnReady()
	case ID_CTX_COPY_COMMAND:
		a.showFFmpegCommand()
	case ID_CTX_PIN:
		a.togglePinSelected()
	case ID_CTX_MOVE_TOP:
		a.moveSelectedToEdge(true)
	case ID_CTX_MOVE_UP:
		a.moveSelected(-1)
	case ID_CTX_MOVE_DOWN:
		a.moveSelected(1)
	case ID_CTX_MOVE_BOTTOM:
		a.moveSelectedToEdge(false)
	case ID_CTX_JUMP_RUNNING:
		a.jumpToRunning()
	case ID_CTX_ERROR_DETAILS:
		a.showTaskDetails()
	case ID_CTX_TECH_REPORT:
		a.writeTechnicalReport()
	case ID_CTX_COPY_SOURCE:
		a.copySelectedPaths(false)
	case ID_CTX_COPY_OUTPUT:
		a.copySelectedPaths(true)
	case ID_CTX_OPEN_OUTPUT_FILE:
		a.openSelectedOutputFile()
	case ID_CTX_RES_4K, ID_CTX_RES_1080, ID_CTX_RES_720, ID_CTX_RES_480, ID_CTX_RES_ORIGINAL,
		ID_CTX_CODEC_265, ID_CTX_CODEC_264, ID_CTX_CODEC_JPG, ID_CTX_CODEC_PNG,
		ID_CTX_QUALITY_HIGH, ID_CTX_QUALITY_MEDIUM, ID_CTX_QUALITY_LOW,
		ID_CTX_ROT_AUTO, ID_CTX_ROT_RIGHT, ID_CTX_ROT_LEFT, ID_CTX_ROT_180, ID_CTX_ROT_HFLIP, ID_CTX_ROT_VFLIP:
		a.setSelectedQuickOption(id)
	case ID_FFMPEG_STATUS:
		a.showFFmpegStatus()
	case ID_GPU_STATUS:
		a.showGPUStatus()
	case ID_FFMPEG_SELECT:
		a.chooseFFmpeg()
	case ID_FFMPEG_IMPORT_ZIP:
		a.chooseFFmpegZip()
	case ID_FFMPEG_OPEN:
		ffmpeg, _, _, _, _ := a.componentSnapshot()
		if ffmpeg != "" {
			shellOpen(filepath.Dir(ffmpeg))
		}
	case ID_GPU_BENCHMARK:
		a.runEncoderBenchmark(true)
	case ID_FFMPEG_DOWNLOAD_GYAN:
		shellOpen("https://www.gyan.dev/ffmpeg/builds/")
	case ID_FFMPEG_DOWNLOAD_GITHUB:
		shellOpen("https://github.com/BtbN/FFmpeg-Builds/releases")
	case ID_PLAYER_STATUS:
		a.showPlayerStatus()
	case ID_PLAYER_AUTO:
		a.settings.AutoDetectPlayer = !a.settings.AutoDetectPlayer
		if a.settings.AutoDetectPlayer {
			player, playerOK, _ := media.DetectPotPlayer("")
			a.componentMu.Lock()
			a.player, a.playerOK = player, playerOK
			a.componentMu.Unlock()
		}
		_ = config.Save(a.settings)
		a.updateComponentStatus()
	case ID_PLAYER_SELECT:
		a.choosePlayer()
	case ID_PLAYER_DEFAULT:
		a.componentMu.Lock()
		a.player = ""
		a.playerOK = false
		a.componentMu.Unlock()
		a.settings.PlayerPath = ""
		a.settings.AutoDetectPlayer = false
		_ = config.Save(a.settings)
		a.updateComponentStatus()
	case ID_PLAYER_OPEN:
		_, _, _, player, _ := a.componentSnapshot()
		if player != "" {
			shellOpen(filepath.Dir(player))
		}
	case ID_SET_RECURSIVE:
		a.settings.IncludeSubdirs = !a.settings.IncludeSubdirs
		a.saveSettings()
	case ID_SET_GPU:
		a.settings.UseGPU = !a.settings.UseGPU
		a.saveSettings()
	case ID_SET_GPU_FALLBACK:
		a.settings.GPUFallback = !a.settings.GPUFallback
		a.saveSettings()
	case ID_SET_CLEAR_META:
		a.settings.ClearMetadata = !a.settings.ClearMetadata
		a.saveSettings()
	case ID_SET_PRESERVE_TIMES:
		a.settings.PreserveTimes = !a.settings.PreserveTimes
		a.saveSettings()
	case ID_SET_UPSCALE:
		a.settings.AllowUpscale = !a.settings.AllowUpscale
		a.saveSettings()
	case ID_SET_EXACT_SIZE:
		a.settings.ExactTargetSize = !a.settings.ExactTargetSize
		a.saveSettings()
	case ID_SET_SMART_COPY:
		a.settings.SmartStreamCopy = !a.settings.SmartStreamCopy
		a.saveSettings()
	case ID_SET_AUDIO_AAC:
		a.settings.AudioMode = "AAC 192k"
		a.saveSettings()
	case ID_SET_AUDIO_COPY:
		a.settings.AudioMode = "复制音频"
		a.saveSettings()
	case ID_SET_AUDIO_MUTE:
		a.settings.AudioMode = "静音"
		a.saveSettings()
	case ID_SET_SUBTITLE_NONE:
		a.settings.SubtitleMode = "不保留字幕"
		a.saveSettings()
	case ID_SET_SUBTITLE_TEXT:
		a.settings.SubtitleMode = "保留文本字幕"
		a.saveSettings()
	case ID_SET_CONCURRENCY_AUTO:
		a.settings.AutoConcurrency = true
		a.saveSettings()
		a.updateComponentStatus()
		setText(a.hStatusText, fmt.Sprintf("已启用自动智能并发；检测到 %d 个逻辑处理器，本机上限 %d。", config.LogicalProcessorCount(), config.MaxConcurrency()))
	case ID_SET_FILENAME_KEEP:
		a.settings.FilenameMode = "保持原文件名"
		a.saveSettings()
	case ID_SET_FILENAME_SUFFIX:
		a.settings.FilenameMode = "添加规格后缀"
		a.saveSettings()
	case ID_SET_CONFLICT_NUMBER:
		a.settings.ConflictPolicy = "自动编号"
		a.saveSettings()
	case ID_SET_CONFLICT_SKIP:
		a.settings.ConflictPolicy = "跳过已有"
		a.saveSettings()
	case ID_SET_CONFLICT_OVERWRITE:
		a.settings.ConflictPolicy = "覆盖已有"
		a.saveSettings()
	case ID_SET_SESSION:
		a.settings.RestoreSession = !a.settings.RestoreSession
		a.saveSettings()
	case ID_SET_HISTORY:
		a.settings.SaveHistory = !a.settings.SaveHistory
		a.saveSettings()
	case ID_SET_NOTIFY:
		a.settings.NotifyOnDone = !a.settings.NotifyOnDone
		a.saveSettings()
	case ID_SET_VERIFY_OUTPUT:
		a.settings.VerifyOutput = !a.settings.VerifyOutput
		a.saveSettings()
	case ID_SET_THUMB_CACHE:
		a.settings.ThumbnailCache = !a.settings.ThumbnailCache
		a.saveSettings()
		if a.settings.ThumbnailCache {
			go media.CleanupThumbnailCache(1200, 90*24*time.Hour)
		}
	case ID_SET_ESTIMATE_SPACE:
		a.settings.EstimateDiskSpace = !a.settings.EstimateDiskSpace
		a.saveSettings()
	case ID_SET_OPEN_DONE:
		a.settings.OpenOutputOnDone = !a.settings.OpenOutputOnDone
		a.saveSettings()
	case ID_SET_PORTABLE_MODE:
		current := config.PortableModeEnabled()
		prompt := "确定启用便携模式？重启后配置、历史与缓存将保存在 EXE 同目录的 MediovaData 中；FFmpeg 等运行组件仍位于透明 Runtime。"
		if current {
			prompt = "确定关闭便携模式？重启后将恢复使用 AppData 目录。当前便携数据不会删除。"
		}
		if messageBox(a.hwnd, "便携模式", prompt, MB_YESNO|MB_ICONQUESTION) == IDYES {
			if err := config.SetPortableMode(!current); err != nil {
				messageBox(a.hwnd, "便携模式", err.Error(), MB_OK|MB_ICONERROR)
			} else {
				messageBox(a.hwnd, "便携模式", "设置已写入，请从托盘退出并重新启动软件后生效。", MB_OK|MB_ICONINFORMATION)
			}
		}
	case ID_SET_CONFIG_DIR:
		if d, e := config.Dir(); e == nil {
			shellOpen(d)
		}
	case ID_SET_RESET:
		if messageBox(a.hwnd, "恢复默认设置", "确定恢复全部默认设置？已导入任务不会删除。", MB_YESNO|MB_ICONQUESTION) == IDYES {
			a.settings = model.DefaultSettings()
			a.writeSettingsToUI()
			a.saveSettings()
		}
	case ID_PRESET_1080, ID_PRESET_720, ID_PRESET_ORIGINAL, ID_PRESET_4K:
		a.applyPreset(id)
	case ID_PRESET_CUSTOM1, ID_PRESET_CUSTOM2, ID_PRESET_CUSTOM3:
		a.applyCustomPreset(id)
	case ID_PRESET_SAVE1, ID_PRESET_SAVE2, ID_PRESET_SAVE3:
		a.saveCustomPreset(id)
	case ID_PRESET_CLEAR:
		a.settings.QuickCustom1 = nil
		a.settings.QuickCustom2 = nil
		a.settings.QuickCustom3 = nil
		a.saveSettings()
	case ID_PRESET_EXPORT:
		a.exportPresets()
	case ID_PRESET_IMPORT:
		a.importPresets()
	case ID_VIEW_RIGHT:
		a.rightVisible = !a.rightVisible
		a.settings.RightPanelVisible = a.rightVisible
		_ = config.Save(a.settings)
		a.syncMenuChecks()
		var rc rect
		procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&rc)))
		a.layout(rc.Right, rc.Bottom)
	case ID_VIEW_PERFORMANCE:
		a.settings.ShowPerformanceStats = !a.settings.ShowPerformanceStats
		_ = config.Save(a.settings)
		a.syncMenuChecks()
		a.refreshTotal()
	case ID_VIEW_SIMPLE:
		if a.settings.InterfaceMode == "简洁" {
			a.settings.InterfaceMode = "完整"
		} else {
			a.settings.InterfaceMode = "简洁"
		}
		_ = config.Save(a.settings)
		a.syncMenuChecks()
		var rc rect
		procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&rc)))
		a.layout(rc.Right, rc.Bottom)
	case ID_VIEW_RESET_COLUMNS:
		a.resetTaskColumnWidths()
	case ID_VIEW_FLOATING:
		a.settings.ShowFloatingBar = !a.settings.ShowFloatingBar
		_ = config.Save(a.settings)
		a.syncMenuChecks()
		a.runMu.Lock()
		running := a.running
		a.runMu.Unlock()
		if !a.settings.ShowFloatingBar && a.hFloating != 0 {
			show(a.hFloating, false)
		} else if running {
			a.refreshTotal()
		}
	case ID_HISTORY_VIEW:
		a.viewHistory()
	case ID_HISTORY_LAST_SUMMARY:
		if a.lastSummaryPath != "" {
			shellOpen(a.lastSummaryPath)
		} else {
			messageBox(a.hwnd, "任务总结", "尚未生成任务总结。完成一次队列后即可查看。", MB_OK|MB_ICONINFORMATION)
		}
	case ID_HISTORY_CLEAR:
		if messageBox(a.hwnd, "清空历史记录", "确定清空最近转换记录？", MB_YESNO|MB_ICONQUESTION) == IDYES {
			_ = media.ClearHistory()
		}
	case ID_HELP_DIAGNOSTICS:
		a.writeDiagnostics()
	case ID_HELP_ABOUT:
		messageBox(a.hwnd, "关于", fmt.Sprintf("Mediova v%s\r\n\r\n采用透明 Runtime 与独立 Data 架构。\r\n支持视频转正、压缩、裁剪、目标体积、GPU 回退、图片压缩、PotPlayer 对比、历史与任务恢复。\r\n\r\n本机检测到 %d 个逻辑处理器；并行任务上限为 %d。自动模式会结合媒体类型、分辨率、时长、CPU/GPU与任务数量选择实际并发，不会盲目启动上限数量的 FFmpeg 进程。", appVersion, config.LogicalProcessorCount(), config.MaxConcurrency()), MB_OK|MB_ICONINFORMATION)
	case ID_FILE_EXIT:
		show(a.hwnd, false)
		if !a.closeHintShown {
			a.closeHintShown = true
			a.notifyBalloon("Mediova仍在运行", "程序已隐藏到系统托盘。真正退出请使用右下角托盘菜单。")
		}
	case IDC_SEARCH, IDC_FILTER:
		a.refreshList()
	}
}

func (a *application) currentWorkspaceTaskCopies() []*model.Task {
	a.mu.Lock()
	defer a.mu.Unlock()
	items := make([]*model.Task, 0, len(a.tasks))
	for _, task := range a.tasks {
		if task == nil || task.Kind != a.currentKind {
			continue
		}
		cp := *task
		items = append(items, &cp)
	}
	return items
}

func (a *application) taskQueueExportDir() string {
	if dir := strings.TrimSpace(a.settings.OutputDir); dir != "" {
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return dir
		}
	}
	if dir, err := config.Dir(); err == nil {
		return dir
	}
	return ""
}

func (a *application) exportCurrentTaskQueueJSON() {
	items := a.currentWorkspaceTaskCopies()
	if len(items) == 0 {
		messageBox(a.hwnd, "导出任务队列", "当前工作区没有可导出的任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	dir := a.taskQueueExportDir()
	if dir == "" {
		messageBox(a.hwnd, "导出任务队列", "无法确定导出目录。", MB_OK|MB_ICONERROR)
		return
	}
	path := filepath.Join(dir, fmt.Sprintf("Mediova_queue_%s.json", time.Now().Format("20060102_150405")))
	if err := media.WriteTaskBundle(path, appVersion, a.currentKind, items); err != nil {
		messageBox(a.hwnd, "导出任务队列", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	setClipboardText(a.hwnd, path)
	shellOpen(path)
	setText(a.hStatusText, fmt.Sprintf("已导出 %d 个任务到 JSON，文件路径已复制。", len(items)))
}

func (a *application) importTaskQueueJSON() {
	path := chooseSingleFile(a.hwnd, "导入任务队列 JSON", "任务队列 JSON\x00*.json\x00所有文件\x00*.*\x00\x00")
	if path == "" {
		return
	}
	bundle, err := media.ReadTaskBundle(path)
	if err != nil {
		messageBox(a.hwnd, "导入任务队列", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	a.mu.Lock()
	existing := make(map[string]bool, len(a.tasks))
	for _, task := range a.tasks {
		if task != nil {
			existing[strings.ToLower(filepath.Clean(task.Input))] = true
		}
	}
	prepared, duplicates, missing := media.PrepareImportedTasks(bundle.Tasks, existing, func() int64 { return a.nextID.Add(1) })
	var probeIDs []int64
	for _, task := range prepared {
		a.tasks = append(a.tasks, task)
		a.pendingSelection[task.ID] = true
		probeIDs = append(probeIDs, task.ID)
	}
	a.mu.Unlock()
	if len(prepared) == 0 {
		messageBox(a.hwnd, "导入任务队列", fmt.Sprintf("没有可加入的新任务。重复 %d 个，源文件缺失 %d 个。", duplicates, missing), MB_OK|MB_ICONINFORMATION)
		return
	}
	a.currentKind = bundle.Kind
	if a.currentKind != model.KindVideo && a.currentKind != model.KindImage {
		a.currentKind = prepared[0].Kind
	}
	a.saveSession()
	a.writeSettingsToUI()
	a.refreshAll()
	_, ffprobe, _, _, _ := a.componentSnapshot()
	if ffprobe != "" {
		for _, id := range probeIDs {
			a.queueProbe(id)
		}
	}
	msg := fmt.Sprintf("已从 JSON 导入 %d 个任务", len(prepared))
	if duplicates > 0 {
		msg += fmt.Sprintf("，跳过重复 %d 个", duplicates)
	}
	if missing > 0 {
		msg += fmt.Sprintf("，跳过缺失 %d 个", missing)
	}
	a.showImportToast(msg)
}

func (a *application) exportCurrentTasksCSV() {
	a.mu.Lock()
	tasks := make([]model.Task, 0, len(a.tasks))
	for _, t := range a.tasks {
		if t != nil && t.Kind == a.currentKind {
			tasks = append(tasks, *t)
		}
	}
	a.mu.Unlock()
	if len(tasks) == 0 {
		messageBox(a.hwnd, "导出任务清单", "当前工作区没有可导出的任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	dir := strings.TrimSpace(a.settings.OutputDir)
	if dir == "" {
		if d, err := config.Dir(); err == nil {
			dir = d
		}
	}
	if dir == "" {
		messageBox(a.hwnd, "导出任务清单", "无法确定导出目录。", MB_OK|MB_ICONERROR)
		return
	}
	kind := "videos"
	if a.currentKind == model.KindImage {
		kind = "images"
	}
	path := filepath.Join(dir, fmt.Sprintf("Mediova_%s_%s.csv", kind, time.Now().Format("20060102_150405")))
	if err := media.ExportTasksCSV(path, tasks, a.settings); err != nil {
		messageBox(a.hwnd, "导出任务清单", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	setClipboardText(a.hwnd, path)
	shellOpen(path)
	setText(a.hStatusText, fmt.Sprintf("已导出 %d 个任务，文件路径已复制到剪贴板。", len(tasks)))
}

func (a *application) saveSettings() {
	a.readSettingsFromUI()
	_ = config.Save(a.settings)
	a.syncMenuChecks()
	a.refreshList()
}
func (a *application) refreshOutputHistory() {
	a.v420RefreshOutputHistory()
}

func (a *application) rememberOutputDirectory(path string) {
	a.v420SetOutputDir(a.currentKind, path)
}

func (a *application) openOutputMotherDir() {
	path := a.v420OutputDir(a.currentKind)
	if path == "" {
		messageBox(a.hwnd, "输出母目录", "请先选择输出母目录。", MB_OK|MB_ICONINFORMATION)
		return
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		messageBox(a.hwnd, "输出母目录", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	shellOpen(path)
}

func (a *application) writeSettingsToUI() {
	a.rightUpdating = true
	defer func() { a.rightUpdating = false }()
	a.v420RefreshOutputHistory()
	if a.currentKind == model.KindImage {
		labels := []string{"尺寸", "格式", "质量", "大小", "旋转"}
		for i, label := range labels {
			setText(a.globalLabels[i], label)
			setText(a.rightLabels[i], label)
		}
		comboFill(a.hResolution, imageSizes(), a.settings.ImageSize)
		comboFill(a.hCodec, []string{"JPG", "PNG"}, a.settings.ImageFormat)
		comboFill(a.hQuality, []string{"高", "中", "低"}, a.settings.ImageQuality)
		comboFill(a.hVolume, []string{"不限", "约 500KB", "约 1MB", "约 2MB", "约 5MB"}, a.settings.ImageLimit)
	} else {
		labels := []string{"输出", "格式", "质量", "体积", "旋转"}
		for i, label := range labels {
			setText(a.globalLabels[i], label)
			setText(a.rightLabels[i], label)
		}
		comboFill(a.hResolution, videoResolutions(), a.settings.Resolution)
		comboFill(a.hCodec, []string{"H.265", "H.264"}, a.settings.Codec)
		comboFill(a.hQuality, []string{"高", "中", "低"}, a.settings.Quality)
		comboFill(a.hVolume, volumeModes(), volumeDisplay(a.settings))
	}
	comboFill(a.hRotation, rotations(), a.settings.Rotation)
	comboFill(a.hSpeedMode, speedModes(), a.settings.SpeedMode)
}

func (a *application) switchKind(kind model.Kind) {
	a.currentKind = kind
	a.writeSettingsToUI()
	a.refreshList()
	a.updateRightPanel()
	a.v420UpdateStartAction()
	for _, h := range []uintptr{a.hVideo, a.hImage} {
		procInvalidateRect.Call(h, 0, 1)
	}
}

func (a *application) notify(h *nmhdr) uintptr {
	if h == nil || h.HwndFrom != a.hList {
		return 0
	}
	switch h.Code {
	case LVN_ITEMCHANGED:
		a.updateRightPanel()
	case LVN_COLUMNCLICK:
		n := (*nmListView)(unsafe.Pointer(h))
		a.toggleTaskSort(int(n.IItemSub))
	case NM_DBLCLK:
		a.playSelected(false)
	case NM_CUSTOMDRAW:
		return a.drawTaskListCell((*nmListViewCustomDraw)(unsafe.Pointer(h)))
	}
	return 0
}

func compressionCellMetrics(t *model.Task) (fraction float64, label string, active bool) {
	if t == nil || t.OutputSize <= 0 {
		return 0, "—", false
	}
	label = media.FormatBytes(t.OutputSize)
	if t.InputSize <= 0 {
		return 0, label, true
	}
	fraction = float64(t.OutputSize) / float64(t.InputSize)
	label += fmt.Sprintf(" (%.1f%%)", fraction*100)
	if fraction < 0 {
		fraction = 0
	}
	if fraction > 1 {
		fraction = 1
	}
	return fraction, label, true
}

func progressCellMetrics(t *model.Task) (fraction float64, label string) {
	if t == nil {
		return 0, "0.0%"
	}
	fraction = t.Progress / 100
	if fraction < 0 {
		fraction = 0
	}
	if fraction > 1 {
		fraction = 1
	}
	return fraction, fmt.Sprintf("%.1f%%", t.Progress)
}

func listItemSelected(hwnd uintptr, item int) bool {
	return send(hwnd, LVM_GETITEMSTATE, uintptr(item), LVIS_SELECTED)&LVIS_SELECTED != 0
}

func listSubItemBounds(hwnd uintptr, item, subItem int) (rect, bool) {
	sub := rect{Top: int32(subItem), Left: LVIR_BOUNDS}
	if send(hwnd, LVM_GETSUBITEMRECT, uintptr(item), uintptr(unsafe.Pointer(&sub))) == 0 {
		return rect{}, false
	}
	// Some ListView versions return only the text band when a small-image list
	// controls row height. Merge horizontal subitem bounds with the full row.
	row := rect{Left: LVIR_BOUNDS}
	if send(hwnd, LVM_GETITEMRECT, uintptr(item), uintptr(unsafe.Pointer(&row))) != 0 {
		sub.Top = row.Top
		sub.Bottom = row.Bottom
	}
	return sub, true
}

func drawSelectedCell(hdc uintptr, rc rect, label string, active bool) {
	if active {
		brush, _, _ := procGetSysColorBrush.Call(COLOR_HIGHLIGHT)
		procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
		color, _, _ := procGetSysColor.Call(COLOR_HIGHLIGHTTEXT)
		drawCenteredText(hdc, label, rc, uiFontSmall, color)
		return
	}
	fillSolid(hdc, rc, colorRef(240, 240, 240))
	drawCenteredText(hdc, label, rc, uiFontSmall, colorRef(38, 46, 58))
}

func fullCellBarRect(rc rect) rect {
	insets := listCellBarInsets()
	rc.Left += scaleDPI(insets.Horizontal)
	rc.Right -= scaleDPI(insets.Horizontal)
	available := rc.Bottom - rc.Top - 2*scaleDPI(insets.Vertical)
	preferred := scaleDPI(24)
	minimum := scaleDPI(insets.MinimumHeight)
	if preferred > available {
		preferred = available
	}
	if preferred < minimum && available >= minimum {
		preferred = minimum
	}
	if preferred < 1 {
		preferred = 1
	}
	centre := (rc.Top + rc.Bottom) / 2
	rc.Top = centre - preferred/2
	rc.Bottom = rc.Top + preferred
	return rc
}

func drawProgressPill(hdc uintptr, rc rect, fraction float64, label string, selected, active bool) {
	if selected {
		if active {
			brush, _, _ := procGetSysColorBrush.Call(COLOR_HIGHLIGHT)
			procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
		} else {
			fillSolid(hdc, rc, colorRef(240, 244, 249))
		}
	} else {
		fillSolid(hdc, rc, colorRef(255, 255, 255))
	}
	fraction = clamp01(fraction)
	bar := fullCellBarRect(rc)
	withRoundedClip(hdc, bar, 3, func() {
		fillSolid(hdc, bar, colorRef(247, 249, 252))
		if fraction > 0 {
			fill := bar
			fill.Right = fill.Left + int32(float64(fill.Right-fill.Left)*fraction)
			if fill.Right < fill.Left+3 {
				fill.Right = fill.Left + 3
			}
			drawHorizontalGradient(hdc, fill, colorRef(169, 204, 243), colorRef(76, 138, 220))
		}
	})
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(35, 51, 74))
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
		if active {
			brush, _, _ := procGetSysColorBrush.Call(COLOR_HIGHLIGHT)
			procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
		} else {
			fillSolid(hdc, rc, colorRef(240, 244, 249))
		}
	} else {
		fillSolid(hdc, rc, colorRef(255, 255, 255))
	}
	bar := fullCellBarRect(rc)
	withRoundedClip(hdc, bar, 3, func() {
		if task == nil || task.InputSize <= 0 || task.OutputSize <= 0 {
			fillSolid(hdc, bar, colorRef(247, 249, 252))
			return
		}
		visual := compressionVisualFor(task.InputSize, task.OutputSize)
		split := bar.Left + int32(float64(bar.Right-bar.Left)*visual.InputFraction)
		if split <= bar.Left {
			split = bar.Left + 1
		}
		if split >= bar.Right {
			split = bar.Right - 1
		}
		left := bar
		left.Right = split
		right := bar
		right.Left = split
		fillSolid(hdc, left, colorRef(247, 249, 251))
		start, finish := compressionColorPair(visual)
		drawHorizontalGradient(hdc, right, start, finish)
	})
	drawCenteredText(hdc, label, bar, uiFontSmall, colorRef(35, 51, 70))
}

func taskStatusColor(status model.Status) uintptr {
	switch status {
	case model.StatusProcessing:
		return colorRef(126, 78, 190)
	case model.StatusQueued:
		return colorRef(53, 104, 166)
	case model.StatusReady:
		return colorRef(76, 96, 120)
	case model.StatusPaused:
		return colorRef(197, 126, 16)
	case model.StatusHeld:
		return colorRef(172, 102, 31)
	case model.StatusDone:
		return colorRef(35, 143, 79)
	case model.StatusFailed:
		return colorRef(198, 67, 61)
	case model.StatusSkipped:
		return colorRef(116, 126, 139)
	case model.StatusCancelled:
		return colorRef(137, 96, 96)
	default:
		return colorRef(70, 80, 94)
	}
}

func (a *application) visibleTaskSnapshot(row int) (model.Task, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if row < 0 || row >= len(a.visible) {
		return model.Task{}, false
	}
	idx := a.visible[row]
	if idx < 0 || idx >= len(a.tasks) || a.tasks[idx] == nil {
		return model.Task{}, false
	}
	return *a.tasks[idx], true
}

func (a *application) drawTaskListCell(cd *nmListViewCustomDraw) uintptr {
	if cd == nil {
		return CDRF_DODEFAULT
	}
	switch cd.NMCD.DrawStage {
	case CDDS_PREPAINT:
		return CDRF_NOTIFYITEMDRAW
	case CDDS_ITEMPREPAINT:
		return CDRF_NOTIFYSUBITEMDRAW
	case CDDS_ITEMPREPAINT | CDDS_SUBITEM:
		if cd.ISubItem != 7 && cd.ISubItem != 8 && cd.ISubItem != 9 {
			return CDRF_DODEFAULT
		}
		task, ok := a.visibleTaskSnapshot(int(cd.NMCD.ItemSpec))
		if !ok {
			return CDRF_DODEFAULT
		}
		cell := cd.NMCD.Rc
		if exact, ok := listSubItemBounds(a.hList, int(cd.NMCD.ItemSpec), int(cd.ISubItem)); ok {
			cell = exact
		}
		selected := listItemSelected(a.hList, int(cd.NMCD.ItemSpec))
		focus, _, _ := procGetFocus.Call()
		activeSelection := selected && focus == a.hList
		if cd.ISubItem == 7 {
			_, label, _ := compressionCellMetrics(&task)
			drawCompressionPill(cd.NMCD.HDC, cell, &task, label, selected, activeSelection)
			return CDRF_SKIPDEFAULT
		}
		if cd.ISubItem == 8 {
			fraction, label := progressCellMetrics(&task)
			drawProgressPill(cd.NMCD.HDC, cell, fraction, label, selected, activeSelection)
			return CDRF_SKIPDEFAULT
		}
		label := a.taskTexts(&task)[9]
		if selected {
			drawSelectedCell(cd.NMCD.HDC, cell, label, activeSelection)
		} else {
			fillSolid(cd.NMCD.HDC, cell, colorRef(255, 255, 255))
			textRC := cell
			textRC.Left += 8
			old, _, _ := procSelectObject.Call(cd.NMCD.HDC, uiFontSmall)
			procSetBkMode.Call(cd.NMCD.HDC, TRANSPARENT)
			procSetTextColor.Call(cd.NMCD.HDC, taskStatusColor(task.Status))
			procDrawTextW.Call(cd.NMCD.HDC, uintptr(unsafe.Pointer(p(label))), ^uintptr(0), uintptr(unsafe.Pointer(&textRC)), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
			if old != 0 {
				procSelectObject.Call(cd.NMCD.HDC, old)
			}
		}
		return CDRF_SKIPDEFAULT
	}
	return CDRF_DODEFAULT
}

func (a *application) showContextMenu() {
	m, _, _ := procCreatePopupMenu.Call()
	if m == 0 {
		return
	}
	defer procDestroyMenu.Call(m)
	appendMenu(m, MF_STRING, ID_CTX_PLAY_SOURCE, "播放原视频")
	appendMenu(m, MF_STRING, ID_CTX_PLAY_OUTPUT, "播放转换后视频")
	appendMenu(m, MF_STRING, ID_CTX_DUAL, "PotPlayer 双窗口快速对比")
	appendMenu(m, MF_SEPARATOR, 0, "")

	res, _, _ := procCreatePopupMenu.Call()
	appendMenu(res, MF_STRING, ID_CTX_RES_4K, "4K / 最大边 3840px")
	appendMenu(res, MF_STRING, ID_CTX_RES_1080, "1080P / 最大边 1920px")
	appendMenu(res, MF_STRING, ID_CTX_RES_720, "720P / 最大边 1280px")
	appendMenu(res, MF_STRING, ID_CTX_RES_480, "480P / 最大边 854px")
	appendMenu(res, MF_STRING, ID_CTX_RES_ORIGINAL, "原尺寸")
	appendMenu(m, MF_POPUP, res, "修改输出规格")
	codec, _, _ := procCreatePopupMenu.Call()
	if a.currentKind == model.KindImage {
		appendMenu(codec, MF_STRING, ID_CTX_CODEC_JPG, "JPG")
		appendMenu(codec, MF_STRING, ID_CTX_CODEC_PNG, "PNG")
	} else {
		appendMenu(codec, MF_STRING, ID_CTX_CODEC_265, "H.265 / HEVC")
		appendMenu(codec, MF_STRING, ID_CTX_CODEC_264, "H.264 / AVC")
	}
	appendMenu(m, MF_POPUP, codec, "修改编码 / 格式")
	quality, _, _ := procCreatePopupMenu.Call()
	appendMenu(quality, MF_STRING, ID_CTX_QUALITY_HIGH, "高")
	appendMenu(quality, MF_STRING, ID_CTX_QUALITY_MEDIUM, "中")
	appendMenu(quality, MF_STRING, ID_CTX_QUALITY_LOW, "低")
	appendMenu(m, MF_POPUP, quality, "修改质量")
	rotation, _, _ := procCreatePopupMenu.Call()
	appendMenu(rotation, MF_STRING, ID_CTX_ROT_AUTO, "自动")
	appendMenu(rotation, MF_STRING, ID_CTX_ROT_RIGHT, "90°右转")
	appendMenu(rotation, MF_STRING, ID_CTX_ROT_LEFT, "90°左转")
	appendMenu(rotation, MF_STRING, ID_CTX_ROT_180, "180°")
	appendMenu(rotation, MF_STRING, ID_CTX_ROT_HFLIP, "左右翻转")
	appendMenu(rotation, MF_STRING, ID_CTX_ROT_VFLIP, "上下翻转")
	appendMenu(m, MF_POPUP, rotation, "修改旋转处理")
	appendMenu(m, MF_STRING, ID_CTX_COPY_TASK, "以第一项为来源，复制全部参数")
	appendMenu(m, MF_STRING, ID_CTX_COPY_TRIM_CROP, "仅复制第一项的时长 / 画面裁剪")
	temporary, _, _ := procCreatePopupMenu.Call()
	editFlags, removeFlags := a.v420ContextMenuFlags()
	appendMenu(temporary, editFlags, ID_CTX_HOLD_EDIT, "搁置并修改参数")
	appendMenu(temporary, removeFlags, ID_CTX_REMOVE_SAFE, "从任务列表移除")
	appendMenu(m, MF_POPUP, temporary, "临时操作")
	appendMenu(m, MF_STRING, ID_CTX_READY, "恢复选中准备任务默认参数")
	appendMenu(m, MF_SEPARATOR, 0, "")
	appendMenu(m, MF_STRING, ID_CTX_ROTATION_PREVIEW, "预览选中的方向")
	appendMenu(m, MF_STRING, ID_CTX_TRIM, "编辑时长与画面裁剪...")
	appendMenu(m, MF_STRING, ID_CTX_COMPARE_IMAGE, "生成五点画面对比图...")
	appendMenu(m, MF_STRING, ID_CTX_COMPARE_VIDEO, "生成 30 秒同步对比视频...")
	appendMenu(m, MF_STRING, ID_CTX_RETRY, "复制为准备任务并重新转换")
	appendMenu(m, MF_STRING, ID_CTX_COPY_COMMAND, "查看 / 复制 FFmpeg 命令")
	appendMenu(m, MF_STRING, ID_CTX_ERROR_DETAILS, "查看错误与任务详情")
	appendMenu(m, MF_STRING, ID_CTX_TECH_REPORT, "生成前后技术参数报告...")
	appendMenu(m, MF_SEPARATOR, 0, "")
	appendMenu(m, MF_STRING, ID_CTX_PIN, "置顶 / 取消置顶")
	appendMenu(m, MF_STRING, ID_CTX_MOVE_TOP, "移到当前工作区最前")
	appendMenu(m, MF_STRING, ID_CTX_MOVE_UP, "上移")
	appendMenu(m, MF_STRING, ID_CTX_MOVE_DOWN, "下移")
	appendMenu(m, MF_STRING, ID_CTX_MOVE_BOTTOM, "移到当前工作区最后")
	appendMenu(m, MF_STRING, ID_CTX_JUMP_RUNNING, "跳转到正在运行的任务")
	appendMenu(m, MF_SEPARATOR, 0, "")
	appendMenu(m, MF_STRING, ID_CTX_OPEN_SOURCE, "打开源文件所在文件夹")
	appendMenu(m, MF_STRING, ID_CTX_OPEN_OUTPUT, "打开输出文件夹")
	appendMenu(m, MF_STRING, ID_CTX_OPEN_OUTPUT_FILE, "直接打开输出文件")
	appendMenu(m, MF_STRING, ID_CTX_COPY_SOURCE, "复制源文件路径")
	appendMenu(m, MF_STRING, ID_CTX_COPY_OUTPUT, "复制输出文件路径")
	appendMenu(m, MF_STRING, ID_CTX_REMOVE_SAFE, "从任务列表移除")
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(a.hwnd)
	cmd, _, _ := procTrackPopupMenu.Call(m, TPM_RIGHTBUTTON|TPM_RETURNCMD|TPM_NONOTIFY, uintptr(pt.X), uintptr(pt.Y), 0, a.hwnd, 0)
	procPostMessageW.Call(a.hwnd, WM_NULL, 0, 0)
	if cmd != 0 {
		a.command(int(cmd))
	}
}

func (a *application) chooseFiles(special bool) {
	buf := make([]uint16, 65536)
	filter := "媒体文件\x00*.mp4;*.mov;*.m4v;*.avi;*.mkv;*.wmv;*.flv;*.webm;*.mts;*.m2ts;*.jpg;*.jpeg;*.png;*.bmp;*.webp;*.heic;*.heif\x00所有文件\x00*.*\x00\x00"
	title := "添加媒体文件"
	flags := uint32(OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY | OFN_ALLOWMULTISELECT)
	if special {
		filter = "程序文件\x00*.exe\x00所有文件\x00*.*\x00\x00"
		title = "选择程序"
		flags &^= OFN_ALLOWMULTISELECT
	}
	futf := utf16Multi(filter)
	initial := a.settings.LastInputDir
	if special {
		initial = ""
	}
	ofn := openFileName{LStructSize: uint32(unsafe.Sizeof(openFileName{})), HwndOwner: a.hwnd, LpstrFilter: &futf[0], LpstrFile: &buf[0], NMaxFile: uint32(len(buf)), LpstrTitle: p(title), Flags: flags}
	if initial != "" {
		ofn.LpstrInitialDir = p(initial)
	}
	r, _, _ := procGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&ofn)))
	if r == 0 {
		return
	}
	parts := splitUTF16Multi(buf)
	if special {
		if len(parts) > 0 {
			if strings.Contains(strings.ToLower(filepath.Base(parts[0])), "ffmpeg") {
				a.setFFmpeg(parts[0])
			} else {
				a.setPlayer(parts[0])
			}
		}
		return
	}
	if len(parts) > 0 {
		last := parts[0]
		if len(parts) == 1 {
			last = filepath.Dir(parts[0])
		}
		a.settings.LastInputDir = last
		_ = config.Save(a.settings)
	}
	if len(parts) == 1 {
		a.addPaths(parts, "")
	} else if len(parts) > 1 {
		dir := parts[0]
		var paths []string
		for _, name := range parts[1:] {
			paths = append(paths, filepath.Join(dir, name))
		}
		a.addPaths(paths, "")
	}
}
func splitUTF16Multi(buf []uint16) []string {
	var out []string
	start := 0
	for i, v := range buf {
		if v == 0 {
			if i == start {
				break
			}
			out = append(out, syscall.UTF16ToString(buf[start:i]))
			start = i + 1
		}
	}
	return out
}
func comInvoke(obj uintptr, index uintptr, args ...uintptr) uintptr {
	if obj == 0 {
		return ^uintptr(0)
	}
	vtbl := *(*uintptr)(unsafe.Pointer(obj))
	fn := *(*uintptr)(unsafe.Pointer(vtbl + index*unsafe.Sizeof(uintptr(0))))
	callArgs := make([]uintptr, 0, len(args)+1)
	callArgs = append(callArgs, obj)
	callArgs = append(callArgs, args...)
	r, _, _ := syscall.SyscallN(fn, callArgs...)
	return r
}

func chooseExplorerFolder(owner uintptr, title, initial string) string {
	clsidFileOpenDialog := guid{Data1: 0xDC1C5A9C, Data2: 0xE88A, Data3: 0x4DDE, Data4: [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidFileOpenDialog := guid{Data1: 0xD57C7288, Data2: 0xD4AD, Data3: 0x4768, Data4: [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
	iidShellItem := guid{Data1: 0x43826D1E, Data2: 0xE718, Data3: 0x42EE, Data4: [8]byte{0xBC, 0x55, 0xA1, 0xE2, 0x61, 0xC3, 0x7B, 0xFE}}
	var dialog uintptr
	hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidFileOpenDialog)), 0, 1, uintptr(unsafe.Pointer(&iidFileOpenDialog)), uintptr(unsafe.Pointer(&dialog)))
	if int32(hr) < 0 || dialog == 0 {
		return ""
	}
	defer comInvoke(dialog, 2)
	var options uint32
	if int32(comInvoke(dialog, 10, uintptr(unsafe.Pointer(&options)))) >= 0 {
		options |= FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_DONTADDTORECENT
		comInvoke(dialog, 9, uintptr(options))
	}
	if title != "" {
		comInvoke(dialog, 17, uintptr(unsafe.Pointer(p(title))))
	}
	if initial != "" {
		var initialItem uintptr
		hr, _, _ := procSHCreateItemFromParsingName.Call(uintptr(unsafe.Pointer(p(initial))), 0, uintptr(unsafe.Pointer(&iidShellItem)), uintptr(unsafe.Pointer(&initialItem)))
		if int32(hr) >= 0 && initialItem != 0 {
			comInvoke(dialog, 12, initialItem)
			comInvoke(initialItem, 2)
		}
	}
	if int32(comInvoke(dialog, 3, owner)) < 0 {
		return ""
	}
	var item uintptr
	if int32(comInvoke(dialog, 20, uintptr(unsafe.Pointer(&item)))) < 0 || item == 0 {
		return ""
	}
	defer comInvoke(item, 2)
	var pathPtr *uint16
	if int32(comInvoke(item, 5, SIGDN_FILESYSPATH, uintptr(unsafe.Pointer(&pathPtr)))) < 0 || pathPtr == nil {
		return ""
	}
	defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(pathPtr)))
	return utf16PtrString(pathPtr)
}

func (a *application) chooseFolder(add bool) {
	title := "选择输出母目录"
	initial := a.v420OutputDir(a.currentKind)
	if add {
		title = "选择包含媒体文件的文件夹"
		initial = a.settings.LastInputDir
	} else if a.v420OutputLocked(a.currentKind) {
		setText(a.hStatusText, "当前活动队列已锁定输出母目录；停止队列后才能更换。")
		return
	}
	folder := chooseExplorerFolder(a.hwnd, title, initial)
	if folder == "" {
		return
	}
	if !add {
		if a.v420SetOutputDir(a.currentKind, folder) {
			a.v420RefreshOutputHistory()
			setText(a.hStatusText, "输出母目录已更换；准备中任务将使用新目录，已入队任务保持原快照。")
		}
		return
	}
	a.settings.LastInputDir = folder
	_ = config.Save(a.settings)
	setText(a.hStatusText, "正在扫描文件夹并自动分流视频与图片…")
	recursive := a.settings.IncludeSubdirs
	go func() {
		result, err := media.ListMixedFiles(folder, recursive)
		a.postUI(func() {
			if err != nil {
				setText(a.hStatusText, "扫描失败: "+err.Error())
				return
			}
			paths := append(append([]string{}, result.Videos...), result.Images...)
			videoAdded, imageAdded, duplicate := a.addPaths(paths, media.ImportTreeRoot(folder))
			msg := fmt.Sprintf("导入完成：视频 %d 个，图片 %d 个", videoAdded, imageAdded)
			if duplicate > 0 {
				msg += fmt.Sprintf("，重复 %d 个", duplicate)
			}
			if result.Unsupported > 0 {
				msg += fmt.Sprintf("，忽略不支持文件 %d 个", result.Unsupported)
			}
			if result.Unreadable > 0 {
				msg += fmt.Sprintf("，无法读取 %d 项", result.Unreadable)
			}
			a.showImportToast(msg)
		})
	}()
}

func chooseSingleFile(owner uintptr, title, filter string) string {
	buf := make([]uint16, 32768)
	futf := utf16Multi(filter)
	ofn := openFileName{LStructSize: uint32(unsafe.Sizeof(openFileName{})), HwndOwner: owner, LpstrFilter: &futf[0], LpstrFile: &buf[0], NMaxFile: uint32(len(buf)), LpstrTitle: p(title), Flags: OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY}
	r, _, _ := procGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&ofn)))
	if r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

func (a *application) chooseFFmpeg() {
	path := chooseSingleFile(a.hwnd, "选择 ffmpeg.exe", "FFmpeg 程序\x00ffmpeg.exe\x00程序文件\x00*.exe\x00所有文件\x00*.*\x00\x00")
	if path != "" {
		a.setFFmpeg(path)
	}
}
func (a *application) choosePlayer() {
	path := chooseSingleFile(a.hwnd, "选择 PotPlayer 程序", "PotPlayer 程序\x00PotPlayerMini64.exe;PotPlayerMini.exe\x00程序文件\x00*.exe\x00所有文件\x00*.*\x00\x00")
	if path != "" {
		a.setPlayer(path)
	}
}
func (a *application) chooseFFmpegZip() {
	path := chooseSingleFile(a.hwnd, "导入 FFmpeg ZIP 组件包", "ZIP 压缩包\x00*.zip\x00所有文件\x00*.*\x00\x00")
	if path == "" {
		return
	}
	setText(a.hStatusText, "正在导入 FFmpeg 组件，请稍候…")
	go func() {
		ff, fp, err := media.InstallFFmpegZip(path)
		a.postUI(func() {
			if err != nil {
				setText(a.hStatusText, "FFmpeg 组件导入失败")
				messageBox(a.hwnd, "导入 FFmpeg", err.Error(), MB_OK|MB_ICONERROR)
				return
			}
			a.componentMu.Lock()
			a.ffmpeg, a.ffprobe = ff, fp
			a.componentMu.Unlock()
			a.settings.FFmpegPath = ff
			_ = config.Save(a.settings)
			a.componentMu.Lock()
			a.hardware = media.Hardware{Detail: "FFmpeg 已安装。启动和导入阶段不自动测试 GPU；当前默认使用 CPU。可从 FFmpeg 菜单手动测速。"}
			a.componentMu.Unlock()
			setText(a.hStatusText, "FFmpeg 组件导入完成。未自动测试编码器或 GPU。")
			a.updateComponentStatus()
			messageBox(a.hwnd, "导入 FFmpeg", "组件已安装到 Mediova Runtime 的 Components\\FFmpeg 目录。为避免界面卡住，本次未自动运行编码器或 GPU 测试；需要时可从 FFmpeg 菜单手动测速。", MB_OK|MB_ICONINFORMATION)
		})
	}()
}
func (a *application) setFFmpeg(path string) {
	ff, fp, ok := media.FindFFmpeg(path)
	if !ok {
		messageBox(a.hwnd, "FFmpeg", "同一目录必须同时存在 ffmpeg.exe 与 ffprobe.exe。", MB_OK|MB_ICONERROR)
		return
	}
	a.componentMu.Lock()
	a.ffmpeg, a.ffprobe = ff, fp
	a.componentMu.Unlock()
	a.settings.FFmpegPath = ff
	_ = config.Save(a.settings)
	a.componentMu.Lock()
	a.hardware = media.Hardware{Detail: "已指定 FFmpeg。未自动测试编码器或 GPU；当前默认使用 CPU。可从 FFmpeg 菜单手动测速。"}
	a.componentMu.Unlock()
	setText(a.hStatusText, "FFmpeg 路径已更新。未自动运行编码器或 GPU 测试。")
	a.updateComponentStatus()
}
func (a *application) setPlayer(path string) {
	if st, err := os.Stat(path); err != nil || st.IsDir() {
		messageBox(a.hwnd, "PotPlayer", "选择的程序无效。", MB_OK|MB_ICONERROR)
		return
	}
	a.componentMu.Lock()
	a.player = path
	a.playerOK = true
	a.componentMu.Unlock()
	a.settings.PlayerPath = path
	a.settings.AutoDetectPlayer = false
	_ = config.Save(a.settings)
	a.updateComponentStatus()
}

type dropFilesHeader struct {
	PFiles uint32
	PtX    int32
	PtY    int32
	FNC    int32
	FWide  int32
}

func makeSelfTestDropHandle(paths []string) uintptr {
	words := make([]uint16, 0, 256)
	for _, path := range paths {
		if strings.ContainsRune(path, '\x00') {
			return 0
		}
		words = append(words, syscall.StringToUTF16(path)...)
	}
	words = append(words, 0)
	headerSize := unsafe.Sizeof(dropFilesHeader{})
	size := headerSize + uintptr(len(words)*2)
	h, _, _ := procGlobalAlloc.Call(GMEM_MOVEABLE, size)
	if h == 0 {
		return 0
	}
	ptr, _, _ := procGlobalLock.Call(h)
	if ptr == 0 {
		procGlobalFree.Call(h)
		return 0
	}
	memory := unsafe.Slice((*byte)(unsafe.Pointer(ptr)), int(size))
	clear(memory)
	header := (*dropFilesHeader)(unsafe.Pointer(ptr))
	header.PFiles = uint32(headerSize)
	header.FWide = 1
	dst := unsafe.Slice((*uint16)(unsafe.Pointer(ptr+headerSize)), len(words))
	copy(dst, words)
	procGlobalUnlock.Call(h)
	return h
}

func queryDroppedFiles(hdrop uintptr) (files []string, err error) {
	if hdrop == 0 {
		return nil, fmt.Errorf("invalid drop handle")
	}
	defer procDragFinish.Call(hdrop)
	count, _, _ := procDragQueryFileW.Call(hdrop, uintptr(^uint32(0)), 0, 0)
	if count > 100000 {
		return nil, fmt.Errorf("too many dropped items: %d", count)
	}
	files = make([]string, 0, int(count))
	for i := uintptr(0); i < count; i++ {
		n, _, _ := procDragQueryFileW.Call(hdrop, i, 0, 0)
		if n == 0 || n > 1<<20 {
			continue
		}
		buf := make([]uint16, int(n)+1)
		written, _, _ := procDragQueryFileW.Call(hdrop, i, uintptr(unsafe.Pointer(&buf[0])), n+1)
		if written == 0 {
			continue
		}
		path := strings.TrimSpace(syscall.UTF16ToString(buf))
		if path != "" {
			files = append(files, filepath.Clean(path))
		}
	}
	return files, nil
}

func (a *application) handleDrop(hdrop uintptr) {
	files, err := queryDroppedFiles(hdrop)
	if err != nil {
		writeCrashContext("decode WM_DROPFILES", err)
		setText(a.hStatusText, "拖拽导入失败："+err.Error())
		return
	}
	if len(files) == 0 {
		setText(a.hStatusText, "未从拖拽内容中读取到文件。")
		return
	}
	recursive := a.settings.IncludeSubdirs
	setText(a.hStatusText, fmt.Sprintf("正在后台读取 %d 个拖拽项目…", len(files)))
	go a.processDroppedPaths(files, recursive)
}

func (a *application) processDroppedPaths(files []string, recursive bool) {
	defer func() {
		if r := recover(); r != nil {
			writeCrashContext("background drop import", r)
			a.postUI(func() {
				setText(a.hStatusText, "拖拽导入发生异常，已拦截并写入 crash.log。")
			})
		}
	}()

	scan := media.ScanDroppedPaths(files, recursive)
	a.postUI(func() {
		totalVideo, totalImage, totalDuplicate := 0, 0, 0
		for _, group := range scan.Groups {
			v, i, d := a.addPaths(group.Paths, group.Root)
			totalVideo += v
			totalImage += i
			totalDuplicate += d
		}
		msg := fmt.Sprintf("导入完成：视频 %d 个，图片 %d 个", totalVideo, totalImage)
		if totalDuplicate > 0 {
			msg += fmt.Sprintf("，重复 %d 个", totalDuplicate)
		}
		if scan.Unsupported > 0 {
			msg += fmt.Sprintf("，忽略不支持文件 %d 个", scan.Unsupported)
		}
		if scan.Unreadable > 0 {
			msg += fmt.Sprintf("，无法读取 %d 项", scan.Unreadable)
		}
		if scan.ScanErrors > 0 {
			msg += fmt.Sprintf("，文件夹扫描失败 %d 个", scan.ScanErrors)
		}
		if totalVideo+totalImage > 0 {
			a.showImportToast(msg)
		} else {
			setText(a.hStatusText, msg)
		}
	})
}

func workspaceFocusKind(videoCount, imageCount int, current model.Kind) model.Kind {
	if videoCount > 0 && imageCount == 0 {
		return model.KindVideo
	}
	if imageCount > 0 && videoCount == 0 {
		return model.KindImage
	}
	return current
}

func (a *application) addPaths(paths []string, root string) (videoAdded, imageAdded, duplicates int) {
	if len(paths) == 0 {
		setText(a.hStatusText, "未发现可导入的媒体文件")
		return 0, 0, 0
	}
	sort.Strings(paths)
	a.mu.Lock()
	existing := map[string]*model.Task{}
	for _, t := range a.tasks {
		if t != nil {
			existing[strings.ToLower(filepath.Clean(t.Input))] = t
		}
	}
	var probeIDs []int64
	highlightIDs := make(map[int64]bool)
	videoTouched, imageTouched := 0, 0
	for _, path := range paths {
		kind, ok := media.DetectKind(path)
		if !ok {
			continue
		}
		key := strings.ToLower(filepath.Clean(path))
		if old := existing[key]; old != nil {
			duplicates++
			highlightIDs[old.ID] = true
			if old.Kind == model.KindVideo {
				videoTouched++
			} else {
				imageTouched++
			}
			continue
		}
		t := &model.Task{ID: a.nextID.Add(1), Input: path, Root: root, Kind: kind, Status: model.StatusReady, InputSize: media.FileSize(path), Options: a.settings.DefaultOptions(kind), ThumbnailIndex: -1}
		a.tasks = append(a.tasks, t)
		existing[key] = t
		highlightIDs[t.ID] = true
		probeIDs = append(probeIDs, t.ID)
		if kind == model.KindVideo {
			videoAdded++
			videoTouched++
		} else {
			imageAdded++
			imageTouched++
		}
	}
	for id := range highlightIDs {
		a.pendingSelection[id] = true
	}
	a.mu.Unlock()

	a.currentKind = workspaceFocusKind(videoTouched, imageTouched, a.currentKind)
	added := videoAdded + imageAdded
	if added == 0 {
		if duplicates > 0 {
			a.refreshAll()
			setText(a.hStatusText, fmt.Sprintf("未加入新文件；已定位并选中 %d 个现有任务。", duplicates))
		} else {
			setText(a.hStatusText, "未加入新文件；所选内容不是支持的媒体文件。")
		}
		return videoAdded, imageAdded, duplicates
	}
	setText(a.hStatusText, fmt.Sprintf("已自动分流：视频 %d 个，图片 %d 个；新增任务已选中。", videoAdded, imageAdded))
	a.saveSession()
	a.refreshAll()
	_, ffprobe, _, _, _ := a.componentSnapshot()
	if ffprobe != "" {
		for _, id := range probeIDs {
			a.queueProbe(id)
		}
	}
	return videoAdded, imageAdded, duplicates
}

type thumbnailJob struct {
	id    int64
	input string
	probe media.ProbeInfo
}

const (
	probeWorkerCount     = 4
	thumbnailWorkerCount = 2
)

func (a *application) startBackgroundWorkers() {
	if a == nil || a.probeQueue == nil || a.thumbnailQueue == nil {
		return
	}
	for i := 0; i < probeWorkerCount; i++ {
		go func(worker int) {
			for id := range a.probeQueue {
				func() {
					defer func() {
						if r := recover(); r != nil {
							writeCrashContext(fmt.Sprintf("probe worker %d task %d", worker, id), r)
							a.postUI(func() {
								a.mu.Lock()
								if t, _ := a.findTaskByIDLocked(id); t != nil && t.Error == "" {
									t.Error = "媒体检测发生异常；详细信息已写入 crash.log"
								}
								a.mu.Unlock()
								a.updateTaskRowByID(id)
							})
						}
					}()
					a.probeTask(id)
				}()
			}
		}(i + 1)
	}
	for i := 0; i < thumbnailWorkerCount; i++ {
		go func(worker int) {
			for job := range a.thumbnailQueue {
				func() {
					defer func() {
						if r := recover(); r != nil {
							writeCrashContext(fmt.Sprintf("thumbnail worker %d task %d", worker, job.id), r)
						}
					}()
					a.generateThumbnail(job.id, job.input, job.probe)
				}()
			}
		}(i + 1)
	}
}

func (a *application) queueProbe(id int64) bool {
	if a == nil || a.probeQueue == nil || id == 0 {
		return false
	}
	select {
	case a.probeQueue <- id:
		return true
	default:
		a.probeQueueDropped.Add(1)
		return false
	}
}

func (a *application) queueThumbnail(id int64, input string, pinfo media.ProbeInfo) bool {
	if a == nil || a.thumbnailQueue == nil || id == 0 || strings.TrimSpace(input) == "" {
		return false
	}
	select {
	case a.thumbnailQueue <- thumbnailJob{id: id, input: input, probe: pinfo}:
		return true
	default:
		// Thumbnails are optional. Saturation must never create one waiting
		// goroutine per task or delay conversion/import completion.
		a.thumbnailQueueDropped.Add(1)
		return false
	}
}

func (a *application) probeTask(id int64) {
	a.mu.Lock()
	t, _ := a.findTaskByIDLocked(id)
	if t == nil {
		a.mu.Unlock()
		return
	}
	path := t.Input
	a.mu.Unlock()
	_, ffprobe, _, _, _ := a.componentSnapshot()
	if ffprobe == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	pinfo, err := media.ProbeContext(ctx, ffprobe, path)
	cancel()
	a.mu.Lock()
	t, _ = a.findTaskByIDLocked(id)
	if t != nil && t.Input == path {
		if err == nil {
			t.Width = pinfo.Width
			t.Height = pinfo.Height
			t.Rotation = pinfo.Rotation
			t.Duration = pinfo.Duration
			t.FPS = pinfo.FPS
			t.BitrateKbps = pinfo.BitrateKbps
			t.VideoCodec = pinfo.VideoCodec
			t.AudioCodec = pinfo.AudioCodec
			t.AudioStreams = pinfo.AudioStreams
			t.AudioBitrateKbps = pinfo.AudioBitrateKbps
			t.SubtitleStreams = pinfo.SubtitleStreams
			t.TextSubtitleStreams = pinfo.TextSubtitles
			t.BitmapSubtitleStreams = pinfo.BitmapSubtitles
			t.VariableFrameRate = pinfo.VariableFrameRate
			t.HDRInfo = pinfo.HDRInfo
		} else if t.Error == "" {
			t.Error = "检测失败: " + err.Error()
		}
	}
	a.mu.Unlock()
	procPostMessageW.Call(a.hwnd, WM_APP_PROBE, uintptr(id), 0)
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	if err == nil && ffmpeg != "" {
		a.queueThumbnail(id, path, pinfo)
	}
}

func (a *application) generateThumbnail(id int64, input string, pinfo media.ProbeInfo) {
	defer func() {
		if r := recover(); r != nil {
			writeCrashContext(fmt.Sprintf("thumbnail task %d", id), r)
		}
	}()
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	if a.hImageList == 0 || ffmpeg == "" {
		return
	}
	at := 0.0
	if pinfo.Duration > 1 {
		at = pinfo.Duration * .05
	}
	out := ""
	cached := a.settings.ThumbnailCache
	var err error
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if cached {
		out, err = media.GenerateThumbnailBMPCached(ctx, ffmpeg, input, at, "自动", 86, 48)
	} else {
		dir, e := config.TempDir()
		if e != nil {
			return
		}
		out = filepath.Join(dir, fmt.Sprintf("thumb_%d_%d.bmp", id, time.Now().UnixNano()))
		err = media.GenerateThumbnailBMP(ctx, ffmpeg, input, out, at, "自动", 86, 48)
	}
	if err != nil {
		if !cached {
			_ = os.Remove(out)
		}
		return
	}
	a.postUI(func() {
		if !cached {
			defer os.Remove(out)
		}
		if a.hImageList == 0 {
			return
		}
		h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
		if h == 0 || a.hImageList == 0 {
			return
		}
		idx, _, _ := procImageListAdd.Call(a.hImageList, h, 0)
		procDeleteObject.Call(h)
		if int32(idx) < 0 {
			return
		}
		a.mu.Lock()
		t, _ := a.findTaskByIDLocked(id)
		if t != nil && t.Input == input {
			t.ThumbnailIndex = int(int32(idx))
		}
		a.mu.Unlock()
		a.updateTaskRowByID(id)
	})
}

func (a *application) refreshAll() {
	a.refreshList()
	a.refreshTotal()
	a.updateRightPanel()
	a.updateComponentStatus()
	a.v420RefreshOutputHistory()
	a.v420UpdateStartAction()
}
func taskStatusRank(status model.Status) int {
	switch status {
	case model.StatusProcessing:
		return 0
	case model.StatusPaused:
		return 1
	case model.StatusQueued:
		return 2
	case model.StatusHeld:
		return 3
	case model.StatusReady:
		return 3
	case model.StatusFailed:
		return 4
	case model.StatusCancelled:
		return 5
	case model.StatusSkipped:
		return 6
	case model.StatusDone:
		return 7
	default:
		return 8
	}
}

func compareTaskColumn(left, right *model.Task, column int) int {
	if left == nil && right == nil {
		return 0
	}
	if left == nil {
		return 1
	}
	if right == nil {
		return -1
	}
	cmpString := func(a, b string) int { return strings.Compare(strings.ToLower(a), strings.ToLower(b)) }
	cmpInt64 := func(a, b int64) int {
		if a < b {
			return -1
		}
		if a > b {
			return 1
		}
		return 0
	}
	cmpFloat := func(a, b float64) int {
		if a < b {
			return -1
		}
		if a > b {
			return 1
		}
		return 0
	}
	switch column {
	case 0:
		return cmpString(filepath.Base(left.Input), filepath.Base(right.Input))
	case 1:
		if left.Width != right.Width {
			return cmpInt64(int64(left.Width), int64(right.Width))
		}
		return cmpInt64(int64(left.Height), int64(right.Height))
	case 2:
		return cmpInt64(int64(left.Rotation), int64(right.Rotation))
	case 3:
		return cmpString(left.Options.Resolution+left.Options.ImageSize, right.Options.Resolution+right.Options.ImageSize)
	case 4:
		return cmpString(left.Options.Quality, right.Options.Quality)
	case 5:
		return cmpString(left.Options.Rotation, right.Options.Rotation)
	case 6:
		return cmpInt64(left.InputSize, right.InputSize)
	case 7:
		return cmpInt64(left.OutputSize, right.OutputSize)
	case 8:
		return cmpFloat(left.Progress, right.Progress)
	case 9:
		return cmpInt64(int64(taskStatusRank(left.Status)), int64(taskStatusRank(right.Status)))
	default:
		return cmpInt64(left.ID, right.ID)
	}
}

func taskSortLabel(column int) string {
	labels := []string{"文件名", "分辨率", "方向", "输出分辨率", "质量", "旋转", "源体积", "输出体积", "进度", "状态"}
	if column >= 0 && column < len(labels) {
		return labels[column]
	}
	return "任务"
}

func (a *application) toggleTaskSort(column int) {
	if column < 0 || column > 9 {
		return
	}
	if a.sortActive && a.sortColumn == column {
		a.sortDescending = !a.sortDescending
	} else {
		a.sortActive = true
		a.sortColumn = column
		a.sortDescending = false
	}
	a.refreshList()
	direction := "升序"
	if a.sortDescending {
		direction = "降序"
	}
	setText(a.hStatusText, fmt.Sprintf("任务列表已按%s%s排列；再次点击同一表头可反向。", taskSortLabel(column), direction))
}

func selectionRows(tasks []model.Task, selectedIDs map[int64]bool) []int {
	if len(selectedIDs) == 0 {
		return nil
	}
	rows := make([]int, 0, len(selectedIDs))
	for row := range tasks {
		if selectedIDs[tasks[row].ID] {
			rows = append(rows, row)
		}
	}
	return rows
}

func (a *application) selectedTaskIDsSnapshot() map[int64]bool {
	selected := map[int64]bool{}
	if a == nil || a.hList == 0 {
		return selected
	}
	rows := []int{}
	for row := -1; ; {
		next := int(int32(send(a.hList, LVM_GETNEXTITEM, uintptr(row), LVNI_SELECTED)))
		if next < 0 {
			break
		}
		rows = append(rows, next)
		row = next
	}
	a.mu.Lock()
	for _, row := range rows {
		if row >= 0 && row < len(a.visible) {
			idx := a.visible[row]
			if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil {
				selected[a.tasks[idx].ID] = true
			}
		}
	}
	a.mu.Unlock()
	return selected
}

func (a *application) restoreTaskSelection(tasks []model.Task, selectedIDs map[int64]bool) {
	rows := selectionRows(tasks, selectedIDs)
	for i, row := range rows {
		state := uint32(LVIS_SELECTED)
		if i == 0 {
			state |= LVIS_FOCUSED
		}
		it := lvItem{State: state, StateMask: LVIS_SELECTED | LVIS_FOCUSED}
		send(a.hList, LVM_SETITEMSTATE, uintptr(row), uintptr(unsafe.Pointer(&it)))
	}
	if len(rows) > 0 {
		send(a.hList, LVM_ENSUREVISIBLE, uintptr(rows[0]), 0)
	}
}

func (a *application) refreshList() {
	selectedIDs := a.selectedTaskIDsSnapshot()
	a.mu.Lock()
	for id := range a.pendingSelection {
		selectedIDs[id] = true
	}
	a.pendingSelection = make(map[int64]bool)
	a.mu.Unlock()
	search := strings.ToLower(strings.TrimSpace(getText(a.hSearch)))
	filter := comboText(a.hFilter)

	// ListView SendMessage calls can synchronously emit WM_NOTIFY. Never keep
	// a.mu held while rebuilding the control, because the notification path
	// refreshes the right panel and needs the same mutex. Build immutable row
	// snapshots first, publish the final visible-index mapping, then touch UI.
	type listRowSnapshot struct {
		index int
		task  model.Task
	}
	a.mu.Lock()
	rows := make([]listRowSnapshot, 0, len(a.tasks))
	for idx, t := range a.tasks {
		if t.Kind != a.currentKind {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(filepath.Base(t.Input)), search) && !strings.Contains(strings.ToLower(t.Input), search) {
			continue
		}
		if filter != "" && filter != "全部状态" && string(t.Status) != filter {
			continue
		}
		rows = append(rows, listRowSnapshot{index: idx, task: *t})
	}
	sortActive, sortColumn, sortDescending := a.sortActive, a.sortColumn, a.sortDescending
	a.mu.Unlock()
	if sortActive {
		sort.SliceStable(rows, func(i, j int) bool {
			cmp := compareTaskColumn(&rows[i].task, &rows[j].task, sortColumn)
			if cmp == 0 {
				cmp = compareTaskColumn(&rows[i].task, &rows[j].task, 0)
			}
			if sortDescending {
				return cmp > 0
			}
			return cmp < 0
		})
	}
	visible := make([]int, 0, len(rows))
	for _, row := range rows {
		visible = append(visible, row.index)
	}
	a.mu.Lock()
	a.visible = visible
	a.mu.Unlock()

	send(a.hList, WM_SETREDRAW, 0, 0)
	defer func() {
		send(a.hList, WM_SETREDRAW, 1, 0)
		count := int(send(a.hList, LVM_GETITEMCOUNT, 0, 0))
		if count > 0 {
			send(a.hList, LVM_REDRAWITEMS, 0, uintptr(count-1))
		}
		procInvalidateRect.Call(a.hList, 0, 1)
		procUpdateWindow.Call(a.hList)
	}()
	send(a.hList, LVM_DELETEALLITEMS, 0, 0)
	for row := range rows {
		a.insertRow(row, &rows[row].task)
	}
	rowTasks := make([]model.Task, len(rows))
	for i := range rows {
		rowTasks[i] = rows[i].task
	}
	a.restoreTaskSelection(rowTasks, selectedIDs)
}
func (a *application) insertRow(row int, t *model.Task) {
	texts := a.taskTexts(t)
	q := p(texts[0])
	item := lvItem{Mask: LVIF_TEXT | LVIF_IMAGE, IItem: int32(row), PszText: q, IImage: int32(t.ThumbnailIndex)}
	send(a.hList, LVM_INSERTITEMW, 0, uintptr(unsafe.Pointer(&item)))
	for col := 1; col < len(texts); col++ {
		q = p(texts[col])
		it := lvItem{ISubItem: int32(col), PszText: q}
		send(a.hList, LVM_SETITEMTEXTW, uintptr(row), uintptr(unsafe.Pointer(&it)))
	}
}
func (a *application) taskTexts(t *model.Task) []string {
	spec := "检测中"
	if t.Width > 0 {
		spec = fmt.Sprintf("%d×%d", t.Width, t.Height)
	}
	dir := "0°"
	if t.Rotation != 0 {
		dir = fmt.Sprintf("%d°", t.Rotation)
	}
	opts := a.settings.EffectiveOptions(t)
	outRes := a.outputResolutionText(t, opts)
	compressed := "—"
	if t.OutputSize > 0 {
		ratio := ""
		if t.InputSize > 0 {
			ratio = fmt.Sprintf(" (%.1f%%)", float64(t.OutputSize)/float64(t.InputSize)*100)
		}
		compressed = media.FormatBytes(t.OutputSize) + ratio
	}
	status := string(t.Status)
	if t.Status == model.StatusProcessing && t.Progress > 0.5 && !t.StartedAt.IsZero() {
		elapsed := time.Since(t.StartedAt)
		remain := time.Duration(float64(elapsed) * (100 - t.Progress) / t.Progress)
		if remain > 0 && remain < 7*24*time.Hour {
			status = "剩余 " + formatDuration(remain)
		}
	}
	if t.Error != "" {
		if t.FailureCategory != "" {
			status += " · " + t.FailureCategory
		}
		status += " · " + short(t.Error, 45)
	} else if t.ValidationWarning != "" {
		status += " · 校验警告"
	}
	name := filepath.Base(t.Input)
	if t.Pinned {
		name = "[置顶] " + name
	}
	return []string{name, spec, dir, outRes, opts.Quality, opts.Rotation, media.FormatBytes(t.InputSize), compressed, fmt.Sprintf("%.1f%%", t.Progress), status}
}
func (a *application) outputResolutionText(t *model.Task, opts model.TaskOptions) string {
	if t == nil {
		return "—"
	}
	if t.Kind == model.KindImage {
		if opts.ImageSize == "" {
			return "保持原尺寸"
		}
		return opts.ImageSize
	}
	w, h := t.Width, t.Height
	if w <= 0 || h <= 0 {
		if opts.Resolution != "" {
			return opts.Resolution
		}
		return "检测中"
	}
	rotation := opts.Rotation
	if rotation == "自动" {
		if t.Rotation == 90 || t.Rotation == 270 {
			w, h = h, w
		}
	} else if rotation == "90°右转" || rotation == "90°左转" {
		w, h = h, w
	}
	if opts.Crop.Enabled && opts.Crop.Width > 1 && opts.Crop.Height > 1 {
		w, h = opts.Crop.Width, opts.Crop.Height
	}
	edge := media.MaxEdge(opts.Resolution)
	if edge > 0 {
		maxDim := w
		if h > maxDim {
			maxDim = h
		}
		if maxDim > 0 && (a.settings.AllowUpscale || maxDim > edge) {
			scale := float64(edge) / float64(maxDim)
			w = int(float64(w)*scale) / 2 * 2
			h = int(float64(h)*scale) / 2 * 2
		}
	}
	if w < 2 || h < 2 {
		return opts.Resolution
	}
	return fmt.Sprintf("%d×%d", w, h)
}

func short(s string, n int) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r", " "), "\n", " ")
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}
func (a *application) updateTaskRowByID(taskID int64) {
	// Never hold a.mu across SendMessage. List-view updates can synchronously
	// emit WM_NOTIFY, whose right-panel refresh needs the same mutex. Holding
	// it here therefore self-deadlocks the UI thread. Snapshot the row data
	// under the lock, release it, and only then call Win32.
	a.mu.Lock()
	task, taskIndex := a.findTaskByIDLocked(taskID)
	if task == nil {
		a.mu.Unlock()
		return
	}
	row := -1
	for i, idx := range a.visible {
		if idx == taskIndex {
			row = i
			break
		}
	}
	if row < 0 {
		a.mu.Unlock()
		return
	}
	taskSnapshot := *task
	a.mu.Unlock()

	texts := a.taskTexts(&taskSnapshot)
	q := p(texts[0])
	first := lvItem{Mask: LVIF_TEXT | LVIF_IMAGE, IItem: int32(row), ISubItem: 0, PszText: q, IImage: int32(taskSnapshot.ThumbnailIndex)}
	send(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&first)))
	for col := 1; col < len(texts); col++ {
		q = p(texts[col])
		it := lvItem{ISubItem: int32(col), PszText: q}
		send(a.hList, LVM_SETITEMTEXTW, uintptr(row), uintptr(unsafe.Pointer(&it)))
	}
	send(a.hList, LVM_REDRAWITEMS, uintptr(row), uintptr(row))
}

func (a *application) selectedVisibleRows() []int {
	var rows []int
	i := int32(-1)
	for {
		r := int32(send(a.hList, LVM_GETNEXTITEM, uintptr(i), LVNI_SELECTED))
		if r < 0 {
			break
		}
		rows = append(rows, int(r))
		i = r
	}
	return rows
}
func (a *application) selectedTaskIndices() []int {
	rows := a.selectedVisibleRows()
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []int
	for _, r := range rows {
		if r >= 0 && r < len(a.visible) {
			out = append(out, a.visible[r])
		}
	}
	return out
}
func (a *application) selectedTask() (*model.Task, int) {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return nil, -1
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if idxs[0] < 0 || idxs[0] >= len(a.tasks) {
		return nil, -1
	}
	return a.tasks[idxs[0]], idxs[0]
}
func (a *application) updateRightPanel() {
	a.v420UpdateRightPanel()
}
func emptyDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func compressionBar(ratio float64) string {
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 100 {
		ratio = 100
	}
	filled := int(ratio/10 + .5)
	if filled < 0 {
		filled = 0
	}
	if filled > 10 {
		filled = 10
	}
	return "[" + strings.Repeat("■", filled) + strings.Repeat("□", 10-filled) + "]"
}

func trimCropSummary(t *model.Task) string {
	dur := "完整时长"
	if t.Options.TrimStart > 0 || t.Options.TrimEnd > 0 {
		dur = fmt.Sprintf("%s → %s", formatSecondsClock(t.Options.TrimStart), formatSecondsClock(t.Options.TrimEnd))
	}
	crop := "全画面"
	if t.Options.Crop.Enabled {
		crop = fmt.Sprintf("裁剪 %d×%d @ (%d,%d)", t.Options.Crop.Width, t.Options.Crop.Height, t.Options.Crop.X, t.Options.Crop.Y)
	}
	return dur + " · " + crop
}

func (a *application) applyTaskOptions(defaults bool) {
	a.v420ApplyTaskOptions(defaults)
}
func scaleCropValue(value, sourceSize, targetSize int) int {
	if sourceSize <= 0 || targetSize <= 0 {
		return value
	}
	return int((int64(value)*int64(targetSize) + int64(sourceSize)/2) / int64(sourceSize))
}

func scaledCropForTarget(source *model.Task, sourceOpts model.TaskOptions, target *model.Task, targetOpts model.TaskOptions) model.Crop {
	crop := sourceOpts.Crop
	if !crop.Enabled || source == nil || target == nil {
		return model.Crop{}
	}
	sourceW, sourceH := effectiveFrameSize(source, sourceOpts.Rotation)
	targetW, targetH := effectiveFrameSize(target, targetOpts.Rotation)
	if sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0 {
		return crop
	}
	x := evenCoord(scaleCropValue(crop.X, sourceW, targetW))
	y := evenCoord(scaleCropValue(crop.Y, sourceH, targetH))
	w := evenSize(scaleCropValue(crop.Width, sourceW, targetW))
	h := evenSize(scaleCropValue(crop.Height, sourceH, targetH))
	if x > targetW-2 {
		x = evenCoord(targetW - 2)
	}
	if y > targetH-2 {
		y = evenCoord(targetH - 2)
	}
	if x+w > targetW {
		w = evenSize(targetW - x)
	}
	if y+h > targetH {
		h = evenSize(targetH - y)
	}
	return model.Crop{Enabled: true, X: x, Y: y, Width: w, Height: h}
}

func trimRangeForTarget(sourceOpts model.TaskOptions, target *model.Task) (float64, float64) {
	if target == nil || target.Kind == model.KindImage || sourceOpts.TrimEnd <= sourceOpts.TrimStart {
		return 0, 0
	}
	start, end := sourceOpts.TrimStart, sourceOpts.TrimEnd
	if start < 0 {
		start = 0
	}
	if target.Duration > 0 {
		if end > target.Duration {
			end = target.Duration
		}
		if start >= end {
			return 0, 0
		}
	}
	return start, end
}

func resetTaskAfterOptionChange(t *model.Task) {
	if t == nil {
		return
	}
	switch t.Status {
	case model.StatusDone, model.StatusFailed, model.StatusSkipped, model.StatusCancelled:
		t.Status = model.StatusReady
		t.Progress = 0
		t.OutputPath = ""
		t.OutputSize = 0
		t.Error = ""
		t.FailureCategory = ""
		t.ValidationWarning = ""
		t.Engine = ""
		t.StartedAt = time.Time{}
		t.FinishedAt = time.Time{}
	}
}

func copyTrimCropToTargets(settings model.Settings, tasks []*model.Task, idxs []int) int {
	if len(idxs) < 2 || idxs[0] < 0 || idxs[0] >= len(tasks) || tasks[idxs[0]] == nil {
		return 0
	}
	source := tasks[idxs[0]]
	sourceOpts := settings.EffectiveOptions(source)
	copied := 0
	for _, idx := range idxs[1:] {
		if idx < 0 || idx >= len(tasks) || tasks[idx] == nil {
			continue
		}
		target := tasks[idx]
		if target.IsLocked() {
			continue
		}
		targetOpts := settings.EffectiveOptions(target)
		targetOpts.FollowDefaults = false
		targetOpts.TrimStart, targetOpts.TrimEnd = trimRangeForTarget(sourceOpts, target)
		targetOpts.Crop = scaledCropForTarget(source, sourceOpts, target, targetOpts)
		target.Options = targetOpts
		resetTaskAfterOptionChange(target)
		copied++
	}
	return copied
}

func (a *application) copyTrimCropOptions() {
	idxs := a.selectedTaskIndices()
	if len(idxs) < 2 {
		messageBox(a.hwnd, "复制裁剪设置", "请先选择至少两个任务，第一项作为来源，其余项作为目标。", MB_OK|MB_ICONINFORMATION)
		return
	}
	a.mu.Lock()
	copied := copyTrimCropToTargets(a.settings, a.tasks, idxs)
	a.mu.Unlock()
	if copied == 0 {
		messageBox(a.hwnd, "复制裁剪设置", "没有可修改的目标任务。队列中、转换中或暂停中的任务不会被改变。", MB_OK|MB_ICONINFORMATION)
		return
	}
	a.saveSession()
	a.refreshList()
	a.updateRightPanel()
	setText(a.hStatusText, fmt.Sprintf("已将第一项的时长与画面裁剪复制到 %d 个任务；其他输出参数保持不变。", copied))
}

func (a *application) copyTaskOptions() {
	idxs := a.selectedTaskIndices()
	if len(idxs) < 2 {
		messageBox(a.hwnd, "复制任务参数", "请先选择至少两个任务，第一项作为来源，其余项作为目标。", MB_OK|MB_ICONINFORMATION)
		return
	}
	a.mu.Lock()
	src := a.tasks[idxs[0]].Options
	for _, i := range idxs[1:] {
		if i < 0 || i >= len(a.tasks) {
			continue
		}
		t := a.tasks[i]
		if t.IsLocked() {
			continue
		}
		t.Options = src
		if t.Status == model.StatusDone || t.Status == model.StatusFailed || t.Status == model.StatusSkipped || t.Status == model.StatusCancelled {
			t.Status = model.StatusReady
			t.Progress = 0
			t.OutputPath = ""
			t.OutputSize = 0
			t.Error = ""
		}
	}
	a.mu.Unlock()
	a.saveSession()
	a.refreshList()
}

func (a *application) setSelectedQuickOption(id int) {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	a.mu.Lock()
	for _, i := range idxs {
		if i < 0 || i >= len(a.tasks) {
			continue
		}
		t := a.tasks[i]
		if t.IsLocked() {
			continue
		}
		o := a.settings.EffectiveOptions(t)
		o.FollowDefaults = false
		switch id {
		case ID_CTX_RES_4K:
			if t.Kind == model.KindImage {
				o.ImageSize = "最大边 3840px"
			} else {
				o.Resolution = "4K"
			}
		case ID_CTX_RES_1080:
			if t.Kind == model.KindImage {
				o.ImageSize = "最大边 1920px"
			} else {
				o.Resolution = "1080P"
			}
		case ID_CTX_RES_720:
			if t.Kind == model.KindImage {
				o.ImageSize = "最大边 1280px"
			} else {
				o.Resolution = "720P"
			}
		case ID_CTX_RES_480:
			if t.Kind == model.KindImage {
				o.ImageSize = "最大边 854px"
			} else {
				o.Resolution = "480P"
			}
		case ID_CTX_RES_ORIGINAL:
			if t.Kind == model.KindImage {
				o.ImageSize = "保持原尺寸"
			} else {
				o.Resolution = "原尺寸"
			}
		case ID_CTX_CODEC_265:
			o.Codec = "H.265"
		case ID_CTX_CODEC_264:
			o.Codec = "H.264"
		case ID_CTX_CODEC_JPG:
			o.ImageFormat = "JPG"
		case ID_CTX_CODEC_PNG:
			o.ImageFormat = "PNG"
		case ID_CTX_QUALITY_HIGH:
			o.Quality = "高"
		case ID_CTX_QUALITY_MEDIUM:
			o.Quality = "中"
		case ID_CTX_QUALITY_LOW:
			o.Quality = "低"
		case ID_CTX_ROT_AUTO:
			o.Rotation = "自动"
		case ID_CTX_ROT_RIGHT:
			o.Rotation = "90°右转"
		case ID_CTX_ROT_LEFT:
			o.Rotation = "90°左转"
		case ID_CTX_ROT_180:
			o.Rotation = "180°"
		case ID_CTX_ROT_HFLIP:
			o.Rotation = "左右翻转"
		case ID_CTX_ROT_VFLIP:
			o.Rotation = "上下翻转"
		}
		t.Options = o
		if t.Status == model.StatusDone || t.Status == model.StatusFailed || t.Status == model.StatusSkipped || t.Status == model.StatusCancelled {
			t.Status = model.StatusReady
			t.Progress = 0
			t.OutputPath = ""
			t.OutputSize = 0
			t.Error = ""
		}
	}
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
}

func (a *application) togglePinSelected() {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	a.mu.Lock()
	pin := true
	if idxs[0] >= 0 && idxs[0] < len(a.tasks) {
		pin = !a.tasks[idxs[0]].Pinned
	}
	selected := make(map[int64]bool)
	for _, i := range idxs {
		if i >= 0 && i < len(a.tasks) {
			a.tasks[i].Pinned = pin
			selected[a.tasks[i].ID] = true
		}
	}
	if pin {
		front := make([]*model.Task, 0, len(selected))
		rest := make([]*model.Task, 0, len(a.tasks)-len(selected))
		for _, t := range a.tasks {
			if selected[t.ID] {
				front = append(front, t)
			} else {
				rest = append(rest, t)
			}
		}
		a.tasks = append(front, rest...)
	}
	a.sortActive = false
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
}

func (a *application) moveSelected(delta int) {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 || delta == 0 {
		return
	}
	a.mu.Lock()
	selected := make(map[int64]bool)
	for _, i := range idxs {
		if i >= 0 && i < len(a.tasks) {
			selected[a.tasks[i].ID] = true
		}
	}
	if delta < 0 {
		for i := 1; i < len(a.tasks); i++ {
			if selected[a.tasks[i].ID] && !selected[a.tasks[i-1].ID] && a.tasks[i].Kind == a.tasks[i-1].Kind {
				a.tasks[i-1], a.tasks[i] = a.tasks[i], a.tasks[i-1]
			}
		}
	} else {
		for i := len(a.tasks) - 2; i >= 0; i-- {
			if selected[a.tasks[i].ID] && !selected[a.tasks[i+1].ID] && a.tasks[i].Kind == a.tasks[i+1].Kind {
				a.tasks[i], a.tasks[i+1] = a.tasks[i+1], a.tasks[i]
			}
		}
	}
	a.sortActive = false
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
}

func reorderTaskBlock(tasks []*model.Task, selected map[int64]bool, kind model.Kind, front bool) []*model.Task {
	if len(tasks) == 0 || len(selected) == 0 {
		return tasks
	}
	selectedKind := make([]*model.Task, 0, len(selected))
	unselectedKind := make([]*model.Task, 0)
	for _, task := range tasks {
		if task == nil || task.Kind != kind {
			continue
		}
		if selected[task.ID] {
			selectedKind = append(selectedKind, task)
		} else {
			unselectedKind = append(unselectedKind, task)
		}
	}
	orderedKind := append([]*model.Task{}, unselectedKind...)
	if front {
		orderedKind = append(append([]*model.Task{}, selectedKind...), unselectedKind...)
	} else {
		orderedKind = append(orderedKind, selectedKind...)
	}
	result := make([]*model.Task, 0, len(tasks))
	pos := 0
	for _, task := range tasks {
		if task != nil && task.Kind == kind {
			result = append(result, orderedKind[pos])
			pos++
		} else {
			result = append(result, task)
		}
	}
	return result
}

func (a *application) moveSelectedToEdge(front bool) {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	a.mu.Lock()
	selected := make(map[int64]bool, len(idxs))
	for _, idx := range idxs {
		if idx >= 0 && idx < len(a.tasks) && a.tasks[idx] != nil {
			selected[a.tasks[idx].ID] = true
		}
	}
	a.tasks = reorderTaskBlock(a.tasks, selected, a.currentKind, front)
	for id := range selected {
		a.pendingSelection[id] = true
	}
	a.sortActive = false
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
	where := "最后"
	if front {
		where = "最前"
	}
	setText(a.hStatusText, fmt.Sprintf("已将 %d 个选中任务整块移动到当前工作区%s。", len(selected), where))
}

func (a *application) jumpToRunning() {
	a.refreshList()
	a.mu.Lock()
	row := -1
	for r, idx := range a.visible {
		if idx >= 0 && idx < len(a.tasks) {
			t := a.tasks[idx]
			if t.Status == model.StatusProcessing || t.Status == model.StatusPaused {
				row = r
				break
			}
		}
	}
	a.mu.Unlock()
	if row < 0 {
		messageBox(a.hwnd, "正在运行的任务", "当前工作区没有正在运行或暂停的任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	it := lvItem{State: LVIS_SELECTED | LVIS_FOCUSED, StateMask: LVIS_SELECTED | LVIS_FOCUSED}
	send(a.hList, LVM_SETITEMSTATE, uintptr(row), uintptr(unsafe.Pointer(&it)))
	send(a.hList, LVM_ENSUREVISIBLE, uintptr(row), 0)
	a.updateRightPanel()
}

func (a *application) showTaskDetails() {
	t, _ := a.selectedTask()
	if t == nil {
		return
	}
	opts := a.settings.EffectiveOptions(t)
	text := fmt.Sprintf("任务：%s\r\n\r\n源文件：%s\r\n输出文件：%s\r\n状态：%s\r\n进度：%.1f%%\r\n编码引擎：%s\r\n失败分类：%s\r\n\r\n源信息：%d×%d · %.3f FPS · %s · %s\r\n视频：%s · %s\r\n音频：%s（%d 轨，%d kb/s） · 字幕 %d 轨\r\n方向标签：%d°\r\n\r\n输出设置：%s · %s · %s · %s · %s\r\n音频：%s · 字幕：%s · 智能复制：%s\r\n裁剪/时长：%s\r\n\r\n错误：%s\r\n输出校验：%s",
		filepath.Base(t.Input), t.Input, t.OutputPath, t.Status, t.Progress, t.Engine, valueOr(t.FailureCategory, "无"),
		t.Width, t.Height, t.FPS, media.FormatBytes(t.InputSize), formatSecondsClock(t.Duration), emptyDash(t.VideoCodec), emptyDash(t.HDRInfo), emptyDash(t.AudioCodec), t.AudioStreams, t.AudioBitrateKbps, t.SubtitleStreams, t.Rotation,
		opts.Resolution, opts.Codec, opts.Quality, optionsVolumeDisplay(opts), opts.Rotation, a.settings.AudioMode, a.settings.SubtitleMode, boolText(a.settings.SmartStreamCopy), trimCropSummary(t), valueOr(t.Error, "无"), valueOr(t.ValidationWarning, "通过或未启用"))
	messageBox(a.hwnd, "任务详情", text, MB_OK|MB_ICONINFORMATION)
}

func (a *application) writeTechnicalReport() {
	t, _ := a.selectedTask()
	if t == nil || t.OutputPath == "" || media.FileSize(t.OutputPath) == 0 {
		messageBox(a.hwnd, "技术参数报告", "请选择一个已有输出文件的任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	_, ffprobe, _, _, _ := a.componentSnapshot()
	if ffprobe == "" {
		messageBox(a.hwnd, "技术参数报告", "未找到 FFprobe。", MB_OK|MB_ICONERROR)
		return
	}
	src, err1 := media.Probe(ffprobe, t.Input)
	out, err2 := media.Probe(ffprobe, t.OutputPath)
	if err1 != nil || err2 != nil {
		messageBox(a.hwnd, "技术参数报告", fmt.Sprintf("读取参数失败：\r\n源文件：%v\r\n输出文件：%v", err1, err2), MB_OK|MB_ICONERROR)
		return
	}
	dir, err := config.Dir()
	if err != nil {
		return
	}
	path := filepath.Join(dir, fmt.Sprintf("media_report_%s.html", time.Now().Format("20060102_150405")))
	inSize, outSize := media.FileSize(t.Input), media.FileSize(t.OutputPath)
	ratio, saving := 0.0, 0.0
	if inSize > 0 {
		ratio = float64(outSize) / float64(inSize) * 100
		saving = 100 - ratio
	}
	esc := func(v string) string {
		v = strings.ReplaceAll(v, "&", "&amp;")
		v = strings.ReplaceAll(v, "<", "&lt;")
		v = strings.ReplaceAll(v, ">", "&gt;")
		return v
	}
	savingLabel := fmt.Sprintf("节省 %.1f%%", saving)
	if saving < 0 {
		savingLabel = fmt.Sprintf("体积增加 %.1f%%", -saving)
	}
	html := fmt.Sprintf(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>媒体技术参数对比</title><style>body{font-family:"Microsoft YaHei",Arial;margin:24px;color:#17202a}h1{font-size:22px}table{border-collapse:collapse;width:100%%;max-width:1100px}th,td{border:1px solid #d6dce5;padding:9px;text-align:left}th{background:#eef2f6}.good{color:#087f36}.path{word-break:break-all}.note{color:#667085}</style></head><body><h1>Mediova技术参数对比报告</h1><p>生成时间：%s</p><table><tr><th>项目</th><th>源文件</th><th>输出文件</th></tr><tr><td>路径</td><td class="path">%s</td><td class="path">%s</td></tr><tr><td>体积</td><td>%s</td><td>%s</td></tr><tr><td>分辨率</td><td>%d×%d</td><td>%d×%d</td></tr><tr><td>视频编码</td><td>%s</td><td>%s</td></tr><tr><td>像素格式</td><td>%s</td><td>%s</td></tr><tr><td>HDR / 色彩</td><td>%s<br><span class="note">%s / %s / %s</span></td><td>%s<br><span class="note">%s / %s / %s</span></td></tr><tr><td>音频</td><td>%s（%d 轨）</td><td>%s（%d 轨）</td></tr><tr><td>字幕</td><td>%s（%d 轨）</td><td>%s（%d 轨）</td></tr><tr><td>帧率</td><td>%.3f FPS</td><td>%.3f FPS</td></tr><tr><td>时长</td><td>%.3f s</td><td>%.3f s</td></tr><tr><td>码率</td><td>%d kb/s</td><td>%d kb/s</td></tr><tr><td>方向标签</td><td>%d°</td><td>%d°</td></tr></table><p class="good"><b>输出 / 原始：%.1f%%；%s</b></p><p>任务编码引擎：%s</p><p>音频策略：%s；字幕策略：%s；智能复制：%s</p></body></html>`, time.Now().Format("2006-01-02 15:04:05"), esc(t.Input), esc(t.OutputPath), media.FormatBytes(inSize), media.FormatBytes(outSize), src.Width, src.Height, out.Width, out.Height, esc(src.VideoCodec), esc(out.VideoCodec), esc(src.PixelFormat), esc(out.PixelFormat), esc(src.HDRInfo), esc(src.ColorPrimaries), esc(src.ColorTransfer), esc(src.ColorSpace), esc(out.HDRInfo), esc(out.ColorPrimaries), esc(out.ColorTransfer), esc(out.ColorSpace), esc(src.AudioCodec), src.AudioStreams, esc(out.AudioCodec), out.AudioStreams, esc(src.SubtitleCodec), src.SubtitleStreams, esc(out.SubtitleCodec), out.SubtitleStreams, src.FPS, out.FPS, src.Duration, out.Duration, src.BitrateKbps, out.BitrateKbps, src.Rotation, out.Rotation, ratio, savingLabel, esc(t.Engine), esc(a.settings.AudioMode), esc(a.settings.SubtitleMode), boolText(a.settings.SmartStreamCopy))
	if err := os.WriteFile(path, []byte(html), 0o644); err != nil {
		messageBox(a.hwnd, "技术参数报告", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	setClipboardText(a.hwnd, path)
	shellOpen(path)
}

func boolText(v bool) string {
	if v {
		return "启用"
	}
	return "关闭"
}

func valueOr(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func parseVolume(o *model.TaskOptions, s string) {
	o.VolumeMode = "质量优先"
	if strings.HasPrefix(s, "目标体积 ") {
		o.VolumeMode = "目标体积"
		n, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(s, "目标体积 "), "MB"))
		o.TargetSizeMB = n
	} else if strings.HasPrefix(s, "码率 ") {
		o.VolumeMode = "码率优先"
		v := strings.TrimSuffix(strings.TrimPrefix(s, "码率 "), "Mbps")
		o.BitrateMbps, _ = strconv.ParseFloat(v, 64)
	}
}
func volumeDisplay(s model.Settings) string {
	o := model.TaskOptions{VolumeMode: s.VolumeMode, TargetSizeMB: s.TargetSizeMB, BitrateMbps: s.BitrateMbps}
	return optionsVolumeDisplay(o)
}
func optionsVolumeDisplay(o model.TaskOptions) string {
	switch o.VolumeMode {
	case "目标体积":
		return fmt.Sprintf("目标体积 %dMB", o.TargetSizeMB)
	case "码率优先":
		return fmt.Sprintf("码率 %gMbps", o.BitrateMbps)
	default:
		return "质量优先"
	}
}

func (a *application) readSettingsFromUI() {
	path := strings.TrimSpace(getText(a.hOutputEdit))
	if path != "" && !a.v420OutputLocked(a.currentKind) {
		a.v420SetOutputDir(a.currentKind, path)
	}
	if a.currentKind == model.KindImage {
		a.settings.ImageSize = comboText(a.hResolution)
		a.settings.ImageFormat = comboText(a.hCodec)
		a.settings.ImageQuality = comboText(a.hQuality)
		a.settings.ImageLimit = comboText(a.hVolume)
	} else {
		a.settings.Resolution = comboText(a.hResolution)
		a.settings.Codec = comboText(a.hCodec)
		a.settings.Quality = comboText(a.hQuality)
		o := a.settings.DefaultOptions(model.KindVideo)
		parseVolume(&o, comboText(a.hVolume))
		a.settings.VolumeMode = o.VolumeMode
		a.settings.TargetSizeMB = o.TargetSizeMB
		a.settings.BitrateMbps = o.BitrateMbps
	}
	a.settings.Rotation = comboText(a.hRotation)
	a.settings.SpeedMode = comboText(a.hSpeedMode)
}

func cleanupMatches(status model.Status, mode string) bool {
	switch mode {
	case "done":
		return status == model.StatusDone
	case "problems":
		return status == model.StatusFailed || status == model.StatusSkipped || status == model.StatusCancelled
	case "finished":
		return status == model.StatusDone || status == model.StatusFailed || status == model.StatusSkipped || status == model.StatusCancelled
	default:
		return false
	}
}

func cleanupTaskList(tasks []*model.Task, kind model.Kind, mode string) (kept []*model.Task, removed int) {
	kept = make([]*model.Task, 0, len(tasks))
	for _, task := range tasks {
		if task != nil && task.Kind == kind && cleanupMatches(task.Status, mode) {
			removed++
			continue
		}
		kept = append(kept, task)
	}
	return kept, removed
}

func cleanupModeLabel(mode string) string {
	switch mode {
	case "done":
		return "已完成"
	case "problems":
		return "失败、跳过和停止"
	default:
		return "全部已结束"
	}
}

func (a *application) cleanupCurrentWorkspace(mode string) {
	a.mu.Lock()
	count := 0
	for _, task := range a.tasks {
		if task != nil && task.Kind == a.currentKind && cleanupMatches(task.Status, mode) {
			count++
		}
	}
	a.mu.Unlock()
	if count == 0 {
		setText(a.hStatusText, "当前工作区没有符合清理条件的任务。")
		return
	}
	label := cleanupModeLabel(mode)
	if messageBox(a.hwnd, "清理任务", fmt.Sprintf("确定从当前工作区移除 %d 个%s任务？\r\n源文件和输出文件不会被删除。", count, label), MB_YESNO|MB_ICONQUESTION) != IDYES {
		return
	}
	a.mu.Lock()
	a.tasks, count = cleanupTaskList(a.tasks, a.currentKind, mode)
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
	setText(a.hStatusText, fmt.Sprintf("已从当前工作区移除 %d 个%s任务；媒体文件未删除。", count, label))
}

func (a *application) removeSelected() {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	a.mu.Lock()
	remove := map[int]bool{}
	for _, i := range idxs {
		remove[i] = true
	}
	keep := make([]*model.Task, 0, len(a.tasks)-len(remove))
	for i, t := range a.tasks {
		if !remove[i] || t.Status == model.StatusProcessing {
			keep = append(keep, t)
		}
	}
	a.tasks = keep
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
}
func (a *application) clearCurrent() {
	a.mu.Lock()
	var keep []*model.Task
	for _, t := range a.tasks {
		if t.Kind != a.currentKind || t.Status == model.StatusProcessing {
			keep = append(keep, t)
		}
	}
	a.tasks = keep
	a.mu.Unlock()
	a.saveSession()
	a.refreshAll()
}
func (a *application) selectAll(v bool) {
	state := uint32(0)
	if v {
		state = LVIS_SELECTED
	}
	it := lvItem{State: state, StateMask: LVIS_SELECTED}
	send(a.hList, LVM_SETITEMSTATE, ^uintptr(0), uintptr(unsafe.Pointer(&it)))
}
func (a *application) invertSelection() {
	a.mu.Lock()
	n := len(a.visible)
	a.mu.Unlock()
	sel := map[int]bool{}
	for _, r := range a.selectedVisibleRows() {
		sel[r] = true
	}
	for i := 0; i < n; i++ {
		st := uint32(0)
		if !sel[i] {
			st = LVIS_SELECTED
		}
		it := lvItem{State: st, StateMask: LVIS_SELECTED}
		send(a.hList, LVM_SETITEMSTATE, uintptr(i), uintptr(unsafe.Pointer(&it)))
	}
}

func taskPathList(tasks []*model.Task, idxs []int, output bool) []string {
	seen := make(map[string]bool)
	paths := make([]string, 0, len(idxs))
	for _, idx := range idxs {
		if idx < 0 || idx >= len(tasks) || tasks[idx] == nil {
			continue
		}
		path := tasks[idx].Input
		if output {
			path = tasks[idx].OutputPath
		}
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		key := strings.ToLower(filepath.Clean(path))
		if seen[key] {
			continue
		}
		seen[key] = true
		paths = append(paths, path)
	}
	return paths
}

func (a *application) selectedPaths(output bool) []string {
	idxs := a.selectedTaskIndices()
	a.mu.Lock()
	defer a.mu.Unlock()
	return taskPathList(a.tasks, idxs, output)
}

func (a *application) copySelectedPaths(output bool) {
	paths := a.selectedPaths(output)
	if len(paths) == 0 {
		title := "复制源路径"
		text := "请先选择任务。"
		if output {
			title = "复制输出路径"
			text = "选中任务尚未生成输出文件。"
		}
		messageBox(a.hwnd, title, text, MB_OK|MB_ICONINFORMATION)
		return
	}
	if !setClipboardText(a.hwnd, strings.Join(paths, "\r\n")) {
		messageBox(a.hwnd, "复制路径", "无法写入剪贴板。", MB_OK|MB_ICONERROR)
		return
	}
	kind := "源文件"
	if output {
		kind = "输出文件"
	}
	setText(a.hStatusText, fmt.Sprintf("已复制 %d 个%s路径。", len(paths), kind))
}

func (a *application) openSelectedOutputFile() {
	paths := a.selectedPaths(true)
	if len(paths) == 0 {
		messageBox(a.hwnd, "打开输出文件", "选中任务尚未生成输出文件。", MB_OK|MB_ICONINFORMATION)
		return
	}
	path := paths[0]
	if st, err := os.Stat(path); err != nil || st.IsDir() {
		messageBox(a.hwnd, "打开输出文件", "输出文件不存在或尚未完成：\r\n"+path, MB_OK|MB_ICONWARNING)
		return
	}
	shellOpen(path)
}

func (a *application) openSelectedDir(output bool) {
	t, _ := a.selectedTask()
	path := ""
	if t != nil {
		if output && t.OutputPath != "" {
			path = filepath.Dir(t.OutputPath)
		} else if !output {
			path = filepath.Dir(t.Input)
		}
	}
	if path == "" && output {
		path = strings.TrimSpace(getText(a.hOutputEdit))
	}
	if path != "" {
		_ = os.MkdirAll(path, 0o755)
		shellOpen(path)
	}
}

func (a *application) estimateRunBytes(runIDs map[int64]bool) int64 {
	var total int64
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, t := range a.tasks {
		if t == nil || !runIDs[t.ID] {
			continue
		}
		total += media.EstimateOutputBytes(t, a.settings.EffectiveOptions(t))
	}
	return total
}

func (a *application) startQueue() { a.startQueueFiltered(nil) }

func (a *application) startQueueFiltered(only map[int64]bool) {
	a.v420StartQueueFiltered(only)
}

func (a *application) worker() {
	defer a.workers.Done()
	for {
		id, t, settings, ok := a.takeNext()
		if !ok {
			return
		}
		func() {
			defer func() {
				if r := recover(); r != nil {
					writeCrashContext(fmt.Sprintf("worker task %d", id), r)
					partial := ""
					a.mu.Lock()
					if current, _ := a.findTaskByIDLocked(id); current != nil {
						partial = current.OutputPath
					}
					a.mu.Unlock()
					if partial != "" {
						_ = os.Remove(partial)
					}
					a.failTask(id, "内部处理异常，任务已明确标记失败: "+fmt.Sprint(r))
				}
			}()
			a.convertOne(id, t, settings)
			for {
				next, nextSettings, restart := a.v420WaitReservedRestart(id)
				if !restart {
					break
				}
				a.convertOne(id, next, nextSettings)
			}
		}()
	}
}

func (a *application) takeNext() (int64, *model.Task, model.Settings, bool) {
	return a.v420TakeNext()
}

func (a *application) outputUnavailable(path string) bool {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	_, ok := a.reservedOutputs[normalizeOutputKey(path)]
	return ok
}

func (a *application) appendTaskHistory(t *model.Task, opts model.TaskOptions, result string) {
	if t == nil || !a.settings.SaveHistory {
		return
	}
	resolution := opts.Resolution
	codec := opts.Codec
	if t.Kind == model.KindImage {
		resolution = opts.ImageSize
		codec = opts.ImageFormat
	}
	dur := 0.0
	if !t.StartedAt.IsZero() {
		end := t.FinishedAt
		if end.IsZero() {
			end = time.Now()
		}
		dur = end.Sub(t.StartedAt).Seconds()
		if dur < 0 {
			dur = 0
		}
	}
	_ = media.AppendHistory(media.HistoryRecord{
		CompletedAt: time.Now(), Input: t.Input, Output: t.OutputPath,
		InputSize: t.InputSize, OutputSize: t.OutputSize,
		Resolution: resolution, Codec: codec, Quality: opts.Quality,
		Rotation: opts.Rotation, Engine: t.Engine, DurationSecs: dur, Result: result,
	})
}

func probeInfoFromTask(t *model.Task) (media.ProbeInfo, bool) {
	if t == nil || t.Width <= 0 || t.Height <= 0 || t.Duration <= 0 || strings.TrimSpace(t.VideoCodec) == "" {
		return media.ProbeInfo{}, false
	}
	return media.ProbeInfo{
		Width: t.Width, Height: t.Height, Rotation: t.Rotation, Duration: t.Duration,
		FPS: t.FPS, BitrateKbps: t.BitrateKbps, HasAudio: t.AudioStreams > 0,
		VideoCodec: t.VideoCodec, AudioCodec: t.AudioCodec, AudioStreams: t.AudioStreams,
		AudioBitrateKbps: t.AudioBitrateKbps, SubtitleStreams: t.SubtitleStreams, HDRInfo: t.HDRInfo,
	}, true
}

type progressThrottler struct {
	mu       sync.Mutex
	lastAt   time.Time
	lastStat time.Time
	last     float64
	stage    string
	size     int64
}

func (p *progressThrottler) accept(value float64, stage, output string, now time.Time) (bool, int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if value < 0 {
		value = 0
	}
	if value > 100 {
		value = 100
	}
	stageChanged := stage != "" && stage != p.stage
	emit := p.lastAt.IsZero() || stageChanged || value >= 100 || value-p.last >= .25 || now.Sub(p.lastAt) >= 125*time.Millisecond
	if (p.lastStat.IsZero() || now.Sub(p.lastStat) >= 500*time.Millisecond || value >= 100) && strings.TrimSpace(output) != "" {
		p.size = media.FileSize(output)
		p.lastStat = now
	}
	if !emit {
		return false, p.size
	}
	p.lastAt = now
	p.last = value
	if stage != "" {
		p.stage = stage
	}
	return true, p.size
}

func (a *application) convertOne(id int64, taskSnapshot *model.Task, settings model.Settings) {
	pinfo, reused := probeInfoFromTask(taskSnapshot)
	if settings.SubtitleMode == "保留文本字幕" && taskSnapshot.SubtitleStreams > 0 {
		reused = false // detailed subtitle indexes/codecs are required to skip bitmap tracks safely
	}
	currentSize := media.FileSize(taskSnapshot.Input)
	if !reused || currentSize <= 0 || (taskSnapshot.InputSize > 0 && currentSize != taskSnapshot.InputSize) {
		var err error
		pinfo, err = media.Probe(a.ffprobe, taskSnapshot.Input)
		if err != nil {
			a.failTask(id, "检测失败: "+err.Error())
			return
		}
	}
	a.mu.Lock()
	t, _ := a.findTaskByIDLocked(id)
	if t == nil {
		a.mu.Unlock()
		return
	}
	t.Width, t.Height, t.Rotation = pinfo.Width, pinfo.Height, pinfo.Rotation
	t.Duration, t.FPS, t.BitrateKbps = pinfo.Duration, pinfo.FPS, pinfo.BitrateKbps
	t.InputSize = media.FileSize(t.Input)
	opts := settings.EffectiveOptions(t)
	input, root, kind := t.Input, t.Root, t.Kind
	a.mu.Unlock()

	out := strings.TrimSpace(taskSnapshot.OutputPath)
	skip := false
	var err error
	if out == "" {
		outputRoot := settings.OutputDirFor(kind)
		if taskSnapshot.Queue != nil && taskSnapshot.Queue.OutputRoot != "" {
			outputRoot = taskSnapshot.Queue.OutputRoot
		}
		out, skip, err = media.ResolveAndReserveOutput(input, root, outputRoot, kind, opts, settings, a.outputUnavailable, func(path string) bool { return a.reserveOutput(path, id) })
	}
	if err != nil {
		a.failTask(id, "输出路径失败: "+err.Error())
		return
	}
	if skip {
		a.mu.Lock()
		t, _ = a.findTaskByIDLocked(id)
		if t != nil {
			t.Status = model.StatusSkipped
			t.OutputPath = out
			t.FinishedAt = time.Now()
			t.Engine = "跳过已有文件"
			t.Error = ""
		}
		a.mu.Unlock()
		a.appendTaskHistory(taskSnapshot, opts, "已跳过 · 输出文件已存在")
		a.postTaskRow(id)
		return
	}
	defer a.releaseOutput(out, id)
	a.mu.Lock()
	t, _ = a.findTaskByIDLocked(id)
	if t != nil {
		t.OutputPath = out
	}
	a.mu.Unlock()

	a.runMu.Lock()
	gpuDisabled := a.gpuDisabledForRun
	parentCtx := a.ctx
	a.runMu.Unlock()
	ctx, taskCancel := context.WithCancel(parentCtx)
	a.v420RegisterTaskCancel(id, taskCancel)
	defer func() { taskCancel(); a.v420UnregisterTaskCancel(id) }()
	if gpuDisabled {
		settings.UseGPU = false
	}
	if settings.SmartEngine && settings.UseGPU && !media.PreferGPU(settings.Benchmark, opts.Codec) && settings.Benchmark.TestedAt != "" {
		settings.UseGPU = false
	}
	ffmpeg, _, hardware, _, _ := a.componentSnapshot()
	req := media.ConvertRequest{Input: input, Output: out, Kind: kind, Probe: pinfo, Options: opts, Settings: settings, Hardware: hardware}
	throttler := &progressThrottler{}
	progressFn := func(v float64, stage string) {
		emit, partialSize := throttler.accept(v, stage, out, time.Now())
		if !emit {
			return
		}
		a.mu.Lock()
		current, _ := a.findTaskByIDLocked(id)
		if current != nil && (current.Status == model.StatusProcessing || current.Status == model.StatusPaused) {
			current.Progress = v
			if partialSize > 0 {
				current.OutputSize = partialSize
			}
			if stage != "" {
				current.Engine = stage
			}
		}
		a.mu.Unlock()
		a.postTaskRow(id)
	}
	engine, err := media.Convert(ctx, ffmpeg, req, progressFn)
	if err != nil && settings.UseGPU && settings.GPUFallback && hardware.Available && !(opts.VolumeMode == "目标体积" && settings.ExactTargetSize) && ctx.Err() == nil {
		a.runMu.Lock()
		a.gpuDisabledForRun = true
		a.runMu.Unlock()
		_ = os.Remove(out)
		req.Settings.UseGPU = false
		engine, err = media.Convert(ctx, ffmpeg, req, func(v float64, stage string) {
			progressFn(v, "GPU失败，CPU回退 · "+stage)
		})
	}
	if err != nil {
		_ = os.Remove(out)
		if a.v420CompleteInterruption(id) {
			return
		}
		if ctx != nil && ctx.Err() != nil {
			a.cancelTask(id, "任务已停止", opts)
		} else {
			a.failTaskWithOptions(id, err.Error(), opts)
		}
		return
	}
	if a.outputIntegrityHook != nil {
		a.outputIntegrityHook(out)
	}
	// This minimum integrity gate cannot be disabled. A successful FFmpeg exit
	// must never become a false 100% result when no usable output was created.
	if presenceErr := media.ValidateOutputPresence(out); presenceErr != nil {
		_ = os.Remove(out)
		a.failTaskWithOptions(id, "输出完整性失败: "+presenceErr.Error(), opts)
		return
	}
	verificationWarning := ""
	if settings.VerifyOutput {
		progressFn(99, "正在校验输出")
		_, ffprobe, _, _, _ := a.componentSnapshot()
		vr, verifyErr := media.VerifyOutput(ctx, ffmpeg, ffprobe, req)
		verificationWarning = vr.Warning
		if verifyErr != nil {
			_ = os.Remove(out)
			a.failTaskWithOptions(id, "输出校验失败: "+verifyErr.Error(), opts)
			return
		}
	}
	if settings.PreserveTimes {
		if err := media.PreserveTimes(input, out); err != nil {
			a.postUI(func() {
				setText(a.hStatusText, "输出已完成，但文件时间戳恢复失败："+short(err.Error(), 180))
			})
		}
		outputRoot := settings.OutputDirFor(kind)
		if taskSnapshot.Queue != nil && strings.TrimSpace(taskSnapshot.Queue.OutputRoot) != "" {
			outputRoot = taskSnapshot.Queue.OutputRoot
		}
		if err := media.PreserveOutputTreeTimes(input, root, outputRoot); err != nil {
			a.postUI(func() {
				setText(a.hStatusText, "输出已完成，但目录时间戳恢复失败："+short(err.Error(), 180))
			})
		}
	}
	a.mu.Lock()
	t, _ = a.findTaskByIDLocked(id)
	if t != nil {
		t.Status = model.StatusDone
		t.Progress = 100
		t.OutputSize = media.FileSize(out)
		t.Engine = engine
		t.FinishedAt = time.Now()
		t.Error = ""
		t.FailureCategory = ""
		t.ValidationWarning = verificationWarning
	}
	a.mu.Unlock()
	if t != nil {
		result := "转换完成 · " + engine
		if settings.PreserveTimes {
			result += " · 日期保留"
		}
		if verificationWarning != "" {
			result += " · 校验警告: " + verificationWarning
		} else if settings.VerifyOutput {
			result += " · 输出校验通过"
		}
		a.appendTaskHistory(t, opts, result)
	}
	a.postTaskRow(id)
	a.saveSession()
}

func (a *application) failTask(id int64, msg string) {
	a.mu.Lock()
	t, _ := a.findTaskByIDLocked(id)
	var opts model.TaskOptions
	if t != nil {
		opts = a.settings.EffectiveOptions(t)
	}
	a.mu.Unlock()
	a.failTaskWithOptions(id, msg, opts)
}

func (a *application) failTaskWithOptions(id int64, msg string, opts model.TaskOptions) {
	a.mu.Lock()
	t, _ := a.findTaskByIDLocked(id)
	if t != nil {
		t.Status = model.StatusFailed
		if t.Progress >= 100 {
			t.Progress = 99
		}
		t.Error = short(msg, 900)
		t.FailureCategory = media.ClassifyFailure(fmt.Errorf("%s", msg))
		t.ValidationWarning = ""
		t.OutputPath = ""
		t.OutputSize = 0
		t.FinishedAt = time.Now()
		t.Engine = "失败 · " + t.FailureCategory
	}
	a.mu.Unlock()
	if t != nil {
		a.appendTaskHistory(t, opts, "转换失败 · "+short(msg, 300))
	}
	a.postTaskRow(id)
	a.saveSession()
}

func (a *application) cancelTask(id int64, msg string, opts model.TaskOptions) {
	a.mu.Lock()
	t, _ := a.findTaskByIDLocked(id)
	alreadyRecorded := false
	if t != nil {
		alreadyRecorded = t.Status == model.StatusCancelled && !t.FinishedAt.IsZero()
		t.Status = model.StatusCancelled
		if t.Progress >= 100 {
			t.Progress = 99
		}
		t.Error = msg
		t.OutputPath = ""
		t.OutputSize = 0
		t.FinishedAt = time.Now()
		t.Engine = "已停止"
	}
	a.mu.Unlock()
	if t != nil && !alreadyRecorded {
		a.appendTaskHistory(t, opts, "已停止")
	}
	a.postTaskRow(id)
	a.saveSession()
}

func (a *application) togglePause() {
	a.v420TogglePause()
}

func (a *application) stopQueue() {
	a.v420StopQueue()
}

func (a *application) finishRun() {
	a.runMu.Lock()
	runKind := a.runKind
	runIDs := a.runTaskIDs
	a.running = false
	a.paused = false
	a.timeEnd = time.Now()
	a.cancel = nil
	a.controller = nil
	a.gpuDisabledForRun = false
	a.runOnly = nil
	a.runTaskIDs = nil
	a.reservedOutputs = make(map[string]int64)
	a.v420ResetRunMaps()
	runStarted := a.runStart
	runEnded := a.timeEnd
	a.runMu.Unlock()
	procKillTimer.Call(a.hwnd, TIMER_MAIN_CLOCK)
	enable(a.hStart, true)
	enable(a.hPause, false)
	enable(a.hStop, false)
	setText(a.hPause, "暂停")

	a.mu.Lock()
	reconciled := media.ReconcileRunTasks(a.tasks, runIDs, time.Now())
	done, failed, skipped, cancelled := 0, 0, 0, 0
	var totalIn, totalOut int64
	var summaryTasks []model.Task
	for _, t := range a.tasks {
		if t.Kind != runKind || (runIDs != nil && !runIDs[t.ID]) {
			continue
		}
		summaryTasks = append(summaryTasks, *t)
		switch t.Status {
		case model.StatusDone:
			done++
			totalIn += t.InputSize
			totalOut += t.OutputSize
		case model.StatusFailed:
			failed++
		case model.StatusSkipped:
			skipped++
		case model.StatusCancelled:
			cancelled++
		}
	}
	a.mu.Unlock()
	if len(reconciled) > 0 {
		writeCrashContext("queue integrity reconciliation", fmt.Errorf("%d tasks lacked terminal results: %v", len(reconciled), reconciled))
	}
	if err := media.ValidateRunAccounting(len(summaryTasks), done, failed, skipped, cancelled); err != nil {
		writeCrashContext("queue result accounting", err)
	}
	// Refresh only after reconciliation so the list and summary expose the same
	// explicit terminal state for every task in the finished run.
	a.refreshAll()
	duration := runEnded.Sub(runStarted)
	if duration < 0 {
		duration = 0
	}
	text := fmt.Sprintf("队列处理结束。完成 %d，跳过 %d，失败 %d，停止 %d，总用时 %s。", done, skipped, failed, cancelled, formatDuration(duration))
	setText(a.hStatusText, text)
	a.lastSummaryPath = a.writeRunSummary(summaryTasks, duration, totalIn, totalOut, done, failed, skipped, cancelled)
	a.saveSession()
	if a.settings.NotifyOnDone {
		ratioText := "总压缩比例：—"
		if totalIn > 0 {
			ratio := float64(totalOut) / float64(totalIn) * 100
			saving := 100 - ratio
			change := fmt.Sprintf("节省 %.1f%%", saving)
			if saving < 0 {
				change = fmt.Sprintf("体积增加 %.1f%%", -saving)
			}
			ratioText = fmt.Sprintf("总压缩比例 %.1f%%（%s，%s → %s）", ratio, change, media.FormatBytes(totalIn), media.FormatBytes(totalOut))
		}
		body := fmt.Sprintf("完成 %d 个，用时 %s\r\n%s", done, formatDuration(duration), ratioText)
		if failed > 0 || skipped > 0 || cancelled > 0 {
			body += fmt.Sprintf("\r\n失败 %d · 跳过 %d · 停止 %d", failed, skipped, cancelled)
		}
		title := "本次转换已完成"
		if failed > 0 || cancelled > 0 {
			title = "本次队列处理结束"
		}
		a.showCompletionToast(title, body)
	}
	if outputDir := a.settings.OutputDirFor(runKind); a.settings.OpenOutputOnDone && outputDir != "" {
		shellOpen(outputDir)
	}
}

func (a *application) refreshTotal() {
	a.runMu.Lock()
	running := a.running
	paused := a.paused
	start := a.runStart
	kind := a.currentKind
	runIDs := copyTaskIDSet(a.runTaskIDs)
	if running {
		kind = a.runKind
	}
	a.runMu.Unlock()

	a.mu.Lock()
	total, completed, failed, active := 0, 0, 0, 0
	sum := 0.0
	processedSeconds := 0.0
	processedImages := 0.0
	var totalInput, totalOutput int64
	engineLabel := ""
	for _, t := range a.tasks {
		if t.Kind != kind || (running && runIDs != nil && !runIDs[t.ID]) {
			continue
		}
		total++
		sum += t.Progress
		totalInput += t.InputSize
		if t.Status == model.StatusDone {
			totalOutput += t.OutputSize
		}
		if kind == model.KindVideo && t.Duration > 0 {
			processedSeconds += t.Duration * t.Progress / 100
		}
		if kind == model.KindImage {
			processedImages += t.Progress / 100
		}
		switch t.Status {
		case model.StatusDone, model.StatusSkipped:
			completed++
		case model.StatusFailed:
			failed++
		case model.StatusProcessing, model.StatusPaused:
			active++
			low := strings.ToLower(t.Engine)
			if strings.Contains(low, "copy") || strings.Contains(t.Engine, "复制") {
				engineLabel = "直接复制"
			} else if strings.Contains(low, "nvenc") || strings.Contains(low, "qsv") || strings.Contains(low, "amf") || strings.Contains(t.Engine, "GPU") {
				engineLabel = "GPU"
			} else if engineLabel == "" {
				engineLabel = "CPU"
			}
		}
	}
	a.mu.Unlock()
	pct := 0.0
	if total > 0 {
		pct = sum / float64(total)
	}
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	progressText := fmt.Sprintf("已完成 %d/%d · 总进度 %.1f%%", completed, total, pct)
	var elapsed, remaining time.Duration
	speedLabel := "—"
	if running {
		elapsed = time.Since(start)
		progressText += " · 已用 " + formatDuration(elapsed)
		if pct > 0.2 && pct < 100 {
			totalEstimate := time.Duration(float64(elapsed) * 100 / pct)
			remaining = totalEstimate - elapsed
			if remaining > 0 {
				progressText += " · 剩余 " + formatDuration(remaining)
			}
		}
		if elapsed.Seconds() > 0 {
			if kind == model.KindVideo {
				speedLabel = fmt.Sprintf("%.2fx", processedSeconds/elapsed.Seconds())
			} else {
				speedLabel = fmt.Sprintf("%.0f 张/分", processedImages/elapsed.Minutes())
			}
		}
		if a.settings.ShowPerformanceStats {
			progressText += " · 速度 " + speedLabel
			if totalInput > 0 {
				progressText += " · " + media.FormatBytes(totalInput) + " → " + media.FormatBytes(totalOutput)
			}
		}
		if paused {
			progressText += " · 已暂停"
		}
	}
	if failed > 0 {
		progressText += fmt.Sprintf(" · 失败 %d", failed)
	}
	a.overallProgress = pct
	a.overallText = progressText
	a.overallPaused = paused
	procInvalidateRect.Call(a.hProgress, 0, 1)
	a.updateFloatingBar(pct, floatingProgressText(pct, completed, total, elapsed, remaining, speedLabel, active, engineLabel, paused), running)
}

func prepareTaskForRetry(t *model.Task) bool {
	if t == nil || t.IsLocked() {
		return false
	}
	t.Status = model.StatusReady
	t.Progress = 0
	t.Error = ""
	t.FailureCategory = ""
	t.ValidationWarning = ""
	t.OutputPath = ""
	t.OutputSize = 0
	t.StartedAt = time.Time{}
	t.FinishedAt = time.Time{}
	return true
}

func recoverableTaskStatus(status model.Status) bool {
	return status == model.StatusFailed || status == model.StatusSkipped || status == model.StatusCancelled
}

func (a *application) retrySelected() {
	idxs := a.selectedTaskIndices()
	changed := 0
	a.mu.Lock()
	for _, i := range idxs {
		if i >= 0 && i < len(a.tasks) && prepareTaskForRetry(a.tasks[i]) {
			changed++
		}
	}
	a.mu.Unlock()
	if changed == 0 {
		setText(a.hStatusText, "没有可重新准备的选中任务；运行中和暂停中的任务不会被修改。")
		return
	}
	a.saveSession()
	a.refreshAll()
	setText(a.hStatusText, fmt.Sprintf("已将 %d 个选中任务重新设为准备中。", changed))
}

func (a *application) retryRecoverableWorkspace() {
	changed := 0
	a.mu.Lock()
	for _, t := range a.tasks {
		if t.Kind == a.currentKind && recoverableTaskStatus(t.Status) && prepareTaskForRetry(t) {
			changed++
		}
	}
	a.mu.Unlock()
	if changed == 0 {
		setText(a.hStatusText, "当前工作区没有失败、已跳过或已停止的任务。")
		return
	}
	a.saveSession()
	a.refreshAll()
	setText(a.hStatusText, fmt.Sprintf("已重新准备当前工作区的 %d 个失败 / 停止任务。", changed))
}
func (a *application) returnReady() { a.retrySelected() }
func (a *application) singleOutput() {
	idxs := a.selectedTaskIndices()
	if len(idxs) == 0 {
		return
	}
	only := map[int64]bool{}
	a.mu.Lock()
	for _, i := range idxs {
		if i >= 0 && i < len(a.tasks) {
			only[a.tasks[i].ID] = true
		}
	}
	a.mu.Unlock()
	a.startQueueFiltered(only)
}

func (a *application) playSelected(output bool) {
	t, _ := a.selectedTask()
	if t == nil {
		return
	}
	path := t.Input
	if output {
		path = t.OutputPath
		if path == "" || media.FileSize(path) == 0 {
			messageBox(a.hwnd, "播放输出", "该任务尚无可播放的输出文件。", MB_OK|MB_ICONINFORMATION)
			return
		}
	}
	a.launchPlayer(path, true)
}
func (a *application) launchPlayer(path string, newWindow bool) {
	_, _, _, player, playerOK := a.componentSnapshot()
	if playerOK && player != "" {
		args := []string{}
		if newWindow {
			args = append(args, "/new")
		}
		args = append(args, path)
		cmd := exec.Command(player, args...)
		_ = cmd.Start()
	} else {
		shellOpen(path)
	}
}
func (a *application) dualCompare() {
	t, _ := a.selectedTask()
	if t == nil || t.OutputPath == "" {
		messageBox(a.hwnd, "双窗口对比", "请先选择已完成任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	a.launchPlayer(t.Input, true)
	time.Sleep(200 * time.Millisecond)
	a.launchPlayer(t.OutputPath, true)
}
func (a *application) rotationPreview() {
	t, _ := a.selectedTask()
	if t == nil || a.ffmpeg == "" {
		return
	}
	opts := a.settings.EffectiveOptions(t)
	dir, _ := config.TempDir()
	out := filepath.Join(dir, fmt.Sprintf("rotation_preview_%d.jpg", time.Now().UnixNano()))
	setText(a.hStatusText, "正在生成方向预览...")
	go func() {
		at := t.Duration * 0.2
		if at < 0 {
			at = 0
		}
		err := media.GenerateFrame(context.Background(), a.ffmpeg, t.Input, out, at, opts.Rotation)
		if err != nil {
			messageBox(a.hwnd, "方向预览", err.Error(), MB_OK|MB_ICONERROR)
			return
		}
		shellOpen(out)
		setText(a.hStatusText, "方向预览已生成，正在打开图片。")
	}()
}
func (a *application) compareImage() {
	t, _ := a.selectedTask()
	if t == nil || t.OutputPath == "" {
		messageBox(a.hwnd, "画面对比", "请选择已完成任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	dir, _ := config.TempDir()
	out := filepath.Join(dir, fmt.Sprintf("compare_%d.jpg", time.Now().UnixNano()))
	go func() {
		err := media.GenerateFivePointComparisonImage(context.Background(), a.ffmpeg, t.Input, t.OutputPath, out, t.Duration)
		if err != nil {
			messageBox(a.hwnd, "画面对比", err.Error(), MB_OK|MB_ICONERROR)
			return
		}
		shellOpen(out)
	}()
}
func (a *application) compareVideo() {
	t, _ := a.selectedTask()
	if t == nil || t.OutputPath == "" {
		messageBox(a.hwnd, "同步对比视频", "请选择已完成任务。", MB_OK|MB_ICONINFORMATION)
		return
	}
	dir, _ := config.TempDir()
	out := filepath.Join(dir, fmt.Sprintf("compare30_%d.mp4", time.Now().UnixNano()))
	setText(a.hStatusText, "正在生成 30 秒同步对比视频...")
	go func() {
		err := media.GenerateComparisonVideo(context.Background(), a.ffmpeg, t.Input, t.OutputPath, out, 30, func(v float64, stage string) { setText(a.hStatusText, fmt.Sprintf("%s %.1f%%", stage, v)) })
		if err != nil {
			messageBox(a.hwnd, "同步对比视频", err.Error(), MB_OK|MB_ICONERROR)
			return
		}
		a.launchPlayer(out, true)
		setText(a.hStatusText, "同步对比视频已生成。")
	}()
}
func (a *application) editTrimCrop() {
	t, idx := a.selectedTask()
	if t == nil {
		return
	}
	opts := a.settings.EffectiveOptions(t)
	updated, ok := showTrimCropDialog(a, t, opts)
	if ok {
		a.mu.Lock()
		if idx < len(a.tasks) {
			updated.FollowDefaults = false
			a.tasks[idx].Options = updated
		}
		a.mu.Unlock()
		a.refreshAll()
	}
}
func (a *application) showFFmpegCommand() {
	t, _ := a.selectedTask()
	if t == nil {
		return
	}
	opts := a.settings.EffectiveOptions(t)
	out := t.OutputPath
	if out == "" {
		ext := media.OutputExtension(t.Kind, opts)
		out = filepath.Join(a.settings.OutputDir, strings.TrimSuffix(filepath.Base(t.Input), filepath.Ext(t.Input))+"_converted"+ext)
	}
	pinfo := media.ProbeInfo{Width: t.Width, Height: t.Height, Rotation: t.Rotation, Duration: t.Duration, FPS: t.FPS, BitrateKbps: t.BitrateKbps, VideoCodec: t.VideoCodec, AudioCodec: t.AudioCodec, AudioStreams: t.AudioStreams, AudioBitrateKbps: t.AudioBitrateKbps, SubtitleStreams: t.SubtitleStreams, HDRInfo: t.HDRInfo, HasAudio: t.AudioStreams > 0}
	ffmpeg, ffprobe, hardware, _, _ := a.componentSnapshot()
	if ffprobe != "" {
		if p, err := media.Probe(ffprobe, t.Input); err == nil {
			pinfo = p
		}
	}
	req := media.ConvertRequest{Input: t.Input, Output: out, Kind: t.Kind, Probe: pinfo, Options: opts, Settings: a.settings, Hardware: hardware}
	commands := media.ExplainConvertCommands(ffmpeg, req)
	text := strings.Join(commands, "\r\n\r\n")
	copied := setClipboardText(a.hwnd, text)
	prefix := "以下为该任务当前会执行的命令："
	if copied {
		prefix += "\r\n（已复制到剪贴板）"
	}
	messageBox(a.hwnd, "FFmpeg 命令", prefix+"\r\n\r\n"+text, MB_OK|MB_ICONINFORMATION)
}

func (a *application) detectComponents() {
	ffmpeg, _, oldHardware, oldPlayer, oldPlayerOK := a.componentSnapshot()
	hardware := oldHardware
	if ffmpeg != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		hardware = media.DetectHardwareQuick(ctx, ffmpeg)
		cancel()
	} else {
		hardware = media.Hardware{Detail: "未找到 FFmpeg"}
	}
	player, playerOK := oldPlayer, oldPlayerOK
	if a.settings.AutoDetectPlayer {
		player, playerOK, _ = media.DetectPotPlayer(a.settings.PlayerPath)
	}
	a.componentMu.Lock()
	a.hardware, a.player, a.playerOK = hardware, player, playerOK
	a.componentMu.Unlock()
	procPostMessageW.Call(a.hwnd, WM_APP_STATUS, 0, 0)
	// Startup must never run real encoder benchmarks. The explicit FFmpeg/GPU
	// menu action remains available for users who want a full hardware test.
}
func (a *application) concurrencyChipText() string {
	if a.settings.AutoConcurrency {
		return fmt.Sprintf("自动 ≤%d", config.MaxConcurrency())
	}
	return fmt.Sprintf("并发 %d", config.NormalizeConcurrency(a.settings.Concurrency))
}

func (a *application) currentConcurrencyCandidates(kind model.Kind) map[int64]bool {
	ids := make(map[int64]bool)
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, task := range a.tasks {
		if task == nil || task.Kind != kind {
			continue
		}
		switch task.Status {
		case model.StatusReady, model.StatusFailed, model.StatusCancelled:
			ids[task.ID] = true
		}
	}
	return ids
}

func (a *application) showConcurrencyMenu() {
	if a == nil || a.menuConcurrency == 0 || a.hConcurrencyStatus == 0 {
		return
	}
	a.syncMenuChecks()
	var rc rect
	if ok, _, _ := procGetWindowRect.Call(a.hConcurrencyStatus, uintptr(unsafe.Pointer(&rc))); ok == 0 {
		return
	}
	cmd, _, _ := procTrackPopupMenu.Call(a.menuConcurrency, TPM_RIGHTBUTTON|TPM_RETURNCMD|TPM_NONOTIFY, uintptr(rc.Left), uintptr(rc.Bottom+2), 0, a.hwnd, 0)
	if cmd != 0 {
		a.command(int(cmd))
	}
}
func (a *application) showConcurrencyStatus() {
	ids := a.currentConcurrencyCandidates(a.currentKind)
	suggested := a.recommendedWorkers(a.currentKind, ids)
	mode := fmt.Sprintf("手动 %d", config.NormalizeConcurrency(a.settings.Concurrency))
	if a.settings.AutoConcurrency {
		mode = "自动智能"
	}
	messageBox(a.hwnd, "并行任务", fmt.Sprintf("逻辑处理器：%d\r\n安全上限：%d\r\n当前模式：%s\r\n当前工作区建议：%d\r\n待处理任务：%d\r\n\r\n并发上限只限制同时运行的任务数量。自动模式还会根据 4K、长视频、平均文件体积和 GPU 状态主动降低实际并发。", config.LogicalProcessorCount(), config.MaxConcurrency(), mode, suggested, len(ids)), MB_OK|MB_ICONINFORMATION)
}

func (a *application) updateComponentStatus() {
	ffmpeg, _, hardware, _, playerOK := a.componentSnapshot()
	if ffmpeg != "" {
		setText(a.hFFStatus, "● FFmpeg")
	} else {
		setText(a.hFFStatus, "○ FFmpeg")
	}
	if hardware.Available {
		setText(a.hGPUStatus, "● GPU")
	} else {
		setText(a.hGPUStatus, "○ GPU")
	}
	if playerOK {
		setText(a.hPotStatus, "● PotPlayer")
	} else {
		setText(a.hPotStatus, "○ PotPlayer")
	}
	setText(a.hConcurrencyStatus, a.concurrencyChipText())
	if a.hConcurrencyStatus != 0 {
		procInvalidateRect.Call(a.hConcurrencyStatus, 0, 1)
	}
}
func (a *application) showFFmpegStatus() {
	ffmpeg, ffprobe, hardware, _, _ := a.componentSnapshot()
	state := "未找到"
	if ffmpeg != "" {
		state = "正常"
	}
	runtimeDir, _ := config.RuntimeDir()
	roamingDir, _ := config.Dir()
	localDir, _ := config.LocalDir()
	messageBox(a.hwnd, "FFmpeg 组件", fmt.Sprintf("FFmpeg 组件状态：%s\r\n\r\nRuntime：\r\n%s\r\n\r\nFFmpeg：\r\n%s\r\n\r\nFFprobe：\r\n%s\r\n\r\nRoaming Data：\r\n%s\r\n\r\nLocal Data：\r\n%s\r\n\r\nGPU：%s", state, runtimeDir, ffmpeg, ffprobe, roamingDir, localDir, hardware.Detail), MB_OK|MB_ICONINFORMATION)
}
func (a *application) showGPUStatus() {
	_, _, hardware, _, _ := a.componentSnapshot()
	p := a.settings.Benchmark
	bench := "尚未测速"
	if p.TestedAt != "" {
		bench = fmt.Sprintf("CPU H.264 %.2fx · H.265 %.2fx", p.CPUH264X, p.CPUH265X)
		if p.GPUH264X > 0 || p.GPUH265X > 0 {
			bench += fmt.Sprintf("\r\n%s H.264 %.2fx · H.265 %.2fx", valueOr(p.GPUVendor, "GPU"), p.GPUH264X, p.GPUH265X)
		}
	}
	messageBox(a.hwnd, "GPU 与编码效率", fmt.Sprintf("%s\r\n\r\n速度测试：\r\n%s\r\n\r\n当前策略：%s\r\n智能引擎选择：%s\r\n目标体积精确模式：%s\r\nGPU 失败自动回退 CPU：%s", hardware.Detail, bench, func() string {
		if a.settings.UseGPU {
			return "允许使用 GPU"
		}
		return "仅使用 CPU"
	}(), func() string {
		if a.settings.SmartEngine {
			return "按实测速度自动选择"
		}
		return "始终按手动 GPU 开关"
	}(), func() string {
		if a.settings.ExactTargetSize {
			return "CPU 两遍闭环校准"
		}
		return "单遍编码"
	}(), func() string {
		if a.settings.GPUFallback {
			return "开启"
		}
		return "关闭"
	}()), MB_OK|MB_ICONINFORMATION)
}

func (a *application) showPlayerStatus() {
	_, _, _, player, playerOK := a.componentSnapshot()
	mode := "Windows 默认播放器"
	if playerOK {
		mode = "PotPlayer"
	}
	messageBox(a.hwnd, "PotPlayer 状态", fmt.Sprintf("播放器状态：%s\r\n\r\nPotPlayer：\r\n%s\r\n\r\n检测方式：%s\r\n\r\n当前播放方式：%s", func() string {
		if playerOK {
			return "PotPlayer 已就绪"
		}
		return "未找到 PotPlayer"
	}(), player, func() string {
		if a.settings.AutoDetectPlayer {
			return "自动检测 / 已保存路径"
		}
		return "手动指定"
	}(), mode), MB_OK|MB_ICONINFORMATION)
}

func (a *application) applyPreset(id int) {
	switch id {
	case ID_PRESET_1080:
		a.settings.Resolution = "1080P"
		a.settings.Codec = "H.265"
		a.settings.Quality = "高"
		a.settings.VolumeMode = "质量优先"
		a.settings.Rotation = "自动"
	case ID_PRESET_720:
		a.settings.Resolution = "720P"
		a.settings.Codec = "H.265"
		a.settings.Quality = "低"
		a.settings.VolumeMode = "质量优先"
		a.settings.Rotation = "自动"
	case ID_PRESET_ORIGINAL:
		a.settings.Resolution = "原尺寸"
		a.settings.Codec = "H.265"
		a.settings.Quality = "高"
		a.settings.VolumeMode = "质量优先"
		a.settings.Rotation = "自动"
	case ID_PRESET_4K:
		a.settings.Resolution = "4K"
		a.settings.Codec = "H.265"
		a.settings.Quality = "高"
		a.settings.VolumeMode = "质量优先"
		a.settings.Rotation = "自动"
	}
	a.writeSettingsToUI()
	a.saveSettings()
}
func currentPreset(s model.Settings) *model.Preset {
	return &model.Preset{Resolution: s.Resolution, Codec: s.Codec, Quality: s.Quality, VolumeMode: s.VolumeMode, TargetSizeMB: s.TargetSizeMB, BitrateMbps: s.BitrateMbps, Rotation: s.Rotation}
}
func (a *application) saveCustomPreset(id int) {
	a.readSettingsFromUI()
	pr := currentPreset(a.settings)
	switch id {
	case ID_PRESET_SAVE1:
		a.settings.QuickCustom1 = pr
	case ID_PRESET_SAVE2:
		a.settings.QuickCustom2 = pr
	case ID_PRESET_SAVE3:
		a.settings.QuickCustom3 = pr
	}
	a.saveSettings()
}
func (a *application) applyCustomPreset(id int) {
	var pr *model.Preset
	switch id {
	case ID_PRESET_CUSTOM1:
		pr = a.settings.QuickCustom1
	case ID_PRESET_CUSTOM2:
		pr = a.settings.QuickCustom2
	case ID_PRESET_CUSTOM3:
		pr = a.settings.QuickCustom3
	}
	if pr == nil {
		messageBox(a.hwnd, "自定义方案", "该方案尚未保存。", MB_OK|MB_ICONINFORMATION)
		return
	}
	a.settings.Resolution = pr.Resolution
	a.settings.Codec = pr.Codec
	a.settings.Quality = pr.Quality
	a.settings.VolumeMode = pr.VolumeMode
	a.settings.TargetSizeMB = pr.TargetSizeMB
	a.settings.BitrateMbps = pr.BitrateMbps
	a.settings.Rotation = pr.Rotation
	a.writeSettingsToUI()
	a.saveSettings()
}

type presetBundle struct {
	Version string        `json:"version"`
	SavedAt time.Time     `json:"saved_at"`
	Custom1 *model.Preset `json:"custom_1,omitempty"`
	Custom2 *model.Preset `json:"custom_2,omitempty"`
	Custom3 *model.Preset `json:"custom_3,omitempty"`
}

func (a *application) exportPresets() {
	dir, err := config.Dir()
	if err != nil {
		messageBox(a.hwnd, "导出方案", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	path := filepath.Join(dir, "Mediova_presets.json")
	bundle := presetBundle{Version: appVersion, SavedAt: time.Now(), Custom1: a.settings.QuickCustom1, Custom2: a.settings.QuickCustom2, Custom3: a.settings.QuickCustom3}
	if err := config.SaveJSON(path, bundle); err != nil {
		messageBox(a.hwnd, "导出方案", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	setClipboardText(a.hwnd, path)
	shellOpen(filepath.Dir(path))
	messageBox(a.hwnd, "导出方案", "自定义方案已导出，文件路径已复制到剪贴板。\r\n\r\n"+path, MB_OK|MB_ICONINFORMATION)
}

func (a *application) importPresets() {
	path := chooseSingleFile(a.hwnd, "导入Mediova自定义方案", "JSON 方案文件\x00*.json\x00所有文件\x00*.*\x00\x00")
	if path == "" {
		return
	}
	var bundle presetBundle
	if err := config.LoadJSON(path, &bundle); err != nil {
		messageBox(a.hwnd, "导入方案", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	if bundle.Custom1 == nil && bundle.Custom2 == nil && bundle.Custom3 == nil {
		messageBox(a.hwnd, "导入方案", "文件中没有可用的自定义方案。", MB_OK|MB_ICONWARNING)
		return
	}
	a.settings.QuickCustom1 = bundle.Custom1
	a.settings.QuickCustom2 = bundle.Custom2
	a.settings.QuickCustom3 = bundle.Custom3
	a.saveSettings()
	messageBox(a.hwnd, "导入方案", "自定义方案已导入。", MB_OK|MB_ICONINFORMATION)
}

func (a *application) viewHistory() {
	path, err := media.WriteHistoryHTML()
	if err != nil {
		messageBox(a.hwnd, "历史记录", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	shellOpen(path)
}
func (a *application) saveSession() {
	if !a.settings.RestoreSession {
		return
	}
	path, err := config.SessionPath()
	if err != nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	items := make([]*model.Task, 0, len(a.tasks))
	for _, t := range a.tasks {
		cp := *t
		if cp.Status == model.StatusProcessing || cp.Status == model.StatusQueued || cp.Status == model.StatusPaused || cp.Status == model.StatusHeld {
			cp.Status = model.StatusReady
			cp.Progress = 0
		}
		items = append(items, &cp)
	}
	_ = config.SaveJSON(path, items)
}
func (a *application) loadSession() {
	if !a.settings.RestoreSession {
		return
	}
	path, err := config.SessionPath()
	if err != nil {
		return
	}
	var items []*model.Task
	if config.LoadJSON(path, &items) != nil {
		return
	}
	var loadedIDs []int64
	a.mu.Lock()
	for _, t := range items {
		missing := false
		if _, err := os.Stat(t.Input); err != nil {
			missing = true
			t.Status = model.StatusFailed
			t.Error = "源文件不存在或已移动: " + t.Input
			t.FailureCategory = "源文件缺失"
			t.Progress = 0
		}
		if !missing && (t.Status == model.StatusProcessing || t.Status == model.StatusQueued || t.Status == model.StatusPaused || t.Status == model.StatusHeld || t.Status == model.StatusCancelled) {
			t.Status = model.StatusReady
			t.Progress = 0
		}
		t.ThumbnailIndex = -1
		if t.ID == 0 {
			t.ID = a.nextID.Add(1)
		}
		a.tasks = append(a.tasks, t)
		if !missing {
			loadedIDs = append(loadedIDs, t.ID)
		}
	}
	a.mu.Unlock()
	if a.ffprobe != "" {
		for _, id := range loadedIDs {
			a.queueProbe(id)
		}
	}
}

func (a *application) addTray() {
	if a.hIcon == 0 || a.trayAdded {
		return
	}
	nid := notifyIconData{CbSize: uint32(unsafe.Sizeof(notifyIconData{})), HWnd: a.hwnd, UID: 1, UFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP, UCallbackMessage: WM_APP_TRAY, HIcon: a.hIcon}
	copy(nid.SzTip[:], syscall.StringToUTF16("Mediova v"+appVersion+" · 托盘常驻"))
	if r, _, _ := procShellNotifyIconW.Call(NIM_ADD, uintptr(unsafe.Pointer(&nid))); r != 0 {
		a.trayAdded = true
		procKillTimer.Call(a.hwnd, TIMER_TRAY_RETRY)
		nid.UVersion = NOTIFYICON_VERSION_4
		procShellNotifyIconW.Call(NIM_SETVERSION, uintptr(unsafe.Pointer(&nid)))
		return
	}
	// Explorer may still be starting. Retry periodically; without a tray icon
	// the close button intentionally refuses to hide the only visible window.
	procSetTimer.Call(a.hwnd, TIMER_TRAY_RETRY, 5000, 0)
}
func (a *application) removeTray() {
	if !a.trayAdded {
		return
	}
	nid := notifyIconData{CbSize: uint32(unsafe.Sizeof(notifyIconData{})), HWnd: a.hwnd, UID: 1}
	procShellNotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&nid)))
	a.trayAdded = false
}
func (a *application) notifyBalloon(title, text string) {
	if a.hIcon == 0 || !a.trayAdded {
		return
	}
	nid := notifyIconData{CbSize: uint32(unsafe.Sizeof(notifyIconData{})), HWnd: a.hwnd, UID: 1, UFlags: NIF_INFO, DwInfoFlags: NIIF_INFO}
	copy(nid.SzInfoTitle[:], syscall.StringToUTF16(title))
	copy(nid.SzInfo[:], syscall.StringToUTF16(text))
	procShellNotifyIconW.Call(NIM_MODIFY, uintptr(unsafe.Pointer(&nid)))
}
func (a *application) restoreMainWindow() {
	show(a.hwnd, true)
	procShowWindow.Call(a.hwnd, SW_RESTORE)
	procSetForegroundWindow.Call(a.hwnd)
}
func (a *application) trayEvent(lParam uintptr) {
	msg := uint32(lParam)
	// Depending on NOTIFYICON version, Windows can send either the mouse
	// message directly or pack it in the low word.
	if lo := uint32(loWord(lParam)); lo != 0 {
		msg = lo
	}
	switch msg {
	case 0x0202, 0x0203: // left button up / double click
		a.restoreMainWindow()
	case 0x0205: // right button up
		m, _, _ := procCreatePopupMenu.Call()
		appendMenu(m, MF_STRING, ID_TRAY_OPEN, "打开Mediova")
		flags := uintptr(MF_STRING)
		if a.settings.ShowFloatingBar {
			flags |= MF_CHECKED
		}
		appendMenu(m, flags, ID_TRAY_FLOATING, "转换时显示悬浮进度条")
		appendMenu(m, MF_SEPARATOR, 0, "")
		appendMenu(m, MF_STRING, ID_TRAY_EXIT, "退出Mediova")
		var pt point
		procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
		procSetForegroundWindow.Call(a.hwnd)
		cmd, _, _ := procTrackPopupMenu.Call(m, TPM_RIGHTBUTTON|TPM_RETURNCMD|TPM_NONOTIFY, uintptr(pt.X), uintptr(pt.Y), 0, a.hwnd, 0)
		switch int(cmd) {
		case ID_TRAY_OPEN:
			a.restoreMainWindow()
		case ID_TRAY_FLOATING:
			a.settings.ShowFloatingBar = !a.settings.ShowFloatingBar
			_ = config.Save(a.settings)
			a.syncMenuChecks()
			if !a.settings.ShowFloatingBar && a.hFloating != 0 {
				show(a.hFloating, false)
			} else {
				a.refreshTotal()
			}
		case ID_TRAY_EXIT:
			a.exiting = true
			procPostMessageW.Call(a.hwnd, WM_CLOSE, 0, 0)
		}
	}
}

func formatDuration(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	h := int(d / time.Hour)
	m := int(d/time.Minute) % 60
	s := int(d/time.Second) % 60
	if h > 0 {
		return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%02d:%02d", m, s)
}
func formatSecondsClock(v float64) string {
	if v < 0 {
		v = 0
	}
	d := time.Duration(v * float64(time.Second))
	return fmt.Sprintf("%02d:%02d:%02d.%03d", int(d/time.Hour), int(d/time.Minute)%60, int(d/time.Second)%60, int(d/time.Millisecond)%1000)
}

func (a *application) showPathError(title string, err error) {
	if err != nil {
		messageBox(a.hwnd, title, err.Error(), MB_OK|MB_ICONERROR)
	}
}

// Helps diagnostics when the rebuilt executable is launched from a console or crash reporter.
func (a *application) writeDiagnostics() {
	dir, err := config.Dir()
	if err != nil {
		messageBox(a.hwnd, "诊断报告", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	path := filepath.Join(dir, fmt.Sprintf("diagnostics_%s.txt", time.Now().Format("20060102_150405")))
	a.mu.Lock()
	tasks := make([]model.Task, 0, len(a.tasks))
	for _, t := range a.tasks {
		if t != nil {
			tasks = append(tasks, *t)
		}
	}
	a.mu.Unlock()
	settingsJSON, _ := json.MarshalIndent(a.settings, "", "  ")
	tasksJSON, _ := json.MarshalIndent(tasks, "", "  ")
	ffmpeg, ffprobe, hardware, player, _ := a.componentSnapshot()
	runtimeDir, _ := config.RuntimeDir()
	roamingDir, _ := config.Dir()
	localDir, _ := config.LocalDir()
	manifestState := "未验证"
	if err := config.ValidateRuntimeManifest(appVersion); err == nil {
		manifestState = "通过"
	} else {
		manifestState = err.Error()
	}
	text := fmt.Sprintf("Mediova诊断报告\r\n生成时间：%s\r\n版本：%s\r\n系统：%s/%s\r\n逻辑处理器：%d\r\nRuntime：%s\r\nRoaming Data：%s\r\nLocal Data：%s\r\nRuntime Manifest：%s\r\n\r\nFFmpeg：%s\r\nFFprobe：%s\r\nGPU：%s\r\nPotPlayer：%s\r\n\r\n配置：\r\n%s\r\n\r\n任务快照：\r\n%s\r\n", time.Now().Format("2006-01-02 15:04:05"), appVersion, runtime.GOOS, runtime.GOARCH, runtime.NumCPU(), runtimeDir, roamingDir, localDir, manifestState, ffmpeg, ffprobe, hardware.Detail, player, settingsJSON, tasksJSON)
	if crashPath, e := config.CrashPath(); e == nil {
		if b, e := os.ReadFile(crashPath); e == nil {
			text += "\r\n最近崩溃记录：\r\n" + string(b) + "\r\n"
		}
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		messageBox(a.hwnd, "诊断报告", err.Error(), MB_OK|MB_ICONERROR)
		return
	}
	setClipboardText(a.hwnd, path)
	shellOpen(path)
	messageBox(a.hwnd, "诊断报告", "诊断报告已生成并打开，文件路径已复制到剪贴板。", MB_OK|MB_ICONINFORMATION)
}

func parseUIPreviewArgs(args []string) (bool, string) {
	return parseV420UIPreviewArgs(args)
}

func (a *application) populateUIPreviewTasks() {
	a.v420PopulateUIPreviewTasks()
}
func parseSelfTestArgs(args []string) (bool, string) {
	enabled := false
	output := ""
	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		switch {
		case arg == "--self-test":
			enabled = true
		case strings.HasPrefix(arg, "--self-test-output="):
			enabled = true
			output = strings.TrimSpace(strings.TrimPrefix(arg, "--self-test-output="))
		case arg == "--self-test-output" || arg == "--self-test-out":
			enabled = true
			if i+1 < len(args) {
				i++
				output = strings.TrimSpace(args[i])
			}
		}
	}
	return enabled, output
}

func (a *application) validateCriticalControls() error {
	if a == nil {
		return fmt.Errorf("application is nil")
	}
	critical := map[string]uintptr{
		"main_list": a.hList, "video_tab": a.hVideo, "image_tab": a.hImage,
		"add_files": a.hAddFiles, "add_folder": a.hAddFolder,
		"output_edit": a.hOutputEdit, "resolution": a.hResolution,
		"progress": a.hProgress, "start": a.hStart, "status": a.hStatusText,
		"concurrency_status": a.hConcurrencyStatus,
	}
	for name, handle := range critical {
		if handle == 0 {
			return fmt.Errorf("%s handle is zero", name)
		}
	}
	if len(a.globalLabels) != 5 || len(a.rightLabels) != 5 {
		return fmt.Errorf("label initialization incomplete: global=%d right=%d", len(a.globalLabels), len(a.rightLabels))
	}
	return nil
}

type selfTestReport struct {
	Version       string            `json:"version"`
	Time          string            `json:"time"`
	Passed        bool              `json:"passed"`
	Checks        map[string]bool   `json:"checks"`
	Details       map[string]string `json:"details,omitempty"`
	ElapsedMillis int64             `json:"elapsed_ms"`
}

func (a *application) selfTestPath() string {
	if strings.TrimSpace(a.selfTestOutput) != "" {
		return filepath.Clean(a.selfTestOutput)
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), "self_test.json")
	}
	return "self_test.json"
}

func (a *application) writeSelfTestFailure(stage string, err error) {
	if a == nil || !a.selfTest {
		return
	}
	report := selfTestReport{Version: appVersion, Time: time.Now().Format(time.RFC3339), Passed: false, Checks: map[string]bool{stage: false}, Details: map[string]string{stage: err.Error()}}
	if b, e := json.MarshalIndent(report, "", "  "); e == nil {
		_ = os.MkdirAll(filepath.Dir(a.selfTestPath()), 0o755)
		_ = os.WriteFile(a.selfTestPath(), b, 0o644)
	}
}

func (a *application) resetSelfTestRunState() {
	a.runMu.Lock()
	a.running = false
	a.paused = false
	a.timeEnd = time.Now()
	a.cancel = nil
	a.controller = nil
	a.gpuDisabledForRun = false
	a.runOnly = nil
	a.runTaskIDs = nil
	a.reservedOutputs = make(map[string]int64)
	a.v420ResetRunMaps()
	a.runMu.Unlock()
	a.mu.Lock()
	a.heldEditTaskID = 0
	a.rightDraftFields = make(map[int]bool)
	a.rightSelectionKey = ""
	a.mu.Unlock()
	procKillTimer.Call(a.hwnd, TIMER_MAIN_CLOCK)
}

func (a *application) runSameNameQueueStress(report *selfTestReport, root, seedVideo, ffprobe string) {
	stressCount := config.MaxConcurrency()
	if stressCount < 12 {
		stressCount = 12
	}
	if stressCount > 16 {
		stressCount = 16
	}
	seed, err := os.ReadFile(seedVideo)
	if err != nil || len(seed) <= 1024 {
		report.Checks["same_name_stress_generated"] = false
		if err != nil {
			report.Details["same_name_stress_generated"] = err.Error()
		}
		return
	}
	paths := make([]string, 0, stressCount)
	wanted := make(map[string]bool, stressCount)
	for i := 0; i < stressCount; i++ {
		dir := filepath.Join(root, fmt.Sprintf("同名并发-%02d", i+1))
		_ = os.MkdirAll(dir, 0o755)
		path := filepath.Join(dir, "同名并发.mp4")
		if err := os.WriteFile(path, seed, 0o644); err != nil {
			report.Checks["same_name_stress_generated"] = false
			report.Details["same_name_stress_generated"] = err.Error()
			return
		}
		paths = append(paths, path)
		wanted[strings.ToLower(filepath.Clean(path))] = true
	}
	report.Checks["same_name_stress_generated"] = len(paths) > 8
	a.addPaths(paths, "")

	outputDir := filepath.Join(root, "same-name-output")
	_ = os.MkdirAll(outputDir, 0o755)
	a.settings.OutputDir = outputDir
	a.settings.UseGPU = false
	a.settings.SmartEngine = false
	a.settings.AutoConcurrency = true
	a.settings.Concurrency = config.MaxConcurrency()
	a.settings.EstimateDiskSpace = false
	a.settings.SaveHistory = false
	a.settings.VerifyOutput = true
	a.settings.PreserveTimes = false
	a.settings.FilenameMode = "保持原文件名"
	a.settings.ConflictPolicy = "自动编号"
	a.settings.Resolution = "原尺寸"
	a.settings.Codec = "H.264"
	a.settings.Quality = "低"
	a.settings.VolumeMode = "质量优先"
	a.settings.Rotation = "自动"
	a.switchKind(model.KindVideo)
	a.writeSettingsToUI()

	runOnly := make(map[int64]bool, stressCount)
	ids := make([]int64, 0, stressCount)
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Kind == model.KindVideo && wanted[strings.ToLower(filepath.Clean(task.Input))] {
			task.Status = model.StatusReady
			task.Error = ""
			task.OutputPath = ""
			ids = append(ids, task.ID)
			runOnly[task.ID] = true
		}
	}
	a.mu.Unlock()
	report.Checks["same_name_stress_selected"] = len(ids) == stressCount
	suggested := a.recommendedWorkers(model.KindVideo, runOnly)
	report.Checks["same_name_dynamic_workers"] = suggested >= 1 && suggested <= config.MaxConcurrency() && suggested <= stressCount
	report.Details["same_name_dynamic_workers"] = fmt.Sprintf("logical=%d limit=%d tasks=%d suggested=%d", config.LogicalProcessorCount(), config.MaxConcurrency(), stressCount, suggested)
	if len(ids) != stressCount || ffprobe == "" {
		report.Checks["same_name_queue_completed"] = false
		report.Checks["same_name_all_terminal"] = false
		report.Checks["same_name_unique_outputs"] = false
		report.Checks["same_name_outputs_decodable"] = false
		return
	}

	a.startQueueFiltered(runOnly)
	doneCh := make(chan struct{})
	go func() { a.workers.Wait(); close(doneCh) }()
	completed := false
	select {
	case <-doneCh:
		completed = true
	case <-time.After(180 * time.Second):
		a.runMu.Lock()
		cancel := a.cancel
		a.runMu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	report.Checks["same_name_queue_completed"] = completed

	outputs := make([]string, 0, stressCount)
	unique := make(map[string]bool, stressCount)
	terminal, doneCount, failedCount, skippedCount, cancelledCount := true, 0, 0, 0, 0
	statusDetails := make([]string, 0, stressCount)
	a.mu.Lock()
	for _, id := range ids {
		task, _ := a.findTaskByIDLocked(id)
		if task == nil {
			terminal = false
			continue
		}
		switch task.Status {
		case model.StatusDone:
			doneCount++
		case model.StatusFailed:
			failedCount++
		case model.StatusSkipped:
			skippedCount++
		case model.StatusCancelled:
			cancelledCount++
		default:
			terminal = false
		}
		if task.OutputPath != "" {
			outputs = append(outputs, task.OutputPath)
			unique[strings.ToLower(filepath.Clean(task.OutputPath))] = true
		}
		statusDetails = append(statusDetails, fmt.Sprintf("id=%d status=%s output=%q size=%d error=%s", id, task.Status, task.OutputPath, media.FileSize(task.OutputPath), task.Error))
	}
	a.mu.Unlock()
	accountingErr := media.ValidateRunAccounting(stressCount, doneCount, failedCount, skippedCount, cancelledCount)
	report.Checks["same_name_all_terminal"] = completed && terminal && accountingErr == nil && doneCount == stressCount
	report.Checks["same_name_unique_outputs"] = len(outputs) == stressCount && len(unique) == stressCount
	if !report.Checks["same_name_all_terminal"] || !report.Checks["same_name_unique_outputs"] {
		report.Details["same_name_queue_status"] = strings.Join(statusDetails, " | ")
	}

	decodable := report.Checks["same_name_all_terminal"] && report.Checks["same_name_unique_outputs"]
	for _, path := range outputs {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		info, err := media.ProbeContext(ctx, ffprobe, path)
		cancel()
		if err != nil || info.Width <= 0 || info.Height <= 0 || info.Duration <= 0 {
			decodable = false
			if err != nil {
				report.Details["same_name_outputs_decodable"] = err.Error()
			}
			break
		}
	}
	report.Checks["same_name_outputs_decodable"] = decodable
	a.resetSelfTestRunState()
}

func (a *application) runOutputIntegrityFaultInjection(report *selfTestReport, root, seedVideo string) {
	seed, err := os.ReadFile(seedVideo)
	path := filepath.Join(root, "完整性故障注入.mp4")
	if err == nil {
		err = os.WriteFile(path, seed, 0o644)
	}
	if err != nil {
		report.Checks["verify_off_fault_generated"] = false
		report.Details["verify_off_fault_generated"] = err.Error()
		return
	}
	report.Checks["verify_off_fault_generated"] = media.FileSize(path) > 1024
	a.addPaths([]string{path}, "")
	var taskID int64
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && filepath.Clean(task.Input) == filepath.Clean(path) {
			taskID = task.ID
			task.Status = model.StatusReady
			task.Error = ""
			task.OutputPath = ""
			break
		}
	}
	a.mu.Unlock()
	if taskID == 0 {
		report.Checks["verify_off_fault_rejected"] = false
		return
	}
	a.settings.OutputDir = filepath.Join(root, "fault-output")
	_ = os.MkdirAll(a.settings.OutputDir, 0o755)
	a.settings.UseGPU = false
	a.settings.SmartEngine = false
	a.settings.AutoConcurrency = false
	a.settings.Concurrency = 1
	a.settings.EstimateDiskSpace = false
	a.settings.SaveHistory = false
	a.settings.VerifyOutput = false
	a.settings.PreserveTimes = false
	a.settings.FilenameMode = "保持原文件名"
	a.settings.ConflictPolicy = "自动编号"
	a.settings.Resolution = "原尺寸"
	a.settings.Codec = "H.264"
	a.settings.Quality = "低"
	a.settings.VolumeMode = "质量优先"
	a.settings.Rotation = "自动"
	a.switchKind(model.KindVideo)
	a.writeSettingsToUI()
	a.outputIntegrityHook = func(out string) {
		_ = os.WriteFile(out, []byte("bad"), 0o644)
	}
	a.startQueueFiltered(map[int64]bool{taskID: true})
	doneCh := make(chan struct{})
	go func() { a.workers.Wait(); close(doneCh) }()
	completed := false
	select {
	case <-doneCh:
		completed = true
	case <-time.After(90 * time.Second):
	}
	a.outputIntegrityHook = nil
	status := model.Status("")
	errorText, outputPath := "", ""
	progress := 0.0
	a.mu.Lock()
	if task, _ := a.findTaskByIDLocked(taskID); task != nil {
		status = task.Status
		errorText = task.Error
		outputPath = task.OutputPath
		progress = task.Progress
	}
	a.mu.Unlock()
	report.Checks["verify_off_fault_rejected"] = completed && status == model.StatusFailed && outputPath == "" && progress < 100 && strings.Contains(errorText, "输出完整性失败")
	if !report.Checks["verify_off_fault_rejected"] {
		report.Details["verify_off_fault_rejected"] = fmt.Sprintf("completed=%v status=%s progress=%.1f output=%q error=%s", completed, status, progress, outputPath, errorText)
	}
	a.resetSelfTestRunState()
}

func (a *application) runStreamCompatibilitySelfTest(report *selfTestReport, root, ffmpeg, ffprobe string) {
	if ffmpeg == "" || ffprobe == "" {
		for _, name := range []string{"complex_media_generated", "complex_media_detected", "complex_media_converted", "complex_media_tracks_preserved", "vfr_media_generated", "vfr_media_detected", "vfr_media_converted"} {
			report.Checks[name] = false
		}
		report.Details["complex_media_generated"] = "FFmpeg components unavailable"
		return
	}
	run := func(timeout time.Duration, args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, ffmpeg, args...)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		return cmd.CombinedOutput()
	}

	srt := filepath.Join(root, "轨道测试.srt")
	_ = os.WriteFile(srt, []byte("1\r\n00:00:00,100 --> 00:00:01,100\r\nMediova subtitle test\r\n"), 0o644)
	complexInput := filepath.Join(root, "多音轨字幕测试.mp4")
	out, err := run(45*time.Second,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15:duration=1.5",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
		"-f", "lavfi", "-i", "sine=frequency=880:duration=1.5",
		"-i", srt,
		"-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-map", "3:0",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:s", "mov_text",
		"-metadata:s:a:0", "language=zho", "-metadata:s:a:1", "language=eng", "-metadata:s:s:0", "language=zho",
		"-t", "1.5", complexInput)
	report.Checks["complex_media_generated"] = err == nil && media.FileSize(complexInput) > 1024
	if err != nil {
		detail := strings.TrimSpace(string(out))
		if detail == "" {
			detail = err.Error()
		}
		report.Details["complex_media_generated"] = detail
	}
	complexProbe, probeErr := media.Probe(ffprobe, complexInput)
	report.Checks["complex_media_detected"] = probeErr == nil && complexProbe.AudioStreams == 2 && complexProbe.TextSubtitles == 1 && complexProbe.BitmapSubtitles == 0
	if !report.Checks["complex_media_detected"] {
		report.Details["complex_media_detected"] = fmt.Sprintf("err=%v audio=%d text=%d bitmap=%d", probeErr, complexProbe.AudioStreams, complexProbe.TextSubtitles, complexProbe.BitmapSubtitles)
	}
	if report.Checks["complex_media_detected"] {
		settings := model.DefaultSettings()
		settings.OutputDir = root
		settings.UseGPU = false
		settings.SmartEngine = false
		settings.AudioMode = "AAC 192k"
		settings.SubtitleMode = "保留文本字幕"
		settings.VerifyOutput = true
		settings.PreserveTimes = false
		opts := settings.EffectiveOptions(&model.Task{Kind: model.KindVideo})
		opts.Resolution = "原尺寸"
		opts.Codec = "H.264"
		opts.Quality = "中"
		complexOutput := filepath.Join(root, "多音轨字幕测试_output.mp4")
		req := media.ConvertRequest{Input: complexInput, Output: complexOutput, Kind: model.KindVideo, Probe: complexProbe, Options: opts, Settings: settings}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		_, convertErr := media.Convert(ctx, ffmpeg, req, nil)
		cancel()
		report.Checks["complex_media_converted"] = convertErr == nil && media.FileSize(complexOutput) > 1024
		convertedProbe, convertedErr := media.Probe(ffprobe, complexOutput)
		report.Checks["complex_media_tracks_preserved"] = convertErr == nil && convertedErr == nil && convertedProbe.AudioStreams == 2 && convertedProbe.SubtitleStreams == 1
		if !report.Checks["complex_media_tracks_preserved"] {
			report.Details["complex_media_tracks_preserved"] = fmt.Sprintf("convert=%v probe=%v audio=%d subtitle=%d", convertErr, convertedErr, convertedProbe.AudioStreams, convertedProbe.SubtitleStreams)
		}
	} else {
		report.Checks["complex_media_converted"] = false
		report.Checks["complex_media_tracks_preserved"] = false
	}

	vfrInput := filepath.Join(root, "可变帧率测试.mp4")
	vfrLog, vfrErr := run(45*time.Second,
		"-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2",
		"-vf", "select='if(lt(t,1),not(mod(n,3)),1)'", "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", vfrInput)
	report.Checks["vfr_media_generated"] = vfrErr == nil && media.FileSize(vfrInput) > 1024
	if vfrErr != nil {
		report.Details["vfr_media_generated"] = strings.TrimSpace(string(vfrLog))
	}
	vfrProbe, vfrProbeErr := media.Probe(ffprobe, vfrInput)
	report.Checks["vfr_media_detected"] = vfrProbeErr == nil && vfrProbe.VariableFrameRate
	if !report.Checks["vfr_media_detected"] {
		report.Details["vfr_media_detected"] = fmt.Sprintf("err=%v avg=%.3f nominal=%.3f", vfrProbeErr, vfrProbe.FPS, vfrProbe.NominalFPS)
	}
	if vfrProbeErr == nil {
		settings := model.DefaultSettings()
		settings.UseGPU = false
		settings.SmartEngine = false
		settings.AudioMode = "静音"
		settings.SubtitleMode = "不保留字幕"
		settings.PreserveTimes = false
		opts := settings.EffectiveOptions(&model.Task{Kind: model.KindVideo})
		opts.Resolution = "原尺寸"
		opts.Codec = "H.264"
		opts.Quality = "中"
		vfrOutput := filepath.Join(root, "可变帧率测试_output.mp4")
		req := media.ConvertRequest{Input: vfrInput, Output: vfrOutput, Kind: model.KindVideo, Probe: vfrProbe, Options: opts, Settings: settings}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		_, convertErr := media.Convert(ctx, ffmpeg, req, nil)
		cancel()
		convertedProbe, convertedErr := media.Probe(ffprobe, vfrOutput)
		report.Checks["vfr_media_converted"] = convertErr == nil && convertedErr == nil && convertedProbe.Width > 0 && convertedProbe.Duration > 0
		if !report.Checks["vfr_media_converted"] {
			report.Details["vfr_media_converted"] = fmt.Sprintf("convert=%v probe=%v", convertErr, convertedErr)
		}
	} else {
		report.Checks["vfr_media_converted"] = false
	}
}

func (a *application) runSelfTest() {
	start := time.Now()
	report := selfTestReport{Version: appVersion, Time: start.Format(time.RFC3339), Checks: map[string]bool{}, Details: map[string]string{}}
	defer func() {
		if r := recover(); r != nil {
			report.Passed = false
			report.Details["panic"] = fmt.Sprint(r)
			report.Details["stack"] = string(debug.Stack())
		}
		report.ElapsedMillis = time.Since(start).Milliseconds()
		if len(report.Checks) > 0 && report.Details["panic"] == "" {
			report.Passed = true
			for _, ok := range report.Checks {
				if !ok {
					report.Passed = false
					break
				}
			}
		}
		b, _ := json.MarshalIndent(report, "", "  ")
		_ = os.MkdirAll(filepath.Dir(a.selfTestPath()), 0o755)
		_ = os.WriteFile(a.selfTestPath(), b, 0o644)
		a.exiting = true
		writeStartupStage("self_test_report_written")
		procPostMessageW.Call(a.hwnd, WM_APP_SELFTEST, 0, 0)
	}()

	report.Checks["critical_controls"] = a.validateCriticalControls() == nil
	report.Checks["logical_processor_detection"] = config.LogicalProcessorCount() >= 1
	report.Checks["dynamic_concurrency_limit"] = config.MaxConcurrency() >= 1 && config.MaxConcurrency() <= config.HardMaxConcurrency && config.MaxConcurrency() <= config.LogicalProcessorCount()
	report.Checks["dynamic_concurrency_menu"] = len(a.concurrencyCommands) == len(config.ConcurrencyChoices()) && len(a.concurrencyCommands) > 0
	report.Checks["background_probe_pool_bounded"] = cap(a.probeQueue) == 16384 && probeWorkerCount == 4
	report.Checks["background_thumbnail_pool_bounded"] = cap(a.thumbnailQueue) == 8192 && thumbnailWorkerCount == 2
	beforeGoroutines := runtime.NumGoroutine()
	enqueued := 0
	for i := 0; i < 2000; i++ {
		if a.queueProbe(-int64(i + 1)) {
			enqueued++
		}
	}
	time.Sleep(100 * time.Millisecond)
	afterGoroutines := runtime.NumGoroutine()
	report.Checks["bulk_probe_enqueue_bounded_goroutines"] = enqueued == 2000 && afterGoroutines-beforeGoroutines < 32
	report.Details["bulk_probe_enqueue_bounded_goroutines"] = fmt.Sprintf("enqueued=%d goroutines_before=%d after=%d", enqueued, beforeGoroutines, afterGoroutines)
	pt := &progressThrottler{}
	baseTime := time.Now()
	emitted := 0
	for i := 0; i < 1000; i++ {
		if ok, _ := pt.accept(float64(i)/100, "CPU · H.265", "", baseTime.Add(time.Duration(i)*time.Millisecond)); ok {
			emitted++
		}
	}
	report.Checks["progress_updates_throttled"] = emitted > 0 && emitted < 100
	report.Details["progress_updates_throttled"] = fmt.Sprintf("callbacks=1000 emitted=%d", emitted)
	originalDPI := uiDPI
	layoutOK := true
	for _, dpi := range []uint32{96, 120, 144, 168} {
		uiDPI = dpi
		for _, size := range [][2]int32{{980, 700}, {1050, 700}, {1120, 720}, {1200, 740}, {1280, 760}, {1320, 780}, {1499, 860}, {1512, 898}, {1640, 925}, {1650, 930}, {1920, 1080}} {
			pw, ph := scaleDPIValue(size[0], dpi), scaleDPIValue(size[1], dpi)
			a.layout(pw, ph)
			if err := a.validateCurrentLayout(pw, ph); err != nil {
				layoutOK = false
				report.Details["layout_multiple_dpi"] = fmt.Sprintf("dpi=%d size=%dx%d: %v", dpi, size[0], size[1], err)
				break
			}
		}
	}
	uiDPI = originalDPI
	a.layout(scaleDPIValue(1650, originalDPI), scaleDPIValue(930, originalDPI))
	report.Checks["layout_multiple_sizes"] = layoutOK
	report.Checks["layout_multiple_dpi"] = layoutOK
	report.Checks["minimum_window_scaled"] = scaleDPIValue(980, 168) > scaleDPIValue(980, 96) && scaleDPIValue(700, 168) > scaleDPIValue(700, 96)
	a.switchKind(model.KindImage)
	a.switchKind(model.KindVideo)
	report.Checks["tab_switch"] = a.currentKind == model.KindVideo

	root, err := os.MkdirTemp("", "Mediova-selftest-")
	if err != nil {
		report.Details["temp"] = err.Error()
		report.Checks["mixed_scan"] = false
		return
	}
	defer os.RemoveAll(root)
	sub := filepath.Join(root, "子目录")
	_ = os.MkdirAll(sub, 0o755)
	imgPath := filepath.Join(sub, "测试图片.png")
	f, err := os.Create(imgPath)
	if err == nil {
		// Use a realistically sized image so the application queue can verify
		// image resizing and output decoding rather than only tiny-file import.
		im := image.NewRGBA(image.Rect(0, 0, 1200, 675))
		for y := 0; y < 675; y++ {
			for x := 0; x < 1200; x++ {
				im.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: uint8((x + y) % 256), A: 255})
			}
		}
		err = png.Encode(f, im)
		_ = f.Close()
	}
	if err != nil {
		report.Details["png"] = err.Error()
		report.Checks["mixed_scan"] = false
		return
	}
	videoPath := filepath.Join(root, "测试视频.mp4")
	videoPath2 := filepath.Join(sub, filepath.Base(videoPath))
	ffmpeg, ffprobe, _, _, _ := a.componentSnapshot()
	report.Checks["bundled_ffmpeg"] = ffmpeg != "" && ffprobe != ""
	if ffmpeg == "" || ffprobe == "" {
		report.Details["bundled_ffmpeg"] = "ffmpeg.exe or ffprobe.exe was not discovered beside the application"
		_ = os.WriteFile(videoPath, []byte("self-test-placeholder"), 0o644)
		_ = os.WriteFile(videoPath2, []byte("self-test-placeholder-2"), 0o644)
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
		output, genErr := cmd.CombinedOutput()
		cancel()
		report.Checks["generate_real_video"] = genErr == nil && media.FileSize(videoPath) > 1024
		if genErr != nil {
			report.Details["generate_real_video"] = genErr.Error() + ": " + string(output)
		} else {
			videoBytes, readErr := os.ReadFile(videoPath)
			copyErr := readErr
			if copyErr == nil {
				copyErr = os.WriteFile(videoPath2, videoBytes, 0o644)
			}
			report.Checks["generate_second_real_video"] = copyErr == nil && media.FileSize(videoPath2) == media.FileSize(videoPath) && media.FileSize(videoPath2) > 1024
			if copyErr != nil {
				report.Details["generate_second_real_video"] = copyErr.Error()
			}
			probeCtx, probeCancel := context.WithTimeout(context.Background(), 20*time.Second)
			pinfo, probeErr := media.ProbeContext(probeCtx, ffprobe, videoPath)
			probeCancel()
			report.Checks["real_video_probe"] = probeErr == nil && pinfo.Width == 320 && pinfo.Height == 180 && pinfo.Duration > 0
			if probeErr != nil {
				report.Details["real_video_probe"] = probeErr.Error()
			}
			thumbPath := filepath.Join(root, "self_test_thumb.bmp")
			thumbCtx, thumbCancel := context.WithTimeout(context.Background(), 20*time.Second)
			thumbErr := media.GenerateThumbnailBMP(thumbCtx, ffmpeg, videoPath, thumbPath, 0.1, "自动", 80, 48)
			thumbCancel()
			report.Checks["real_thumbnail"] = thumbErr == nil && media.FileSize(thumbPath) > 64
			if thumbErr != nil {
				report.Details["real_thumbnail"] = thumbErr.Error()
			}
		}
	}
	mixed, err := media.ListMixedFiles(root, true)
	report.Checks["mixed_scan"] = err == nil && len(mixed.Images) >= 1 && len(mixed.Videos) == 2
	if err != nil {
		report.Details["mixed_scan"] = err.Error()
	}

	hdrop := makeSelfTestDropHandle([]string{imgPath, videoPath, videoPath2})
	decoded, dropErr := queryDroppedFiles(hdrop)
	report.Checks["wm_dropfiles_decode"] = dropErr == nil && len(decoded) == 3 && decoded[0] == filepath.Clean(imgPath) && decoded[1] == filepath.Clean(videoPath) && decoded[2] == filepath.Clean(videoPath2)
	if dropErr != nil {
		report.Details["wm_dropfiles_decode"] = dropErr.Error()
	}

	// Exercise the real Windows drop-message path end to end:
	// WM_DROPFILES -> handleDrop -> background scan -> UI queue -> addPaths.
	// Probe is temporarily disabled only for the imported tasks because probe
	// and thumbnail execution were already tested above with real media.
	a.componentMu.Lock()
	savedProbe := a.ffprobe
	a.ffprobe = ""
	a.componentMu.Unlock()
	hdropEndToEnd := makeSelfTestDropHandle([]string{imgPath, videoPath, videoPath2})
	if hdropEndToEnd != 0 {
		send(a.hwnd, WM_DROPFILES, hdropEndToEnd, 0)
	}
	deadline := time.Now().Add(5 * time.Second)
	videoAdded, imageAdded := 0, 0
	for time.Now().Before(deadline) {
		a.drainUIQueue()
		videoAdded, imageAdded = 0, 0
		a.mu.Lock()
		for _, task := range a.tasks {
			switch task.Kind {
			case model.KindVideo:
				videoAdded++
			case model.KindImage:
				imageAdded++
			}
		}
		a.mu.Unlock()
		if videoAdded >= 2 && imageAdded >= 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	a.componentMu.Lock()
	a.ffprobe = savedProbe
	a.componentMu.Unlock()
	report.Checks["wm_dropfiles_end_to_end"] = hdropEndToEnd != 0 && videoAdded == 2 && imageAdded == 1
	report.Checks["task_import"] = videoAdded == 2 && imageAdded == 1
	if !report.Checks["wm_dropfiles_end_to_end"] {
		report.Details["wm_dropfiles_end_to_end"] = fmt.Sprintf("video=%d image=%d", videoAdded, imageAdded)
	}
	report.Checks["duplicate_guard"] = func() bool { _, _, d := a.addPaths([]string{imgPath}, root); return d == 1 }()

	// Rebuild the ListView while a task is selected. Before v3.5.6,
	// refreshList held a.mu across synchronous ListView SendMessage calls;
	// WM_NOTIFY then re-entered the right-panel path and self-deadlocked.
	a.switchKind(model.KindVideo)
	a.refreshList()
	selectedState := lvItem{State: LVIS_SELECTED | LVIS_FOCUSED, StateMask: LVIS_SELECTED | LVIS_FOCUSED}
	send(a.hList, LVM_SETITEMSTATE, 0, uintptr(unsafe.Pointer(&selectedState)))
	a.refreshList()
	report.Checks["selected_row_refresh"] = true
	report.Checks["right_panel_default_visible"] = a.rightVisible
	row := rect{Left: LVIR_BOUNDS}
	rowOK := send(a.hList, LVM_GETITEMRECT, 0, uintptr(unsafe.Pointer(&row))) != 0
	compressionCell, compressionOK := listSubItemBounds(a.hList, 0, 7)
	progressCell, progressOK := listSubItemBounds(a.hList, 0, 8)
	compressionBar := fullCellBarRect(compressionCell)
	progressBar := fullCellBarRect(progressCell)
	report.Checks["list_progress_cells_use_full_row_height"] = rowOK && compressionOK && progressOK &&
		compressionCell.Top == row.Top && compressionCell.Bottom == row.Bottom &&
		progressCell.Top == row.Top && progressCell.Bottom == row.Bottom &&
		compressionBar.Bottom-compressionBar.Top >= row.Bottom-row.Top-12 &&
		progressBar.Bottom-progressBar.Top >= row.Bottom-row.Top-12
	if !report.Checks["list_progress_cells_use_full_row_height"] {
		report.Details["list_progress_cells_use_full_row_height"] = fmt.Sprintf("row=%+v compression=%+v bar=%+v progress=%+v bar=%+v", row, compressionCell, compressionBar, progressCell, progressBar)
	}
	report.Checks["status_grid_two_rows"] = func() bool {
		ff, okFF := childClientRect(a.hFFStatus, a.hwnd)
		gpu, okGPU := childClientRect(a.hGPUStatus, a.hwnd)
		pot, okPot := childClientRect(a.hPotStatus, a.hwnd)
		conc, okConc := childClientRect(a.hConcurrencyStatus, a.hwnd)
		return okFF && okGPU && okPot && okConc && ff.Top == gpu.Top && pot.Top == conc.Top && ff.Left == pot.Left && gpu.Left == conc.Left && pot.Top > ff.Bottom
	}()
	report.Checks["concurrency_chip_opens_dynamic_menu"] = a.hConcurrencyStatus != 0 && a.menuConcurrency != 0 && len(a.concurrencyCommands) == len(config.ConcurrencyChoices())

	// Verify that an asynchronous thumbnail result can update the ListView
	// image column in place. Before v3.6.0, updateTaskRowByID refreshed only
	// text subitems, leaving the row at image index -1 until a full rebuild.
	var thumbnailTaskID int64
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Kind == model.KindVideo {
			task.ThumbnailIndex = 0
			thumbnailTaskID = task.ID
			break
		}
	}
	a.mu.Unlock()
	if thumbnailTaskID != 0 {
		a.updateTaskRowByID(thumbnailTaskID)
		imageItem := lvItem{Mask: LVIF_IMAGE, IItem: 0, ISubItem: 0, IImage: -1}
		ok := send(a.hList, LVM_GETITEMW, 0, uintptr(unsafe.Pointer(&imageItem))) != 0
		report.Checks["thumbnail_row_image_update"] = ok && imageItem.IImage == 0
		if !report.Checks["thumbnail_row_image_update"] {
			report.Details["thumbnail_row_image_update"] = fmt.Sprintf("ok=%v image=%d", ok, imageItem.IImage)
		}
	} else {
		report.Checks["thumbnail_row_image_update"] = false
		report.Details["thumbnail_row_image_update"] = "no imported video task"
	}

	// Exercise two real application workers concurrently. The two source
	// videos intentionally share the same base filename while coming from
	// different directories and a direct-file drop (empty task root). Both
	// workers therefore compete for the same initial output path; the queue's
	// reservation mechanism must allocate unique outputs without overwriting.
	outputDir := filepath.Join(root, "converted")
	_ = os.MkdirAll(outputDir, 0o755)
	a.settings.OutputDir = outputDir
	a.settings.UseGPU = false
	a.settings.SmartEngine = false
	a.settings.AutoConcurrency = false
	a.settings.Concurrency = 2
	a.settings.EstimateDiskSpace = false
	a.settings.SaveHistory = false
	a.settings.VerifyOutput = true
	a.settings.PreserveTimes = false
	a.settings.FilenameMode = "保持原文件名"
	a.settings.ConflictPolicy = "自动编号"
	a.settings.Resolution = "原尺寸"
	a.settings.Codec = "H.264"
	a.settings.Quality = "中"
	a.settings.VolumeMode = "质量优先"
	a.settings.Rotation = "自动"
	a.switchKind(model.KindVideo)
	a.writeSettingsToUI()

	wantedVideoPaths := map[string]bool{
		strings.ToLower(filepath.Clean(videoPath)):  true,
		strings.ToLower(filepath.Clean(videoPath2)): true,
	}
	videoTaskIDs := make([]int64, 0, 2)
	videoRunOnly := make(map[int64]bool, 2)
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Kind == model.KindVideo && wantedVideoPaths[strings.ToLower(filepath.Clean(task.Input))] {
			videoTaskIDs = append(videoTaskIDs, task.ID)
			videoRunOnly[task.ID] = true
			task.Status = model.StatusReady
			task.Error = ""
			task.OutputPath = ""
		}
	}
	a.mu.Unlock()
	report.Checks["queue_task_selected"] = len(videoTaskIDs) == 2
	report.Checks["video_batch_two_tasks"] = len(videoTaskIDs) == 2
	if len(videoTaskIDs) == 2 && ffmpeg != "" && ffprobe != "" {
		a.startQueueFiltered(videoRunOnly)
		queueDone := make(chan struct{})
		go func() {
			a.workers.Wait()
			close(queueDone)
		}()
		queueCompleted := false
		select {
		case <-queueDone:
			queueCompleted = true
		case <-time.After(90 * time.Second):
			a.runMu.Lock()
			cancel := a.cancel
			a.runMu.Unlock()
			if cancel != nil {
				cancel()
			}
			report.Details["queue_conversion_completed"] = "two-worker application queue timed out after 90 seconds"
		}
		report.Checks["queue_conversion_completed"] = queueCompleted

		videoOutputs := make([]string, 0, 2)
		allDone := queueCompleted
		statusDetails := make([]string, 0, 2)
		a.mu.Lock()
		for _, id := range videoTaskIDs {
			if task, _ := a.findTaskByIDLocked(id); task != nil {
				videoOutputs = append(videoOutputs, task.OutputPath)
				ok := task.Status == model.StatusDone && task.OutputPath != "" && media.FileSize(task.OutputPath) > 1024
				allDone = allDone && ok
				statusDetails = append(statusDetails, fmt.Sprintf("id=%d status=%s output=%q size=%d error=%s", id, task.Status, task.OutputPath, media.FileSize(task.OutputPath), task.Error))
			} else {
				allDone = false
				statusDetails = append(statusDetails, fmt.Sprintf("id=%d missing", id))
			}
		}
		a.mu.Unlock()
		report.Checks["queue_task_done"] = allDone && len(videoOutputs) == 2
		if !report.Checks["queue_task_done"] {
			report.Details["queue_task_done"] = strings.Join(statusDetails, " | ")
		}

		uniqueOutputs := len(videoOutputs) == 2 && !strings.EqualFold(filepath.Clean(videoOutputs[0]), filepath.Clean(videoOutputs[1]))
		report.Checks["video_batch_unique_outputs"] = uniqueOutputs
		if !uniqueOutputs {
			report.Details["video_batch_unique_outputs"] = strings.Join(videoOutputs, " | ")
		}

		allDecodable := report.Checks["queue_task_done"]
		for _, convertedPath := range videoOutputs {
			verifyCtx, verifyCancel := context.WithTimeout(context.Background(), 20*time.Second)
			convertedInfo, verifyErr := media.ProbeContext(verifyCtx, ffprobe, convertedPath)
			verifyCancel()
			if verifyErr != nil || convertedInfo.Width <= 0 || convertedInfo.Height <= 0 || convertedInfo.Duration <= 0 {
				allDecodable = false
				if verifyErr != nil {
					report.Details["queue_output_decodable"] = verifyErr.Error()
				}
			}
		}
		report.Checks["queue_output_decodable"] = allDecodable

		// The self-test has already waited for every worker. Reset only the
		// transient run state; temporary task paths are never persisted.
		a.runMu.Lock()
		a.running = false
		a.paused = false
		a.timeEnd = time.Now()
		a.cancel = nil
		a.controller = nil
		a.gpuDisabledForRun = false
		a.runOnly = nil
		a.runTaskIDs = nil
		a.reservedOutputs = make(map[string]int64)
		a.runMu.Unlock()
		procKillTimer.Call(a.hwnd, TIMER_MAIN_CLOCK)
	} else {
		report.Checks["queue_conversion_completed"] = false
		report.Checks["queue_task_done"] = false
		report.Checks["queue_output_decodable"] = false
		report.Checks["video_batch_unique_outputs"] = false
		if ffmpeg == "" || ffprobe == "" {
			report.Details["queue_conversion_completed"] = "FFmpeg components unavailable"
		}
	}

	if ffmpeg != "" && ffprobe != "" && report.Checks["generate_real_video"] {
		a.runSameNameQueueStress(&report, root, videoPath, ffprobe)
		a.runOutputIntegrityFaultInjection(&report, root, videoPath)
		a.runStreamCompatibilitySelfTest(&report, root, ffmpeg, ffprobe)
	} else {
		for _, name := range []string{"same_name_stress_generated", "same_name_stress_selected", "same_name_dynamic_workers", "same_name_queue_completed", "same_name_all_terminal", "same_name_unique_outputs", "same_name_outputs_decodable", "verify_off_fault_generated", "verify_off_fault_rejected", "complex_media_generated", "complex_media_detected", "complex_media_converted", "complex_media_tracks_preserved", "vfr_media_generated", "vfr_media_detected", "vfr_media_converted"} {
			report.Checks[name] = false
		}
	}

	// Exercise the second core workspace through the same real application
	// queue. The imported PNG is resized, encoded as JPG and decoded again.
	imageOutputDir := filepath.Join(root, "converted-images")
	_ = os.MkdirAll(imageOutputDir, 0o755)
	a.settings.SetOutputDirFor(model.KindImage, imageOutputDir)
	a.settings.UseGPU = false
	a.settings.SmartEngine = false
	a.settings.AutoConcurrency = false
	a.settings.Concurrency = 1
	a.settings.EstimateDiskSpace = false
	a.settings.SaveHistory = false
	a.settings.VerifyOutput = true
	a.settings.PreserveTimes = false
	a.settings.ClearMetadata = true
	a.settings.AllowUpscale = false
	a.settings.ImageFormat = "JPG"
	a.settings.ImageSize = "最大边 1000px"
	a.settings.ImageQuality = "中"
	a.settings.ImageLimit = "不限"
	a.switchKind(model.KindImage)
	a.writeSettingsToUI()

	var imageTaskID int64
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Kind == model.KindImage && filepath.Clean(task.Input) == filepath.Clean(imgPath) {
			imageTaskID = task.ID
			task.Status = model.StatusReady
			task.Error = ""
			task.OutputPath = ""
			task.OutputSize = 0
			task.Options = a.settings.DefaultOptions(model.KindImage)
			task.Queue = nil
			task.Hold = nil
			break
		}
	}
	a.mu.Unlock()
	report.Checks["image_queue_task_selected"] = imageTaskID != 0
	if imageTaskID != 0 && ffmpeg != "" && ffprobe != "" {
		a.startQueueFiltered(map[int64]bool{imageTaskID: true})
		imageQueueDone := make(chan struct{})
		go func() {
			a.workers.Wait()
			close(imageQueueDone)
		}()
		imageQueueCompleted := false
		select {
		case <-imageQueueDone:
			imageQueueCompleted = true
		case <-time.After(90 * time.Second):
			a.runMu.Lock()
			cancel := a.cancel
			a.runMu.Unlock()
			if cancel != nil {
				cancel()
			}
			report.Details["image_queue_conversion_completed"] = "application image queue timed out after 90 seconds"
		}
		report.Checks["image_queue_conversion_completed"] = imageQueueCompleted

		var imageConvertedPath string
		var imageConvertedStatus model.Status
		var imageConvertedError string
		a.mu.Lock()
		if task, _ := a.findTaskByIDLocked(imageTaskID); task != nil {
			imageConvertedPath = task.OutputPath
			imageConvertedStatus = task.Status
			imageConvertedError = task.Error
		}
		a.mu.Unlock()
		report.Checks["image_queue_task_done"] = imageQueueCompleted && imageConvertedStatus == model.StatusDone && strings.EqualFold(filepath.Ext(imageConvertedPath), ".jpg") && media.FileSize(imageConvertedPath) > 1024
		if !report.Checks["image_queue_task_done"] {
			report.Details["image_queue_task_done"] = fmt.Sprintf("status=%s output=%q size=%d error=%s", imageConvertedStatus, imageConvertedPath, media.FileSize(imageConvertedPath), imageConvertedError)
		}
		if report.Checks["image_queue_task_done"] {
			imageVerifyCtx, imageVerifyCancel := context.WithTimeout(context.Background(), 20*time.Second)
			imageInfo, imageVerifyErr := media.ProbeContext(imageVerifyCtx, ffprobe, imageConvertedPath)
			imageVerifyCancel()
			report.Checks["image_queue_output_decodable"] = imageVerifyErr == nil && imageInfo.Width > 0 && imageInfo.Height > 0
			report.Checks["image_queue_resize"] = imageVerifyErr == nil && max(imageInfo.Width, imageInfo.Height) == 1000
			if imageVerifyErr != nil {
				report.Details["image_queue_output_decodable"] = imageVerifyErr.Error()
			} else if !report.Checks["image_queue_resize"] {
				report.Details["image_queue_resize"] = fmt.Sprintf("output dimensions=%dx%d", imageInfo.Width, imageInfo.Height)
			}
		} else {
			report.Checks["image_queue_output_decodable"] = false
			report.Checks["image_queue_resize"] = false
		}

		a.runMu.Lock()
		a.running = false
		a.paused = false
		a.timeEnd = time.Now()
		a.cancel = nil
		a.controller = nil
		a.gpuDisabledForRun = false
		a.runOnly = nil
		a.runTaskIDs = nil
		a.reservedOutputs = make(map[string]int64)
		a.runMu.Unlock()
		procKillTimer.Call(a.hwnd, TIMER_MAIN_CLOCK)
	} else {
		report.Checks["image_queue_conversion_completed"] = false
		report.Checks["image_queue_task_done"] = false
		report.Checks["image_queue_output_decodable"] = false
		report.Checks["image_queue_resize"] = false
		if ffmpeg == "" || ffprobe == "" {
			report.Details["image_queue_conversion_completed"] = "FFmpeg components unavailable"
		}
	}

	a.runV420DynamicQueueSelfTest(&report, root, videoPath, ffprobe)
	a.showImportToast("自检导入：视频 2 个，图片 1 个")
	a.hideImportToast()
	report.Checks["import_toast"] = true
	report.Checks["file_filter_utf16"] = len(utf16Multi("媒体文件\x00*.mp4;*.png\x00所有文件\x00*.*\x00\x00")) > 4
}

func startupLogPath() string {
	exe, err := os.Executable()
	if err != nil || exe == "" {
		return filepath.Join(".", "startup.log")
	}
	return filepath.Join(filepath.Dir(exe), "startup.log")
}

func resetStartupLog() {
	_ = os.Remove(startupLogPath())
}

func writeStartupStage(stage string) {
	f, err := os.OpenFile(startupLogPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(f, "%s | v%s | %s\r\n", time.Now().Format(time.RFC3339Nano), appVersion, stage)
	_ = f.Close()
}

func writeCrash(err any) {
	writeCrashContext("unhandled panic", err)
}

func writeCrashContext(stage string, err any) {
	path, e := config.CrashPath()
	if e != nil {
		return
	}
	text := fmt.Sprintf("time: %s\r\nversion: %s\r\nstage: %s\r\nerror: %v\r\n\r\nstack:\r\n%s", time.Now().Format(time.RFC3339), appVersion, stage, err, debug.Stack())
	_ = os.WriteFile(path, []byte(text), 0o644)
}

func (a *application) showImportToast(text string) {
	if a == nil {
		return
	}
	setText(a.hStatusText, text)
	if a.hImportToast != 0 {
		show(a.hImportToast, false)
	}
}

func (a *application) hideImportToast() {
	if a == nil {
		return
	}
	procKillTimer.Call(a.hwnd, TIMER_IMPORT_CLOSE)
	if a.hImportToast != 0 {
		show(a.hImportToast, false)
	}
}

func (a *application) recommendedWorkers(kind model.Kind, runIDs map[int64]bool) int {
	limit := config.MaxConcurrency()
	if !a.settings.AutoConcurrency {
		workers := config.NormalizeConcurrency(a.settings.Concurrency)
		if runIDs != nil && len(runIDs) > 0 && workers > len(runIDs) {
			workers = len(runIDs)
		}
		return workers
	}
	logical := config.LogicalProcessorCount()
	count := 0
	var totalSize int64
	fourK, longVideo := 0, 0
	a.mu.Lock()
	for _, t := range a.tasks {
		if t == nil || t.Kind != kind || (runIDs != nil && !runIDs[t.ID]) {
			continue
		}
		if runIDs == nil {
			switch t.Status {
			case model.StatusReady, model.StatusFailed, model.StatusCancelled:
			default:
				continue
			}
		}
		count++
		totalSize += t.InputSize
		if t.Width >= 3000 || t.Height >= 3000 {
			fourK++
		}
		if t.Duration >= 1200 {
			longVideo++
		}
	}
	a.mu.Unlock()
	if count <= 1 {
		return 1
	}
	workers := 1
	if kind == model.KindImage {
		workers = (logical + 1) / 2
		if workers < 2 {
			workers = 2
		}
	} else {
		workers = (logical + 3) / 4
		if workers < 1 {
			workers = 1
		}
		_, _, hw, _, _ := a.componentSnapshot()
		if a.settings.UseGPU && hw.Available && media.PreferGPU(a.settings.Benchmark, a.settings.Codec) {
			workers++
		}
		if fourK*2 >= count || longVideo*2 >= count {
			if workers > 2 {
				workers = 2
			}
		}
		if count > 0 && totalSize/int64(count) > 3*1024*1024*1024 && workers > 2 {
			workers = 2
		}
	}
	if workers > limit {
		workers = limit
	}
	if workers > count {
		workers = count
	}
	if workers < 1 {
		workers = 1
	}
	return workers
}

func (a *application) runEncoderBenchmark(interactive bool) {
	ffmpeg, _, hardware, _, _ := a.componentSnapshot()
	if ffmpeg == "" {
		if interactive {
			messageBox(a.hwnd, "编码器速度测试", "请先配置 FFmpeg 组件。", MB_OK|MB_ICONWARNING)
		}
		return
	}
	if !a.benchmarkRunning.CompareAndSwap(false, true) {
		if interactive {
			messageBox(a.hwnd, "编码器速度测试", "速度测试正在进行，请稍候。", MB_OK|MB_ICONINFORMATION)
		}
		return
	}
	setText(a.hStatusText, "正在进行本机编码器速度测试；测试期间请勿关闭软件…")
	go func() {
		defer a.benchmarkRunning.Store(false)
		profile := media.BenchmarkEncoders(context.Background(), ffmpeg, hardware)
		a.postUI(func() {
			a.settings.Benchmark = profile
			_ = config.Save(a.settings)
			text := fmt.Sprintf("编码器测速完成：CPU H.264 %.2fx，CPU H.265 %.2fx", profile.CPUH264X, profile.CPUH265X)
			if profile.GPUH264X > 0 || profile.GPUH265X > 0 {
				text += fmt.Sprintf("；%s H.264 %.2fx，H.265 %.2fx", valueOr(profile.GPUVendor, "GPU"), profile.GPUH264X, profile.GPUH265X)
			}
			setText(a.hStatusText, text)
			if interactive {
				messageBox(a.hwnd, "编码器速度测试", text+"\r\n\r\n自动并发与智能引擎选择将参考该结果。", MB_OK|MB_ICONINFORMATION)
			}
		})
	}()
}

func (a *application) applySmartPlan() {
	a.readSettingsFromUI()
	idxs := a.selectedTaskIndices()
	selected := map[int]bool{}
	for _, i := range idxs {
		selected[i] = true
	}
	a.mu.Lock()
	appliedVideo, appliedImage, directCopy := 0, 0, 0
	for i, t := range a.tasks {
		if t.Kind != a.currentKind {
			continue
		}
		if len(selected) > 0 && !selected[i] {
			continue
		}
		if t.IsLocked() {
			continue
		}
		opts := a.settings.EffectiveOptions(t)
		opts.FollowDefaults = false
		maxDim := t.Width
		if t.Height > maxDim {
			maxDim = t.Height
		}
		if t.Kind == model.KindVideo {
			opts.Codec = "H.265"
			opts.VolumeMode = "质量优先"
			opts.Rotation = "自动"
			switch {
			case maxDim > 3840:
				opts.Resolution = "4K"
			case maxDim > 1920:
				opts.Resolution = "1080P"
			default:
				opts.Resolution = "原尺寸"
			}
			switch a.settings.SpeedMode {
			case "极速":
				opts.Quality = "中"
			case "高质量":
				opts.Quality = "高"
			default:
				opts.Quality = "高"
			}
			if opts.Resolution == "原尺寸" && t.Rotation == 0 && (strings.EqualFold(t.VideoCodec, "hevc") || strings.EqualFold(t.VideoCodec, "h265")) {
				directCopy++
			}
			t.Options = opts
			appliedVideo++
		} else {
			if maxDim > 2560 {
				opts.ImageSize = "最大边 2560px"
			} else {
				opts.ImageSize = "保持原尺寸"
			}
			ext := strings.ToLower(filepath.Ext(t.Input))
			if ext == ".png" {
				opts.ImageFormat = "PNG"
			} else {
				opts.ImageFormat = "JPG"
			}
			if a.settings.SpeedMode == "极速" {
				opts.Quality = "中"
			} else {
				opts.Quality = "高"
			}
			t.Options = opts
			appliedImage++
		}
	}
	a.mu.Unlock()
	if appliedVideo > 0 {
		a.settings.SmartStreamCopy = true
	}
	_ = config.Save(a.settings)
	a.saveSession()
	a.refreshAll()
	msg := fmt.Sprintf("智能方案已应用：视频 %d 个，图片 %d 个", appliedVideo, appliedImage)
	if directCopy > 0 {
		msg += fmt.Sprintf("；其中 %d 个可能直接复制视频流", directCopy)
	}
	if appliedVideo+appliedImage == 0 {
		msg = "没有可应用智能方案的准备中任务"
	}
	a.showImportToast(msg)
	setText(a.hStatusText, msg)
}

func (a *application) writeRunSummary(tasks []model.Task, duration time.Duration, totalIn, totalOut int64, done, failed, skipped, cancelled int) string {
	dir, err := config.Dir()
	if err != nil {
		return ""
	}
	path := filepath.Join(dir, "last_run_summary.html")
	ratio := 0.0
	if totalIn > 0 {
		ratio = float64(totalOut) / float64(totalIn) * 100
	}
	saving := 100 - ratio
	change := fmt.Sprintf("节省 %.1f%%", saving)
	if saving < 0 {
		change = fmt.Sprintf("体积增加 %.1f%%", -saving)
	}
	failureCounts := map[string]int{}
	engineCounts := map[string]int{}
	rows := strings.Builder{}
	for _, t := range tasks {
		if t.FailureCategory != "" {
			failureCounts[t.FailureCategory]++
		}
		engine := strings.TrimSpace(t.Engine)
		if engine == "" {
			engine = "—"
		}
		engineCounts[engine]++
		tr := 0.0
		if t.InputSize > 0 {
			tr = float64(t.OutputSize) / float64(t.InputSize) * 100
		}
		fmt.Fprintf(&rows, `<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%.1f%%</td><td>%s</td><td>%s</td></tr>`,
			html.EscapeString(filepath.Base(t.Input)), html.EscapeString(string(t.Kind)), html.EscapeString(string(t.Status)), media.FormatBytes(t.InputSize), tr, media.FormatBytes(t.OutputSize), html.EscapeString(engine))
	}
	listMap := func(m map[string]int) string {
		if len(m) == 0 {
			return "无"
		}
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("%s %d", html.EscapeString(k), m[k]))
		}
		return strings.Join(parts, " · ")
	}
	doc := fmt.Sprintf(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mediova任务总结</title><style>body{font-family:"Microsoft YaHei",Arial;margin:24px;color:#17202a;background:#f6f8fb}.wrap{max-width:1280px;margin:auto}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:#fff;border:1px solid #dfe5ec;border-radius:10px;padding:14px}.value{font-size:22px;font-weight:600;margin-top:6px}.note{color:#667085}.bar{height:12px;background:#e7ebf0;border-radius:8px;overflow:hidden}.bar span{display:block;height:100%%;background:#4f7cff;width:%.2f%%}table{width:100%%;border-collapse:collapse;background:#fff;margin-top:18px}th,td{border:1px solid #dfe5ec;padding:8px;text-align:left}th{background:#eef2f7}h1{font-size:24px}.wide{margin-top:14px;background:#fff;border:1px solid #dfe5ec;border-radius:10px;padding:14px}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}}</style></head><body><div class="wrap"><h1>本次任务总结</h1><p class="note">生成时间 %s · 软件版本 v%s</p><div class="cards"><div class="card">完成<div class="value">%d</div><span class="note">失败 %d · 跳过 %d · 停止 %d</span></div><div class="card">总用时<div class="value">%s</div></div><div class="card">输入体积<div class="value">%s</div></div><div class="card">输出体积<div class="value">%s</div><span class="note">输出/原始 %.1f%% · %s</span></div></div><div class="wide"><b>总体积比例</b><div class="bar"><span></span></div><p>失败分类：%s</p><p>处理引擎：%s</p></div><table><thead><tr><th>文件</th><th>类型</th><th>状态</th><th>原始体积</th><th>输出/原始</th><th>输出体积</th><th>引擎</th></tr></thead><tbody>%s</tbody></table></div></body></html>`,
		mathMin(ratio, 100), time.Now().Format("2006-01-02 15:04:05"), appVersion, done, failed, skipped, cancelled, formatDuration(duration), media.FormatBytes(totalIn), media.FormatBytes(totalOut), ratio, change, listMap(failureCounts), listMap(engineCounts), rows.String())
	if err := os.WriteFile(path, []byte(doc), 0o644); err != nil {
		return ""
	}
	return path
}

func mathMin(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
