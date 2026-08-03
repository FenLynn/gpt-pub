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
				current.postUI(func() {
					current.runtimeNotice = notice
				})
				for attempt := 0; attempt < 32; attempt++ {
					result := make(chan bool, 1)
					current.postUI(func() {
						if current.hStatusText == 0 {
							result <- false
							return
						}
						if startupStatusAllowsConfigNotice(getText(current.hStatusText)) {
							setText(current.hStatusText, notice)
							result <- true
							return
						}
						result <- false
					})
					select {
					case displayed := <-result:
						if displayed {
							return
						}
					case <-time.After(600 * time.Millisecond):
					}
					time.Sleep(250 * time.Millisecond)
				}
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()
}
