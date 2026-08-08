//go:build windows

package main

// Compatibility entry retained for the Round12 selection owner. Preview
// ownership is installed synchronously by the final Round8/Round11 editor
// installer once the Round7 canvas and timeline are fully created. Arming the
// main-window command no longer starts a second WinEvent/fallback discovery
// path, eliminating nondeterministic watcher installation timing.
func round12ArmExclusiveTrimPreviewOwner() {}
