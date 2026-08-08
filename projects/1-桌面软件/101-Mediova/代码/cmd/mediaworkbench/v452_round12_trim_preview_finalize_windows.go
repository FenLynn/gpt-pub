//go:build windows

package main

// Retired compatibility shim. Final editor installation no longer reorders
// competing preview subclasses because preview recovery is sequence-driven.
func round12FinalizeExclusiveTrimPreviewOwner(e *round7Editor) {}
