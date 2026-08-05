//go:build windows

package main

// Round 10 positioned both scroll-cover windows after every list WM_PAINT,
// which created a repaint feedback loop. Round 11 is the sole geometry owner;
// this compatibility entry remains only for older call sites and is strictly
// idempotent.
func round10CoverNativeScrollAreas(a *application) {
	round11EnsureStableScrollGeometry(a)
}
