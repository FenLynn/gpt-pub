package config

import "testing"

func TestMaxConcurrencyFollowsLogicalProcessorsWithHardCap(t *testing.T) {
	cases := []struct {
		logical int
		want    int
	}{{0, 1}, {1, 1}, {4, 4}, {12, 12}, {32, 32}, {64, 32}}
	for _, tc := range cases {
		if got := maxConcurrencyFor(tc.logical); got != tc.want {
			t.Fatalf("logical=%d got=%d want=%d", tc.logical, got, tc.want)
		}
	}
}

func TestNormalizeConcurrencyClampsToMachineLimit(t *testing.T) {
	if got := normalizeConcurrencyFor(0, 1); got != 1 {
		t.Fatalf("single-core default=%d want=1", got)
	}
	if got := normalizeConcurrencyFor(99, 12); got != 12 {
		t.Fatalf("clamped=%d want=12", got)
	}
	if got := normalizeConcurrencyFor(6, 12); got != 6 {
		t.Fatalf("manual=%d want=6", got)
	}
}

func TestConcurrencyChoicesIncludeMachineLimitWithoutExceedingIt(t *testing.T) {
	for _, logical := range []int{1, 3, 10, 24, 64} {
		limit := maxConcurrencyFor(logical)
		choices := concurrencyChoicesFor(logical)
		if len(choices) == 0 || choices[len(choices)-1] != limit {
			t.Fatalf("logical=%d choices=%v limit=%d", logical, choices, limit)
		}
		seen := map[int]bool{}
		for _, value := range choices {
			if value < 1 || value > limit || seen[value] {
				t.Fatalf("logical=%d invalid choices=%v", logical, choices)
			}
			seen[value] = true
		}
	}
}
