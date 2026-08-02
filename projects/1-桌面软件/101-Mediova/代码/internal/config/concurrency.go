package config

import "runtime"

const HardMaxConcurrency = 32

func LogicalProcessorCount() int {
	return logicalProcessorCountFor(runtime.NumCPU())
}

func logicalProcessorCountFor(logical int) int {
	if logical < 1 {
		return 1
	}
	return logical
}

func MaxConcurrency() int {
	return maxConcurrencyFor(runtime.NumCPU())
}

func maxConcurrencyFor(logical int) int {
	logical = logicalProcessorCountFor(logical)
	if logical > HardMaxConcurrency {
		return HardMaxConcurrency
	}
	return logical
}

func NormalizeConcurrency(value int) int {
	return normalizeConcurrencyFor(value, runtime.NumCPU())
}

func normalizeConcurrencyFor(value, logical int) int {
	limit := maxConcurrencyFor(logical)
	if value < 1 {
		value = 2
		if value > limit {
			value = limit
		}
	}
	if value > limit {
		value = limit
	}
	return value
}

func ConcurrencyChoices() []int {
	return concurrencyChoicesFor(runtime.NumCPU())
}

func concurrencyChoicesFor(logical int) []int {
	limit := maxConcurrencyFor(logical)
	candidates := []int{1, 2, 4, 6, 8, 12, 16, 24, 32, limit}
	seen := make(map[int]bool, len(candidates))
	choices := make([]int, 0, len(candidates))
	for _, value := range candidates {
		if value < 1 || value > limit || seen[value] {
			continue
		}
		seen[value] = true
		choices = append(choices, value)
	}
	for i := 1; i < len(choices); i++ {
		for j := i; j > 0 && choices[j] < choices[j-1]; j-- {
			choices[j], choices[j-1] = choices[j-1], choices[j]
		}
	}
	return choices
}
