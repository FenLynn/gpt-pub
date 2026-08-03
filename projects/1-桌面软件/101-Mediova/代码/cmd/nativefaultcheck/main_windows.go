//go:build windows

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const (
	genericRead  = 0x80000000
	genericWrite = 0x40000000
	openExisting = 3
)

var (
	kernel32Fault = syscall.NewLazyDLL("kernel32.dll")
	createFileW   = kernel32Fault.NewProc("CreateFileW")
	closeHandle   = kernel32Fault.NewProc("CloseHandle")
)

type report struct {
	Mode   string            `json:"mode"`
	Passed bool              `json:"passed"`
	Checks map[string]bool   `json:"checks"`
	Detail map[string]string `json:"detail,omitempty"`
}

func main() {
	mode := flag.String("mode", "core", "core, disk-prepare or disk-probe")
	root := flag.String("root", "", "isolated test root")
	reportPath := flag.String("report", "", "optional JSON report path")
	flag.Parse()

	r := report{Mode: *mode, Passed: true, Checks: map[string]bool{}, Detail: map[string]string{}}
	var err error
	switch *mode {
	case "core":
		err = runCore(*root, &r)
	case "disk-prepare":
		err = runDiskPrepare(*root, &r)
	case "disk-probe":
		err = runDiskProbe(*root, &r)
	default:
		err = fmt.Errorf("unknown mode %q", *mode)
	}
	if err != nil {
		r.Passed = false
		r.Detail["error"] = err.Error()
	}
	for _, ok := range r.Checks {
		if !ok {
			r.Passed = false
		}
	}
	data, _ := json.MarshalIndent(r, "", "  ")
	fmt.Println(string(data))
	if strings.TrimSpace(*reportPath) != "" {
		_ = os.MkdirAll(filepath.Dir(*reportPath), 0o755)
		_ = os.WriteFile(*reportPath, data, 0o644)
	}
	if !r.Passed {
		os.Exit(1)
	}
}

func cleanEnv() {
	_ = os.Setenv("MEDIOVA_PORTABLE", "0")
	_ = os.Setenv("MEDIAWORKBENCH_PORTABLE", "0")
	_ = os.Unsetenv("MEDIOVA_STANDARD_DATA_DIR")
	_ = os.Unsetenv("MEDIOVA_PORTABLE_DATA_DIR")
}

func setDataRoot(root string) error {
	if strings.TrimSpace(root) == "" {
		return errors.New("test root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	cleanEnv()
	_ = os.Setenv("APPDATA", filepath.Join(root, "Roaming"))
	_ = os.Setenv("LOCALAPPDATA", filepath.Join(root, "Local"))
	_ = os.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "Xdg"))
	return nil
}

func settingsWithOutput(value string) model.Settings {
	s := model.DefaultSettings()
	s.OutputDir = value
	s.ImageOutputDir = value
	return s
}

func openExclusive(path string) (uintptr, error) {
	pointer, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	handle, _, callErr := createFileW.Call(
		uintptr(unsafe.Pointer(pointer)),
		genericRead|genericWrite,
		0,
		0,
		openExisting,
		0,
		0,
	)
	if handle == ^uintptr(0) || handle == 0 {
		if callErr == nil || callErr == syscall.Errno(0) {
			callErr = errors.New("CreateFileW failed")
		}
		return 0, callErr
	}
	return handle, nil
}

func runCore(root string, r *report) error {
	if err := setDataRoot(root); err != nil {
		return err
	}
	if err := os.RemoveAll(root); err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}

	baseline := settingsWithOutput("native-baseline")
	if err := config.Save(baseline); err != nil {
		return fmt.Errorf("baseline save: %w", err)
	}
	path, err := config.Path()
	if err != nil {
		return err
	}
	before, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	handle, err := openExclusive(path)
	if err != nil {
		return fmt.Errorf("exclusive lock: %w", err)
	}
	lockedErr := config.Save(settingsWithOutput("locked-change"))
	closeHandle.Call(handle)
	afterLocked, readErr := os.ReadFile(path)
	r.Checks["exclusive_lock_returns_error"] = lockedErr != nil
	r.Checks["exclusive_lock_preserves_primary"] = readErr == nil && bytes.Equal(before, afterLocked)
	if lockedErr == nil || readErr != nil || !bytes.Equal(before, afterLocked) {
		return errors.New("exclusive lock did not preserve the primary config")
	}
	if err := config.Save(settingsWithOutput("lock-recovered")); err != nil {
		return fmt.Errorf("save after lock release: %w", err)
	}
	r.Checks["exclusive_lock_recovery"] = config.Load().OutputDir == "lock-recovered"

	dataDir, err := config.Dir()
	if err != nil {
		return err
	}
	identity := strings.TrimSpace(os.Getenv("USERNAME"))
	if identity == "" {
		return errors.New("USERNAME is empty")
	}
	denyArg := identity + ":(OI)(CI)(W,M)"
	denyOut, denyErr := exec.Command("icacls", dataDir, "/deny", denyArg).CombinedOutput()
	if denyErr != nil {
		return fmt.Errorf("icacls deny failed: %v: %s", denyErr, strings.TrimSpace(string(denyOut)))
	}
	aclBefore, _ := os.ReadFile(path)
	aclSaveErr := config.Save(settingsWithOutput("acl-change"))
	aclAfter, aclReadErr := os.ReadFile(path)
	restoreOut, restoreErr := exec.Command("icacls", dataDir, "/remove:d", identity).CombinedOutput()
	if restoreErr != nil {
		return fmt.Errorf("icacls restore failed: %v: %s", restoreErr, strings.TrimSpace(string(restoreOut)))
	}
	r.Checks["ntfs_acl_denial_returns_error"] = aclSaveErr != nil
	r.Checks["ntfs_acl_denial_preserves_primary"] = aclReadErr == nil && bytes.Equal(aclBefore, aclAfter)
	if aclSaveErr == nil || aclReadErr != nil || !bytes.Equal(aclBefore, aclAfter) {
		return errors.New("NTFS ACL denial did not preserve the primary config")
	}
	if err := config.Save(settingsWithOutput("acl-recovered")); err != nil {
		return fmt.Errorf("save after ACL restore: %w", err)
	}
	r.Checks["ntfs_acl_recovery"] = config.Load().OutputDir == "acl-recovered"

	blocked := filepath.Join(root, "blocked-parent")
	if err := os.WriteFile(blocked, []byte("ordinary file"), 0o644); err != nil {
		return err
	}
	_ = os.Setenv("APPDATA", blocked)
	blockedErr := config.Save(settingsWithOutput("blocked-root"))
	r.Checks["ordinary_file_root_returns_error"] = blockedErr != nil
	if blockedErr == nil {
		return errors.New("ordinary-file data root unexpectedly accepted a save")
	}

	standard := filepath.Join(root, "portable-standard")
	portable := filepath.Join(root, "portable-target")
	_ = os.Setenv("MEDIOVA_STANDARD_DATA_DIR", standard)
	_ = os.Setenv("MEDIOVA_PORTABLE_DATA_DIR", portable)
	if err := os.MkdirAll(standard, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(portable, 0o755); err != nil {
		return err
	}
	currentJSON, _ := json.MarshalIndent(settingsWithOutput("portable-current"), "", "  ")
	oldJSON, _ := json.MarshalIndent(settingsWithOutput("portable-old"), "", "  ")
	if err := os.WriteFile(filepath.Join(standard, "config.json"), currentJSON, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(portable, "config.json"), oldJSON, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(portable, "unmanaged.keep"), []byte("keep"), 0o644); err != nil {
		return err
	}
	result, err := config.PreparePortableModeSwitch(true, settingsWithOutput("portable-current"), time.Now())
	if err != nil {
		return fmt.Errorf("portable transition: %w", err)
	}
	var migrated model.Settings
	migratedBytes, readErr := os.ReadFile(filepath.Join(portable, "config.json"))
	if readErr == nil {
		readErr = json.Unmarshal(migratedBytes, &migrated)
	}
	_, unmanagedErr := os.Stat(filepath.Join(portable, "unmanaged.keep"))
	_, backupErr := os.Stat(result.BackupDir)
	r.Checks["portable_current_data_wins"] = readErr == nil && migrated.OutputDir == "portable-current"
	r.Checks["portable_old_data_backed_up"] = result.BackupDir != "" && backupErr == nil
	r.Checks["portable_unmanaged_file_preserved"] = unmanagedErr == nil
	if !r.Checks["portable_current_data_wins"] || !r.Checks["portable_old_data_backed_up"] || !r.Checks["portable_unmanaged_file_preserved"] {
		return errors.New("portable transition authority check failed")
	}
	return nil
}

func runDiskPrepare(root string, r *report) error {
	if err := setDataRoot(root); err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if err := config.Save(settingsWithOutput("disk-baseline")); err != nil {
		return fmt.Errorf("disk baseline save: %w", err)
	}
	r.Checks["disk_baseline_saved"] = config.Load().OutputDir == "disk-baseline"
	return nil
}

func runDiskProbe(root string, r *report) error {
	if err := setDataRoot(root); err != nil {
		return err
	}
	path, err := config.Path()
	if err != nil {
		return err
	}
	before, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	saveErr := config.Save(settingsWithOutput("disk-full-change"))
	after, readErr := os.ReadFile(path)
	r.Checks["disk_full_returns_error"] = saveErr != nil
	r.Checks["disk_full_preserves_primary"] = readErr == nil && bytes.Equal(before, after)
	if saveErr == nil {
		return errors.New("disk-full probe unexpectedly saved")
	}
	if readErr != nil || !bytes.Equal(before, after) {
		return errors.New("disk-full probe changed the primary config")
	}
	return nil
}
