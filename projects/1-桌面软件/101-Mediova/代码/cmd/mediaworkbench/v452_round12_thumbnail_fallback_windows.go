//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/media"
)

type round12ThumbnailFallbackState struct {
	input     string
	scheduled bool
}

var (
	round12ThumbnailFallbackMu sync.Mutex
	round12ThumbnailFallbacks  = make(map[int64]round12ThumbnailFallbackState)
)

// round12ScheduleThumbnailFallback gives the normal cached thumbnail path a
// short head start. If the visible task still has no image afterwards, fall
// back to the direct multi-sample BMP path. Thumbnail caching is an optimization
// and must never decide whether the home list has a preview.
func round12ScheduleThumbnailFallback(a *application, id int64, input string, pinfo media.ProbeInfo) {
	if a == nil || id == 0 || input == "" {
		return
	}
	// The broad native self-test already has its own thumbnail and queue checks.
	// Do not add asynchronous FFmpeg fallback work to that shared timing domain.
	// Round12's dedicated black-intro self-test invokes the smart generator
	// directly, while all normal application launches keep this fallback active.
	if a.selfTest {
		return
	}
	round12ThumbnailFallbackMu.Lock()
	state := round12ThumbnailFallbacks[id]
	if state.input != input {
		state = round12ThumbnailFallbackState{input: input}
	}
	if state.scheduled {
		round12ThumbnailFallbackMu.Unlock()
		return
	}
	state.scheduled = true
	round12ThumbnailFallbacks[id] = state
	round12ThumbnailFallbackMu.Unlock()

	go func() {
		time.Sleep(1500 * time.Millisecond)
		if !round12ThumbnailStillMissing(a, id, input) {
			round12ThumbnailFallbackDone(id, input)
			return
		}
		round12GenerateThumbnailDirect(a, id, input, pinfo)
		round12ThumbnailFallbackDone(id, input)
	}()
}

func round12ThumbnailFallbackDone(id int64, input string) {
	round12ThumbnailFallbackMu.Lock()
	defer round12ThumbnailFallbackMu.Unlock()
	state, ok := round12ThumbnailFallbacks[id]
	if !ok || state.input != input {
		return
	}
	delete(round12ThumbnailFallbacks, id)
}

func round12ThumbnailStillMissing(a *application, id int64, input string) bool {
	if a == nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	task, _ := a.findTaskByIDLocked(id)
	return task != nil && task.Input == input && task.ThumbnailIndex < 0
}

func round12GenerateThumbnailDirect(a *application, id int64, input string, pinfo media.ProbeInfo) {
	if a == nil || !round12ThumbnailStillMissing(a, id, input) {
		return
	}
	ffmpeg, _, _, _, _ := a.componentSnapshot()
	if ffmpeg == "" || a.hImageList == 0 {
		return
	}

	generation := v452NextThumbnailGeneration(a, id)
	if generation == 0 || !v452ThumbnailCurrent(a, id, generation) {
		return
	}
	dir, err := config.TempDir()
	if err != nil {
		writeRuntimeError(fmt.Sprintf("round12 thumbnail temp task %d", id), err)
		return
	}
	out := filepath.Join(dir, fmt.Sprintf("thumb_round12_%d_%d.bmp", id, time.Now().UnixNano()))
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	_, _, err = round12GenerateSmartThumbnailBMP(ctx, ffmpeg, input, out, pinfo, 86, 48)
	cancel()
	if err != nil {
		_ = os.Remove(out)
		writeRuntimeError(fmt.Sprintf("round12 thumbnail direct task %d", id), err)
		return
	}
	if !v452ThumbnailCurrent(a, id, generation) || !round12ThumbnailStillMissing(a, id, input) {
		_ = os.Remove(out)
		round12ConsumeApprovedDarkThumbnailFallback(out)
		return
	}

	a.postUI(func() {
		keepThumbnail := false
		defer func() {
			if !keepThumbnail {
				_ = os.Remove(out)
			}
		}()
		if a.hImageList == 0 || !v452ThumbnailCurrent(a, id, generation) || !round12ThumbnailStillMissing(a, id, input) {
			round12ConsumeApprovedDarkThumbnailFallback(out)
			return
		}
		h, _, _ := procLoadImageW.Call(0, uintptr(unsafe.Pointer(p(out))), IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE|LR_CREATEDIBSECTION)
		if h == 0 {
			round12ConsumeApprovedDarkThumbnailFallback(out)
			writeRuntimeError(fmt.Sprintf("round12 thumbnail load task %d", id), fmt.Errorf("LoadImageW failed for %s", out))
			return
		}
		idx, _, _ := procImageListAdd.Call(a.hImageList, h, 0)
		procDeleteObject.Call(h)
		if int32(idx) < 0 {
			round12ConsumeApprovedDarkThumbnailFallback(out)
			writeRuntimeError(fmt.Sprintf("round12 thumbnail imagelist task %d", id), fmt.Errorf("ImageList_Add failed for %s", out))
			return
		}
		imageIndex := int(int32(idx))
		if !v452InstallThumbnailAsset(a, id, generation, input, out, false, imageIndex) {
			procImageListRemoveV452.Call(a.hImageList, uintptr(imageIndex))
			return
		}
		keepThumbnail = true
		a.updateTaskRowByID(id)
	})
}
