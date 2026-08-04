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
	root, prefix := DecodeRootContext(group.Root)
	if root != base {
		t.Fatalf("root=%q want=%q", root, base)
	}
	if prefix != "" || group.OutputPrefix != "" {
		t.Fatalf("single-volume prefixes root=%q group=%q", prefix, group.OutputPrefix)
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
	root, prefix := DecodeRootContext(groups[0].Root)
	if root != base || prefix != "" {
		t.Fatalf("root=%q prefix=%q want root=%q", root, prefix, base)
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
	cRoot, cPrefix := DecodeRootContext(groups[0].Root)
	dRoot, dPrefix := DecodeRootContext(groups[1].Root)
	if cRoot != `C:\用户\素材` || cPrefix != "C盘" || groups[0].OutputPrefix != "C盘" || len(groups[0].Paths) != 2 {
		t.Fatalf("unexpected C group: %#v decoded=%q/%q", groups[0], cRoot, cPrefix)
	}
	if dRoot != `D:\归档` || dPrefix != "D盘" || groups[1].OutputPrefix != "D盘" || len(groups[1].Paths) != 1 {
		t.Fatalf("unexpected D group: %#v decoded=%q/%q", groups[1], dRoot, dPrefix)
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
	_, firstPrefix := DecodeRootContext(groups[0].Root)
	_, secondPrefix := DecodeRootContext(groups[1].Root)
	if groups[0].OutputPrefix != "server-a_media" || groups[1].OutputPrefix != "server-b_media" ||
		firstPrefix != "server-a_media" || secondPrefix != "server-b_media" {
		t.Fatalf("unexpected UNC prefixes: %#v decoded=%q/%q", groups, firstPrefix, secondPrefix)
	}
}

func TestGroupDirectMediaFilesIgnoresBlankValues(t *testing.T) {
	groups := GroupDirectMediaFiles([]string{"", "   "})
	if len(groups) != 0 {
		t.Fatalf("blank input produced groups: %#v", groups)
	}
}
