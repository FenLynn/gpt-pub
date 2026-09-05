package main

const rightDetailsMinHeight int32 = 90

// rightDetailsHeightFor returns a usable details height only when the complete
// secondary details panel fits above the bottom parameter area. Primary queue
// controls remain visible; the details panel is the first element to collapse.
func rightDetailsHeightFor(listBottom, detailsY int32) (int32, bool) {
	available := listBottom - detailsY
	if available < rightDetailsMinHeight {
		return 0, false
	}
	return available, true
}
