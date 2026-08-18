//go:build windows

package main

import "os"

type transientEnvironmentValue struct {
	value   string
	present bool
}

// isolateTransientRunData prevents native self-tests and UI screenshot modes
// from ever loading or saving the interactive user's configuration, session,
// history, thumbnails or output-directory history.
func isolateTransientRunData(enabled bool) func() {
	if !enabled {
		return func() {}
	}
	root, err := os.MkdirTemp("", "Mediova-isolated-run-")
	if err != nil {
		return func() {}
	}
	keys := []string{
		"APPDATA",
		"LOCALAPPDATA",
		"XDG_CONFIG_HOME",
		"MEDIOVA_PORTABLE",
		"MEDIAWORKBENCH_PORTABLE",
	}
	saved := make(map[string]transientEnvironmentValue, len(keys))
	for _, key := range keys {
		value, present := os.LookupEnv(key)
		saved[key] = transientEnvironmentValue{value: value, present: present}
	}
	_ = os.Setenv("APPDATA", root)
	_ = os.Setenv("LOCALAPPDATA", root)
	_ = os.Setenv("XDG_CONFIG_HOME", root)
	_ = os.Setenv("MEDIOVA_PORTABLE", "0")
	_ = os.Setenv("MEDIAWORKBENCH_PORTABLE", "0")
	return func() {
		for _, key := range keys {
			previous := saved[key]
			if previous.present {
				_ = os.Setenv(key, previous.value)
			} else {
				_ = os.Unsetenv(key)
			}
		}
		_ = os.RemoveAll(root)
	}
}
