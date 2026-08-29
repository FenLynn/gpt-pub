package media

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

var stagedOutputSequence atomic.Uint64

// PreflightInput catches the common instant-failure cases before a task enters
// the shared worker queue. It intentionally reads only one byte; full media
// validation remains the responsibility of ffprobe/WIC and the converter.
func PreflightInput(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("输入路径为空")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("无法访问输入文件: %w", err)
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return fmt.Errorf("输入不是普通文件")
	}
	if info.Size() <= 0 {
		return fmt.Errorf("输入文件为空")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("输入文件不可读: %w", err)
	}
	defer file.Close()
	var one [1]byte
	if _, err := file.Read(one[:]); err != nil && err != io.EOF {
		return fmt.Errorf("读取输入文件失败: %w", err)
	}
	return nil
}

// PreflightOutputDirectory verifies the exact output volume and ACL with a
// tiny disposable file. This avoids queuing hundreds of tasks that will all
// fail immediately for the same missing drive or permission problem.
func PreflightOutputDirectory(root string) error {
	root = strings.TrimSpace(root)
	if root == "" {
		return fmt.Errorf("输出母目录为空")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return fmt.Errorf("无法创建输出目录: %w", err)
	}
	file, err := os.CreateTemp(root, ".mediova-write-test-*")
	if err != nil {
		return fmt.Errorf("输出目录不可写: %w", err)
	}
	name := file.Name()
	if _, err = file.Write([]byte{0}); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	_ = os.Remove(name)
	if err != nil {
		return fmt.Errorf("输出目录写入测试失败: %w", err)
	}
	if closeErr != nil {
		return fmt.Errorf("输出目录关闭测试失败: %w", closeErr)
	}
	return nil
}

// StagedOutputPath stays on the final output volume and keeps the media
// extension so FFmpeg selects the same muxer. A process crash can therefore
// never leave a partial file at the user-visible final name.
func StagedOutputPath(final string) string {
	dir := filepath.Dir(final)
	ext := filepath.Ext(final)
	if ext == "" {
		ext = ".tmp"
	}
	sequence := stagedOutputSequence.Add(1)
	return filepath.Join(dir, fmt.Sprintf(".mediova-part-%d-%d-%d%s", os.Getpid(), time.Now().UnixNano(), sequence, ext))
}

// CommitStagedOutput publishes a verified staged file. The normal automatic-
// numbering path is a same-volume atomic rename. Overwrite mode falls back to
// the existing durable replacement helper only when a destination exists.
func CommitStagedOutput(staged, final string) error {
	if FileSize(staged) <= 0 {
		return fmt.Errorf("暂存输出为空")
	}
	if _, err := os.Stat(final); os.IsNotExist(err) {
		if err := os.Rename(staged, final); err != nil {
			return fmt.Errorf("提交输出失败: %w", err)
		}
		return nil
	}
	if err := replaceFile(staged, final); err != nil {
		return fmt.Errorf("替换正式输出失败: %w", err)
	}
	return nil
}

// CleanupStagedOutputs removes only Mediova-owned crash leftovers. A 24-hour
// age gate at call sites protects any currently running conversion, and the
// scan is limited to the exact output directory being used.
func CleanupStagedOutputs(dir string, olderThan time.Duration) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-olderThan)
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), ".mediova-part-") {
			continue
		}
		if olderThan > 0 {
			info, infoErr := entry.Info()
			if infoErr != nil || info.ModTime().After(cutoff) {
				continue
			}
		}
		if os.Remove(filepath.Join(dir, entry.Name())) == nil {
			removed++
		}
	}
	return removed
}
