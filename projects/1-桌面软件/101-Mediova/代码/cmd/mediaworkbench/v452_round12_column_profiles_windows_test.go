//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"mediaworkbench/internal/model"
)

func TestRound12StatusGlyphSemanticsAreDistinct(t *testing.T) {
	wants := map[model.Status]round12StatusGlyph{
		model.StatusReady:      round12GlyphRing,
		model.StatusQueued:     round12GlyphQueue,
		model.StatusProcessing: round12GlyphPlay,
		model.StatusPaused:     round12GlyphPause,
		model.StatusDone:       round12GlyphCircle,
		model.StatusFailed:     round12GlyphCross,
		model.StatusCancelled:  round12GlyphSquare,
	}
	seen := map[round12StatusGlyph]model.Status{}
	for status, want := range wants {
		got := round12StatusGlyphFor(status)
		if got != want {
			t.Fatalf("status %q glyph=%d want=%d", status, got, want)
		}
		if previous, exists := seen[got]; exists {
			t.Fatalf("statuses %q and %q share glyph %d", previous, status, got)
		}
		seen[got] = status
	}
	for _, status := range []model.Status{model.StatusHeld, model.StatusSkipped, model.Status("future-state")} {
		if got := round12StatusGlyphFor(status); got != round12GlyphRing {
			t.Fatalf("fallback status %q glyph=%d want neutral ring=%d", status, got, round12GlyphRing)
		}
	}
}

func TestRound12StatusGlyphsUseSupersampledEdges(t *testing.T) {
	foreground := colorRef(20, 80, 170)
	background := colorRef(255, 255, 255)
	seen := map[[32]byte]round12StatusGlyph{}
	for glyph := round12GlyphRing; glyph <= round12GlyphSquare; glyph++ {
		pixels := round12BuildAAGlyphPixels(14, glyph, foreground, background)
		if len(pixels) != 14*14*4 {
			t.Fatalf("glyph %d pixel bytes=%d", glyph, len(pixels))
		}
		foregroundPixels, backgroundPixels, blendedPixels := 0, 0, 0
		for offset := 0; offset < len(pixels); offset += 4 {
			red, green, blue := pixels[offset+2], pixels[offset+1], pixels[offset]
			switch {
			case red == 20 && green == 80 && blue == 170:
				foregroundPixels++
			case red == 255 && green == 255 && blue == 255:
				backgroundPixels++
			default:
				blendedPixels++
			}
		}
		if foregroundPixels == 0 || backgroundPixels == 0 || blendedPixels == 0 {
			t.Fatalf("glyph %d lacks solid/empty/antialiased pixels: foreground=%d background=%d blended=%d", glyph, foregroundPixels, backgroundPixels, blendedPixels)
		}
		hash := sha256.Sum256(pixels)
		if previous, exists := seen[hash]; exists {
			t.Fatalf("glyphs %d and %d have identical raster masks", previous, glyph)
		}
		seen[hash] = glyph
	}
}

func TestRound12DefaultProfileUsesCompactCoreColumns(t *testing.T) {
	profile := round12DefaultProfile()
	for column := 0; column < round12ColumnCount; column++ {
		if got, want := profile.Visible[column], round12DefaultColumnVisible(column); got != want {
			t.Fatalf("column %d visible=%v want=%v", column, got, want)
		}
	}
}

func TestRound12ImageDefaultShowsCropAreaRatio(t *testing.T) {
	profile := round12DefaultProfileFor(model.KindImage)
	if !profile.Visible[round12ColPictureCrop] {
		t.Fatal("image default must expose the crop-area ratio column")
	}
	if round12DefaultProfileFor(model.KindVideo).Visible[round12ColPictureCrop] {
		t.Fatal("video compact default unexpectedly exposed the optional crop column")
	}
}

func TestRound12StatusGlyphsRemainAntialiasedAcrossDPISizes(t *testing.T) {
	foreground := colorRef(20, 80, 170)
	background := colorRef(255, 255, 255)
	for _, size := range []int{10, 14, 18, 22} {
		for glyph := round12GlyphRing; glyph <= round12GlyphSquare; glyph++ {
			pixels := round12BuildAAGlyphPixels(size, glyph, foreground, background)
			blended := 0
			for offset := 0; offset < len(pixels); offset += 4 {
				red, green, blue := pixels[offset+2], pixels[offset+1], pixels[offset]
				if !(red == 20 && green == 80 && blue == 170) && !(red == 255 && green == 255 && blue == 255) {
					blended++
				}
			}
			// An axis-aligned stop square can land exactly on physical pixel
			// boundaries at some DPI sizes and is already geometrically crisp.
			if blended == 0 && glyph != round12GlyphSquare {
				t.Fatalf("size=%d glyph=%d has no antialiased edge pixels", size, glyph)
			}
		}
	}
}

func TestRound12HiddenColumnsRejectWidthDrift(t *testing.T) {
	profile := round12DefaultProfile()
	for _, column := range []int{round12ColTimeCrop, round12ColPictureCrop} {
		if round12ColumnWidthChangeAllowed(profile, column, round12Columns[column].width) {
			t.Fatalf("hidden column %d accepted nonzero width", column)
		}
		if !round12ColumnWidthChangeAllowed(profile, column, 0) {
			t.Fatalf("hidden column %d rejected zero width", column)
		}
	}
	if !round12ColumnWidthChangeAllowed(profile, round12ColStatus, 160) {
		t.Fatal("visible status column rejected a user width")
	}
}

func TestRound12TaskStatusColorsAreDistinct(t *testing.T) {
	statuses := []model.Status{
		model.StatusReady, model.StatusQueued, model.StatusProcessing,
		model.StatusPaused, model.StatusHeld, model.StatusDone,
		model.StatusFailed, model.StatusSkipped, model.StatusCancelled,
	}
	seen := make(map[uintptr]model.Status, len(statuses))
	for _, status := range statuses {
		color := taskStatusColor(status)
		if previous, exists := seen[color]; exists {
			t.Fatalf("statuses %q and %q share color %#x", previous, status, color)
		}
		seen[color] = status
	}
}

func TestRound12TaskBackgroundUsesThreeTintsAndWhiteDefault(t *testing.T) {
	done := round12TaskBackground(model.StatusDone)
	processing := round12TaskBackground(model.StatusProcessing)
	queued := round12TaskBackground(model.StatusQueued)
	other := round12TaskBackground(model.StatusReady)
	white := colorRef(255, 255, 255)
	if other != white {
		t.Fatalf("default status background=%#x want white=%#x", other, white)
	}
	if done == processing || done == queued || done == other || processing == queued || processing == other || queued == other {
		t.Fatal("three status tints and the white default must be distinct")
	}
	for _, status := range []model.Status{
		model.StatusReady, model.StatusPaused, model.StatusHeld,
		model.StatusFailed, model.StatusSkipped, model.StatusCancelled,
	} {
		if got := round12TaskBackground(status); got != other {
			t.Fatalf("status %q background=%#x want other=%#x", status, got, other)
		}
	}
}

func TestRound12NormalizeProfileRepairsCollapsedEssentialWidths(t *testing.T) {
	profile := round12DefaultProfile()
	profile.Widths[round12ColNumber] = 73
	profile.Widths[round12ColPreview] = 40
	profile.Widths[round12ColFile] = 120
	profile.Widths[round12ColStatus] = 72

	normalized := round12NormalizeProfile(profile)
	if got, want := normalized.Widths[round12ColNumber], round12Columns[round12ColNumber].width; got != want {
		t.Fatalf("number width=%d want=%d", got, want)
	}
	if got, want := normalized.Widths[round12ColPreview], round12Columns[round12ColPreview].width; got != want {
		t.Fatalf("preview width=%d want=%d", got, want)
	}
	if got, want := normalized.Widths[round12ColFile], round12Columns[round12ColFile].width; got != want {
		t.Fatalf("file width=%d want=%d", got, want)
	}
	if got, want := normalized.Widths[round12ColStatus], round12Columns[round12ColStatus].width; got != want {
		t.Fatalf("status width=%d want=%d", got, want)
	}
}

func TestRound12NormalizeProfileKeepsUsefulCustomWidths(t *testing.T) {
	profile := round12DefaultProfile()
	profile.Widths[round12ColPreview] = 128
	profile.Widths[round12ColFile] = 310
	profile.Widths[round12ColStatus] = 96

	normalized := round12NormalizeProfile(profile)
	for column, want := range map[int]int{
		round12ColPreview: 128,
		round12ColFile:    310,
		round12ColStatus:  96,
	} {
		if got := normalized.Widths[column]; got != want {
			t.Fatalf("column %d width=%d want=%d", column, got, want)
		}
	}
}

func TestRound12DecodeStoredProfilesMigratesVersion1(t *testing.T) {
	legacy := round12ColumnProfiles{
		Version: 1,
		Video:   round12DefaultProfile(),
		Image:   round12DefaultProfile(),
	}
	for column := 0; column < round12ColumnCount; column++ {
		legacy.Video.Visible[column] = true
		legacy.Image.Visible[column] = true
	}
	legacy.Video.Widths[round12ColPreview] = 40
	legacy.Video.Widths[round12ColFile] = 120
	legacy.Video.Widths[round12ColStatus] = 88
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}

	profiles, accepted, migrated := round12DecodeStoredProfiles(data)
	if !accepted || !migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
	if profiles.Version != round12ColumnProfileVersion {
		t.Fatalf("version=%d want=%d", profiles.Version, round12ColumnProfileVersion)
	}
	for _, column := range []int{round12ColPreview, round12ColFile} {
		if got, want := profiles.Video.Widths[column], round12Columns[column].width; got != want {
			t.Fatalf("column %d migrated width=%d want=%d", column, got, want)
		}
	}
	if got := profiles.Video.Widths[round12ColStatus]; got != 88 {
		t.Fatalf("valid status width should survive migration, got=%d", got)
	}
	for column := 0; column < round12ColumnCount; column++ {
		if got, want := profiles.Video.Visible[column], round12DefaultColumnVisible(column); got != want {
			t.Fatalf("column %d migrated visible=%v want=%v", column, got, want)
		}
	}
}

func TestRound12DecodeStoredProfilesPreservesLegacyUserChoices(t *testing.T) {
	legacy := round12ColumnProfiles{
		Version: 2,
		Video: round12ColumnProfile{
			Widths:  append([]int(nil), round12DefaultProfile().Widths...),
			Visible: make([]bool, round12ColumnCount),
		},
		Image: round12DefaultProfile(),
	}
	legacy.Video.Visible[round12ColNumber] = true
	legacy.Video.Visible[round12ColPreview] = true
	legacy.Video.Visible[round12ColFile] = true
	legacy.Video.Visible[round12ColDuration] = true
	legacy.Video.Visible[round12ColStatus] = true

	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	profiles, accepted, migrated := round12DecodeStoredProfiles(data)
	if !accepted || !migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
	if !profiles.Video.Visible[round12ColDuration] {
		t.Fatal("explicitly selected duration column was lost during migration")
	}
	if profiles.Video.Visible[round12ColProgress] {
		t.Fatal("migration overwrote an explicit hidden progress column")
	}
}

func TestRound12DecodeVersion3PromotesImageCropAreaOnce(t *testing.T) {
	stored := round12ColumnProfiles{
		Version: 3,
		Video:   round12DefaultProfileFor(model.KindVideo),
		Image:   round12DefaultProfile(),
	}
	data, err := json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	profiles, accepted, migrated := round12DecodeStoredProfiles(data)
	if !accepted || !migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
	if !profiles.Image.Visible[round12ColPictureCrop] {
		t.Fatal("v3 image profile did not gain the crop-area ratio column")
	}
}

func TestRound12DecodeVersion4PreservesHiddenImageCropArea(t *testing.T) {
	dropLocation := func(profile round12ColumnProfile) round12ColumnProfile {
		profile.Widths = append(append([]int(nil), profile.Widths[:round12ColLocation]...), profile.Widths[round12ColLocation+1:]...)
		profile.Visible = append(append([]bool(nil), profile.Visible[:round12ColLocation]...), profile.Visible[round12ColLocation+1:]...)
		return profile
	}
	video := round12DefaultProfileFor(model.KindVideo)
	image := round12DefaultProfileFor(model.KindImage)
	image.Visible[round12ColPictureCrop] = false
	stored := round12ColumnProfiles{
		Version: 4,
		Video:   dropLocation(video),
		Image:   dropLocation(image),
	}
	data, err := json.Marshal(stored)
	if err != nil {
		t.Fatal(err)
	}
	profiles, accepted, migrated := round12DecodeStoredProfiles(data)
	if !accepted || !migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
	if profiles.Image.Visible[round12ColPictureCrop] {
		t.Fatal("v4 explicit image crop-area hide was not preserved")
	}
	if profiles.Video.Visible[round12ColLocation] || profiles.Image.Visible[round12ColLocation] {
		t.Fatal("new location column must remain hidden after v4 migration")
	}
}

func TestRound12DecodeStoredProfilesRejectsUnknownVersion(t *testing.T) {
	data := []byte(`{"version":99,"video":{"widths":[],"visible":[]},"image":{"widths":[],"visible":[]}}`)
	_, accepted, migrated := round12DecodeStoredProfiles(data)
	if accepted || migrated {
		t.Fatalf("accepted=%v migrated=%v", accepted, migrated)
	}
}

func TestRound12LegacyWidthsBecomeCompactRound12Profiles(t *testing.T) {
	legacy := normalizedTaskColumnWidths(nil)
	legacy[taskColFile] = 360
	profile := round12ProfileFromLegacyWidths(legacy)
	if got := profile.Widths[round12ColFile]; got != 360 {
		t.Fatalf("migrated filename width=%d want=360", got)
	}
	if got := profile.Widths[round12ColPreview]; got != round12Columns[round12ColPreview].width {
		t.Fatalf("preview width=%d want=%d", got, round12Columns[round12ColPreview].width)
	}
	for column := range profile.Visible {
		if got, want := profile.Visible[column], round12DefaultColumnVisible(column); got != want {
			t.Fatalf("column %d visible=%v want=%v", column, got, want)
		}
	}
}

func TestRound12ProfilesSurviveRestartAndRecoverBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-columns-round12.json")
	want := round12ColumnProfiles{
		Version: round12ColumnProfileVersion,
		Video:   round12DefaultProfile(),
		Image:   round12DefaultProfile(),
	}
	want.Video.Visible[round12ColDuration] = true
	want.Video.Widths[round12ColDuration] = 133
	want.Image.Visible[round12ColPictureCrop] = true
	want.Image.Widths[round12ColPictureCrop] = 147
	if err := round12WriteStoredProfiles(path, want); err != nil {
		t.Fatal(err)
	}
	got, accepted, migrated := round12LoadStoredProfiles(path)
	if !accepted || migrated || !reflect.DeepEqual(got, want) {
		t.Fatalf("restart load accepted=%v migrated=%v got=%+v want=%+v", accepted, migrated, got, want)
	}

	backup, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".bak", backup, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"version":3,"video":`), 0o644); err != nil {
		t.Fatal(err)
	}
	recovered, accepted, migrated := round12LoadStoredProfiles(path)
	if !accepted || migrated || !reflect.DeepEqual(recovered, want) {
		t.Fatalf("backup recovery accepted=%v migrated=%v got=%+v want=%+v", accepted, migrated, recovered, want)
	}
}
