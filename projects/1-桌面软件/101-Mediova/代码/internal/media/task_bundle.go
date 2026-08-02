package media

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

const taskBundleFormat = "mediaworkbench-task-bundle-v1"

type TaskBundle struct {
	Format     string        `json:"format"`
	AppVersion string        `json:"app_version"`
	SavedAt    time.Time     `json:"saved_at"`
	Kind       model.Kind    `json:"kind"`
	Tasks      []*model.Task `json:"tasks"`
}

func WriteTaskBundle(path, appVersion string, kind model.Kind, tasks []*model.Task) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("任务队列导出路径为空")
	}
	bundle := TaskBundle{Format: taskBundleFormat, AppVersion: appVersion, SavedAt: time.Now(), Kind: kind, Tasks: tasks}
	b, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func ReadTaskBundle(path string) (TaskBundle, error) {
	var bundle TaskBundle
	b, err := os.ReadFile(path)
	if err != nil {
		return bundle, err
	}
	if err := json.Unmarshal(b, &bundle); err != nil {
		return bundle, errors.New("任务队列 JSON 无法解析: " + err.Error())
	}
	if bundle.Format != taskBundleFormat {
		return bundle, errors.New("不是受支持的任务队列 JSON")
	}
	if len(bundle.Tasks) == 0 {
		return bundle, errors.New("任务队列 JSON 中没有任务")
	}
	return bundle, nil
}

func PrepareImportedTasks(tasks []*model.Task, existing map[string]bool, nextID func() int64) (prepared []*model.Task, duplicates, missing int) {
	if existing == nil {
		existing = map[string]bool{}
	}
	for _, item := range tasks {
		if item == nil || strings.TrimSpace(item.Input) == "" {
			continue
		}
		input := filepath.Clean(item.Input)
		key := strings.ToLower(input)
		if existing[key] {
			duplicates++
			continue
		}
		if st, err := os.Stat(input); err != nil || st.IsDir() {
			missing++
			continue
		}
		kind, ok := DetectKind(input)
		if !ok {
			continue
		}
		cp := *item
		cp.ID = nextID()
		cp.Input = input
		cp.Kind = kind
		cp.Status = model.StatusReady
		cp.Progress = 0
		cp.OutputPath = ""
		cp.OutputSize = 0
		cp.Error = ""
		cp.FailureCategory = ""
		cp.ValidationWarning = ""
		cp.Engine = ""
		cp.StartedAt = time.Time{}
		cp.FinishedAt = time.Time{}
		cp.ThumbnailIndex = -1
		cp.InputSize = FileSize(input)
		existing[key] = true
		prepared = append(prepared, &cp)
	}
	return prepared, duplicates, missing
}
