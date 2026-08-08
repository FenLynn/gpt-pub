//go:build windows

package main

// Retired compatibility shim. Round12 no longer owns trim navigation through
// a competing SetWindowSubclass chain. The sequence-driven watcher observes
// trimDialog.previewSeq instead, so this hook intentionally does nothing.
func round12InstallExclusiveTrimPreviewOwner(e *round7Editor) {}
