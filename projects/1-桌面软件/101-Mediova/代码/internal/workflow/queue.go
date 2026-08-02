package workflow

import (
	"errors"
	"fmt"
	"time"

	"mediaworkbench/internal/model"
)

type DefaultField string

const (
	FieldResolution DefaultField = "resolution"
	FieldCodec      DefaultField = "codec"
	FieldQuality    DefaultField = "quality"
	FieldVolume     DefaultField = "volume"
	FieldRotation   DefaultField = "rotation"
)

var (
	ErrTaskNotReady      = errors.New("task is not ready")
	ErrTaskNotLockable   = errors.New("task cannot enter hold state")
	ErrTaskNotHeld       = errors.New("task is not held")
	ErrBulkEditLocked    = errors.New("locked tasks can only be edited one at a time")
	ErrMixedMediaQueue   = errors.New("active queue only accepts the same media kind")
)

func MaterializeReadyOptions(task *model.Task, settings model.Settings) bool {
	if task == nil || task.Status != model.StatusReady {
		return false
	}
	if task.Kind == model.KindImage && task.Options.ImageSize != "" {
		task.Options.FollowDefaults = false
		return false
	}
	if task.Kind == model.KindVideo && task.Options.Resolution != "" {
		task.Options.FollowDefaults = false
		return false
	}
	task.Options = settings.DefaultOptions(task.Kind)
	return true
}

func ApplyGlobalField(tasks []*model.Task, kind model.Kind, settings model.Settings, field DefaultField) int {
	changed := 0
	defaults := settings.DefaultOptions(kind)
	for _, task := range tasks {
		if task == nil || task.Kind != kind || task.Status != model.StatusReady {
			continue
		}
		MaterializeReadyOptions(task, settings)
		switch field {
		case FieldResolution:
			if kind == model.KindImage {
				task.Options.ImageSize = defaults.ImageSize
			} else {
				task.Options.Resolution = defaults.Resolution
			}
		case FieldCodec:
			if kind == model.KindImage {
				task.Options.ImageFormat = defaults.ImageFormat
			} else {
				task.Options.Codec = defaults.Codec
			}
		case FieldQuality:
			task.Options.Quality = defaults.Quality
		case FieldVolume:
			if kind == model.KindImage {
				task.Options.ImageLimit = defaults.ImageLimit
			} else {
				task.Options.VolumeMode = defaults.VolumeMode
				task.Options.TargetSizeMB = defaults.TargetSizeMB
				task.Options.BitrateMbps = defaults.BitrateMbps
			}
		case FieldRotation:
			task.Options.Rotation = defaults.Rotation
		default:
			continue
		}
		task.Options.FollowDefaults = false
		changed++
	}
	return changed
}

func ResetReadyToDefaults(tasks []*model.Task, kind model.Kind, settings model.Settings) int {
	changed := 0
	defaults := settings.DefaultOptions(kind)
	for _, task := range tasks {
		if task == nil || task.Kind != kind || task.Status != model.StatusReady {
			continue
		}
		task.Options = defaults
		changed++
	}
	return changed
}

func FreezeForQueue(task *model.Task, settings model.Settings, outputRoot string, sequence int64, now time.Time) error {
	if task == nil || task.Status != model.StatusReady {
		return ErrTaskNotReady
	}
	MaterializeReadyOptions(task, settings)
	task.Options.FollowDefaults = false
	task.Queue = &model.QueueSnapshot{
		Options:        task.Options,
		OutputRoot:     outputRoot,
		OutputPath:     task.OutputPath,
		ConflictPolicy: settings.ConflictPolicy,
		QueuedAt:       now,
		Sequence:       sequence,
	}
	task.Hold = nil
	task.Status = model.StatusQueued
	task.Progress = 0
	task.Error = ""
	task.FailureCategory = ""
	task.ValidationWarning = ""
	task.OutputSize = 0
	task.Engine = ""
	task.StartedAt = time.Time{}
	task.FinishedAt = time.Time{}
	return nil
}

func CanAppendToActiveQueue(activeKind, candidateKind model.Kind) error {
	if activeKind != candidateKind {
		return ErrMixedMediaQueue
	}
	return nil
}

func HoldForEdit(task *model.Task, now time.Time) error {
	if task == nil || !task.CanHoldForEdit() {
		return ErrTaskNotLockable
	}
	from := task.Status
	reserve := from == model.StatusProcessing
	var queueCopy *model.QueueSnapshot
	if task.Queue != nil {
		copy := *task.Queue
		queueCopy = &copy
	}
	task.Hold = &model.HoldState{
		FromStatus:    from,
		Original:      task.Options,
		Queue:         queueCopy,
		ReservedSlot:  reserve,
		HeldAt:        now,
	}
	task.Status = model.StatusHeld
	task.Engine = "搁置 · 等待修改"
	return nil
}

func ApplyHeldOptions(task *model.Task, options model.TaskOptions, now time.Time) (immediateRestart bool, err error) {
	if task == nil || task.Status != model.StatusHeld || task.Hold == nil {
		return false, ErrTaskNotHeld
	}
	from := task.Hold.FromStatus
	options.FollowDefaults = false
	task.Options = options
	if task.Queue == nil && task.Hold.Queue != nil {
		copy := *task.Hold.Queue
		task.Queue = &copy
	}
	if task.Queue != nil {
		task.Queue.Options = options
		task.Queue.QueuedAt = now
	}
	task.Progress = 0
	task.OutputPath = ""
	task.OutputSize = 0
	task.Error = ""
	task.FailureCategory = ""
	task.ValidationWarning = ""
	task.StartedAt = time.Time{}
	task.FinishedAt = time.Time{}
	task.Status = model.StatusQueued
	task.Engine = "已修改 · 等待调度"
	immediateRestart = from == model.StatusProcessing && task.Hold.ReservedSlot
	if immediateRestart {
		task.Engine = "已修改 · 立即重新转换"
	}
	task.Hold = nil
	return immediateRestart, nil
}

func CancelHeldEdit(task *model.Task, now time.Time) (immediateRestart bool, err error) {
	if task == nil || task.Status != model.StatusHeld || task.Hold == nil {
		return false, ErrTaskNotHeld
	}
	hold := task.Hold
	task.Options = hold.Original
	if hold.Queue != nil {
		copy := *hold.Queue
		task.Queue = &copy
	}
	task.Progress = 0
	task.OutputPath = ""
	task.OutputSize = 0
	task.Error = ""
	task.FailureCategory = ""
	task.ValidationWarning = ""
	task.StartedAt = time.Time{}
	task.FinishedAt = time.Time{}
	task.Status = model.StatusQueued
	task.Engine = "已取消修改 · 等待调度"
	immediateRestart = hold.FromStatus == model.StatusProcessing && hold.ReservedSlot
	if immediateRestart {
		task.Engine = "已取消修改 · 立即重新转换"
	}
	if task.Queue != nil {
		task.Queue.QueuedAt = now
	}
	task.Hold = nil
	return immediateRestart, nil
}

func StopRunReturnsHeldToReady(task *model.Task, settings model.Settings) bool {
	if task == nil || task.Status != model.StatusHeld {
		return false
	}
	if task.Hold != nil {
		task.Options = task.Hold.Original
	}
	if task.Options.Resolution == "" && task.Options.ImageSize == "" {
		task.Options = settings.DefaultOptions(task.Kind)
	}
	task.Status = model.StatusReady
	task.Queue = nil
	task.Hold = nil
	task.Progress = 0
	task.OutputPath = ""
	task.OutputSize = 0
	task.Error = ""
	task.FailureCategory = ""
	task.ValidationWarning = ""
	task.Engine = ""
	task.StartedAt = time.Time{}
	task.FinishedAt = time.Time{}
	return true
}

func ValidateLockedEditSelection(tasks []*model.Task) error {
	locked := 0
	for _, task := range tasks {
		if task != nil && task.IsLocked() {
			locked++
		}
	}
	if locked > 1 {
		return fmt.Errorf("%w: selected locked tasks=%d", ErrBulkEditLocked, locked)
	}
	return nil
}
