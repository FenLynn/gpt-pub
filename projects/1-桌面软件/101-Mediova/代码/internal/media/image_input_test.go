package media

import (
	"errors"
	"strings"
	"testing"
)

func TestModernImageExtensions(t *testing.T) {
	for _, name := range []string{"a.HEIC", "b.heif", "c.AvIf"} {
		if !IsModernImageInput(name) {
			t.Fatalf("modern image extension not detected: %s", name)
		}
	}
	if IsModernImageInput("a.jpg") {
		t.Fatal("jpg must not use modern-image preflight")
	}
}

func TestModernImageFailureMessage(t *testing.T) {
	err := ExplainModernImageFailure("IMG_0001.HEIC", errors.New("decoder missing"))
	for _, want := range []string{"HEIC", "Windows HEIF", "源文件未被修改", "decoder missing"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("missing failure detail %q: %v", want, err)
		}
	}
}

func TestModernImageFailureCategory(t *testing.T) {
	if got := ClassifyFailure(ExplainModernImageFailure("IMG_0001.HEIC", errors.New("decoder missing"))); got != "HEIC/HEIF 解码不可用" {
		t.Fatalf("modern image category=%q", got)
	}
}
