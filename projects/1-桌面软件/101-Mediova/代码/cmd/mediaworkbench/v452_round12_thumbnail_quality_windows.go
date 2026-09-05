//go:build windows

package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	"mediaworkbench/internal/media"
)

type round12ThumbnailQuality struct {
	MeanLuma    float64
	BrightRatio float64
	Sampled     int
}

var round12ApprovedDarkThumbnailFallbacks sync.Map

func round12ThumbnailNearBlack(quality round12ThumbnailQuality) bool {
	// Intentionally conservative. A legitimate dark scene may have a low mean,
	// but it normally still contains a meaningful fraction of pixels above the
	// near-black range. This rejects actual black/fade frames without trying to
	// "beautify" ordinary low-key footage.
	return quality.Sampled > 0 && quality.MeanLuma < 14.0 && quality.BrightRatio < 0.015
}

func round12ThumbnailQualityForBMP(path string) (round12ThumbnailQuality, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return round12ThumbnailQuality{}, err
	}
	if len(data) < 54 || string(data[:2]) != "BM" {
		return round12ThumbnailQuality{}, fmt.Errorf("unsupported thumbnail BMP")
	}
	pixelOffset := int(binary.LittleEndian.Uint32(data[10:14]))
	dibSize := int(binary.LittleEndian.Uint32(data[14:18]))
	if dibSize < 40 || len(data) < 14+dibSize {
		return round12ThumbnailQuality{}, fmt.Errorf("unsupported BMP DIB header")
	}
	widthRaw := int32(binary.LittleEndian.Uint32(data[18:22]))
	heightRaw := int32(binary.LittleEndian.Uint32(data[22:26]))
	planes := binary.LittleEndian.Uint16(data[26:28])
	bits := int(binary.LittleEndian.Uint16(data[28:30]))
	compression := binary.LittleEndian.Uint32(data[30:34])
	if planes != 1 || (bits != 24 && bits != 32) || compression != 0 {
		return round12ThumbnailQuality{}, fmt.Errorf("unsupported BMP pixel format: planes=%d bits=%d compression=%d", planes, bits, compression)
	}
	width := int(widthRaw)
	if width < 0 {
		width = -width
	}
	height := int(heightRaw)
	if height < 0 {
		height = -height
	}
	if width <= 0 || height <= 0 {
		return round12ThumbnailQuality{}, fmt.Errorf("invalid BMP size %dx%d", width, height)
	}
	bytesPerPixel := bits / 8
	rowStride := ((width*bits + 31) / 32) * 4
	required := pixelOffset + rowStride*height
	if pixelOffset < 0 || required > len(data) {
		return round12ThumbnailQuality{}, fmt.Errorf("truncated BMP pixels")
	}

	var sum int64
	bright := 0
	sampled := 0
	// The generated thumbnails are only 86x48, so examining every pixel is
	// inexpensive and more robust than sparse corner/center probes.
	for y := 0; y < height; y++ {
		row := pixelOffset + y*rowStride
		for x := 0; x < width; x++ {
			i := row + x*bytesPerPixel
			b := int(data[i])
			g := int(data[i+1])
			r := int(data[i+2])
			luma := (77*r + 150*g + 29*b) >> 8
			sum += int64(luma)
			if luma > 36 {
				bright++
			}
			sampled++
		}
	}
	if sampled == 0 {
		return round12ThumbnailQuality{}, fmt.Errorf("BMP contained no pixels")
	}
	return round12ThumbnailQuality{
		MeanLuma:    float64(sum) / float64(sampled),
		BrightRatio: float64(bright) / float64(sampled),
		Sampled:     sampled,
	}, nil
}

func round12ThumbnailCandidateTimes(info media.ProbeInfo) []float64 {
	duration := info.Duration
	fps := info.FPS
	if fps < 1 {
		fps = 25
	}
	last := duration
	if duration > 0 {
		last = duration - 1/fps
		if last < 0 {
			last = 0
		}
	}
	raw := []float64{0}
	if duration > 0.25 {
		raw = []float64{
			duration * 0.05,
			duration * 0.12,
			duration * 0.25,
			duration * 0.40,
			duration * 0.60,
		}
	} else if duration <= 0 {
		raw = []float64{0, 0.8, 2.0, 5.0, 10.0}
	}
	seen := map[int64]bool{}
	times := make([]float64, 0, len(raw))
	for _, value := range raw {
		if value < 0 {
			value = 0
		}
		if duration > 0 && value > last {
			value = last
		}
		key := int64(value*1000 + 0.5)
		if seen[key] {
			continue
		}
		seen[key] = true
		times = append(times, value)
	}
	return times
}

type round12ThumbnailCandidate struct {
	path    string
	at      float64
	quality round12ThumbnailQuality
}

func round12PromoteThumbnailCandidate(candidatePath, output string) error {
	_ = os.Remove(output)
	if err := os.Rename(candidatePath, output); err == nil {
		return nil
	}
	data, err := os.ReadFile(candidatePath)
	if err != nil {
		return err
	}
	if err := os.WriteFile(output, data, 0o644); err != nil {
		return err
	}
	return os.Remove(candidatePath)
}

func round12MarkApprovedDarkThumbnailFallback(path string) {
	if path != "" {
		round12ApprovedDarkThumbnailFallbacks.Store(path, true)
	}
}

func round12ConsumeApprovedDarkThumbnailFallback(path string) bool {
	if path == "" {
		return false
	}
	_, ok := round12ApprovedDarkThumbnailFallbacks.LoadAndDelete(path)
	return ok
}

func round12GenerateSmartThumbnailBMP(
	parent context.Context,
	ffmpeg, input, output string,
	info media.ProbeInfo,
	width, height int,
) (float64, round12ThumbnailQuality, error) {
	if parent == nil {
		parent = context.Background()
	}
	times := round12ThumbnailCandidateTimes(info)
	if len(times) == 0 {
		times = []float64{0}
	}
	candidates := make([]round12ThumbnailCandidate, 0, len(times))
	defer func() {
		for _, candidate := range candidates {
			if candidate.path != output {
				_ = os.Remove(candidate.path)
			}
		}
	}()

	var lastErr error
	for index, at := range times {
		if err := parent.Err(); err != nil {
			return 0, round12ThumbnailQuality{}, err
		}
		candidatePath := fmt.Sprintf("%s.try%d.bmp", output, index)
		_ = os.Remove(candidatePath)
		ctx, cancel := context.WithTimeout(parent, 7*time.Second)
		err := media.GenerateThumbnailBMP(ctx, ffmpeg, input, candidatePath, at, "自动", width, height)
		cancel()
		if err != nil {
			lastErr = err
			_ = os.Remove(candidatePath)
			continue
		}
		quality, qualityErr := round12ThumbnailQualityForBMP(candidatePath)
		if qualityErr != nil {
			lastErr = qualityErr
			_ = os.Remove(candidatePath)
			continue
		}
		candidate := round12ThumbnailCandidate{path: candidatePath, at: at, quality: quality}
		candidates = append(candidates, candidate)
		if !round12ThumbnailNearBlack(quality) {
			if err := round12PromoteThumbnailCandidate(candidatePath, output); err != nil {
				return 0, round12ThumbnailQuality{}, err
			}
			candidates[len(candidates)-1].path = output
			return at, quality, nil
		}
	}

	if err := parent.Err(); err != nil {
		return 0, round12ThumbnailQuality{}, err
	}
	if len(candidates) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("no thumbnail candidate could be decoded")
		}
		return 0, round12ThumbnailQuality{}, lastErr
	}

	// If every sampled frame is genuinely dark, retain the least-dark candidate
	// rather than leaving the row blank forever. The lifecycle marks this one
	// fallback as explicitly approved so the normal near-black rejection does
	// not loop indefinitely.
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].quality.MeanLuma == candidates[j].quality.MeanLuma {
			return candidates[i].quality.BrightRatio > candidates[j].quality.BrightRatio
		}
		return candidates[i].quality.MeanLuma > candidates[j].quality.MeanLuma
	})
	best := candidates[0]
	if err := round12PromoteThumbnailCandidate(best.path, output); err != nil {
		return 0, round12ThumbnailQuality{}, err
	}
	candidates[0].path = output
	round12MarkApprovedDarkThumbnailFallback(output)
	return best.at, best.quality, nil
}
