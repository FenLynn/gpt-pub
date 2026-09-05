//go:build windows

package main

import "mediaworkbench/internal/model"

// The final Round8/Round11 editor installer is the deterministic lifecycle
// point for Round12 preview ownership: the Round7 editor exists, its canvas and
// timeline are created, and inherited editor subclasses are already installed.
//
// A real imported video can become selectable before its asynchronous probe has
// populated Duration/dimensions. Never keep a zero-duration editor alive: all
// time navigation would legally clamp to zero and make the preview look stale.
// Close that transient editor immediately and let the main task finish probing;
// the next trim request will use the populated task snapshot.
func round12FinalizeExclusiveTrimPreviewOwner(e *round7Editor) {
	if e == nil || e.dialog == nil || e.dialog.task == nil {
		return
	}
	task := e.dialog.task
	if task.Kind == model.KindVideo && (task.Duration <= 0 || task.Width < 2 || task.Height < 2) {
		if e.owner != nil && e.owner.hStatusText != 0 {
			setText(e.owner.hStatusText, "媒体信息读取中，完成后即可剪裁。")
		}
		e.close(false, false)
		return
	}
	// UI polish is installed at the same deterministic final-editor point so
	// navigation buttons never flash between native and owner-drawn states.
	round12InstallEditorPolish(e)
	round12InstallTrimPreviewWatcher(e)
}
