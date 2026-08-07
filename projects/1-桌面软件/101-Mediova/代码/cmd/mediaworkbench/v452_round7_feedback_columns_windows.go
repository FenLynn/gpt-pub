//go:build windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

var (
	round7FeedbackProfilesMu      sync.Mutex
	round7FeedbackProfiles        round7FeedbackColumnProfiles
	round7FeedbackProfilesReady   bool
	round7FeedbackApplyingColumns bool
)

func round7FeedbackColumnProfilePath() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ui-column-widths-v452.json"), nil
}

func round7FeedbackLoadColumnProfiles(a *application) {
	if a == nil {
		return
	}
	round7FeedbackProfilesMu.Lock()
	defer round7FeedbackProfilesMu.Unlock()
	if round7FeedbackProfilesReady {
		return
	}

	defaults := normalizedTaskColumnWidths(nil)
	video := defaults
	// The legacy single array is migration input only. It is never written
	// again, so image and video cannot leak widths through Settings.
	if len(a.settings.TaskColumnWidths) == len(taskListColumns) {
		video = normalizedTaskColumnWidths(a.settings.TaskColumnWidths)
	}
	round7FeedbackProfiles = round7FeedbackColumnProfiles{
		Version: 2,
		Video:   round7FeedbackCloneWidths(video),
		Image:   round7FeedbackCloneWidths(defaults),
	}

	if path, err := round7FeedbackColumnProfilePath(); err == nil {
		if data, readErr := os.ReadFile(path); readErr == nil {
			var stored round7FeedbackColumnProfiles
			if json.Unmarshal(data, &stored) == nil && (stored.Version == 1 || stored.Version == 2) {
				if len(stored.Video) == len(taskListColumns) {
					round7FeedbackProfiles.Video = normalizedTaskColumnWidths(stored.Video)
				}
				if len(stored.Image) == len(taskListColumns) {
					round7FeedbackProfiles.Image = normalizedTaskColumnWidths(stored.Image)
				}
			}
		}
	}
	round7FeedbackProfiles.Version = 2
	round7FeedbackProfilesReady = true
}

func round7FeedbackCurrentWidths(a *application) []int {
	if a == nil || a.hList == 0 {
		return nil
	}
	return normalizedTaskColumnWidths(a.currentTaskColumnWidths())
}

// Round12 owns the final 15-column model, including per-media visibility and
// widths. Once it is installed, the round7 13-column profile must become
// read-only legacy state; otherwise its delayed switch finalizer can overwrite
// a hidden Round12 column after switching video -> image -> video.
func round7FeedbackColumnsRetired() bool {
	return round12SelectionInstalled.Load()
}

func round7FeedbackCaptureColumnProfile(a *application, kind model.Kind, save bool) {
	if a == nil || a.hList == 0 || round7FeedbackApplyingColumns || round7FeedbackColumnsRetired() {
		return
	}
	round7FeedbackLoadColumnProfiles(a)
	widths := round7FeedbackCurrentWidths(a)
	if len(widths) != len(taskListColumns) {
		return
	}
	round7FeedbackProfilesMu.Lock()
	before := round7FeedbackProfiles.For(kind)
	if !round7FeedbackEqualWidths(before, widths) {
		round7FeedbackProfiles.Set(kind, widths)
	}
	changed := !round7FeedbackEqualWidths(before, widths)
	round7FeedbackProfilesMu.Unlock()
	if save && changed {
		round7FeedbackSaveColumnProfiles()
	}
}

func round7FeedbackProfileFor(a *application, kind model.Kind) []int {
	round7FeedbackLoadColumnProfiles(a)
	round7FeedbackProfilesMu.Lock()
	widths := round7FeedbackProfiles.For(kind)
	round7FeedbackProfilesMu.Unlock()
	if len(widths) != len(taskListColumns) {
		return normalizedTaskColumnWidths(nil)
	}
	return normalizedTaskColumnWidths(widths)
}

func round7FeedbackApplyColumnProfile(a *application, kind model.Kind) {
	if a == nil || a.hList == 0 || round7FeedbackColumnsRetired() {
		return
	}
	widths := round7FeedbackProfileFor(a, kind)
	if round7FeedbackEqualWidths(round7FeedbackCurrentWidths(a), widths) {
		return
	}
	round7FeedbackApplyingColumns = true
	a.applyTaskColumnWidths(widths)
	round7FeedbackApplyingColumns = false
	procInvalidateRect.Call(a.hList, 0, 0)
}

func round7FeedbackEnsureColumnProfile(a *application) {
	if a == nil || round7FeedbackColumnsRetired() {
		return
	}
	round7FeedbackApplyColumnProfile(a, a.currentKind)
}

func round7FeedbackResetColumnProfile(a *application, kind model.Kind) {
	if a == nil || round7FeedbackColumnsRetired() {
		return
	}
	defaults := normalizedTaskColumnWidths(nil)
	round7FeedbackLoadColumnProfiles(a)
	round7FeedbackProfilesMu.Lock()
	round7FeedbackProfiles.Set(kind, defaults)
	round7FeedbackProfilesMu.Unlock()
	round7FeedbackApplyColumnProfile(a, kind)
	round7FeedbackSaveColumnProfiles()
}

func round7FeedbackSaveColumnProfiles() {
	round7FeedbackProfilesMu.Lock()
	profiles := round7FeedbackProfiles
	profiles.Version = 2
	profiles.Video = round7FeedbackCloneWidths(profiles.Video)
	profiles.Image = round7FeedbackCloneWidths(profiles.Image)
	round7FeedbackProfilesMu.Unlock()

	path, err := round7FeedbackColumnProfilePath()
	if err != nil {
		return
	}
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return
	}
	data = append(data, '\n')
	tmp := path + ".tmp"
	bak := path + ".bak"
	if err = os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Remove(bak)
	if _, statErr := os.Stat(path); statErr == nil {
		if err = os.Rename(path, bak); err != nil {
			_ = os.Remove(tmp)
			return
		}
	}
	if err = os.Rename(tmp, path); err != nil {
		_ = os.Rename(bak, path)
		_ = os.Remove(tmp)
		return
	}
	_ = os.Remove(bak)
}
