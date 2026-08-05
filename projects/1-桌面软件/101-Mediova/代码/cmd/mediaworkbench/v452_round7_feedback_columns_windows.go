//go:build windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
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
	current := normalizedTaskColumnWidths(a.currentTaskColumnWidths())
	round7FeedbackProfiles = round7FeedbackColumnProfiles{Version: 1}
	if a.currentKind == model.KindImage {
		round7FeedbackProfiles.Image = current
		if len(a.settings.TaskColumnWidths) == len(taskListColumns) {
			round7FeedbackProfiles.Video = normalizedTaskColumnWidths(a.settings.TaskColumnWidths)
		} else {
			round7FeedbackProfiles.Video = defaults
		}
	} else {
		round7FeedbackProfiles.Video = current
		round7FeedbackProfiles.Image = defaults
	}

	if path, err := round7FeedbackColumnProfilePath(); err == nil {
		if data, readErr := os.ReadFile(path); readErr == nil {
			var stored round7FeedbackColumnProfiles
			if json.Unmarshal(data, &stored) == nil && stored.Version == 1 {
				if len(stored.Video) == len(taskListColumns) {
					round7FeedbackProfiles.Video = normalizedTaskColumnWidths(stored.Video)
				}
				if len(stored.Image) == len(taskListColumns) {
					round7FeedbackProfiles.Image = normalizedTaskColumnWidths(stored.Image)
				}
			}
		}
	}
	round7FeedbackProfilesReady = true
}

func round7FeedbackCaptureColumnProfile(a *application, kind model.Kind, save bool) {
	if a == nil || a.hList == 0 {
		return
	}
	round7FeedbackLoadColumnProfiles(a)
	widths := normalizedTaskColumnWidths(a.currentTaskColumnWidths())
	round7FeedbackProfilesMu.Lock()
	round7FeedbackProfiles.Set(kind, widths)
	round7FeedbackProfilesMu.Unlock()
	a.settings.TaskColumnWidths = round7FeedbackCloneWidths(widths)
	if save {
		_ = config.Save(a.settings)
		round7FeedbackSaveColumnProfiles()
	}
}

func round7FeedbackApplyColumnProfile(a *application, kind model.Kind) {
	if a == nil || a.hList == 0 {
		return
	}
	round7FeedbackLoadColumnProfiles(a)
	round7FeedbackProfilesMu.Lock()
	widths := round7FeedbackProfiles.For(kind)
	round7FeedbackProfilesMu.Unlock()
	if len(widths) != len(taskListColumns) {
		widths = normalizedTaskColumnWidths(nil)
	}
	a.applyTaskColumnWidths(widths)
	a.settings.TaskColumnWidths = round7FeedbackCloneWidths(widths)
	procInvalidateRect.Call(a.hList, 0, 0)
}

func round7FeedbackSaveColumnProfiles() {
	round7FeedbackProfilesMu.Lock()
	profiles := round7FeedbackProfiles
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
