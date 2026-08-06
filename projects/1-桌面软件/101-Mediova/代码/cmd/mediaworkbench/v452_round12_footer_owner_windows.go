//go:build windows

package main

// Round 12 makes application.layout the only owner of the bottom action row.
// The legacy round-7 footer path derived its geometry from the status control's
// transitional rectangle after the primary layout had already started. That
// second pass could move Start/Pause/Stop to a stale row during resize, right
// panel toggles or video/image switches. Keeping the legacy re-entry guard
// permanently closed retires that second owner without changing its visual
// drawing helpers.
func init() {
	round7FeedbackInLayout = true
}
