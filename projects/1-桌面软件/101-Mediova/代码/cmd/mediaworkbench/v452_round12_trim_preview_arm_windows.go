//go:build windows

package main

// Compatibility entry retained for the Round12 selection owner. Navigation is
// no longer intercepted by an exclusive subclass owner; arming now installs
// the sequence-driven recovery watcher, leaving Round7 as the single input
// owner for jump/buttons/keyboard/timeline.
func round12ArmExclusiveTrimPreviewOwner() {
	round12ArmTrimPreviewHook()
}
