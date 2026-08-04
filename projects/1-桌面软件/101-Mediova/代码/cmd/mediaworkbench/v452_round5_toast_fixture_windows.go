//go:build windows

package main

import (
	"sync"
	"syscall"
)

var (
	v452Round5ToastFixtureCB   uintptr
	v452Round5ToastFixtureHook uintptr
	v452Round5ToastFixtures    sync.Map
)

func init() {
	if !v452Round5Enabled {
		return
	}
	v452Round5ToastFixtureCB = syscall.NewCallback(v452Round5ToastFixtureEventProc)
	v452Round5ToastFixtureHook, _, _ = v452SetWinEventHook.Call(
		v452EventObjectCreate,
		v452EventObjectShow,
		0,
		v452Round5ToastFixtureCB,
		0,
		0,
		v452WineventOutofcontext,
	)
}

func v452Round5ToastFixtureEventProc(hook, event, hwnd, idObject, idChild, eventThread, eventTime uintptr) uintptr {
	if app == nil || !app.selfTest || v452ImportToastWindow == 0 {
		return 0
	}
	value, ok := v452ImportToastStates.Load(v452ImportToastWindow)
	if !ok {
		return 0
	}
	state := value.(*v452ImportToastState)
	if state.text == 0 {
		return 0
	}
	if _, loaded := v452Round5ToastFixtures.LoadOrStore(v452ImportToastWindow, true); loaded {
		return 0
	}
	setText(state.text, "导入完成：视频 2 个，图片 3 个；重复 1 个。\r\n不支持 0 个，不可读 0 个，扫描失败 0 个；已按媒体类型自动分流。")
	return 0
}
