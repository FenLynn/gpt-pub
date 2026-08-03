package main

import (
	"path/filepath"
	"strings"

	"mediaworkbench/internal/model"
)

const (
	taskColNumber = iota
	taskColFile
	taskColResolution
	taskColDuration
	taskColDirection
	taskColOutputResolution
	taskColQuality
	taskColRotation
	taskColInputSize
	taskColOutputSize
	taskColProgress
	taskColStatus
	taskColumnCount
)

type taskColumnDefinition struct {
	name  string
	width int
}

var v452TaskListColumns = []taskColumnDefinition{
	{"#", 48},
	{"文件 / 预览", 280},
	{"分辨率", 100},
	{"时长", 76},
	{"方向", 70},
	{"输出分辨率", 116},
	{"质量", 58},
	{"旋转", 90},
	{"体积", 92},
	{"压缩后", 140},
	{"进度", 105},
	{"状态", 124},
}

func v452NormalizedColumnWidths(widths []int) []int {
	source := append([]int(nil), widths...)
	// v4.2.1 stored ten columns without duration or number.
	if len(source) == 10 {
		migrated := make([]int, 0, 11)
		migrated = append(migrated, source[:2]...)
		migrated = append(migrated, 76)
		migrated = append(migrated, source[2:]...)
		source = migrated
	}
	// v4.2.2-v4.5.1 stored eleven columns without the visual row number.
	if len(source) == 11 {
		source = append([]int{v452TaskListColumns[taskColNumber].width}, source...)
	}
	result := make([]int, taskColumnCount)
	for i, column := range v452TaskListColumns {
		minimum := 45
		if i == taskColNumber {
			minimum = 32
		}
		width := column.width
		if i < len(source) && source[i] >= minimum && source[i] <= 900 {
			width = source[i]
		}
		result[i] = width
	}
	return result
}

type directoryFallback struct {
	LastInputDir       string
	LastImageInputDir  string
	LastOutputDir      string
	LastImageOutputDir string
	OutputDir          string
	ImageOutputDir     string
}

func v452ResolveTaskDirectory(tasks []*model.Task, selectedIDs map[int64]bool, kind model.Kind, output bool, fallback directoryFallback) string {
	var selected, last *model.Task
	for _, task := range tasks {
		if task == nil || task.Kind != kind {
			continue
		}
		last = task
		if selectedIDs[task.ID] {
			selected = task
		}
	}
	chosen := selected
	if chosen == nil {
		chosen = last
	}
	if chosen != nil {
		if output {
			if path := strings.TrimSpace(chosen.OutputPath); path != "" {
				return filepath.Dir(path)
			}
			if chosen.Queue != nil {
				if path := strings.TrimSpace(chosen.Queue.OutputPath); path != "" {
					return filepath.Dir(path)
				}
				if root := strings.TrimSpace(chosen.Queue.OutputRoot); root != "" {
					return filepath.Clean(root)
				}
			}
		} else if path := strings.TrimSpace(chosen.Input); path != "" {
			return filepath.Dir(path)
		}
	}
	if output {
		if kind == model.KindImage {
			for _, value := range []string{fallback.LastImageOutputDir, fallback.ImageOutputDir, fallback.LastOutputDir, fallback.OutputDir} {
				if value = strings.TrimSpace(value); value != "" {
					return filepath.Clean(value)
				}
			}
		} else {
			for _, value := range []string{fallback.LastOutputDir, fallback.OutputDir} {
				if value = strings.TrimSpace(value); value != "" {
					return filepath.Clean(value)
				}
			}
		}
		return ""
	}
	if kind == model.KindImage {
		for _, value := range []string{fallback.LastImageInputDir, fallback.LastInputDir} {
			if value = strings.TrimSpace(value); value != "" {
				return filepath.Clean(value)
			}
		}
	} else if value := strings.TrimSpace(fallback.LastInputDir); value != "" {
		return filepath.Clean(value)
	}
	return ""
}
