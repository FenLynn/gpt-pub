package main

import (
	"os"
	"strings"
	"testing"
)

func TestV440ImageCropSourceContracts(t *testing.T) {
	trim, err := os.ReadFile("trim_dialog_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	s := string(trim)
	for _, want := range []string{"task.Kind == model.KindImage", "Kind: d.task.Kind", "图片画面裁剪", "拍摄时间与文件时间"} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing image crop contract %q", want)
		}
	}
}
