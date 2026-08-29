//go:build windows

package main

import "sort"

// takePendingProbeBatch removes one stable, bounded batch while the caller
// holds the queue mutex. A small batch keeps the native message loop available
// to paint ComboBoxes and owner-drawn toolbar buttons.
func takePendingProbeBatch(pending map[int64]struct{}, limit int) []int64 {
	ids := make([]int64, 0, len(pending))
	for id := range pending {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	for _, id := range ids {
		delete(pending, id)
	}
	return ids
}

// bulkImportSelectionIDs keeps small-import convenience while avoiding one
// native selection notification per item for thousand-file imports.
func bulkImportSelectionIDs(highlighted map[int64]bool, first int64, limit int) map[int64]bool {
	selected := make(map[int64]bool)
	if len(highlighted) <= limit {
		for id := range highlighted {
			selected[id] = true
		}
		return selected
	}
	if first != 0 {
		selected[first] = true
	}
	return selected
}
