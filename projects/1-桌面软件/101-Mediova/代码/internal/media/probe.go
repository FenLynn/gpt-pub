package media

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"mediaworkbench/internal/model"
)

type StreamInfo struct {
	Index        int
	Codec        string
	Language     string
	Title        string
	Default      bool
	Forced       bool
	TextSubtitle bool
}

type ProbeInfo struct {
	Width             int
	Height            int
	Rotation          int
	Duration          float64
	FPS               float64
	BitrateKbps       int
	HasAudio          bool
	VideoCodec        string
	AudioCodec        string
	AudioStreams      int
	AudioBitrateKbps  int
	SubtitleCodec     string
	SubtitleStreams   int
	TextSubtitles     int
	BitmapSubtitles   int
	AudioDetails      []StreamInfo
	SubtitleDetails   []StreamInfo
	VariableFrameRate bool
	NominalFPS        float64
	PixelFormat       string
	ColorSpace        string
	ColorTransfer     string
	ColorPrimaries    string
	HDRInfo           string
	Location          *model.GeoLocation
	CaptureTime       string
}

type ffprobeResult struct {
	Streams []struct {
		Index          int               `json:"index"`
		CodecType      string            `json:"codec_type"`
		CodecName      string            `json:"codec_name"`
		Width          int               `json:"width"`
		Height         int               `json:"height"`
		Duration       string            `json:"duration"`
		BitRate        string            `json:"bit_rate"`
		AvgFPS         string            `json:"avg_frame_rate"`
		RFrameRate     string            `json:"r_frame_rate"`
		PixelFormat    string            `json:"pix_fmt"`
		ColorSpace     string            `json:"color_space"`
		ColorTransfer  string            `json:"color_transfer"`
		ColorPrimaries string            `json:"color_primaries"`
		Tags           map[string]string `json:"tags"`
		Disposition    struct {
			Default int `json:"default"`
			Forced  int `json:"forced"`
		} `json:"disposition"`
		SideData []struct {
			Rotation int `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
	Format struct {
		Duration string            `json:"duration"`
		BitRate  string            `json:"bit_rate"`
		Tags     map[string]string `json:"tags"`
	} `json:"format"`
}

func Probe(ffprobePath, input string) (ProbeInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return ProbeContext(ctx, ffprobePath, input)
}

// ProbeContext reads media metadata with a caller-controlled deadline. A broken
// or incomplete media file must never leave an ffprobe process hanging forever.
func ProbeContext(ctx context.Context, ffprobePath, input string) (ProbeInfo, error) {
	if strings.TrimSpace(ffprobePath) == "" {
		return ProbeInfo{}, fmt.Errorf("ffprobe path is empty")
	}
	if strings.TrimSpace(input) == "" {
		return ProbeInfo{}, fmt.Errorf("input path is empty")
	}
	cmd := exec.CommandContext(ctx, ffprobePath, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", input)
	configureCommand(cmd)
	b, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return ProbeInfo{}, fmt.Errorf("ffprobe timed out: %w", ctx.Err())
		}
		return ProbeInfo{}, fmt.Errorf("ffprobe failed: %w", err)
	}
	var r ffprobeResult
	if err := json.Unmarshal(b, &r); err != nil {
		return ProbeInfo{}, err
	}
	var p ProbeInfo
	for _, s := range r.Streams {
		switch s.CodecType {
		case "video":
			if p.Width != 0 {
				continue
			}
			p.Width, p.Height, p.VideoCodec = s.Width, s.Height, s.CodecName
			p.PixelFormat, p.ColorSpace, p.ColorTransfer, p.ColorPrimaries = s.PixelFormat, s.ColorSpace, s.ColorTransfer, s.ColorPrimaries
			for _, sd := range s.SideData {
				if sd.Rotation != 0 {
					p.Rotation = normalizeRotation(sd.Rotation)
				}
			}
			if p.Rotation == 0 && s.Tags != nil {
				if raw := s.Tags["rotate"]; raw != "" {
					if n, e := strconv.Atoi(strings.TrimSpace(raw)); e == nil {
						p.Rotation = normalizeRotation(n)
					}
				}
			}
			if s.Duration != "" {
				p.Duration, _ = strconv.ParseFloat(s.Duration, 64)
			}
			avgFPS := parseRate(s.AvgFPS)
			nominalFPS := parseRate(s.RFrameRate)
			p.FPS = avgFPS
			if p.FPS <= 0 {
				p.FPS = nominalFPS
			}
			p.NominalFPS = nominalFPS
			p.VariableFrameRate = isVariableFrameRate(avgFPS, nominalFPS)
			if n, e := strconv.Atoi(s.BitRate); e == nil {
				p.BitrateKbps = n / 1000
			}
		case "audio":
			p.HasAudio = true
			p.AudioStreams++
			info := streamInfoFromProbe(s.Index, s.CodecName, s.Tags, s.Disposition.Default != 0, s.Disposition.Forced != 0, false)
			p.AudioDetails = append(p.AudioDetails, info)
			if p.AudioCodec == "" {
				p.AudioCodec = s.CodecName
				if n, e := strconv.Atoi(s.BitRate); e == nil {
					p.AudioBitrateKbps = n / 1000
				}
			}
		case "subtitle":
			p.SubtitleStreams++
			text := isTextSubtitleCodec(s.CodecName)
			info := streamInfoFromProbe(s.Index, s.CodecName, s.Tags, s.Disposition.Default != 0, s.Disposition.Forced != 0, text)
			p.SubtitleDetails = append(p.SubtitleDetails, info)
			if text {
				p.TextSubtitles++
			} else {
				p.BitmapSubtitles++
			}
			if p.SubtitleCodec == "" {
				p.SubtitleCodec = s.CodecName
			}
		}
	}
	if p.Duration <= 0 {
		p.Duration, _ = strconv.ParseFloat(r.Format.Duration, 64)
	}
	if p.BitrateKbps <= 0 {
		if n, e := strconv.Atoi(r.Format.BitRate); e == nil {
			p.BitrateKbps = n / 1000
		}
	}
	p.HDRInfo = detectHDR(p.ColorTransfer, p.ColorPrimaries, p.PixelFormat)
	if p.Width <= 0 || p.Height <= 0 {
		p.Location, p.CaptureTime = locationFromTags(r.Format.Tags)

		return p, fmt.Errorf("未检测到视频画面")
	}
	return p, nil
}

func streamInfoFromProbe(index int, codec string, tags map[string]string, def, forced, text bool) StreamInfo {
	info := StreamInfo{Index: index, Codec: codec, Default: def, Forced: forced, TextSubtitle: text}
	if tags != nil {
		info.Language = strings.TrimSpace(tags["language"])
		info.Title = strings.TrimSpace(tags["title"])
	}
	return info
}

func isTextSubtitleCodec(codec string) bool {
	switch strings.ToLower(strings.TrimSpace(codec)) {
	case "subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text", "ttml":
		return true
	default:
		return false
	}
}

func isVariableFrameRate(avg, nominal float64) bool {
	if avg <= 0 || nominal <= 0 {
		return false
	}
	d := avg - nominal
	if d < 0 {
		d = -d
	}
	base := nominal
	if avg > base {
		base = avg
	}
	return base > 0 && d/base > 0.02
}

func parseRate(s string) float64 {
	parts := strings.Split(strings.TrimSpace(s), "/")
	if len(parts) == 2 {
		a, _ := strconv.ParseFloat(parts[0], 64)
		b, _ := strconv.ParseFloat(parts[1], 64)
		if b != 0 {
			return a / b
		}
	}
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func normalizeRotation(v int) int {
	v %= 360
	if v < 0 {
		v += 360
	}
	return v
}

func detectHDR(transfer, primaries, pixFmt string) string {
	t := strings.ToLower(strings.TrimSpace(transfer))
	p := strings.ToLower(strings.TrimSpace(primaries))
	f := strings.ToLower(strings.TrimSpace(pixFmt))
	switch t {
	case "smpte2084":
		return "HDR10 / PQ"
	case "arib-std-b67":
		return "HLG"
	}
	if strings.Contains(p, "bt2020") && (strings.Contains(f, "10") || strings.Contains(f, "12")) {
		return "BT.2020 广色域 / 高位深"
	}
	return "SDR 或未标记"
}
