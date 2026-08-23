package media

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"mediaworkbench/internal/model"
)

func TestAudioCompatibilityPlanSkipsApplePositionalAudio(t *testing.T) {
	settings := model.DefaultSettings()
	settings.AudioMode = "AAC 192k"
	req := ConvertRequest{
		Kind:     model.KindVideo,
		Settings: settings,
		Probe: ProbeInfo{
			HasAudio:     true,
			AudioStreams: 3,
			AudioDetails: []StreamInfo{
				{Index: 1, Codec: "aac", Default: true},
				{Index: 2, Codec: "apple_apac"},
				{Index: 3, Codec: "alac"},
			},
		},
	}
	wantMap := []string{"-map", "0:1?", "-map", "0:3?"}
	if got := audioMapArgs(req); !reflect.DeepEqual(got, wantMap) {
		t.Fatalf("audio map = %#v, want %#v", got, wantMap)
	}
	if got := expectedAudioStreams(req); got != 2 {
		t.Fatalf("expected audio streams = %d, want 2", got)
	}
	if got := skippedAudioStreams(req); got != 1 {
		t.Fatalf("skipped audio streams = %d, want 1", got)
	}
	if got := streamCompatibilityLabel(req); !strings.Contains(got, "跳过1条不兼容音轨") {
		t.Fatalf("compatibility label = %q", got)
	}
}

func TestAudioCompatibilityPlanHandlesOnlyUnsupportedTrack(t *testing.T) {
	settings := model.DefaultSettings()
	req := ConvertRequest{
		Kind:     model.KindVideo,
		Settings: settings,
		Probe: ProbeInfo{
			HasAudio:     true,
			AudioStreams: 1,
			AudioDetails: []StreamInfo{{Index: 4, Codec: "apple_apac"}},
		},
	}
	if got := audioMapArgs(req); len(got) != 0 {
		t.Fatalf("unsupported-only map = %#v, want none", got)
	}
	if got := audioCodecArgs(req); !reflect.DeepEqual(got, []string{"-an"}) {
		t.Fatalf("unsupported-only codec args = %#v", got)
	}
}

func TestAudioCompatibilityPlanKeepsLegacyProbeBehavior(t *testing.T) {
	settings := model.DefaultSettings()
	req := ConvertRequest{
		Kind:     model.KindVideo,
		Settings: settings,
		Probe:    ProbeInfo{HasAudio: true, AudioStreams: 2},
	}
	if got := audioMapArgs(req); !reflect.DeepEqual(got, []string{"-map", "0:a?"}) {
		t.Fatalf("legacy audio map = %#v", got)
	}
	if got := expectedAudioStreams(req); got != 2 {
		t.Fatalf("legacy expected audio streams = %d", got)
	}
}

func TestClassifyUnsupportedDecoderFailure(t *testing.T) {
	for _, message := range []string{
		"Decoder not found",
		"Error while opening decoder for input stream #0:2",
		"codec apple_apac is not currently supported",
	} {
		if got := ClassifyFailure(errors.New(message)); got != "输入编码不受支持" {
			t.Fatalf("ClassifyFailure(%q) = %q", message, got)
		}
	}
}
