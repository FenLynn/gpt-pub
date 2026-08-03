//go:build windows

package main

import (
	"time"

	"mediaworkbench/internal/config"
)

func init() {
	notice := normalizeStartupConfigNotice(config.StartupConfigNotice())
	if notice == "" {
		return
	}
	go func() {
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			current := app
			if current != nil && current.hStatusText != 0 {
				time.Sleep(350 * time.Millisecond)
				current.postUI(func() {
					if current.hStatusText == 0 {
						return
					}
					current.runtimeNotice = notice
					setText(current.hStatusText, notice)
				})
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()
}
