//go:build windows

package main

// The final Round8/Round11 editor installer is the deterministic lifecycle
// point for Round12 preview ownership: the Round7 editor exists, its canvas and
// timeline are created, and inherited editor subclasses are already installed.
// Installing the sequence watcher here removes the separate asynchronous
// WinEvent/fallback discovery race.
func round12FinalizeExclusiveTrimPreviewOwner(e *round7Editor) {
	round12InstallTrimPreviewWatcher(e)
}
