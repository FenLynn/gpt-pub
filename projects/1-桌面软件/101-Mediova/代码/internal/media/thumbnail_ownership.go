package media

import "sync"

type ThumbnailOwnership struct {
	mu         sync.Mutex
	generation map[int64]uint64
	assets     map[int64]string
	refs       map[string]int
}

func NewThumbnailOwnership() *ThumbnailOwnership {
	return &ThumbnailOwnership{
		generation: make(map[int64]uint64),
		assets:     make(map[int64]string),
		refs:       make(map[string]int),
	}
}

func (o *ThumbnailOwnership) NextGeneration(taskID int64) uint64 {
	if o == nil || taskID == 0 {
		return 0
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.generation[taskID]++
	return o.generation[taskID]
}

func (o *ThumbnailOwnership) Current(taskID int64, generation uint64) bool {
	if o == nil || taskID == 0 || generation == 0 {
		return false
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.generation[taskID] == generation
}

// Assign registers a task's current cache path. It returns an old path that is
// no longer referenced and may be removed from disk.
func (o *ThumbnailOwnership) Assign(taskID int64, generation uint64, path string) (stale bool, orphaned string) {
	if o == nil || taskID == 0 || generation == 0 || path == "" {
		return true, ""
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.generation[taskID] != generation {
		return true, ""
	}
	old := o.assets[taskID]
	if old == path {
		return false, ""
	}
	if old != "" {
		o.refs[old]--
		if o.refs[old] <= 0 {
			delete(o.refs, old)
			orphaned = old
		}
	}
	o.assets[taskID] = path
	o.refs[path]++
	return false, orphaned
}

// Release invalidates pending work for the task and returns a cache path only
// when this was its final owner.
func (o *ThumbnailOwnership) Release(taskID int64) (path string, orphaned bool) {
	if o == nil || taskID == 0 {
		return "", false
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.generation[taskID]++
	path = o.assets[taskID]
	delete(o.assets, taskID)
	if path == "" {
		return "", false
	}
	o.refs[path]--
	if o.refs[path] <= 0 {
		delete(o.refs, path)
		return path, true
	}
	return path, false
}

func (o *ThumbnailOwnership) ReleaseAll(taskIDs []int64) []string {
	if o == nil {
		return nil
	}
	orphans := make([]string, 0, len(taskIDs))
	for _, id := range taskIDs {
		if path, orphaned := o.Release(id); orphaned {
			orphans = append(orphans, path)
		}
	}
	return orphans
}

func (o *ThumbnailOwnership) RefCount(path string) int {
	if o == nil || path == "" {
		return 0
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.refs[path]
}
