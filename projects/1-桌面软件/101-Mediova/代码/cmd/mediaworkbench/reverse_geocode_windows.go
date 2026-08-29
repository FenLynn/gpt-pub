//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"mediaworkbench/internal/config"
)

const (
	reverseGeocodeCacheVersion = 1
	reverseGeocodeMaxEntries   = 10000
	reverseGeocodeMaxBytes     = 20 << 20
	reverseGeocodeInterval     = 1100 * time.Millisecond
	reverseGeocodeEndpoint     = "https://nominatim.openstreetmap.org/reverse"
)

type reverseGeocodeCacheEntry struct {
	Place    string `json:"place"`
	Full     string `json:"full,omitempty"`
	Updated  int64  `json:"updated"`
	LastUsed int64  `json:"last_used"`
}

type reverseGeocodeCacheFile struct {
	Version int                                 `json:"version"`
	Entries map[string]reverseGeocodeCacheEntry `json:"entries"`
}

type reverseGeocodeManager struct {
	app        *application
	mu         sync.Mutex
	path       string
	entries    map[string]reverseGeocodeCacheEntry
	client     *http.Client
	running    bool
	cancel     context.CancelFunc
	generation uint64
}

type reverseGeocodeJob struct {
	key       string
	latitude  float64
	longitude float64
	taskIDs   []int64
}

type nominatimReverseResponse struct {
	DisplayName string            `json:"display_name"`
	Name        string            `json:"name"`
	Error       string            `json:"error"`
	Address     map[string]string `json:"address"`
}

var reverseGeocodeManagers sync.Map

func reverseGeocodeCacheKey(latitude, longitude float64) string {
	return fmt.Sprintf("%.5f,%.5f", latitude, longitude)
}

func newReverseGeocodeManager(a *application) (*reverseGeocodeManager, error) {
	local, err := config.LocalDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(local, "Maps", "ReverseGeocodeCache.json")
	manager := &reverseGeocodeManager{
		app:     a,
		path:    path,
		entries: map[string]reverseGeocodeCacheEntry{},
		client:  &http.Client{Timeout: 20 * time.Second},
	}
	var stored reverseGeocodeCacheFile
	if config.LoadJSON(path, &stored) == nil && stored.Version == reverseGeocodeCacheVersion && stored.Entries != nil {
		manager.entries = stored.Entries
	}
	manager.pruneLocked()
	return manager, nil
}

func reverseGeocoderFor(a *application) (*reverseGeocodeManager, error) {
	if a == nil {
		return nil, errors.New("application is unavailable")
	}
	if value, ok := reverseGeocodeManagers.Load(a); ok {
		manager, _ := value.(*reverseGeocodeManager)
		if manager != nil {
			return manager, nil
		}
	}
	manager, err := newReverseGeocodeManager(a)
	if err != nil {
		return nil, err
	}
	actual, loaded := reverseGeocodeManagers.LoadOrStore(a, manager)
	if loaded {
		manager, _ = actual.(*reverseGeocodeManager)
	}
	return manager, nil
}

func (m *reverseGeocodeManager) cacheGet(key string) (reverseGeocodeCacheEntry, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.entries[key]
	if ok {
		entry.LastUsed = time.Now().Unix()
		m.entries[key] = entry
	}
	return entry, ok && strings.TrimSpace(entry.Place) != ""
}

func (m *reverseGeocodeManager) cachePut(key, place, full string, generation uint64) bool {
	now := time.Now().Unix()
	m.mu.Lock()
	defer m.mu.Unlock()
	if generation != m.generation {
		return false
	}
	m.entries[key] = reverseGeocodeCacheEntry{Place: place, Full: full, Updated: now, LastUsed: now}
	m.pruneLocked()
	_ = m.saveLocked()
	return true
}

func (m *reverseGeocodeManager) pruneLocked() {
	if len(m.entries) <= reverseGeocodeMaxEntries {
		return
	}
	keys := make([]string, 0, len(m.entries))
	for key := range m.entries {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return m.entries[keys[i]].LastUsed < m.entries[keys[j]].LastUsed })
	for len(m.entries) > reverseGeocodeMaxEntries {
		delete(m.entries, keys[0])
		keys = keys[1:]
	}
}

func (m *reverseGeocodeManager) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		return err
	}
	payload := reverseGeocodeCacheFile{Version: reverseGeocodeCacheVersion, Entries: m.entries}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if len(data) > reverseGeocodeMaxBytes {
		keys := make([]string, 0, len(m.entries))
		for key := range m.entries {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return m.entries[keys[i]].LastUsed < m.entries[keys[j]].LastUsed })
		for len(data) > reverseGeocodeMaxBytes && len(keys) > 0 {
			delete(m.entries, keys[0])
			keys = keys[1:]
			data, err = json.Marshal(reverseGeocodeCacheFile{Version: reverseGeocodeCacheVersion, Entries: m.entries})
			if err != nil {
				return err
			}
		}
	}
	return config.SaveJSON(m.path, reverseGeocodeCacheFile{Version: reverseGeocodeCacheVersion, Entries: m.entries})
}

func reversePlacePart(address map[string]string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(address[name]); value != "" {
			return value
		}
	}
	return ""
}

func reversePlaceSummary(response nominatimReverseResponse) string {
	values := []string{
		reversePlacePart(response.Address, "country"),
		reversePlacePart(response.Address, "state", "province", "region"),
		reversePlacePart(response.Address, "city", "town", "municipality", "village"),
		reversePlacePart(response.Address, "city_district", "district", "county", "borough"),
		reversePlacePart(response.Address, "suburb", "neighbourhood", "quarter"),
		reversePlacePart(response.Address, "road", "pedestrian"),
	}
	seen := map[string]bool{}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value == "" || seen[key] {
			continue
		}
		seen[key] = true
		parts = append(parts, value)
	}
	if len(parts) == 0 {
		if name := strings.TrimSpace(response.Name); name != "" {
			return name
		}
		return strings.TrimSpace(response.DisplayName)
	}
	return strings.Join(parts, " · ")
}

func (m *reverseGeocodeManager) lookup(ctx context.Context, latitude, longitude float64) (string, string, error) {
	endpoint, _ := url.Parse(reverseGeocodeEndpoint)
	query := endpoint.Query()
	query.Set("format", "jsonv2")
	query.Set("addressdetails", "1")
	query.Set("accept-language", "zh-CN,zh,en")
	query.Set("zoom", "18")
	query.Set("lat", strconv.FormatFloat(latitude, 'f', 7, 64))
	query.Set("lon", strconv.FormatFloat(longitude, 'f', 7, 64))
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", "", err
	}
	request.Header.Set("User-Agent", "Mediova/4.5.2 (+https://github.com/FenLynn/gpt-pub)")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.5")
	response, err := m.client.Do(request)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("HTTP %d", response.StatusCode)
	}
	var decoded nominatimReverseResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&decoded); err != nil {
		return "", "", err
	}
	if decoded.Error != "" {
		return "", "", errors.New(decoded.Error)
	}
	place := reversePlaceSummary(decoded)
	if place == "" {
		return "", "", errors.New("未找到行政区划")
	}
	return place, strings.TrimSpace(decoded.DisplayName), nil
}

func reverseGeocodeOnlineAllowed(a *application) bool {
	if runtime := mapRuntimeFor(a); runtime != nil && runtime.cache != nil {
		online, _ := runtime.cache.state()
		return online
	}
	local, err := config.LocalDir()
	if err != nil {
		return true
	}
	mode, err := os.ReadFile(filepath.Join(local, "Maps", "map-mode.txt"))
	return err != nil || strings.TrimSpace(string(mode)) != "offline"
}

func (a *application) reverseGeocodeJobs(ids map[int64]bool, all bool) []reverseGeocodeJob {
	grouped := map[string]*reverseGeocodeJob{}
	a.mu.Lock()
	for _, task := range a.tasks {
		if task == nil || task.Kind != a.currentKind || !task.Location.Valid() || strings.TrimSpace(task.Location.Place) != "" {
			continue
		}
		if !all && !ids[task.ID] {
			continue
		}
		key := reverseGeocodeCacheKey(task.Location.Latitude, task.Location.Longitude)
		job := grouped[key]
		if job == nil {
			job = &reverseGeocodeJob{key: key, latitude: task.Location.Latitude, longitude: task.Location.Longitude}
			grouped[key] = job
		}
		job.taskIDs = append(job.taskIDs, task.ID)
	}
	a.mu.Unlock()
	jobs := make([]reverseGeocodeJob, 0, len(grouped))
	for _, job := range grouped {
		jobs = append(jobs, *job)
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].key < jobs[j].key })
	return jobs
}

func (a *application) selectedTasksNeedReverseGeocode() bool {
	selected := a.selectedTaskIDsSnapshot()
	return len(a.reverseGeocodeJobs(selected, false)) > 0
}

func (a *application) startSelectedReverseGeocode() {
	a.startReverseGeocode(false)
}

func (a *application) startAllReverseGeocode() {
	a.startReverseGeocode(true)
}

func (a *application) startReverseGeocode(all bool) {
	if !a.mapFeaturesEnabled() {
		setText(a.hStatusText, "地图与位置功能已关闭；未启动地名补全。")
		return
	}
	manager, err := reverseGeocoderFor(a)
	if err != nil {
		setText(a.hStatusText, "地名缓存初始化失败："+err.Error())
		return
	}
	manager.mu.Lock()
	if manager.running {
		manager.mu.Unlock()
		a.setReverseGeocodeNotice("地名补全正在进行，可点击“停止补全”。", true)
		return
	}
	manager.mu.Unlock()
	ids := a.selectedTaskIDsSnapshot()
	jobs := a.reverseGeocodeJobs(ids, all)
	if len(jobs) == 0 {
		a.setReverseGeocodeNotice("没有需要补全的 GPS 地名。", false)
		return
	}
	if len(jobs) > 10 {
		seconds := len(jobs) * 11 / 10
		prompt := fmt.Sprintf("将按坐标去重后查询 %d 个地点，严格单线程限速，预计至少 %d 分钟。\r\n\r\n只写入 Mediova 缓存和任务记录，不修改媒体文件。是否继续？", len(jobs), (seconds+59)/60)
		title := "补全选中地名"
		if all {
			title = "补全全部地名"
		}
		if messageBox(a.hwnd, title, prompt, MB_YESNO|MB_ICONQUESTION) != IDYES {
			return
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	manager.mu.Lock()
	manager.running, manager.cancel = true, cancel
	generation := manager.generation
	manager.mu.Unlock()
	a.setReverseGeocodeNotice(fmt.Sprintf("开始补全地名：%d 个唯一坐标。", len(jobs)), true)
	go manager.run(ctx, jobs, generation)
}

func (m *reverseGeocodeManager) run(ctx context.Context, jobs []reverseGeocodeJob, generation uint64) {
	completed, cached, failed := 0, 0, 0
	offlineMisses := 0
	lastFailure := ""
	lastRequest := time.Time{}
	for index, job := range jobs {
		if ctx.Err() != nil {
			break
		}
		m.mu.Lock()
		stale := generation != m.generation
		m.mu.Unlock()
		if stale {
			break
		}
		entry, ok := m.cacheGet(job.key)
		if ok {
			m.apply(job.taskIDs, entry.Place)
			completed++
			cached++
		} else if !reverseGeocodeOnlineAllowed(m.app) {
			failed++
			offlineMisses++
		} else {
			if !lastRequest.IsZero() {
				wait := reverseGeocodeInterval - time.Since(lastRequest)
				if wait > 0 {
					timer := time.NewTimer(wait)
					select {
					case <-ctx.Done():
						timer.Stop()
						break
					case <-timer.C:
					}
				}
			}
			if ctx.Err() != nil {
				break
			}
			lastRequest = time.Now()
			place, full, err := m.lookup(ctx, job.latitude, job.longitude)
			if err != nil {
				failed++
				lastFailure = err.Error()
			} else {
				if m.cachePut(job.key, place, full, generation) {
					m.apply(job.taskIDs, place)
					completed++
				}
			}
		}
		if index == len(jobs)-1 || (index+1)%10 == 0 {
			progress := fmt.Sprintf("补全地名 %d/%d · 成功 %d · 缓存 %d · 未完成 %d", index+1, len(jobs), completed, cached, failed)
			m.app.postUI(func() { m.app.setReverseGeocodeNotice(progress, true) })
		}
	}
	cancelled := ctx.Err() != nil
	m.mu.Lock()
	if generation != m.generation {
		m.mu.Unlock()
		return
	}
	m.running, m.cancel = false, nil
	_ = m.saveLocked()
	m.mu.Unlock()
	m.app.postUI(func() {
		m.app.saveSession()
		m.app.invalidateMapView()
		procInvalidateRect.Call(m.app.hList, 0, 0)
		text := fmt.Sprintf("地名补全结束：成功 %d，缓存命中 %d，未完成 %d。", completed, cached, failed)
		if cancelled {
			text = fmt.Sprintf("已停止地名补全：成功 %d，缓存命中 %d，未完成 %d。", completed, cached, failed)
		}
		if offlineMisses > 0 {
			text += " 离线模式下未缓存坐标没有联网。"
		} else if failed > 0 && lastFailure != "" {
			text += " 最近错误：" + lastFailure
		}
		m.app.setReverseGeocodeNotice(text, false)
	})
}

func (m *reverseGeocodeManager) apply(ids []int64, place string) {
	m.app.mu.Lock()
	for _, id := range ids {
		task, _ := m.app.findTaskByIDLocked(id)
		if task == nil || !task.Location.Valid() || strings.TrimSpace(task.Location.Place) != "" {
			continue
		}
		task.Location.Place = place
		task.Location.PlaceSource = "reverse"
	}
	m.app.mu.Unlock()

}

func (a *application) stopReverseGeocoding() {
	if value, ok := reverseGeocodeManagers.Load(a); ok {
		manager, _ := value.(*reverseGeocodeManager)
		if manager != nil {
			manager.mu.Lock()
			cancel := manager.cancel
			manager.mu.Unlock()
			if cancel != nil {
				cancel()
			}
		}
	}
}

func (a *application) clearReverseGeocodeCache() {
	manager, err := reverseGeocoderFor(a)
	if err != nil {
		setText(a.hStatusText, "地名缓存清理失败："+err.Error())
		return
	}
	if messageBox(a.hwnd, "清除地名缓存", "清除在线反查得到的全部地名？\r\n\r\n媒体自带地名和 GPS 坐标不会改变。", MB_YESNO|MB_ICONQUESTION) != IDYES {
		return
	}
	a.stopReverseGeocoding()
	manager.mu.Lock()
	manager.entries = map[string]reverseGeocodeCacheEntry{}
	manager.generation++
	manager.running, manager.cancel = false, nil
	_ = os.Remove(manager.path)
	_ = os.Remove(manager.path + ".bak")
	manager.mu.Unlock()
	a.mu.Lock()
	for _, task := range a.tasks {
		if task != nil && task.Location.Valid() && task.Location.PlaceSource == "reverse" {
			task.Location.Place = ""
			task.Location.PlaceSource = ""
		}
	}
	a.mu.Unlock()
	a.saveSession()
	procInvalidateRect.Call(a.hList, 0, 0)
	a.invalidateMapView()
	a.setReverseGeocodeNotice("已清除地名缓存和任务中的在线地名；媒体自带地点与 GPS 未改变。", false)
}

func (a *application) setReverseGeocodeNotice(text string, running bool) {
	setText(a.hStatusText, text)
	if runtime := mapRuntimeFor(a); runtime != nil && runtime.browser != nil {
		runtime.browser.Eval("window.mediovaGeocode(" + strconv.Quote(text) + "," + strconv.FormatBool(running) + ")")
	}
}

func (a *application) shutdownReverseGeocoder() {
	if value, ok := reverseGeocodeManagers.Load(a); ok {
		manager, _ := value.(*reverseGeocodeManager)
		if manager != nil {
			manager.mu.Lock()
			cancel := manager.cancel
			manager.generation++
			manager.running, manager.cancel = false, nil
			manager.mu.Unlock()
			if cancel != nil {
				cancel()
			}
		}
	}
	reverseGeocodeManagers.Delete(a)
}
