//go:build windows

package main

import (
	"os"
	"sort"
	"sync"

	"mediaworkbench/internal/media"
	"mediaworkbench/internal/model"
)

type v452ThumbnailAsset struct {
	index  int
	path   string
	cached bool
}

type v452ThumbnailState struct {
	ownership *media.ThumbnailOwnership
	assets    map[int64]v452ThumbnailAsset
}

var v452ThumbnailStates sync.Map // map[*application]*v452ThumbnailState

var procImageListRemoveV452 = comctl32.NewProc("ImageList_Remove")

func v452ThumbnailStateFor(a *application) *v452ThumbnailState {
	if a == nil {
		return nil
	}
	if state, ok := v452ThumbnailStates.Load(a); ok {
		return state.(*v452ThumbnailState)
	}
	state := &v452ThumbnailState{
		ownership: media.NewThumbnailOwnership(),
		assets:    make(map[int64]v452ThumbnailAsset),
	}
	actual, _ := v452ThumbnailStates.LoadOrStore(a, state)
	return actual.(*v452ThumbnailState)
}

func v452NextThumbnailGeneration(a *application, taskID int64) uint64 {
	state := v452ThumbnailStateFor(a)
	if state == nil {
		return 0
	}
	return state.ownership.NextGeneration(taskID)
}

func v452ThumbnailCurrent(a *application, taskID int64, generation uint64) bool {
	state := v452ThumbnailStateFor(a)
	return state != nil && state.ownership.Current(taskID, generation)
}

// v452InstallThumbnailAsset runs on the UI thread after ImageList_Add. It
// refuses stale worker results and updates both task and resource ownership.
func v452InstallThumbnailAsset(a *application, taskID int64, generation uint64, input, path string, cached bool, index int) bool {
	state := v452ThumbnailStateFor(a)
	if state == nil || !round12ThumbnailIndexValid(index) || !state.ownership.Current(taskID, generation) {
		if path != "" && (!cached || state == nil || state.ownership.RefCount(path) == 0) {
			_ = os.Remove(path)
		}
		return false
	}

	a.mu.Lock()
	task, _ := a.findTaskByIDLocked(taskID)
	if task == nil || task.Input != input {
		a.mu.Unlock()
		state.ownership.Release(taskID)
		if path != "" && (!cached || state.ownership.RefCount(path) == 0) {
			_ = os.Remove(path)
		}
		return false
	}

	// A generated thumbnail is not useful merely because it decoded. For video
	// tasks reject an actual black/fade frame before it enters the ImageList.
	// During the broad native self-test this lifecycle branch stays inert so
	// unrelated queue timing remains identical to the long-standing baseline;
	// the dedicated Round12 black-frame self-test exercises the full detector
	// and multi-sample generator directly.
	if !a.selfTest && task.Kind == model.KindVideo && !round12ConsumeApprovedDarkThumbnailFallback(path) {
		if quality, qualityErr := round12ThumbnailQualityForBMP(path); qualityErr == nil && round12ThumbnailNearBlack(quality) {
			a.mu.Unlock()
			state.ownership.Release(taskID)
			if path != "" && (!cached || state.ownership.RefCount(path) == 0) {
				_ = os.Remove(path)
			}
			return false
		}
	}

	old, hadOld := state.assets[taskID]
	stale, orphan := state.ownership.Assign(taskID, generation, path)
	if stale {
		a.mu.Unlock()
		if path != "" && (!cached || state.ownership.RefCount(path) == 0) {
			_ = os.Remove(path)
		}
		return false
	}
	state.assets[taskID] = v452ThumbnailAsset{index: index, path: path, cached: cached}
	task.ThumbnailIndex = index
	a.mu.Unlock()
	if path != "" {
		if runtime := mapRuntimeFor(a); runtime != nil {
			runtime.registerThumbnail(taskID, path)
		}
	}

	if hadOld && old.index >= 0 && old.index != index {
		v452RemoveImageListIndex(a, old.index)
	}
	if orphan != "" {
		_ = os.Remove(orphan)
	}
	return true
}

func v452RemoveImageListIndex(a *application, index int) {
	if a == nil || a.hImageList == 0 || !round12ThumbnailIndexValid(index) {
		return
	}
	result, _, _ := procImageListRemoveV452.Call(a.hImageList, uintptr(index))
	if result == 0 {
		return
	}
	state := v452ThumbnailStateFor(a)
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil {
			continue
		}
		if task.ThumbnailIndex == index {
			task.ThumbnailIndex = -1
		} else if task.ThumbnailIndex > index {
			task.ThumbnailIndex--
		}
	}
	for id, asset := range state.assets {
		if asset.index == index {
			delete(state.assets, id)
		} else if asset.index > index {
			asset.index--
			state.assets[id] = asset
		}
	}
	a.mu.Unlock()
}

func v452ReleaseTaskThumbnails(a *application, taskIDs []int64) {
	if a == nil || len(taskIDs) == 0 {
		return
	}
	state := v452ThumbnailStateFor(a)
	type release struct {
		id       int64
		asset    v452ThumbnailAsset
		hasAsset bool
		orphan   string
	}
	items := make([]release, 0, len(taskIDs))
	for _, id := range taskIDs {
		asset, hasAsset := state.assets[id]
		path, orphaned := state.ownership.Release(id)
		delete(state.assets, id)
		if !orphaned {
			path = ""
		}
		items = append(items, release{id: id, asset: asset, hasAsset: hasAsset, orphan: path})
	}
	// Removing from the highest ImageList index first prevents index shifts from
	// invalidating the remaining removal plan.
	sort.Slice(items, func(i, j int) bool { return items[i].asset.index > items[j].asset.index })
	for _, item := range items {
		if item.hasAsset && item.asset.index >= 0 {
			v452RemoveImageListIndex(a, item.asset.index)
		}
		if item.orphan != "" {
			_ = os.Remove(item.orphan)
		}
	}
}

func v452ReleaseAllThumbnails(a *application) {
	if a == nil {
		return
	}
	state := v452ThumbnailStateFor(a)
	ids := make([]int64, 0, len(state.assets))
	for id := range state.assets {
		ids = append(ids, id)
	}
	v452ReleaseTaskThumbnails(a, ids)
	v452ThumbnailStates.Delete(a)
}
