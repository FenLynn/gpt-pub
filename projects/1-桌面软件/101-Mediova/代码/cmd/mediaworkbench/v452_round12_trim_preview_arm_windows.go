//go:build windows

package main

import (
	"sync"
	"sync/atomic"
	"time"
)

var round12ExclusiveTrimPreviewBootstrap sync.Map

// round12ArmExclusiveTrimPreviewOwner is the only Round12 pre-editor arm path.
// It disables the legacy guard hook before the inherited handler creates the
// modal editor, ensures the exclusive owner hook is live, then uses a bounded
// UI-thread fallback to attach once the editor exists. The first attachment
// always starts one owner-controlled preview request, invalidating any legacy
// initial worker by advancing previewSeq.
func round12ArmExclusiveTrimPreviewOwner() {
	// The legacy Round12 watcher is no longer allowed to enter the editor open
	// lifecycle. Its old bounded fallback loop is therefore never started by
	// the current Round12 command path.
	round12TrimPreviewHookMu.Lock()
	if round12TrimPreviewEventHook != 0 {
		round12UnhookWinEvent.Call(round12TrimPreviewEventHook)
		round12TrimPreviewEventHook = 0
	}
	round12TrimPreviewHookMu.Unlock()

	// The exclusive event hook is normally installed from init, but make this
	// arm self-sufficient if it was unavailable during early process startup.
	round12TrimPreviewOwnerHookMu.Lock()
	if round12TrimPreviewOwnerHook == 0 {
		hook, _, _ := round12SetWinEventHook.Call(
			round12EventObjectCreate,
			round12EventObjectShow,
			0,
			round12TrimPreviewOwnerEventCB,
			0,
			0,
			round12WinEventOutOfContext,
		)
		round12TrimPreviewOwnerHook = hook
	}
	round12TrimPreviewOwnerHookMu.Unlock()

	a := app
	if a == nil {
		return
	}
	done := &atomic.Bool{}
	go func() {
		for attempt := 0; attempt < 240 && !done.Load(); attempt++ {
			a.postUI(func() {
				if done.Load() {
					return
				}
				e := round7ActiveEditor
				if e == nil || e.hwnd == 0 || e.dialog == nil || e.dialog.hCanvas == 0 || e.dialog.task == nil {
					return
				}
				round12InstallExclusiveTrimPreviewOwner(e)
				value, ok := round12TrimPreviewOwnerStates.Load(e.hwnd)
				if !ok {
					return
				}
				state := value.(*round12TrimPreviewOwnerState)
				previous, loaded := round12ExclusiveTrimPreviewBootstrap.Load(e.hwnd)
				if !loaded || previous != state {
					round12ExclusiveTrimPreviewBootstrap.Store(e.hwnd, state)
					// Always take ownership of the first visible frame. This advances
					// previewSeq, so any inherited initial worker can no longer install.
					round12RequestExclusiveTrimPreview(e, state)
				}
				done.Store(true)
			})
			time.Sleep(50 * time.Millisecond)
		}
	}()
}
