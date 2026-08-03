package config

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func historyFixture(t *testing.T, label string) []byte {
	t.Helper()
	data, err := json.Marshal([]map[string]any{{"input": label, "result": "完成"}})
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func sessionFixture(t *testing.T, id int) []byte {
	t.Helper()
	data := []byte(`{"schema":1,"saved_at":"2026-08-03T00:00:00Z","clean_exit":false,"tasks":[{"id":` +
		strconv.Itoa(id) + `,"input":"a.mp4"}]}`)
	if !validSessionSnapshot(data) {
		t.Fatalf("invalid session fixture: %s", data)
	}
	return data
}

func TestPrepareHistorySnapshotRefreshesLastGood(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.json")
	want := historyFixture(t, "primary")
	if err := os.WriteFile(path, want, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := prepareHistorySnapshot(path)
	if err != nil || result.Source != "primary" || result.Notice != "" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	got, err := os.ReadFile(path + ".lastgood")
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("lastgood=%q err=%v", got, err)
	}
}

func TestPrepareHistorySnapshotRestoresLastGoodAndPreservesCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.json")
	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	want := historyFixture(t, "lastgood")
	if err := os.WriteFile(path+".lastgood", want, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := prepareHistorySnapshot(path)
	if err != nil || result.Source != "lastgood" || !strings.Contains(result.Notice, "已从有效副本恢复") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("restored=%q err=%v", got, err)
	}
	corrupt, err := os.ReadFile(path + ".corrupt")
	if err != nil || string(corrupt) != "{broken" {
		t.Fatalf("corrupt=%q err=%v", corrupt, err)
	}
}

func TestPrepareHistorySnapshotQuarantinesWithoutFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.json")
	if err := os.WriteFile(path, []byte("not-json"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := prepareHistorySnapshot(path)
	if err != nil || result.Source != "quarantined" || !strings.Contains(result.Notice, "从空历史继续") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("active corrupt history remains: %v", err)
	}
	if got, err := os.ReadFile(path + ".corrupt"); err != nil || string(got) != "not-json" {
		t.Fatalf("quarantined=%q err=%v", got, err)
	}
}

func TestPrepareSessionSnapshotRestoresTemporaryAndPreservesCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	want := sessionFixture(t, 42)
	if err := os.WriteFile(path+".tmp", want, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := prepareSessionSnapshot(path)
	if err != nil || result.Source != "temporary" || !strings.Contains(result.Notice, "已从有效快照恢复") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("restored=%q err=%v", got, err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("temporary snapshot not consumed: %v", err)
	}
	if got, err := os.ReadFile(path + ".corrupt"); err != nil || string(got) != "{broken" {
		t.Fatalf("corrupt=%q err=%v", got, err)
	}
}

func TestPreparePersistentSnapshotsKeepsConfigIndependent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	configBytes := []byte(`{"output_dir":"D:\\out","restore_session":true}`)
	if err := os.WriteFile(configPath, configBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "session.json"), []byte("{bad-session"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "history.json"), []byte("{bad-history"), 0o644); err != nil {
		t.Fatal(err)
	}

	notices := preparePersistentSnapshots(dir)
	if len(notices) != 2 {
		t.Fatalf("notices=%v", notices)
	}
	gotConfig, err := os.ReadFile(configPath)
	if err != nil || !bytes.Equal(gotConfig, configBytes) {
		t.Fatalf("config changed=%q err=%v", gotConfig, err)
	}
	for _, name := range []string{"session.json", "history.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("%s active corrupt file remains: %v", name, err)
		}
		if _, err := os.Stat(filepath.Join(dir, name+".corrupt")); err != nil {
			t.Fatalf("%s corrupt evidence missing: %v", name, err)
		}
	}
}
