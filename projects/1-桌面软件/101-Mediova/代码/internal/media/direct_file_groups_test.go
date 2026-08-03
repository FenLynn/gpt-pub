package media

import (
	"path/filepath"
	"testing"
)

func TestGroupDirectMediaFilesKeepsCommonTopFolder(t *testing.T) {
	base := t.TempDir()
	first := filepath.Join(base, "素材", "视频", "a.mp4")
	second := filepath.Join(base, "素材", "图片", "b.jpg")

	groups := GroupDirectMediaFiles([]string{first, second})
	if len(groups) != 1 {
		t.Fatalf("groups=%d want=1: %#v", len(groups), groups)
	}
	group := groups[0]
	if group.Root != base {
		t.Fatalf("root=%q want=%q", group.Root, base)
	}
	if group.OutputPrefix != "" {
		t.Fatalf("single-volume prefix=%q want empty", group.OutputPrefix)
	}
	if len(group.Paths) != 2 || group.Paths[0] != first || group.Paths[1] != second {
		t.Fatalf("paths were not retained in input order: %#v", group.Paths)
	}
}

func TestGroupDirectMediaFilesSingleFileRetainsParentFolder(t *testing.T) {
	base := t.TempDir()
	file := filepath.Join(base, "旅行", "clip.mov")
	groups := GroupDirectMediaFiles([]string{file})
	if len(groups) != 1 {
		t.Fatalf("groups=%d want=1", len(groups))
	}
	if groups[0].Root != base {
		t.Fatalf("root=%q want=%q", groups[0].Root, base)
	}
}

func TestGroupDirectMediaFilesSeparatesWindowsVolumes(t *testing.T) {
	values := []string{
		`C:\用户\素材\同名\a.mp4`,
		`C:\用户\素材\同名\子目录\b.jpg`,
		`D:\归档\同名\a.mp4`,
	}
	groups := GroupDirectMediaFiles(values)
	if len(groups) != 2 {
		t.Fatalf("groups=%d want=2: %#v", len(groups), groups)
	}
	if groups[0].Root != `C:\用户\素材` || groups[0].OutputPrefix != "C盘" || len(groups[0].Paths) != 2 {
		t.Fatalf("unexpected C group: %#v", groups[0])
	}
	if groups[1].Root != `D:\归档` || groups[1].OutputPrefix != "D盘" || len(groups[1].Paths) != 1 {
		t.Fatalf("unexpected D group: %#v", groups[1])
	}
}

func TestGroupDirectMediaFilesSeparatesUNCShares(t *testing.T) {
	values := []string{
		`\\server-a\media\同名\a.mp4`,
		`\\server-b\media\同名\a.mp4`,
	}
	groups := GroupDirectMediaFiles(values)
	if len(groups) != 2 {
		t.Fatalf("groups=%d want=2: %#v", len(groups), groups)
	}
	if groups[0].OutputPrefix != "server-a_media" || groups[1].OutputPrefix != "server-b_media" {
		t.Fatalf("unexpected UNC prefixes: %#v", groups)
	}
}

func TestGroupDirectMediaFilesIgnoresBlankValues(t *testing.T) {
	groups := GroupDirectMediaFiles([]string{"", "   "})
	if len(groups) != 0 {
		t.Fatalf("blank input produced groups: %#v", groups)
	}
}
