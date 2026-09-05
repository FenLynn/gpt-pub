package main

import "testing"

func TestRightDetailsHeightCollapsesBeforeOverlap(t *testing.T) {
	tests := []struct {
		name       string
		listBottom int32
		detailsY   int32
		wantHeight int32
		wantShown  bool
	}{
		{"negative", 400, 418, 0, false},
		{"short", 456, 418, 0, false},
		{"boundary-below", 507, 418, 0, false},
		{"boundary", 508, 418, 90, true},
		{"expanded", 620, 418, 202, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			height, shown := rightDetailsHeightFor(tc.listBottom, tc.detailsY)
			if height != tc.wantHeight || shown != tc.wantShown {
				t.Fatalf("height=%d shown=%v, want height=%d shown=%v", height, shown, tc.wantHeight, tc.wantShown)
			}
			if shown && tc.detailsY+height > tc.listBottom {
				t.Fatalf("visible details exceed list bottom: y=%d h=%d bottom=%d", tc.detailsY, height, tc.listBottom)
			}
		})
	}
}

func TestRightDetailsHeightContinuousHeightMatrix(t *testing.T) {
	for clientH := int32(620); clientH <= 1200; clientH++ {
		for _, compactBottom := range []bool{false, true} {
			bottomBarH := int32(126)
			if compactBottom {
				bottomBarH = 164
			}
			const top int32 = 68
			listH := clientH - top - bottomBarH
			if listH < 260 {
				listH = 260
			}
			detailsY := top + 40 + 5*38 + 6 + 114
			listBottom := top + listH
			height, shown := rightDetailsHeightFor(listBottom, detailsY)
			available := listBottom - detailsY
			if shown {
				if height < rightDetailsMinHeight || detailsY+height != listBottom {
					t.Fatalf("h=%d compact=%v visible geometry invalid: available=%d height=%d", clientH, compactBottom, available, height)
				}
			} else if available >= rightDetailsMinHeight {
				t.Fatalf("h=%d compact=%v hid usable details space=%d", clientH, compactBottom, available)
			}
		}
	}
}
