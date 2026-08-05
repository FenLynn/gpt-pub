//go:build windows

package main

// The editor now has one layout owner only. Keep this compatibility function
// for native tests and older call sites, but delegate directly to the unified
// feedback editor layout instead of installing another WinEvent hook.
func round7ApplyCompactEditorLayout(e *round7Editor) {
	round7FeedbackApplyEditorLayout(e)
}
