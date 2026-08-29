package media

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"sort"
	"strings"

	"mediaworkbench/internal/model"
)

// MetadataAuditResult is intentionally compact: successful audits remain
// silent in the main UI, while only real differences are surfaced as warnings.
type MetadataAuditResult struct {
	Checked int
	Missing []string
	Changed []string
}

func (r MetadataAuditResult) Warning() string {
	parts := make([]string, 0, 2)
	if len(r.Missing) > 0 {
		parts = append(parts, "输出缺少 "+strings.Join(r.Missing, "、"))
	}
	if len(r.Changed) > 0 {
		parts = append(parts, "值不一致 "+strings.Join(r.Changed, "、"))
	}
	return strings.Join(parts, "；")
}

func metadataAuditTags(kind model.Kind) []string {
	common := []string{
		"EXIF:DateTimeOriginal", "EXIF:CreateDate", "EXIF:ModifyDate",
		"EXIF:GPSLatitude", "EXIF:GPSLongitude", "EXIF:GPSAltitude",
		"EXIF:Make", "EXIF:Model", "XMP:DateTimeOriginal", "XMP:CreateDate", "XMP:ModifyDate",
	}
	if kind == model.KindVideo {
		common = append(common,
			"QuickTime:CreateDate", "QuickTime:ModifyDate",
			"QuickTime:TrackCreateDate", "QuickTime:TrackModifyDate",
			"QuickTime:MediaCreateDate", "QuickTime:MediaModifyDate",
			"QuickTime:GPSCoordinates",
		)
	}
	return common
}

func metadataValuesEqual(left, right any) bool {
	lf, lok := left.(float64)
	rf, rok := right.(float64)
	if lok && rok {
		return math.Abs(lf-rf) <= 0.000001
	}
	return strings.TrimSpace(fmt.Sprint(left)) == strings.TrimSpace(fmt.Sprint(right))
}

func CompareCriticalMetadata(source, output map[string]any) MetadataAuditResult {
	result := MetadataAuditResult{}
	keys := make([]string, 0, len(source))
	for key := range source {
		if key != "SourceFile" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := source[key]
		if strings.TrimSpace(fmt.Sprint(value)) == "" {
			continue
		}
		result.Checked++
		other, ok := output[key]
		if !ok || strings.TrimSpace(fmt.Sprint(other)) == "" {
			result.Missing = append(result.Missing, key)
			continue
		}
		if !metadataValuesEqual(value, other) {
			result.Changed = append(result.Changed, key)
		}
	}
	return result
}

// AuditCriticalMetadata reads both files in one ExifTool process. This avoids
// doubling process startup cost for large image queues and never mutates either
// file. Full metadata copying remains PreserveImageMetadata/PreserveVideoDateMetadata.
func AuditCriticalMetadata(ctx context.Context, ffmpeg, source, output string, kind model.Kind) (MetadataAuditResult, error) {
	tool := FindExifTool(ffmpeg)
	if tool == "" {
		return MetadataAuditResult{}, fmt.Errorf("缺少 ExifTool，无法核验关键元数据")
	}
	args := []string{"-j", "-G1", "-n"}
	for _, tag := range metadataAuditTags(kind) {
		args = append(args, "-"+tag)
	}
	args = append(args, source, output)
	cmd := exec.CommandContext(ctx, tool, args...)
	configureCommand(cmd)
	data, err := cmd.Output()
	if err != nil {
		return MetadataAuditResult{}, fmt.Errorf("读取元数据核验结果失败: %w", err)
	}
	var records []map[string]any
	if err := json.Unmarshal(data, &records); err != nil || len(records) != 2 {
		if err == nil {
			err = fmt.Errorf("返回 %d 条记录", len(records))
		}
		return MetadataAuditResult{}, fmt.Errorf("解析元数据核验结果失败: %w", err)
	}
	return CompareCriticalMetadata(records[0], records[1]), nil
}
