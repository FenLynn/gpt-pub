package media

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const HistoryLimitPerKind = 1000

var (
	historyMu                sync.Mutex
	historyThumbnailMu       sync.Mutex
	historyThumbnailJPEGSize = 160
	historyThumbnailJPEGHigh = 90
	historyCachePath         string
	historyCache             []HistoryRecord
	historyCacheLoaded       bool
	historyDirtyChanges      int
	historyFlushTimer        *time.Timer
)

// HistoryRecord is a terminal-task snapshot. New fields deliberately retain
// the central list's useful context instead of relying on result prose.
// Older history.json entries remain readable because every new field is
// optional during JSON decoding.
type HistoryRecord struct {
	ID                string       `json:"id,omitempty"`
	Kind              model.Kind   `json:"kind,omitempty"`
	Status            model.Status `json:"status,omitempty"`
	CompletedAt       time.Time    `json:"completed_at"`
	Input             string       `json:"input"`
	Output            string       `json:"output"`
	Thumbnail         string       `json:"thumbnail,omitempty"`
	InputSize         int64        `json:"input_size"`
	OutputSize        int64        `json:"output_size"`
	SourceWidth       int          `json:"source_width,omitempty"`
	SourceHeight      int          `json:"source_height,omitempty"`
	SourceDurationSec float64      `json:"source_duration_secs,omitempty"`
	SourceFPS         float64      `json:"source_fps,omitempty"`
	SourceRotation    int          `json:"source_rotation,omitempty"`
	SourceVideoCodec  string       `json:"source_video_codec,omitempty"`
	SourceAudioCodec  string       `json:"source_audio_codec,omitempty"`
	AudioStreams      int          `json:"audio_streams,omitempty"`
	SubtitleStreams   int          `json:"subtitle_streams,omitempty"`
	Resolution        string       `json:"resolution"`
	OutputResolution  string       `json:"output_resolution,omitempty"`
	Codec             string       `json:"codec"`
	Quality           string       `json:"quality"`
	Rotation          string       `json:"rotation"`
	VolumeMode        string       `json:"volume_mode,omitempty"`
	AudioMode         string       `json:"audio_mode,omitempty"`
	SubtitleMode      string       `json:"subtitle_mode,omitempty"`
	CropSummary       string       `json:"crop_summary,omitempty"`
	Progress          float64      `json:"progress,omitempty"`
	Engine            string       `json:"engine"`
	FailureCategory   string       `json:"failure_category,omitempty"`
	Error             string       `json:"error,omitempty"`
	ValidationWarning string       `json:"validation_warning,omitempty"`
	DurationSecs      float64      `json:"duration_secs"`
	Result            string       `json:"result"`
}

func historyKindFromLegacy(record HistoryRecord) model.Kind {
	codec := strings.ToLower(strings.TrimSpace(record.Codec))
	switch codec {
	case "jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "bmp", "gif":
		return model.KindImage
	default:
		return model.KindVideo
	}
}

func historyStatusFromResult(value string) model.Status {
	value = strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.Contains(value, "失败"), strings.Contains(value, "failed"):
		return model.StatusFailed
	case strings.Contains(value, "跳过"), strings.Contains(value, "skipped"):
		return model.StatusSkipped
	case strings.Contains(value, "停止"), strings.Contains(value, "cancel"):
		return model.StatusCancelled
	case strings.Contains(value, "完成"), strings.Contains(value, "done"):
		return model.StatusDone
	default:
		return model.StatusFailed
	}
}

func historyRecordID(record HistoryRecord) string {
	if strings.TrimSpace(record.ID) != "" {
		return strings.TrimSpace(record.ID)
	}
	payload := strings.Join([]string{record.Input, record.Output, record.CompletedAt.UTC().Format(time.RFC3339Nano), record.Result}, "\n")
	sum := sha256.Sum256([]byte(payload))
	return "legacy-" + hex.EncodeToString(sum[:12])
}

func NewHistoryRecordID() string {
	var random [12]byte
	if _, err := rand.Read(random[:]); err == nil {
		return hex.EncodeToString(random[:])
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	return hex.EncodeToString(sum[:12])
}

func normalizeHistoryRecord(record HistoryRecord) HistoryRecord {
	record.ID = historyRecordID(record)
	if record.Kind != model.KindVideo && record.Kind != model.KindImage {
		record.Kind = historyKindFromLegacy(record)
	}
	switch record.Status {
	case model.StatusDone, model.StatusFailed, model.StatusSkipped, model.StatusCancelled:
	default:
		record.Status = historyStatusFromResult(record.Result)
	}
	if record.Progress <= 0 {
		switch record.Status {
		case model.StatusDone:
			record.Progress = 100
		case model.StatusFailed, model.StatusSkipped, model.StatusCancelled:
			record.Progress = 99
		}
	}
	if record.OutputResolution == "" {
		record.OutputResolution = record.Resolution
	}
	return record
}

func loadHistoryUnlocked() []HistoryRecord {
	path, err := config.HistoryPath()
	if err != nil {
		return nil
	}
	if historyCacheLoaded && historyCachePath == path {
		return append([]HistoryRecord(nil), historyCache...)
	}
	// Tests, portable-mode switches and migrations may change the data root
	// during one process. Persist the old root before changing cache authority.
	_ = flushHistoryUnlocked()
	b, err := os.ReadFile(path)
	if err != nil {
		historyCachePath = path
		historyCache = nil
		historyCacheLoaded = true
		return nil
	}
	var records []HistoryRecord
	if json.Unmarshal(b, &records) != nil {
		historyCachePath = path
		historyCache = nil
		historyCacheLoaded = true
		return nil
	}
	for i := range records {
		records[i] = normalizeHistoryRecord(records[i])
	}
	historyCachePath = path
	historyCache = records
	historyCacheLoaded = true
	return append([]HistoryRecord(nil), records...)
}

func flushHistoryUnlocked() error {
	if !historyCacheLoaded || historyDirtyChanges == 0 || historyCachePath == "" {
		return nil
	}
	if historyFlushTimer != nil {
		historyFlushTimer.Stop()
		historyFlushTimer = nil
	}
	if err := config.SaveJSON(historyCachePath, historyCache); err != nil {
		return err
	}
	historyDirtyChanges = 0
	return nil
}

func setHistoryUnlocked(items []HistoryRecord) {
	historyCache = append(historyCache[:0], items...)
	historyCacheLoaded = true
	historyDirtyChanges++
}

func scheduleHistoryFlushUnlocked() error {
	// A bounded count protects history even during a continuously busy queue;
	// the timer collapses the common burst of many nearly simultaneous finishes.
	if historyDirtyChanges >= 25 {
		return flushHistoryUnlocked()
	}
	if historyFlushTimer == nil {
		historyFlushTimer = time.AfterFunc(time.Second, func() {
			historyMu.Lock()
			historyFlushTimer = nil
			_ = flushHistoryUnlocked()
			historyMu.Unlock()
		})
	}
	return nil
}

// FlushHistory makes all coalesced terminal records durable. It is called on
// clean application shutdown and before history is displayed or cleared.
func FlushHistory() error {
	historyMu.Lock()
	defer historyMu.Unlock()
	return flushHistoryUnlocked()
}

func LoadHistory() []HistoryRecord {
	historyMu.Lock()
	defer historyMu.Unlock()
	items := loadHistoryUnlocked()
	_ = flushHistoryUnlocked()
	return items
}

// WriteFailureCenterHTML creates one replace-in-place report. It deliberately
// reuses history.json instead of introducing another database or thumbnail
// lifecycle, so the failure centre can never become a second garbage pile.
func WriteFailureCenterHTML() (string, int, error) {
	historyMu.Lock()
	defer historyMu.Unlock()
	records := loadHistoryUnlocked()
	failures := make([]HistoryRecord, 0)
	for _, record := range records {
		if record.Status == model.StatusFailed {
			failures = append(failures, record)
		}
	}
	sort.SliceStable(failures, func(i, j int) bool { return failures[i].CompletedAt.After(failures[j].CompletedAt) })
	dir, err := config.Dir()
	if err != nil {
		return "", 0, err
	}
	path := filepath.Join(dir, "failure-center.html")
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mediova 失败任务中心</title><style>:root{font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:#243b53;background:#f6f8fb}*{box-sizing:border-box}body{margin:18px}h1{font-size:21px;margin:0}.sub{font-size:12px;color:#718096;margin:6px 0 15px}.tools{display:flex;gap:8px;margin-bottom:12px}.tools input,.tools select{height:34px;border:1px solid #cbd8e6;border-radius:6px;background:#fff;padding:0 10px;color:#243b53}.tools input{width:min(520px,70vw)}.wrap{overflow:auto;max-height:calc(100vh - 150px);background:#fff;border:1px solid #d9e2ec;border-radius:8px}table{border-collapse:collapse;min-width:1500px;width:100%;font-size:12px}th,td{border-bottom:1px solid #edf1f5;padding:8px;vertical-align:top;text-align:left}th{position:sticky;top:0;background:#f3f7fb;color:#486581;z-index:2}.kind{color:#526d82}.category{color:#b44b3e;font-weight:600}.error{white-space:normal;min-width:280px;max-width:480px;word-break:break-word}.path{white-space:normal;min-width:260px;max-width:420px;word-break:break-all}.file-link{color:#176ac1;text-decoration:none}.path-actions{display:flex;gap:5px;margin-top:5px}.folder-link,.copy-path{height:23px;padding:0 8px;border:1px solid #bfd4e8;border-radius:12px;background:#fff;color:#2571b8;font-size:11px;line-height:21px;text-decoration:none;cursor:pointer}.empty{padding:36px;text-align:center;color:#718096}</style></head><body>`)
	fmt.Fprintf(&b, `<h1>失败任务中心（%d）</h1><p class="sub">这里只汇总历史中的失败记录，不占用主界面；文件每次打开都会覆盖更新。需要重试时，回到软件使用“任务管理 → 重新准备失败任务”。</p>`, len(failures))
	b.WriteString(`<div class="tools"><input id="q" type="search" placeholder="搜索文件名、路径、失败分类或错误"><select id="kind"><option value="">全部类型</option><option value="video">视频</option><option value="image">图片</option></select><span id="count"></span></div><div class="wrap">`)
	if len(failures) == 0 {
		b.WriteString(`<div class="empty">当前没有失败记录。</div>`)
	} else {
		b.WriteString(`<table><thead><tr><th>时间</th><th>类型</th><th>失败分类</th><th>错误详情</th><th>输入文件</th><th>预定输出</th><th>引擎 / 阶段</th></tr></thead><tbody>`)
		for _, record := range failures {
			kindLabel := "视频"
			if record.Kind == model.KindImage {
				kindLabel = "图片"
			}
			fmt.Fprintf(&b, `<tr data-kind="%s"><td>%s</td><td class="kind">%s</td><td class="category">%s</td><td class="error">%s</td><td class="path">%s%s</td><td class="path">%s%s</td><td>%s</td></tr>`, record.Kind, record.CompletedAt.Format("2006-01-02 15:04:05"), kindLabel, html.EscapeString(record.FailureCategory), html.EscapeString(record.Error), historyPathHTML(record.Input), historyFolderActionsHTML(record.Input, "打开输入文件夹"), historyPathHTML(record.Output), historyFolderActionsHTML(record.Output, "打开输出文件夹"), html.EscapeString(record.Engine))
		}
		b.WriteString(`</tbody></table>`)
	}
	b.WriteString(`</div><script>const q=document.getElementById('q'),kind=document.getElementById('kind'),count=document.getElementById('count');function apply(){let shown=0;document.querySelectorAll('tbody tr').forEach(r=>{const ok=(!kind.value||r.dataset.kind===kind.value)&&(!q.value||r.textContent.toLowerCase().includes(q.value.toLowerCase()));r.hidden=!ok;if(ok)shown++});count.textContent='显示 '+shown+' 条'}q.oninput=apply;kind.onchange=apply;apply();document.querySelectorAll('.copy-path').forEach(button=>button.onclick=()=>navigator.clipboard.writeText(button.dataset.path||''));</script></body></html>`)
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		return "", 0, err
	}
	return path, len(failures), nil
}

func historyThumbnailDir() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "history-thumbnails")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func historyThumbnailRelative(recordID string) string {
	return filepath.ToSlash(filepath.Join("history-thumbnails", recordID+".jpg"))
}

func historyThumbnailPath(recordID string) (string, error) {
	if strings.TrimSpace(recordID) == "" || strings.ContainsAny(recordID, `\\/:*?"<>|`) {
		return "", fmt.Errorf("invalid history thumbnail id")
	}
	dir, err := historyThumbnailDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, recordID+".jpg"), nil
}

func removeHistoryThumbnail(record HistoryRecord) {
	path, err := historyThumbnailPath(record.ID)
	if err == nil {
		_ = os.Remove(path)
	}
}

func trimHistory(records []HistoryRecord) (kept, removed []HistoryRecord) {
	counts := map[model.Kind]int{}
	kept = make([]HistoryRecord, 0, len(records))
	for _, raw := range records {
		record := normalizeHistoryRecord(raw)
		if counts[record.Kind] >= HistoryLimitPerKind {
			removed = append(removed, record)
			continue
		}
		counts[record.Kind]++
		kept = append(kept, record)
	}
	return kept, removed
}

func AppendHistory(record HistoryRecord) error {
	historyMu.Lock()
	defer historyMu.Unlock()
	record = normalizeHistoryRecord(record)
	items := append([]HistoryRecord{record}, loadHistoryUnlocked()...)
	items, removed := trimHistory(items)
	path, err := config.HistoryPath()
	if err != nil {
		return err
	}
	historyCachePath = path
	setHistoryUnlocked(items)
	for _, item := range removed {
		removeHistoryThumbnail(item)
	}
	return scheduleHistoryFlushUnlocked()
}

// AttachHistoryThumbnail publishes a completed thumbnail only when its record
// still exists. A concurrent manual clear or rolling eviction therefore leaves
// no stray image behind.
func AttachHistoryThumbnail(recordID, relative string) error {
	historyMu.Lock()
	defer historyMu.Unlock()
	items := loadHistoryUnlocked()
	found := false
	for i := range items {
		if items[i].ID == recordID {
			items[i].Thumbnail = relative
			found = true
			break
		}
	}
	if !found {
		removeHistoryThumbnail(HistoryRecord{ID: recordID})
		return nil
	}
	path, err := config.HistoryPath()
	if err != nil {
		return err
	}
	historyCachePath = path
	setHistoryUnlocked(items)
	return scheduleHistoryFlushUnlocked()
}

func ClearHistoryKind(kind model.Kind) (int, error) {
	if kind != model.KindVideo && kind != model.KindImage {
		return 0, fmt.Errorf("invalid history kind")
	}
	historyMu.Lock()
	defer historyMu.Unlock()
	items := loadHistoryUnlocked()
	kept := make([]HistoryRecord, 0, len(items))
	removed := make([]HistoryRecord, 0)
	for _, record := range items {
		if record.Kind == kind {
			removed = append(removed, record)
		} else {
			kept = append(kept, record)
		}
	}
	path, err := config.HistoryPath()
	if err != nil {
		return 0, err
	}
	historyCachePath = path
	setHistoryUnlocked(kept)
	if err := flushHistoryUnlocked(); err != nil {
		return 0, err
	}
	for _, record := range removed {
		removeHistoryThumbnail(record)
	}
	return len(removed), nil
}

func ClearHistory() error {
	historyMu.Lock()
	defer historyMu.Unlock()
	path, err := config.HistoryPath()
	if err != nil {
		return err
	}
	if historyFlushTimer != nil {
		historyFlushTimer.Stop()
		historyFlushTimer = nil
	}
	historyCachePath = path
	historyCache = nil
	historyCacheLoaded = true
	historyDirtyChanges = 0
	_ = os.Remove(path)
	htmlPath, _ := config.HistoryHTMLPath()
	if htmlPath != "" {
		_ = os.Remove(htmlPath)
	}
	dir, dirErr := historyThumbnailDir()
	if dirErr == nil {
		_ = os.RemoveAll(dir)
	}
	return nil
}

// CleanupHistoryThumbnails removes only files in the dedicated history
// thumbnail directory that are no longer referenced by history.json. It is
// safe to run on startup and after interrupted history writes.
func CleanupHistoryThumbnails() error {
	historyMu.Lock()
	defer historyMu.Unlock()
	items := loadHistoryUnlocked()
	allowed := make(map[string]bool, len(items))
	for _, record := range items {
		if record.ID != "" && record.Thumbnail != "" {
			allowed[record.ID+".jpg"] = true
		}
	}
	dir, err := historyThumbnailDir()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || allowed[entry.Name()] {
			continue
		}
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".jpg") || strings.HasSuffix(strings.ToLower(entry.Name()), ".tmp") {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
	return nil
}

// StoreHistoryThumbnail writes a compact, independent JPEG. The serialized
// history record owns this file; task-list thumbnail cache cleanup never does.
func StoreHistoryThumbnail(ctx context.Context, ffmpeg, source, output, recordID, rotation string, duration float64) (string, error) {
	if strings.TrimSpace(ffmpeg) == "" || strings.TrimSpace(recordID) == "" {
		return "", nil
	}
	input := output
	if info, err := os.Stat(input); err != nil || info.IsDir() {
		input = source
	}
	if info, err := os.Stat(input); err != nil || info.IsDir() {
		return "", nil
	}
	path, err := historyThumbnailPath(recordID)
	if err != nil {
		return "", err
	}
	historyThumbnailMu.Lock()
	defer historyThumbnailMu.Unlock()
	if info, statErr := os.Stat(path); statErr == nil && info.Size() > 128 {
		return historyThumbnailRelative(recordID), nil
	}
	tmp := path + fmt.Sprintf(".%d.tmp.jpg", time.Now().UnixNano())
	defer os.Remove(tmp)
	at := 0.0
	if duration > 1 {
		at = duration * .05
	}
	if err := GenerateThumbnailJPEG(ctx, ffmpeg, input, tmp, at, rotation, historyThumbnailJPEGSize, historyThumbnailJPEGHigh); err != nil {
		return "", err
	}
	if FileSize(tmp) <= 128 {
		return "", fmt.Errorf("history thumbnail output is empty")
	}
	_ = os.Remove(path)
	if err := os.Rename(tmp, path); err != nil {
		return "", err
	}
	return historyThumbnailRelative(recordID), nil
}

func historyStatusClass(status model.Status) string {
	switch status {
	case model.StatusDone:
		return "done"
	case model.StatusFailed:
		return "failed"
	case model.StatusSkipped:
		return "skipped"
	case model.StatusCancelled:
		return "cancelled"
	default:
		return "other"
	}
}

func historyStatusLabel(status model.Status) string {
	switch status {
	case model.StatusDone:
		return "完成"
	case model.StatusFailed:
		return "失败"
	case model.StatusSkipped:
		return "已跳过"
	case model.StatusCancelled:
		return "已停止"
	default:
		return "其他"
	}
}

func historyRatio(record HistoryRecord) (float64, string, string) {
	if record.InputSize <= 0 || record.OutputSize <= 0 {
		return 0, "—", ""
	}
	ratio := float64(record.OutputSize) / float64(record.InputSize) * 100
	label := fmt.Sprintf("%s (%.1f%%)", FormatBytes(record.OutputSize), ratio)
	change := 100 - ratio
	if change >= 0 {
		return ratio, label, fmt.Sprintf("节省 %.1f%%", change)
	}
	return ratio, label, fmt.Sprintf("增加 %.1f%%", -change)
}

func historyVolumeClass(record HistoryRecord) string {
	if record.InputSize <= 0 || record.OutputSize <= 0 {
		return "unknown"
	}
	ratio := float64(record.OutputSize) / float64(record.InputSize)
	switch {
	case ratio >= 1.1:
		return "larger"
	case ratio <= 0.9:
		return "smaller"
	default:
		return "unchanged"
	}
}

func historyThumbnailHTML(record HistoryRecord) string {
	if record.Thumbnail == "" {
		return `<span class="thumb-placeholder">无预览</span>`
	}
	name := filepath.Base(record.Thumbnail)
	if name != record.ID+".jpg" {
		return `<span class="thumb-placeholder">无预览</span>`
	}
	return `<img class="thumb" loading="lazy" src="` + html.EscapeString(filepath.ToSlash(filepath.Join("history-thumbnails", name))) + `" alt="缩略图">`
}

func historyPathHTML(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return `<span class="missing">—</span>`
	}
	display := html.EscapeString(path)
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return `<span class="missing" title="文件不存在或已移动">` + display + `<span class="missing-badge">文件不存在</span></span>`
	}
	href, err := historyFileURL(path)
	if err != nil {
		return `<span class="missing">` + display + `</span>`
	}
	return `<a class="file-link" href="` + html.EscapeString(href) + `" target="_blank" rel="noopener" title="点击打开或播放文件">` + display + `</a>`
}

func historyFolderActionsHTML(path, label string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	dir := filepath.Dir(path)
	copyButton := `<button type="button" class="copy-path" data-path="` + html.EscapeString(dir) + `">复制路径</button>`
	href, err := historyFileURL(dir)
	if err != nil {
		return `<div class="path-actions">` + copyButton + `</div>`
	}
	return `<div class="path-actions"><a class="folder-link" href="` + html.EscapeString(href) + `" target="_blank" rel="noopener" title="在文件资源管理器中打开">` + html.EscapeString(label) + `</a>` + copyButton + `</div>`
}

func historyFileURL(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	slash := filepath.ToSlash(absolute)
	if strings.HasPrefix(slash, "//") {
		parts := strings.SplitN(strings.TrimPrefix(slash, "//"), "/", 2)
		fileURL := &url.URL{Scheme: "file", Host: parts[0], Path: "/"}
		if len(parts) == 2 {
			fileURL.Path += parts[1]
		}
		return fileURL.String(), nil
	}
	if filepath.VolumeName(absolute) != "" && !strings.HasPrefix(slash, "/") {
		slash = "/" + slash
	}
	return (&url.URL{Scheme: "file", Path: slash}).String(), nil
}

func formatDurationSeconds(v float64) string {
	if v < 0 {
		v = 0
	}
	d := time.Duration(v * float64(time.Second))
	if d < time.Minute {
		return fmt.Sprintf("%02d:%02d", int(d/time.Second)/60, int(d/time.Second)%60)
	}
	return fmt.Sprintf("%02d:%02d:%02d", int(d/time.Hour), int(d/time.Minute)%60, int(d/time.Second)%60)
}

func historySourceResolution(record HistoryRecord) string {
	if record.SourceWidth > 0 && record.SourceHeight > 0 {
		return fmt.Sprintf("%d×%d", record.SourceWidth, record.SourceHeight)
	}
	return "检测未知"
}

func historyMediaDuration(record HistoryRecord) string {
	if record.Kind == model.KindImage {
		return "图片"
	}
	if record.SourceDurationSec <= 0 {
		return "—"
	}
	return formatDurationSeconds(record.SourceDurationSec)
}

func historyProgressWidth(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func historyTableHTML(records []HistoryRecord, kind model.Kind) string {
	var b strings.Builder
	for _, record := range records {
		if record.Kind != kind {
			continue
		}
		statusClass := historyStatusClass(record.Status)
		ratio, compressed, change := historyRatio(record)
		volumeClass := historyVolumeClass(record)
		barClass := "good"
		if ratio > 100 {
			barClass = "large"
		}
		progress := historyProgressWidth(record.Progress)
		fmt.Fprintf(&b, `<tr class="row-%s" data-status="%s" data-volume="%s">`, statusClass, statusClass, volumeClass)
		fmt.Fprintf(&b, `<td class="c-preview">%s</td>`, historyThumbnailHTML(record))
		fmt.Fprintf(&b, `<td class="c-name path">%s%s</td>`, historyPathHTML(record.Input), historyFolderActionsHTML(record.Input, "打开输入文件夹"))
		fmt.Fprintf(&b, `<td class="c-source">%s</td><td class="c-duration">%s</td><td class="c-direction">%d°</td>`, historySourceResolution(record), historyMediaDuration(record), record.SourceRotation)
		fmt.Fprintf(&b, `<td class="c-output">%s</td><td class="c-format">%s</td><td class="c-quality">%s</td><td class="c-rotation">%s</td>`, html.EscapeString(record.OutputResolution), html.EscapeString(record.Codec), html.EscapeString(record.Quality), html.EscapeString(record.Rotation))
		fmt.Fprintf(&b, `<td class="c-input-size num">%s</td>`, FormatBytes(record.InputSize))
		fmt.Fprintf(&b, `<td class="c-output-size"><div class="ratio-bar %s"><span style="width:%.1f%%"></span><em>%s</em></div><small>%s</small></td>`, barClass, historyProgressWidth(ratio), html.EscapeString(compressed), html.EscapeString(change))
		fmt.Fprintf(&b, `<td class="c-progress"><div class="progress-bar"><span style="width:%.1f%%"></span><em>%.1f%%</em></div></td>`, progress, record.Progress)
		fmt.Fprintf(&b, `<td class="c-status"><span class="status-badge %s"><i></i>%s</span></td>`, statusClass, historyStatusLabel(record.Status))
		fmt.Fprintf(&b, `<td class="c-result">%s</td><td class="c-failure">%s</td><td class="c-warning">%s</td>`, html.EscapeString(record.Result), html.EscapeString(record.FailureCategory), html.EscapeString(record.ValidationWarning))
		audio := strings.Trim(strings.Join([]string{record.SourceAudioCodec, record.AudioMode, fmt.Sprintf("字幕 %d", record.SubtitleStreams)}, " · "), " ·")
		fmt.Fprintf(&b, `<td class="c-engine">%s</td><td class="c-process">%s</td><td class="c-audio">%s</td><td class="c-time">%s</td>`, html.EscapeString(record.Engine), html.EscapeString(record.CropSummary), html.EscapeString(audio), formatDurationSeconds(record.DurationSecs))
		fmt.Fprintf(&b, `<td class="c-output-path path">%s%s</td><td class="c-finished">%s</td></tr>`, historyPathHTML(record.Output), historyFolderActionsHTML(record.Output, "打开输出文件夹"), record.CompletedAt.Format("2006-01-02 15:04:05"))
	}
	return b.String()
}

type historyCounts struct {
	total, done, failed, skipped, cancelled int
	input, output                           int64
}

func countHistory(records []HistoryRecord, kind model.Kind) historyCounts {
	var counts historyCounts
	for _, record := range records {
		if record.Kind != kind {
			continue
		}
		counts.total++
		counts.input += record.InputSize
		counts.output += record.OutputSize
		switch record.Status {
		case model.StatusDone:
			counts.done++
		case model.StatusFailed:
			counts.failed++
		case model.StatusSkipped:
			counts.skipped++
		case model.StatusCancelled:
			counts.cancelled++
		}
	}
	return counts
}

func historySavedRatio(counts historyCounts) string {
	if counts.input <= 0 {
		return "—"
	}
	value := 100 - float64(counts.output)/float64(counts.input)*100
	if value >= 0 {
		return fmt.Sprintf("%.1f%%", value)
	}
	return fmt.Sprintf("增加 %.1f%%", -value)
}

func WriteHistoryHTML() (string, error) {
	historyMu.Lock()
	defer historyMu.Unlock()
	records := loadHistoryUnlocked()
	sort.SliceStable(records, func(i, j int) bool { return records[i].CompletedAt.After(records[j].CompletedAt) })
	video, image := countHistory(records, model.KindVideo), countHistory(records, model.KindImage)
	path, err := config.HistoryHTMLPath()
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mediova 历史记录</title><style>
:root{color-scheme:light;font-family:"Microsoft YaHei UI","Microsoft YaHei",Arial,sans-serif;color:#18314d;background:#f7f9fc}*{box-sizing:border-box}body{margin:18px}.head{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;flex-wrap:wrap}h1{font-size:22px;margin:0 0 5px}.sub{margin:0;color:#667085;font-size:13px}.caps{font-size:12px;color:#667085}.tabs{display:flex;gap:7px;margin:16px 0 10px}.tab{border:1px solid #cbd8e8;background:#fff;border-radius:7px;padding:8px 15px;cursor:pointer;color:#45617f}.tab.active{background:#e8f3ff;color:#176ac1;border-color:#8fc3f4;font-weight:600}.cards{display:flex;flex-wrap:wrap;gap:9px;margin:10px 0 14px}.card{background:#fff;border:1px solid #dce4ee;border-radius:8px;min-width:112px;padding:8px 12px;color:#63758b;font-size:12px}.card b{display:block;font-size:18px;color:#1f3853;margin-top:2px}.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.tools input,.tools select,.tools button{height:34px;border:1px solid #c9d7e6;border-radius:6px;background:#fff;padding:0 10px;color:#263c55;font-size:13px}.tools input{min-width:310px}.tools button{cursor:pointer}.primary{background:#2f7ed8!important;border-color:#2f7ed8!important;color:#fff!important}.wrap{overflow:auto;border:1px solid #d7e0eb;background:#fff;border-radius:8px;max-height:calc(100vh - 260px)}table{border-collapse:separate;border-spacing:0;min-width:2260px;width:100%;font-size:12px}th,td{border-right:1px solid #edf1f5;border-bottom:1px solid #edf1f5;padding:7px 8px;text-align:left;vertical-align:middle;white-space:nowrap}th{background:#f5f8fc;color:#39536f;font-weight:600;text-align:center;position:sticky;top:0;z-index:2}.path{white-space:normal;min-width:230px;max-width:390px;word-break:break-all}.file-link{color:#176ac1;text-decoration:none}.file-link:hover{text-decoration:underline}.missing{color:#98a4b3}.missing-badge{margin-left:5px;font-size:11px;color:#b87213}.path-actions{display:flex;gap:5px;margin-top:5px;white-space:nowrap}.folder-link,.copy-path{height:23px;padding:0 8px;border:1px solid #bfd4e8;border-radius:12px;background:#fff;color:#2571b8;font-size:11px;line-height:21px;text-decoration:none;cursor:pointer}.thumb{width:80px;height:45px;object-fit:cover;border-radius:3px;display:block;background:#edf2f7}.thumb-placeholder{display:grid;place-items:center;width:80px;height:45px;color:#8392a4;background:#f4f6f8;border:1px solid #e0e6ec;border-radius:3px}.row-done{background:#f0fbf5}.row-failed{background:#fff4f3}.row-skipped{background:#f5f7f9}.row-cancelled{background:#fff9ee}.status-badge{display:inline-flex;align-items:center;gap:6px}.status-badge i{width:8px;height:8px;border-radius:50%;background:#8090a1}.status-badge.done{color:#178948}.status-badge.done i{background:#259c57}.status-badge.failed{color:#c9453e}.status-badge.failed i{background:#dc564e;border-radius:1px;transform:rotate(45deg)}.status-badge.skipped{color:#687787}.status-badge.skipped i{width:10px;height:2px;border-radius:2px;background:#7c8997}.status-badge.cancelled{color:#aa7321}.status-badge.cancelled i{border-radius:1px;background:#bd8125}.ratio-bar,.progress-bar{height:23px;min-width:136px;position:relative;overflow:hidden;background:#eef3f8}.ratio-bar span,.progress-bar span{display:block;height:100%;background:linear-gradient(90deg,#e1f5e9,#53b875)}.ratio-bar.large span{background:linear-gradient(90deg,#ffe9be,#ef705f)}.progress-bar span{background:linear-gradient(90deg,#d9ebff,#72a9ee)}.ratio-bar em,.progress-bar em{position:absolute;inset:0;display:grid;place-items:center;font-style:normal;color:#24415d}.ratio-bar+small{display:block;color:#718198;margin-top:3px}.num{text-align:right}.hidden,.panel.hidden{display:none!important}.columns{position:relative}.column-pop{position:absolute;right:0;top:38px;z-index:5;width:300px;max-height:420px;overflow:auto;padding:10px;background:#fff;border:1px solid #cbd8e6;border-radius:8px;box-shadow:0 8px 24px #17324a22}.column-pop label{display:inline-flex;width:50%;padding:5px 2px;gap:5px;font-size:12px;cursor:pointer}@media(max-width:720px){body{margin:10px}.tools input{min-width:180px}.wrap{max-height:calc(100vh - 300px)}}</style></head><body>`)
	fmt.Fprintf(&b, `<div class="head"><div><h1>Mediova 转换历史</h1><p class="sub">视频与图片各保留最近 %d 条；新记录替换同类最旧记录，并同步删除对应历史缩略图。</p></div><div class="caps">历史缩略图仅随记录保存；软件“历史记录”菜单可按类型或全部清除。</div></div>`, HistoryLimitPerKind)
	b.WriteString(`<div class="tabs"><button class="tab active" data-kind="video">视频历史</button><button class="tab" data-kind="image">图片历史</button></div>`)
	fmt.Fprintf(&b, `<div class="cards" data-kind="video"><div class="card">记录<b>%d / %d</b></div><div class="card">完成<b>%d</b></div><div class="card">失败<b>%d</b></div><div class="card">跳过 / 停止<b>%d / %d</b></div></div>`, video.total, HistoryLimitPerKind, video.done, video.failed, video.skipped, video.cancelled)
	fmt.Fprintf(&b, `<div class="cards hidden" data-kind="image"><div class="card">记录<b>%d / %d</b></div><div class="card">完成<b>%d</b></div><div class="card">失败<b>%d</b></div><div class="card">跳过 / 停止<b>%d / %d</b></div></div>`, image.total, HistoryLimitPerKind, image.done, image.failed, image.skipped, image.cancelled)
	b.WriteString(`<div class="tools"><input id="q" type="search" placeholder="搜索文件名、路径、状态、失败分类、编码或错误内容"><select id="status"><option value="">全部状态</option><option value="done">完成</option><option value="failed">失败</option><option value="skipped">已跳过</option><option value="cancelled">已停止</option></select><button id="csv" class="primary">导出当前结果 CSV</button><span class="columns"><button id="columns">选择列</button><div id="column-pop" class="column-pop hidden"></div></span><span id="count"></span></div>`)
	fmt.Fprintf(&b, `<div class="caps" data-kind="video">累计节省：%s</div><div class="caps hidden" data-kind="image">累计节省：%s</div>`, historySavedRatio(video), historySavedRatio(image))
	head := `<thead><tr><th data-col="preview">预览</th><th data-col="name">输入文件</th><th data-col="source">分辨率</th><th data-col="duration">时长</th><th data-col="direction">方向</th><th data-col="output">输出分辨率</th><th data-col="format">格式</th><th data-col="quality">质量</th><th data-col="rotation">旋转</th><th data-col="input-size">体积</th><th data-col="output-size">压缩后</th><th data-col="progress">进度</th><th data-col="status">状态</th><th data-col="result">结果</th><th data-col="failure">失败分类</th><th data-col="warning">校验警告</th><th data-col="engine">编码引擎</th><th data-col="process">剪辑 / 画面</th><th data-col="audio">音频 / 字幕</th><th data-col="time">处理耗时</th><th data-col="output-path">输出文件</th><th data-col="finished">完成时间</th></tr></thead>`
	b.WriteString(`<section class="panel" data-kind="video"><div class="wrap"><table id="video-table">` + head + `<tbody>` + historyTableHTML(records, model.KindVideo) + `</tbody></table></div></section>`)
	b.WriteString(`<section class="panel hidden" data-kind="image"><div class="wrap"><table id="image-table">` + head + `<tbody>` + historyTableHTML(records, model.KindImage) + `</tbody></table></div></section>`)
	b.WriteString(`<script>
const key='mediova-history-columns-v2',q=document.getElementById('q'),status=document.getElementById('status'),count=document.getElementById('count'),pop=document.getElementById('column-pop'),colButton=document.getElementById('columns');let kind='video';const columnNames={preview:'预览',name:'输入文件',source:'分辨率',duration:'时长',direction:'方向',output:'输出分辨率',format:'格式',quality:'质量',rotation:'旋转','input-size':'体积','output-size':'压缩后',progress:'进度',status:'状态',result:'结果',failure:'失败分类',warning:'校验警告',engine:'编码引擎',process:'剪辑 / 画面',audio:'音频 / 字幕',time:'处理耗时','output-path':'输出文件',finished:'完成时间'};let columns=JSON.parse(localStorage.getItem(key)||'{}');
function table(){return document.getElementById(kind+'-table')}function applyColumns(){for(const [name,on] of Object.entries(columns)){for(const node of document.querySelectorAll('[data-col="'+name+'"],.c-'+name))node.style.display=on===false?'none':''}pop.innerHTML='';for(const [name,label] of Object.entries(columnNames)){const checked=columns[name]!==false;pop.insertAdjacentHTML('beforeend','<label><input type="checkbox" data-name="'+name+'" '+(checked?'checked':'')+'>'+label+'</label>')}pop.querySelectorAll('input').forEach(x=>x.onchange=()=>{columns[x.dataset.name]=x.checked;localStorage.setItem(key,JSON.stringify(columns));applyColumns()})}applyColumns();
function apply(){const needle=q.value.trim().toLowerCase(),want=status.value;let n=0;for(const row of table().tBodies[0].rows){const ok=(!needle||row.innerText.toLowerCase().includes(needle))&&(!want||row.dataset.status===want);row.classList.toggle('hidden',!ok);if(ok)n++}count.textContent='当前显示 '+n+' 条'}q.oninput=apply;status.onchange=apply;
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{kind=tab.dataset.kind;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.cards,.panel,.caps[data-kind]').forEach(x=>x.classList.toggle('hidden',x.dataset.kind!==kind));apply();applyColumns()});colButton.onclick=()=>pop.classList.toggle('hidden');document.addEventListener('click',e=>{if(!e.target.closest('.columns'))pop.classList.add('hidden');const button=e.target.closest('.copy-path');if(!button)return;const path=button.dataset.path||'',old=button.textContent,done=()=>{button.textContent='已复制';setTimeout(()=>button.textContent=old,1200)};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(path).then(done).catch(()=>copy(path,done));else copy(path,done)});function copy(text,done){const a=document.createElement('textarea');a.value=text;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();done()}
document.getElementById('csv').onclick=()=>{const rows=[...table().tBodies[0].rows].filter(r=>!r.classList.contains('hidden')),head=[...table().tHead.rows[0].cells].filter(x=>x.style.display!=='none').map(x=>csv(x.innerText));const lines=rows.map(r=>[...r.cells].filter(x=>x.style.display!=='none').map(x=>csv(x.innerText)).join(','));const blob=new Blob(['\ufeff'+[head.join(','),...lines].join('\r\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Mediova-'+(kind==='video'?'视频':'图片')+'历史.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};function csv(v){return '"'+v.replaceAll('"','""')+'"'}apply();
</script></body></html>`)
	// Volume change is independent from task status: a completed item can be
	// filtered by its output-size class without merging two unrelated filters.
	b.WriteString(`<script>(()=>{const statusSelect=document.getElementById('status');if(!statusSelect)return;const volumeSelect=document.createElement('select');volumeSelect.id='volume';volumeSelect.innerHTML='<option value="">全部体积变化</option><option value="larger">体积增加 (>=1.1倍)</option><option value="smaller">体积缩小 (<=0.9倍)</option><option value="unchanged">维持不变 (0.9~1.1倍)</option>';statusSelect.insertAdjacentElement('afterend',volumeSelect);apply=function(){const needle=q.value.trim().toLowerCase(),want=status.value,wantVolume=volumeSelect.value;let n=0;for(const row of table().tBodies[0].rows){const ok=(!needle||row.innerText.toLowerCase().includes(needle))&&(!want||row.dataset.status===want)&&(!wantVolume||row.dataset.volume===wantVolume);row.classList.toggle('hidden',!ok);if(ok)n++}count.textContent='当前显示 '+n+' 条'};q.oninput=apply;status.onchange=apply;volumeSelect.onchange=apply;apply()})()</script>`)
	tmp, err := os.CreateTemp(filepath.Dir(path), ".history-*.html")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err = tmp.WriteString(b.String()); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err = tmp.Close(); err != nil {
		return "", err
	}
	_ = os.Remove(path)
	if err = os.Rename(tmpName, path); err != nil {
		return "", err
	}
	return path, nil
}
