package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const resilienceModernConfig = `{"output_dir":"D:\\out","codec":"H.264","quality":"高"}`

func TestPrepareInstalledConfigLeavesFreshInstallUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Mediova", "config.json")
	source, err := prepareInstalledConfig(path)
	if err != nil || source != "" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	for _, candidate := range []string{path, path + ".bak", path + installedConfigLastGoodSuffix} {
		if _, err := os.Stat(candidate); !os.IsNotExist(err) {
			t.Fatalf("fresh install created %s: %v", candidate, err)
		}
	}
}

func TestPrepareInstalledConfigRefreshesLastGood(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(resilienceModernConfig), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := prepareInstalledConfig(path)
	if err != nil || source != "primary" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	got, err := os.ReadFile(path + installedConfigLastGoodSuffix)
	if err != nil || string(got) != resilienceModernConfig {
		t.Fatalf("lastgood=%q err=%v", got, err)
	}
}

func TestPrepareInstalledConfigRestoresBackupAndPreservesCorruptPrimary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", []byte(resilienceModernConfig), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := prepareInstalledConfig(path)
	if err != nil || source != "backup" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != resilienceModernConfig {
		t.Fatalf("restored=%q", got)
	}
	corrupt, err := os.ReadFile(path + ".corrupt")
	if err != nil || string(corrupt) != "{broken" {
		t.Fatalf("corrupt=%q err=%v", corrupt, err)
	}
}

func TestPrepareInstalledConfigFallsBackToLastGood(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path+".bak", []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+installedConfigLastGoodSuffix, []byte(resilienceModernConfig), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := prepareInstalledConfig(path)
	if err != nil || source != "lastgood" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != resilienceModernConfig {
		t.Fatalf("restored=%q", got)
	}
}

func TestPrepareInstalledConfigNeverReplacesValidPrimary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	primary := `{"output_dir":"D:\\primary"}`
	backup := `{"output_dir":"D:\\backup"}`
	if err := os.WriteFile(path, []byte(primary), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", []byte(backup), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := prepareInstalledConfig(path)
	if err != nil || source != "primary" {
		t.Fatalf("source=%q err=%v", source, err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != primary {
		t.Fatalf("primary overwritten: %q", got)
	}
}

func TestPrepareInstalledConfigReportsUnrecoverableCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", []byte("not-json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+installedConfigLastGoodSuffix, []byte("[]"), 0o644); err != nil {
		t.Fatal(err)
	}
	source, err := prepareInstalledConfig(path)
	if source != "" || err == nil || !strings.Contains(err.Error(), "no valid recovery") {
		t.Fatalf("source=%q err=%v", source, err)
	}
	if got, _ := os.ReadFile(path); string(got) != "{broken" {
		t.Fatalf("unrecoverable primary changed: %q", got)
	}
}
