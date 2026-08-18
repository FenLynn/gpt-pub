package model

import "time"

type Kind string

const (
	KindVideo Kind = "video"
	KindImage Kind = "image"
)

type Status string

const (
	StatusReady      Status = "准备中"
	StatusQueued     Status = "队列中"
	StatusProcessing Status = "转换中"
	StatusPaused     Status = "暂停"
	StatusHeld       Status = "搁置·待修改"
	StatusDone       Status = "完成"
	StatusFailed     Status = "失败"
	StatusSkipped    Status = "已跳过"
	StatusCancelled  Status = "已停止"
)

type Crop struct {
	Enabled bool `json:"enabled"`
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Width   int  `json:"width"`
	Height  int  `json:"height"`
}

type TaskOptions struct {
	// FollowDefaults is retained for v4.1.x session/config compatibility. v4.2.0
	// materialises explicit options on every ready task; new queue logic must not
	// depend on this flag as a live reference to mutable global settings.
	FollowDefaults bool    `json:"follow_defaults"`
	Resolution     string  `json:"resolution"`
	Codec          string  `json:"codec"`
	Quality        string  `json:"quality"`
	VolumeMode     string  `json:"volume_mode"`
	TargetSizeMB   int     `json:"target_size_mb"`
	BitrateMbps    float64 `json:"bitrate_mbps"`
	Rotation       string  `json:"rotation"`
	TrimStart      float64 `json:"trim_start"`
	TrimEnd        float64 `json:"trim_end"`
	Crop           Crop    `json:"crop"`
	ImageFormat    string  `json:"image_format"`
	ImageSize      string  `json:"image_size"`
	ImageLimit     string  `json:"image_limit"`
}

type QueueSnapshot struct {
	Options        TaskOptions `json:"options"`
	OutputRoot     string      `json:"output_root"`
	OutputPath     string      `json:"output_path"`
	ConflictPolicy string      `json:"conflict_policy"`
	QueuedAt       time.Time   `json:"queued_at"`
	Sequence       int64       `json:"sequence"`
}

type HoldState struct {
	FromStatus   Status         `json:"from_status"`
	Original     TaskOptions    `json:"original_options"`
	Queue        *QueueSnapshot `json:"queue_snapshot,omitempty"`
	ReservedSlot bool           `json:"reserved_slot"`
	HeldAt       time.Time      `json:"held_at"`
}

type Task struct {
	ID                    int64          `json:"id"`
	Input                 string         `json:"input"`
	Root                  string         `json:"root"`
	Kind                  Kind           `json:"kind"`
	Width                 int            `json:"width"`
	Height                int            `json:"height"`
	Rotation              int            `json:"rotation_tag"`
	Duration              float64        `json:"duration"`
	FPS                   float64        `json:"fps"`
	BitrateKbps           int            `json:"bitrate_kbps"`
	VideoCodec            string         `json:"video_codec,omitempty"`
	AudioCodec            string         `json:"audio_codec,omitempty"`
	AudioStreams          int            `json:"audio_streams,omitempty"`
	AudioBitrateKbps      int            `json:"audio_bitrate_kbps,omitempty"`
	SubtitleStreams       int            `json:"subtitle_streams,omitempty"`
	TextSubtitleStreams   int            `json:"text_subtitle_streams,omitempty"`
	BitmapSubtitleStreams int            `json:"bitmap_subtitle_streams,omitempty"`
	VariableFrameRate     bool           `json:"variable_frame_rate,omitempty"`
	HDRInfo               string         `json:"hdr_info,omitempty"`
	InputSize             int64          `json:"input_size"`
	OutputPath            string         `json:"output_path"`
	OutputSize            int64          `json:"output_size"`
	Status                Status         `json:"status"`
	Progress              float64        `json:"progress"`
	Error                 string         `json:"error"`
	FailureCategory       string         `json:"failure_category,omitempty"`
	ValidationWarning     string         `json:"validation_warning,omitempty"`
	Engine                string         `json:"engine"`
	Pinned                bool           `json:"pinned"`
	ThumbnailIndex        int            `json:"-"`
	Options               TaskOptions    `json:"options"`
	Queue                 *QueueSnapshot `json:"queue_snapshot,omitempty"`
	Hold                  *HoldState     `json:"hold_state,omitempty"`
	StartedAt             time.Time      `json:"started_at"`
	FinishedAt            time.Time      `json:"finished_at"`
}

func (t *Task) IsReadyEditable() bool {
	return t != nil && t.Status == StatusReady
}

func (t *Task) IsLocked() bool {
	if t == nil {
		return false
	}
	switch t.Status {
	case StatusQueued, StatusProcessing, StatusPaused, StatusHeld:
		return true
	default:
		return false
	}
}

func (t *Task) CanHoldForEdit() bool {
	return t != nil && (t.Status == StatusQueued || t.Status == StatusProcessing || t.Status == StatusPaused)
}

func (t *Task) CanRemoveSafely() bool {
	if t == nil {
		return false
	}
	switch t.Status {
	case StatusReady, StatusQueued, StatusProcessing, StatusPaused, StatusHeld,
		StatusDone, StatusFailed, StatusSkipped, StatusCancelled:
		return true
	default:
		return false
	}
}

type BenchmarkProfile struct {
	TestedAt   string  `json:"tested_at,omitempty"`
	CPUH264X   float64 `json:"cpu_h264_x,omitempty"`
	CPUH265X   float64 `json:"cpu_h265_x,omitempty"`
	GPUH264X   float64 `json:"gpu_h264_x,omitempty"`
	GPUH265X   float64 `json:"gpu_h265_x,omitempty"`
	GPUVendor  string  `json:"gpu_vendor,omitempty"`
	FFmpegPath string  `json:"ffmpeg_path,omitempty"`
}

type Preset struct {
	Resolution   string  `json:"resolution"`
	Codec        string  `json:"codec"`
	Quality      string  `json:"quality"`
	VolumeMode   string  `json:"volume_mode"`
	TargetSizeMB int     `json:"target_size_mb"`
	BitrateMbps  float64 `json:"bitrate_mbps"`
	Rotation     string  `json:"rotation"`
}

type Settings struct {
	OutputDir              string           `json:"output_dir"`
	ImageOutputDir         string           `json:"image_output_dir,omitempty"`
	RecentOutputDirs       []string         `json:"recent_output_dirs,omitempty"`
	RecentImageOutputDirs  []string         `json:"recent_image_output_dirs,omitempty"`
	Resolution             string           `json:"resolution"`
	Codec                  string           `json:"codec"`
	Quality                string           `json:"quality"`
	VolumeMode             string           `json:"volume_mode"`
	TargetSizeMB           int              `json:"target_size_mb"`
	BitrateMbps            float64          `json:"bitrate_mbps"`
	Rotation               string           `json:"rotation"`
	IncludeSubdirs         bool             `json:"include_subdirs"`
	Concurrency            int              `json:"concurrency"`
	AutoConcurrency        bool             `json:"auto_concurrency"`
	SmartEngine            bool             `json:"smart_engine"`
	SpeedMode              string           `json:"speed_mode"`
	InterfaceMode          string           `json:"interface_mode"`
	ShowPerformanceStats   bool             `json:"show_performance_stats"`
	RightPanelVisible      bool             `json:"right_panel_visible"`
	UILayoutRevision       int              `json:"ui_layout_revision"`
	TaskColumnWidths       []int            `json:"task_column_widths,omitempty"`
	AutoBenchmark          bool             `json:"auto_benchmark"`
	Benchmark              BenchmarkProfile `json:"benchmark"`
	FFmpegPath             string           `json:"ffmpeg_path"`
	PlayerPath             string           `json:"player_path"`
	AutoDetectPlayer       bool             `json:"auto_detect_player"`
	UseGPU                 bool             `json:"use_gpu"`
	GPUFallback            bool             `json:"gpu_fallback"`
	ExactTargetSize        bool             `json:"exact_target_size"`
	ClearMetadata          bool             `json:"clear_metadata"`
	AllowUpscale           bool             `json:"allow_upscale"`
	PreserveTimes          bool             `json:"preserve_times"`
	FilenameMode           string           `json:"filename_mode"`
	ConflictPolicy         string           `json:"conflict_policy"`
	SaveHistory            bool             `json:"save_history"`
	RestoreSession         bool             `json:"restore_session"`
	NotifyOnDone           bool             `json:"notify_on_done"`
	ShowFloatingBar        bool             `json:"show_floating_bar"`
	FloatingTopmost        bool             `json:"floating_topmost"`
	FloatingPositionSet    bool             `json:"floating_position_set"`
	FloatingX              int              `json:"floating_x"`
	FloatingY              int              `json:"floating_y"`
	CompletionToastSeconds int              `json:"completion_toast_seconds"`
	VerifyOutput           bool             `json:"verify_output"`
	ThumbnailCache         bool             `json:"thumbnail_cache"`
	EstimateDiskSpace      bool             `json:"estimate_disk_space"`
	SmartStreamCopy        bool             `json:"smart_stream_copy"`
	AudioMode              string           `json:"audio_mode"`
	SubtitleMode           string           `json:"subtitle_mode"`
	OpenOutputOnDone       bool             `json:"open_output_on_done"`
	ImageFormat            string           `json:"image_format"`
	ImageSize              string           `json:"image_size"`
	ImageQuality           string           `json:"image_quality"`
	ImageLimit             string           `json:"image_limit"`
	LastInputDir           string           `json:"last_input_dir"`
	LastImageInputDir      string           `json:"last_image_input_dir"`
	LastOutputDir          string           `json:"last_output_dir"`
	LastImageOutputDir     string           `json:"last_image_output_dir,omitempty"`
	QuickCustom1           *Preset          `json:"quick_custom_1,omitempty"`
	QuickCustom2           *Preset          `json:"quick_custom_2,omitempty"`
	QuickCustom3           *Preset          `json:"quick_custom_3,omitempty"`
}

func DefaultSettings() Settings {
	return Settings{
		Resolution:             "1080P",
		Codec:                  "H.265",
		Quality:                "高",
		VolumeMode:             "质量优先",
		TargetSizeMB:           100,
		BitrateMbps:            5,
		Rotation:               "自动",
		IncludeSubdirs:         true,
		Concurrency:            2,
		AutoConcurrency:        true,
		SmartEngine:            true,
		SpeedMode:              "均衡",
		InterfaceMode:          "完整",
		ShowPerformanceStats:   false,
		RightPanelVisible:      true,
		UILayoutRevision:       420,
		AutoBenchmark:          false,
		AutoDetectPlayer:       true,
		UseGPU:                 true,
		GPUFallback:            true,
		ExactTargetSize:        true,
		PreserveTimes:          true,
		FilenameMode:           "保持原文件名",
		ConflictPolicy:         "自动编号",
		SaveHistory:            true,
		RestoreSession:         true,
		NotifyOnDone:           false,
		ShowFloatingBar:        true,
		CompletionToastSeconds: 30,
		VerifyOutput:           true,
		ThumbnailCache:         true,
		EstimateDiskSpace:      true,
		SmartStreamCopy:        false,
		AudioMode:              "AAC 192k",
		SubtitleMode:           "不保留字幕",
		ImageFormat:            "JPG",
		ImageSize:              "保持原尺寸",
		ImageQuality:           "高",
		ImageLimit:             "不限",
	}
}

func (s Settings) OutputDirFor(kind Kind) string {
	if kind == KindImage {
		if s.ImageOutputDir != "" {
			return s.ImageOutputDir
		}
	}
	return s.OutputDir
}

func (s *Settings) SetOutputDirFor(kind Kind, dir string) {
	if s == nil {
		return
	}
	if kind == KindImage {
		s.ImageOutputDir = dir
		s.LastImageOutputDir = dir
		return
	}
	s.OutputDir = dir
	s.LastOutputDir = dir
}

func (s Settings) RecentOutputDirsFor(kind Kind) []string {
	if kind == KindImage {
		return s.RecentImageOutputDirs
	}
	return s.RecentOutputDirs
}

func (s *Settings) SetRecentOutputDirsFor(kind Kind, dirs []string) {
	if s == nil {
		return
	}
	if kind == KindImage {
		s.RecentImageOutputDirs = dirs
		return
	}
	s.RecentOutputDirs = dirs
}

func (s Settings) DefaultOptions(kind Kind) TaskOptions {
	quality := s.Quality
	if kind == KindImage {
		quality = s.ImageQuality
	}
	return TaskOptions{
		FollowDefaults: false,
		Resolution:     s.Resolution,
		Codec:          s.Codec,
		Quality:        quality,
		VolumeMode:     s.VolumeMode,
		TargetSizeMB:   s.TargetSizeMB,
		BitrateMbps:    s.BitrateMbps,
		Rotation:       s.Rotation,
		ImageFormat:    s.ImageFormat,
		ImageSize:      s.ImageSize,
		ImageLimit:     s.ImageLimit,
	}
}

func (s Settings) EffectiveOptions(t *Task) TaskOptions {
	if t != nil {
		if t.Queue != nil && t.Status != StatusReady {
			return t.Queue.Options
		}
		if t.Kind == KindImage && t.Options.ImageSize != "" {
			return t.Options
		}
		if t.Kind == KindVideo && t.Options.Resolution != "" {
			return t.Options
		}
	}
	kind := KindVideo
	if t != nil {
		kind = t.Kind
	}
	return s.DefaultOptions(kind)
}
