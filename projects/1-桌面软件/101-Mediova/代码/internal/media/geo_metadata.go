package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"mediaworkbench/internal/model"
)

type MediaMetadata struct {
	Location    *model.GeoLocation
	CaptureTime string
}

var iso6709Pattern = regexp.MustCompile(`^([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/?$`)

// ParseISO6709 accepts Apple QuickTime ISO 6709 values such as
// +36.1741+120.3865+022.970/ without changing the original WGS84 coordinates.
func ParseISO6709(raw string) (*model.GeoLocation, bool) {
	raw = strings.TrimSpace(raw)
	match := iso6709Pattern.FindStringSubmatch(raw)
	if len(match) == 0 {
		return nil, false
	}
	latitude, errLat := strconv.ParseFloat(match[1], 64)
	longitude, errLon := strconv.ParseFloat(match[2], 64)
	if errLat != nil || errLon != nil {
		return nil, false
	}
	location := &model.GeoLocation{
		Latitude:  latitude,
		Longitude: longitude,
		Source:    "Apple QuickTime / ISO 6709",
		Raw:       raw,
	}
	if match[3] != "" {
		if altitude, err := strconv.ParseFloat(match[3], 64); err == nil {
			location.Altitude = altitude
			location.HasAltitude = true
		}
	}
	return location, location.Valid()
}

func parseCoordinateText(raw string) (*model.GeoLocation, bool) {
	if location, ok := ParseISO6709(raw); ok {
		return location, true
	}
	fields := strings.Fields(strings.NewReplacer(",", " ", ";", " ").Replace(strings.TrimSpace(raw)))
	if len(fields) < 2 {
		return nil, false
	}
	latitude, errLat := strconv.ParseFloat(fields[0], 64)
	longitude, errLon := strconv.ParseFloat(fields[1], 64)
	if errLat != nil || errLon != nil {
		return nil, false
	}
	location := &model.GeoLocation{Latitude: latitude, Longitude: longitude, Raw: raw}
	if len(fields) >= 3 {
		if altitude, err := strconv.ParseFloat(fields[2], 64); err == nil {
			location.Altitude = altitude
			location.HasAltitude = true
		}
	}
	return location, location.Valid()
}

func locationFromTags(tags map[string]string) (*model.GeoLocation, string) {
	if len(tags) == 0 {
		return nil, ""
	}
	normalized := make(map[string]string, len(tags))
	for key, value := range tags {
		normalized[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}
	var location *model.GeoLocation
	for _, key := range []string{
		"com.apple.quicktime.location.iso6709",
		"location",
		"location-eng",
		"gpscoordinates",
	} {
		if candidate, ok := parseCoordinateText(normalized[key]); ok {
			location = candidate
			if location.Source == "" {
				location.Source = "QuickTime GPS"
			}
			break
		}
	}
	if location != nil {
		for _, key := range []string{
			"com.apple.quicktime.location.accuracy.horizontal",
			"gpshpositioningerror",
		} {
			if accuracy, err := strconv.ParseFloat(normalized[key], 64); err == nil && accuracy > 0 {
				location.Accuracy = accuracy
				break
			}
		}
	}
	captureTime := firstNonEmpty(
		normalized["com.apple.quicktime.creationdate"],
		normalized["creation_time"],
		normalized["date_time_original"],
	)
	return location, captureTime
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func recordValue(record map[string]any, names ...string) any {
	for key, value := range record {
		plain := strings.ToLower(strings.TrimSpace(key))
		if colon := strings.LastIndex(plain, ":"); colon >= 0 {
			plain = plain[colon+1:]
		}
		for _, name := range names {
			if plain == strings.ToLower(name) {
				return value
			}
		}
	}
	return nil
}

func valueText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func valueFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case json.Number:
		result, err := typed.Float64()
		return result, err == nil
	case string:
		result, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return result, err == nil
	default:
		return 0, false
	}
}

// ProbeMediaMetadata is intentionally serialized by the caller's single
// metadata worker. Large imports therefore cannot start hundreds of ExifTool
// processes or delay the normal ffprobe and thumbnail workers.
func ProbeMediaMetadata(ctx context.Context, ffmpeg, input string) (MediaMetadata, error) {
	tool := FindExifTool(ffmpeg)
	if tool == "" {
		return MediaMetadata{}, errors.New("ExifTool is unavailable")
	}
	args := []string{
		"-j", "-n", "-m", "-q", "-api", "QuickTimeUTC=1",
		"-GPSLatitude", "-GPSLongitude", "-GPSAltitude",
		"-GPSHPositioningError", "-GPSCoordinates",
		"-DateTimeOriginal", "-CreateDate", "-MediaCreateDate",
		input,
	}
	cmd := exec.CommandContext(ctx, tool, args...)
	configureCommand(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return MediaMetadata{}, ctx.Err()
		}
		return MediaMetadata{}, fmt.Errorf("ExifTool metadata read failed: %w", err)
	}
	decoder := json.NewDecoder(strings.NewReader(string(output)))
	decoder.UseNumber()
	var records []map[string]any
	if err := decoder.Decode(&records); err != nil || len(records) == 0 {
		if err == nil {
			err = errors.New("empty metadata result")
		}
		return MediaMetadata{}, err
	}
	record := records[0]
	result := MediaMetadata{
		CaptureTime: firstNonEmpty(
			valueText(recordValue(record, "DateTimeOriginal")),
			valueText(recordValue(record, "CreateDate")),
			valueText(recordValue(record, "MediaCreateDate")),
		),
	}
	latitude, latOK := valueFloat(recordValue(record, "GPSLatitude"))
	longitude, lonOK := valueFloat(recordValue(record, "GPSLongitude"))
	if latOK && lonOK {
		result.Location = &model.GeoLocation{
			Latitude:  latitude,
			Longitude: longitude,
			Source:    "EXIF GPS",
		}
	} else if raw := valueText(recordValue(record, "GPSCoordinates")); raw != "" {
		result.Location, _ = parseCoordinateText(raw)
		if result.Location != nil && result.Location.Source == "" {
			result.Location.Source = "QuickTime GPS"
		}
	}
	if result.Location != nil {
		if altitude, ok := valueFloat(recordValue(record, "GPSAltitude")); ok {
			result.Location.Altitude = altitude
			result.Location.HasAltitude = true
		}
		if accuracy, ok := valueFloat(recordValue(record, "GPSHPositioningError")); ok && accuracy > 0 {
			result.Location.Accuracy = accuracy
		}
		result.Location.Timestamp = result.CaptureTime
		if !result.Location.Valid() {
			result.Location = nil
		}
	}
	return result, nil
}
