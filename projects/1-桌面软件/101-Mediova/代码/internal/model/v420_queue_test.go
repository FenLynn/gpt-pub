package model

import "testing"

func TestOutputDirectoriesAreIndependentByKind(t *testing.T) {
	s := DefaultSettings()
	s.SetOutputDirFor(KindVideo, `D:\VideoOut`)
	s.SetOutputDirFor(KindImage, `E:\ImageOut`)

	if got := s.OutputDirFor(KindVideo); got != `D:\VideoOut` {
		t.Fatalf("video output dir = %q", got)
	}
	if got := s.OutputDirFor(KindImage); got != `E:\ImageOut` {
		t.Fatalf("image output dir = %q", got)
	}
}

func TestImageOutputFallsBackToLegacyOutputDir(t *testing.T) {
	s := DefaultSettings()
	s.OutputDir = `D:\LegacyOut`
	if got := s.OutputDirFor(KindImage); got != `D:\LegacyOut` {
		t.Fatalf("image fallback output dir = %q", got)
	}
}

func TestDefaultOptionsAreExplicitPerKind(t *testing.T) {
	s := DefaultSettings()
	video := s.DefaultOptions(KindVideo)
	image := s.DefaultOptions(KindImage)

	if video.FollowDefaults || image.FollowDefaults {
		t.Fatal("v4.2.0 defaults must be materialised, not live references")
	}
	if video.Resolution != s.Resolution || video.Codec != s.Codec || video.Quality != s.Quality {
		t.Fatalf("unexpected video defaults: %+v", video)
	}
	if image.ImageSize != s.ImageSize || image.ImageFormat != s.ImageFormat || image.Quality != s.ImageQuality {
		t.Fatalf("unexpected image defaults: %+v", image)
	}
}

func TestQueueSnapshotOverridesMutableDefaults(t *testing.T) {
	s := DefaultSettings()
	task := &Task{
		Kind:    KindVideo,
		Status:  StatusQueued,
		Options: TaskOptions{Resolution: "1080P", Codec: "H.265", Quality: "高"},
		Queue: &QueueSnapshot{
			Options: TaskOptions{Resolution: "4K", Codec: "H.264", Quality: "中"},
		},
	}

	s.Resolution = "720P"
	got := s.EffectiveOptions(task)
	if got.Resolution != "4K" || got.Codec != "H.264" || got.Quality != "中" {
		t.Fatalf("queued snapshot was not authoritative: %+v", got)
	}
}

func TestTaskStateCapabilities(t *testing.T) {
	cases := []struct {
		status   Status
		editable bool
		locked   bool
		holdable bool
	}{
		{StatusReady, true, false, false},
		{StatusQueued, false, true, true},
		{StatusProcessing, false, true, true},
		{StatusPaused, false, true, false},
		{StatusHeld, false, true, false},
		{StatusDone, false, false, false},
	}
	for _, tc := range cases {
		task := &Task{Status: tc.status}
		if got := task.IsReadyEditable(); got != tc.editable {
			t.Errorf("%s editable = %v", tc.status, got)
		}
		if got := task.IsLocked(); got != tc.locked {
			t.Errorf("%s locked = %v", tc.status, got)
		}
		if got := task.CanHoldForEdit(); got != tc.holdable {
			t.Errorf("%s holdable = %v", tc.status, got)
		}
	}
}
