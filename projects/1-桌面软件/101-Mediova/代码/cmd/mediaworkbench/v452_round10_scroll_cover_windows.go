//go:build windows

package main

// Round 10 previously repositioned both cover windows from the list drawing
// path and created a feedback loop. Round 11 is the sole cached layout owner;
// this compatibility entry remains only for older call sites and is strictly
// idempotent.
func round10CoverNativeScrollAreas(a *application) {
	round11EnsureStableScrollGeometry(a)
}
