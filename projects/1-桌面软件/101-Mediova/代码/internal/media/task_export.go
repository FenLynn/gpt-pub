package media

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"mediaworkbench/internal/model"
)

// ExportTasksCSV writes a UTF-8 BOM CSV that can be opened directly by Excel.
// The caller supplies task snapshots so the export never holds the UI task lock.
func ExportTasksCSV(path string, tasks []model.Task, settings model.Settings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		_ = f.Close()
		if !ok {
			_ = os.Remove(path)
		}
	}()
	if _, err = f.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return err
	}
	w := csv.NewWriter(f)
	header := []string{"序号", "类型", "文件名", "源路径", "输出路径", "状态", "进度", "源分辨率", "输出规格", "编码/格式", "质量", "旋转", "源体积", "输出体积", "压缩后比例", "引擎", "错误/警告", "开始时间", "完成时间"}
	if err = w.Write(header); err != nil {
		return err
	}
	for i := range tasks {
		t := &tasks[i]
		opts := settings.EffectiveOptions(t)
		kind := "视频"
		outputSpec := opts.Resolution
		codec := opts.Codec
		if t.Kind == model.KindImage {
			kind = "图片"
			outputSpec = opts.ImageSize
			codec = opts.ImageFormat
		}
		ratio := ""
		if t.InputSize > 0 && t.OutputSize > 0 {
			ratio = fmt.Sprintf("%.1f%%", float64(t.OutputSize)/float64(t.InputSize)*100)
		}
		problem := t.Error
		if t.ValidationWarning != "" {
			if problem != "" {
				problem += "；"
			}
			problem += t.ValidationWarning
		}
		row := []string{
			strconv.Itoa(i + 1), kind, filepath.Base(t.Input), t.Input, t.OutputPath,
			string(t.Status), fmt.Sprintf("%.1f%%", t.Progress), fmt.Sprintf("%d×%d", t.Width, t.Height),
			outputSpec, codec, opts.Quality, opts.Rotation, FormatBytes(t.InputSize), FormatBytes(t.OutputSize), ratio,
			t.Engine, problem, formatTaskTime(t.StartedAt), formatTaskTime(t.FinishedAt),
		}
		if err = w.Write(row); err != nil {
			return err
		}
	}
	w.Flush()
	if err = w.Error(); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	ok = true
	return nil
}

func formatTaskTime(v time.Time) string {
	if v.IsZero() {
		return ""
	}
	return v.Local().Format("2006-01-02 15:04:05")
}
