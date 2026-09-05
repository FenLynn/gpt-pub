package media

import "testing"

func TestCompareCriticalMetadata(t *testing.T) {
	source := map[string]any{
		"SourceFile":            "in.jpg",
		"EXIF:DateTimeOriginal": "2024:01:02 03:04:05",
		"EXIF:GPSLatitude":      31.1234567,
		"EXIF:Make":             "Apple",
	}
	output := map[string]any{
		"SourceFile":            "out.webp",
		"EXIF:DateTimeOriginal": "2024:01:02 03:04:05",
		"EXIF:GPSLatitude":      31.1234568,
	}
	result := CompareCriticalMetadata(source, output)
	if result.Checked != 3 || len(result.Missing) != 1 || result.Missing[0] != "EXIF:Make" || len(result.Changed) != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestCompareCriticalMetadataReportsChanged(t *testing.T) {
	result := CompareCriticalMetadata(map[string]any{"EXIF:Model": "A"}, map[string]any{"EXIF:Model": "B"})
	if len(result.Changed) != 1 || result.Warning() == "" {
		t.Fatalf("changed metadata not reported: %+v", result)
	}
}
