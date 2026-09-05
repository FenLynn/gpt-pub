//go:build windows

package main

import (
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"

	"mediaworkbench/internal/config"
)

const (
	mapCacheLimit = int64(1 << 30) // 1 GiB hard ceiling.
	mapMaxObject  = int64(32 << 20)
)

// These files are pinned and embedded so opening a map never contacts a JS CDN.
//
//go:embed assets/map/maplibre-gl.js
var mapLibreJS []byte

//go:embed assets/map/maplibre-gl.css
var mapLibreCSS []byte

//go:embed assets/map/MAPLIBRE_LICENSE.txt
var mapLibreLicense []byte

type mapCacheManager struct {
	mu         sync.Mutex
	root       string
	modePath   string
	size       int64
	online     bool
	limit      int64
	generation uint64
}

type mapCacheFile struct {
	path string
	size int64
	when time.Time
}

func newMapCacheManager() (*mapCacheManager, error) {
	base, err := config.LocalDir()
	if err != nil {
		return nil, err
	}
	root := filepath.Join(base, "Maps", "OpenFreeMapCache")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	modePath := filepath.Join(base, "Maps", "map-mode.txt")
	online := true
	if mode, readErr := os.ReadFile(modePath); readErr == nil && strings.TrimSpace(string(mode)) == "offline" {
		online = false
	}
	m := &mapCacheManager{root: root, modePath: modePath, online: online, limit: mapCacheLimit}
	if err := m.scanAndPrune(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *mapCacheManager) cachePath(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	name := hex.EncodeToString(sum[:])
	return filepath.Join(m.root, name[:2], name[2:])
}

func (m *mapCacheManager) scanAndPrune() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.scanAndPruneLocked()
}

func (m *mapCacheManager) scanAndPruneLocked() error {
	files := make([]mapCacheFile, 0, 256)
	var total int64
	err := filepath.WalkDir(m.root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if strings.Contains(entry.Name(), ".part") {
			_ = os.Remove(path)
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		total += info.Size()
		files = append(files, mapCacheFile{path: path, size: info.Size(), when: info.ModTime()})
		return nil
	})
	if err != nil {
		return err
	}
	if total > m.limit {
		sort.Slice(files, func(i, j int) bool { return files[i].when.Before(files[j].when) })
		for _, file := range files {
			if total <= m.limit {
				break
			}
			if os.Remove(file.path) == nil {
				total -= file.size
			}
		}
	}
	m.size = total
	return nil
}

func (m *mapCacheManager) get(rawURL string) ([]byte, bool) {
	// Cache files are immutable after their atomic rename. Reads therefore do
	// not need the manager mutex and can serve multiple visible vector tiles in
	// parallel while the user pans or zooms. A concurrent clear simply turns a
	// read into a harmless cache miss.
	data, err := os.ReadFile(m.cachePath(rawURL))
	if err != nil {
		return nil, false
	}
	return data, true
}

func (m *mapCacheManager) put(rawURL string, data []byte, generation uint64) error {
	if len(data) == 0 || int64(len(data)) > mapMaxObject {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if generation != m.generation {
		return nil
	}
	target := m.cachePath(rawURL)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(target); err == nil {
		now := time.Now()
		_ = os.Chtimes(target, now, now)
		return nil
	}
	tmpFile, err := os.CreateTemp(filepath.Dir(target), ".part-")
	if err != nil {
		return err
	}
	tmp := tmpFile.Name()
	_, err = tmpFile.Write(data)
	// The cache is disposable and can always be downloaded again. Closing and
	// atomically renaming the completed temporary file protects readers without
	// forcing a physical disk flush for every map tile.
	if closeErr := tmpFile.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err = os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	m.size += int64(len(data))
	if m.size > m.limit {
		return m.scanAndPruneLocked()
	}
	return nil
}

func (m *mapCacheManager) clear() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.generation++
	m.online = false
	_ = writeMapMode(m.modePath, false)
	cleanRoot := filepath.Clean(m.root)
	if filepath.Base(cleanRoot) != "OpenFreeMapCache" || filepath.Base(filepath.Dir(cleanRoot)) != "Maps" {
		return fmt.Errorf("refusing unsafe map cache path: %s", cleanRoot)
	}
	if err := os.RemoveAll(cleanRoot); err != nil {
		return err
	}
	if err := os.MkdirAll(cleanRoot, 0o755); err != nil {
		return err
	}
	m.size = 0
	return nil
}

func (m *mapCacheManager) sizeBytes() int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.size
}

func (m *mapCacheManager) setOnline(online bool) {
	m.mu.Lock()
	m.online = online
	modePath := m.modePath
	m.mu.Unlock()
	_ = writeMapMode(modePath, online)
}

func writeMapMode(path string, online bool) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	mode := "offline"
	if online {
		mode = "online"
	}
	tmp := path + ".part"
	if err := os.WriteFile(tmp, []byte(mode+"\n"), 0o644); err != nil {
		return err
	}
	_ = os.Remove(path)
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (m *mapCacheManager) state() (bool, uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.online, m.generation
}

type mapRuntime struct {
	app            *application
	cache          *mapCacheManager
	browser        *edge.Chromium
	server         *http.Server
	listener       net.Listener
	baseURL        string
	prefix         string
	profileDir     string
	client         *http.Client
	mu             sync.Mutex
	thumbnailMu    sync.RWMutex
	thumbnailPaths map[int64]string
	closed         bool
	hasFocus       bool
	currentTaskID  int64
	folderState    string
	pointState     string
	focusLongitude float64
	focusLatitude  float64
}

func (r *mapRuntime) setCurrentTask(id int64) bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	changed := r.currentTaskID != id
	r.currentTaskID = id
	r.mu.Unlock()
	return changed
}

func (r *mapRuntime) currentTask() int64 {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	id := r.currentTaskID
	r.mu.Unlock()
	return id
}

func randomMapToken() string {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func newMapRuntime(a *application) (*mapRuntime, error) {
	cache, err := newMapCacheManager()
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	token := randomMapToken()
	r := &mapRuntime{app: a, cache: cache, listener: listener, thumbnailPaths: make(map[int64]string)}
	r.prefix = "/" + token
	r.baseURL = "http://" + listener.Addr().String() + "/" + token
	r.client = &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          64,
			MaxIdleConnsPerHost:   24,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Host != "tiles.openfreemap.org" && req.URL.Host != "assets.openfreemap.com" {
				return fmt.Errorf("blocked map redirect to %s", req.URL.Host)
			}
			if len(via) > 5 {
				return fmt.Errorf("too many map redirects")
			}
			return nil
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/"+token+"/", r.serve)
	r.server = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = r.server.Serve(listener) }()

	profileBase := filepath.Join(os.TempDir(), "MediovaMapWebView")
	_ = os.MkdirAll(profileBase, 0o755)
	entries, _ := os.ReadDir(profileBase)
	for _, entry := range entries {
		if entry.IsDir() {
			_ = os.RemoveAll(filepath.Join(profileBase, entry.Name()))
		}
	}
	r.profileDir = filepath.Join(profileBase, strconv.Itoa(os.Getpid()))
	r.browser = edge.NewChromium()
	r.browser.DataPath = r.profileDir
	r.browser.MessageCallback = r.onMessage
	if !r.browser.Embed(a.hMapSurface) {
		r.close()
		return nil, fmt.Errorf("WebView2 initialization failed")
	}
	r.browser.Navigate(r.baseURL + "/map")
	r.browser.Resize()
	_ = r.browser.Show()
	return r, nil
}

func (r *mapRuntime) serve(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// The unguessable prefix prevents unrelated local pages from using the
	// loopback cache endpoint while Mediova is running.
	path := strings.TrimPrefix(req.URL.Path, r.prefix)
	switch path {
	case "/map", "/map/":
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, r.mapHTML())
	case "/maplibre.js":
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = w.Write(mapLibreJS)
	case "/maplibre.css":
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		_, _ = w.Write(mapLibreCSS)
	case "/maplibre-license.txt":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(mapLibreLicense)
	case "/cache-status":
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = fmt.Fprintf(w, "{\"bytes\":%d}", r.cache.sizeBytes())
	default:
		if strings.HasPrefix(path, "/thumb/") {
			r.serveMapThumbnail(w, req, strings.TrimPrefix(path, "/thumb/"))
			return
		}
		if strings.HasPrefix(path, "/ofm/") {
			r.serveOpenFreeMap(w, req, strings.TrimPrefix(path, "/ofm/"))
			return
		}
		http.NotFound(w, req)
	}
}

func (r *mapRuntime) serveMapThumbnail(w http.ResponseWriter, req *http.Request, rawID string) {
	if req.Method != http.MethodGet && req.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id <= 0 {
		http.NotFound(w, req)
		return
	}
	r.thumbnailMu.RLock()
	path := r.thumbnailPaths[id]
	r.thumbnailMu.RUnlock()
	if strings.TrimSpace(path) == "" {
		http.NotFound(w, req)
		return
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 64 {
		http.NotFound(w, req)
		return
	}
	w.Header().Set("Content-Type", "image/bmp")
	w.Header().Set("Cache-Control", "private, max-age=60")
	http.ServeFile(w, req, path)
}

func (r *mapRuntime) serveOpenFreeMap(w http.ResponseWriter, req *http.Request, resource string) {
	if req.Method != http.MethodGet && req.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	resource = strings.TrimLeft(resource, "/")
	if resource == "" || strings.Contains(resource, "..") {
		http.NotFound(w, req)
		return
	}
	host := "tiles.openfreemap.org"
	if strings.HasPrefix(resource, "assets/") {
		host = "assets.openfreemap.com"
		resource = strings.TrimPrefix(resource, "assets/")
	}
	rawURL := "https://" + host + "/" + resource
	data, cached := r.cache.get(rawURL)
	if !cached {
		online, generation := r.cache.state()
		if !online {
			if mapJSONResource(resource) {
				data = mapOfflineJSON(resource)
			} else {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		if len(data) == 0 {
			upstream, err := http.NewRequestWithContext(req.Context(), http.MethodGet, rawURL, nil)
			if err != nil {
				http.Error(w, "map request failed", http.StatusBadGateway)
				return
			}
			upstream.Header.Set("User-Agent", "Mediova/4.5.2 map-view")
			resp, err := r.client.Do(upstream)
			if err != nil {
				http.Error(w, "map service unavailable", http.StatusBadGateway)
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				w.WriteHeader(resp.StatusCode)
				return
			}
			data, err = io.ReadAll(io.LimitReader(resp.Body, mapMaxObject+1))
			if err != nil || int64(len(data)) > mapMaxObject {
				http.Error(w, "map object too large", http.StatusBadGateway)
				return
			}
			_ = r.cache.put(rawURL, data, generation)
		}
	}
	if mapJSONResource(resource) {
		data = []byte(strings.ReplaceAll(strings.ReplaceAll(string(data), "https://tiles.openfreemap.org/", r.baseURL+"/ofm/"), "https://assets.openfreemap.com/", r.baseURL+"/ofm/assets/"))
	}
	if mapJSONResource(resource) {
		w.Header().Set("Cache-Control", "private, max-age=300")
	} else {
		w.Header().Set("Cache-Control", "private, max-age=86400")
	}
	w.Header().Set("Content-Type", mapContentType(resource))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	if req.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
}

func mapJSONResource(path string) bool {
	lower := strings.ToLower(strings.TrimSpace(path))
	return lower == "planet" || strings.HasSuffix(lower, ".json") || strings.Contains(lower, "styles/")
}

func mapOfflineJSON(path string) []byte {
	lower := strings.ToLower(path)
	if strings.Contains(lower, "styles/") {
		return []byte(`{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#eef4f8"}}]}`)
	}
	if lower == "planet" {
		return []byte(`{"tilejson":"3.0.0","tiles":[],"minzoom":0,"maxzoom":0}`)
	}
	return []byte(`{}`)
}
func mapContentType(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(lower, ".js"):
		return "application/javascript; charset=utf-8"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case mapJSONResource(lower):
		return "application/json; charset=utf-8"
	default:
		return "application/x-protobuf"
	}
}

func validMapCamera(longitude, latitude, zoom float64) bool {
	return longitude >= -180 && longitude <= 180 && latitude >= -85 && latitude <= 85 && zoom >= 0 && zoom <= 22
}

func (r *mapRuntime) initialMapCamera() (longitude, latitude, zoom float64, fast bool) {
	longitude, latitude, zoom, fast = 105, 35, 3, true
	if r == nil || r.app == nil {
		return
	}
	fast = r.app.settings.MapFastZoom
	if r.app.settings.MapCameraSet && validMapCamera(r.app.settings.MapCenterLongitude, r.app.settings.MapCenterLatitude, r.app.settings.MapZoom) {
		longitude = r.app.settings.MapCenterLongitude
		latitude = r.app.settings.MapCenterLatitude
		zoom = r.app.settings.MapZoom
	}
	return
}

func (r *mapRuntime) mapHTML() string {
	base, _ := json.Marshal(r.baseURL)
	longitude, latitude, zoom, fast := r.initialMapCamera()
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="` + r.baseURL + `/maplibre.css"><style>
html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#eef4f8}.toolbar{position:absolute;z-index:5;top:10px;left:10px;right:10px;display:flex;gap:6px;align-items:center;pointer-events:none}.brand,.tools,.folder-select,.folder-scope{pointer-events:auto;background:rgba(255,255,255,.94);box-shadow:0 1px 5px rgba(31,57,76,.18);border-radius:5px;height:34px;display:flex;align-items:center}.brand{padding:0 11px;color:#29465a;font-size:13px}.folder-select{width:270px;border:0;padding:0 28px 0 10px;color:#355a73;font:12px "Segoe UI","Microsoft YaHei";outline:none}.folder-scope{padding:0 8px;color:#526d82;font-size:11px;white-space:nowrap}.folder-scope input{margin:0 5px 0 0}.tools{margin-left:0;padding:0 5px;gap:3px}.tools button{border:0;background:transparent;color:#355a73;height:26px;padding:0 9px;border-radius:4px;font:12px "Segoe UI","Microsoft YaHei";cursor:pointer}.tools button.active{background:#dcecff;color:#125a9a}.tools button:hover{background:#e8f2fa}.tools button.stop{color:#b8493f}.tools .divider{width:1px;height:18px;background:#dbe5ec;margin:0 2px}.cache{color:#6f8492;font-size:11px;padding:0 5px}.notice{position:absolute;z-index:4;left:12px;bottom:12px;background:rgba(255,255,255,.92);color:#5b7180;padding:6px 9px;border-radius:4px;font-size:11px;box-shadow:0 1px 4px rgba(31,57,76,.13)}.quick{position:absolute;z-index:5;right:10px;bottom:82px;display:flex;flex-direction:column;background:rgba(255,255,255,.94);box-shadow:0 1px 5px rgba(31,57,76,.18);border-radius:4px;overflow:hidden}.quick button{width:46px;height:28px;border:0;border-bottom:1px solid #e4edf3;background:transparent;color:#355a73;font:11px "Segoe UI","Microsoft YaHei";cursor:pointer}.quick button:last-child{border-bottom:0}.quick button:hover{background:#e8f2fa}
.maplibregl-popup-content{padding:8px;border-radius:6px;box-shadow:0 3px 14px rgba(24,49,67,.24)}.media-popup{width:310px;max-width:calc(100vw - 44px);color:#29465a}.media-summary{font-size:11px;color:#718694;margin:0 0 5px}.media-list{max-height:250px;overflow:auto}.media-row{display:grid;grid-template-columns:44px minmax(0,1fr);gap:7px;width:100%;padding:5px;border:0;border-radius:4px;background:transparent;text-align:left;cursor:pointer;color:#29465a}.media-row:hover{background:#e8f2fa}.media-row img,.media-placeholder{width:44px;height:30px;object-fit:cover;border-radius:2px;background:#edf3f7}.media-name{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.media-meta{font-size:10px;color:#718694;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.media-more{padding:6px 4px 2px;color:#718694;font-size:10px}
</style></head><body><div id="map"></div><div class="toolbar"><div id="map-count" class="brand">地图点 0</div><select id="folder" class="folder-select" title="所有源目录都在这里统计，包括没有 GPS 的视频和图片"><option value="">全部目录</option></select><label class="folder-scope"><input id="folder-children" type="checkbox">含子目录</label><div class="tools"><button id="folder-select-all">选中目录</button><button id="folder-convert">转换目录</button><button id="folder-open">源目录</button><button id="folder-output">输出目录</button><span class="divider"></span><button id="online" class="active">在线 · OpenFreeMap</button><button id="offline">离线地图</button><span id="cache" class="cache">缓存 0 MB / 1 GB</span><button id="clear">清除离线地图</button><span class="divider"></span><button id="geocode" title="按坐标去重，手动补全当前列表的地名">补全全部地名</button><button id="geocode-stop" class="stop" style="display:none">停止补全</button><button id="geocode-clear" title="只清除在线反查地名，不改变媒体 GPS">清除地名缓存</button></div></div><div class="quick"><button id="fit" title="显示全部地图点（Home）">全览</button><button id="current" title="定位当前媒体（F）">当前</button></div><div id="notice" class="notice">在线模式仅缓存实际查看过的区域</div><script src="` + r.baseURL + `/maplibre.js"></script><script>
const BASE=` + string(base) + `,INITIAL_CENTER=[` + strconv.FormatFloat(longitude, 'f', 7, 64) + `,` + strconv.FormatFloat(latitude, 'f', 7, 64) + `],INITIAL_ZOOM=` + strconv.FormatFloat(zoom, 'f', 3, 64) + `,INITIAL_FAST=` + strconv.FormatBool(fast) + `;let mode='online',allPoints=[],points=[],folderData=[],folderKey='',includeSubfolders=false,geocoding=false,fastZoom=INITIAL_FAST;const post=o=>window.chrome.webview.postMessage(JSON.stringify(o)),folderSelect=document.getElementById('folder'),folderChildren=document.getElementById('folder-children');
const map=new maplibregl.Map({container:'map',style:BASE+'/ofm/styles/liberty',center:INITIAL_CENTER,zoom:INITIAL_ZOOM,attributionControl:true,fadeDuration:fastZoom?60:180,refreshExpiredTiles:false,cancelPendingTileRequestsWhileZooming:true,maxTileCacheSize:128});map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
function animationMs(){return fastZoom?180:320}function applyZoomSpeed(){map.scrollZoom.setWheelZoomRate(fastZoom?1/240:1/450);map.scrollZoom.setZoomRate(fastZoom?1/70:1/100)}window.mediovaSpeed=function(fast){fastZoom=!!fast;applyZoomSpeed()};applyZoomSpeed();
let mediaPopup=null,thumbTimer=null;const thumbVersions=new Map();
const hasThumb=p=>p&&(p.hasThumbnail===true||p.hasThumbnail==='true');
function mediaItems(features){const found=new Map();for(const feature of features||[]){const p=feature&&feature.properties||{},id=String(p.taskID||''),key=id?'t'+id:'d'+(p.label||'');if(key!=='d'&&!found.has(key))found.set(key,p)}return Array.from(found.values())}
function mediaThumb(p){const id=String(p.taskID||''),img=document.createElement('img');img.loading='lazy';img.alt='';img.dataset.taskId=id;img.src=BASE+'/thumb/'+encodeURIComponent(id)+'?v='+(thumbVersions.get(id)||0);img.onerror=()=>{img.style.visibility='hidden'};return img}function popupPlacement(lngLat){const p=map.project(lngLat),c=map.getCanvas(),right=p.x<c.clientWidth-360,above=p.y>170;return{anchor:(above?'bottom':'top')+'-'+(right?'left':'right'),offset:[right?14:-14,above?-12:12]}}
function showMediaPopup(features,lngLat,total){const items=mediaItems(features);if(!items.length)return;if(mediaPopup)mediaPopup.remove();const root=document.createElement('div');root.className='media-popup';const summary=document.createElement('div');summary.className='media-summary';summary.textContent=(total||items.length)>1?'此位置共 '+(total||items.length)+' 项；单击定位，双击打开':'已选中当前媒体；双击打开';root.appendChild(summary);const list=document.createElement('div');list.className='media-list';items.slice(0,80).forEach(p=>{const row=document.createElement('button');row.type='button';row.className='media-row';if(hasThumb(p))row.appendChild(mediaThumb(p));else{const blank=document.createElement('span');blank.className='media-placeholder';row.appendChild(blank)}const text=document.createElement('span');const name=document.createElement('div');name.className='media-name';name.textContent=p.name||p.label||'媒体文件';const meta=document.createElement('div');meta.className='media-meta';meta.textContent=[p.status,p.label].filter(Boolean).join(' · ');text.append(name,meta);row.appendChild(text);row.onclick=ev=>{ev.stopPropagation();post({type:'select',ids:p.taskID?[String(p.taskID)]:[],demo:p.demo?p.label:''})};row.ondblclick=ev=>{ev.stopPropagation();ev.preventDefault();if(p.taskID)post({type:'play',ids:[String(p.taskID)]})};list.appendChild(row)});root.appendChild(list);if((total||items.length)>80){const more=document.createElement('div');more.className='media-more';more.textContent='仅显示前 80 项；继续放大地图可进一步拆分。';root.appendChild(more)}mediaPopup=new maplibregl.Popup(Object.assign({closeButton:true,closeOnClick:true,maxWidth:'350px'},popupPlacement(lngLat))).setLngLat(lngLat).setDOMContent(root).addTo(map)}
function install(){if(map.getSource('media'))return;map.addSource('media',{type:'geojson',data:{type:'FeatureCollection',features:points},cluster:true,clusterMaxZoom:20,clusterRadius:36,clusterProperties:{selected_count:['+',['case',['get','selected'],1,0]]}});const selected=['>', ['get','selected_count'],0];map.addLayer({id:'clusters',type:'circle',source:'media',filter:['has','point_count'],paint:{'circle-color':['case',selected,'#f28a1a','#167fba'],'circle-radius':['step',['get','point_count'],15,10,19,50,23],'circle-stroke-color':['case',selected,'#c8660d','#fff'],'circle-stroke-width':['case',selected,2.5,2]}});map.addLayer({id:'cluster-count',type:'symbol',source:'media',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},paint:{'text-color':'#fff'}});map.addLayer({id:'point',type:'circle',source:'media',filter:['all',['!',['has','point_count']],['!=',['get','current'],true]],paint:{'circle-color':['case',['get','selected'],'#f28a1a',['get','demo'],'#d6862e','#159783'],'circle-radius':['case',['get','selected'],9,7],'circle-stroke-color':'#fff','circle-stroke-width':2}});map.addLayer({id:'current-star',type:'symbol',source:'media',filter:['all',['!',['has','point_count']],['==',['get','current'],true]],layout:{'text-field':'★','text-size':24,'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#f28a1a','text-halo-color':'#fff','text-halo-width':1.1}});for(const id of ['clusters','point','current-star']){map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',id,()=>map.getCanvas().style.cursor='')}}
function fitAll(animate=true){if(!points.length)return;const b=new maplibregl.LngLatBounds();points.forEach(p=>b.extend(p.geometry.coordinates));map.fitBounds(b,{padding:70,maxZoom:14,duration:animate?animationMs():0})}function focusCurrent(){const current=points.find(p=>p.properties&&p.properties.current===true);if(!current){document.getElementById('notice').textContent='当前没有已选中的地图媒体';return}map.easeTo({center:current.geometry.coordinates,zoom:Math.max(map.getZoom(),15),duration:animationMs()})}
function updateMediaSource(){document.getElementById('map-count').textContent='地图点 '+points.length;if(map.isStyleLoaded()){const s=map.getSource('media');if(s)s.setData({type:'FeatureCollection',features:points});else install()}}
function rebuildFolders(){folderSelect.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部目录（'+folderData.reduce((n,g)=>n+Number(g.total||0),0)+'）';folderSelect.appendChild(all);folderData.forEach(g=>{const option=document.createElement('option');option.value=String(g.key||'');option.textContent=String(g.label||g.path||'目录')+'（总'+g.total+' · 视'+g.video+' · 图'+g.image+' · GPS'+g.located+'）';option.title=String(g.path||'');folderSelect.appendChild(option)});if(!folderData.some(g=>String(g.key||'')===folderKey))folderKey='';folderSelect.value=folderKey;folderChildren.checked=includeSubfolders}
function inFolder(p){const key=String(p.folderKey||'').toLowerCase(),base=String(folderKey||'').toLowerCase();return key===base||(includeSubfolders&&key.startsWith(base+'\\'))}
function applyFolder(fit){points=allPoints.filter(f=>{const p=f.properties||{};return folderKey?inFolder(p):(p.demo===true||p.demo==='true'||p.listVisible!==false&&p.listVisible!=='false')});updateMediaSource();if(fit)fitAll(false);const selected=folderSelect.selectedOptions[0];if(folderKey&&selected)document.getElementById('notice').textContent='目录：'+selected.textContent+'；列表与地图联动，视频和图片合并统计'}
map.on('style.load',install);window.mediovaSetFolders=function(data,selectedKey,include){folderData=Array.isArray(data)?data:[];folderKey=String(selectedKey||'');includeSubfolders=!!include;rebuildFolders()};window.mediovaSetPoints=function(data,fit){allPoints=data.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:p}));applyFolder(fit)};
window.mediovaSelection=function(ids,currentID){const selected=new Set((ids||[]).map(String)),current=String(currentID||'');let changed=false;allPoints.forEach(feature=>{const p=feature.properties||{},id=String(p.taskID||''),nextSelected=id!==''&&selected.has(id),nextCurrent=current!==''&&current!=='0'&&id===current;if(p.selected!==nextSelected||p.current!==nextCurrent){p.selected=nextSelected;p.current=nextCurrent;changed=true}});if(changed)applyFolder(false)};
window.mediovaThumbnail=function(rawID){const id=String(rawID),version=(thumbVersions.get(id)||0)+1;thumbVersions.set(id,version);let changed=false;allPoints.forEach(feature=>{if(String(feature.properties.taskID||'')===id){feature.properties.hasThumbnail=true;changed=true}});document.querySelectorAll('img[data-task-id]').forEach(img=>{if(img.dataset.taskId===id){img.style.visibility='visible';img.src=BASE+'/thumb/'+encodeURIComponent(id)+'?v='+version}});if(!changed)return;clearTimeout(thumbTimer);thumbTimer=setTimeout(()=>applyFolder(false),160)};
map.on('click','clusters',async e=>{const feature=e.features&&e.features[0];if(!feature)return;const source=map.getSource('media'),clusterID=feature.properties.cluster_id,current=map.getZoom(),total=Number(feature.properties.point_count)||1;try{const leaves=await source.getClusterLeaves(clusterID,Math.min(Math.max(total,1),5000),0),items=mediaItems(leaves),ids=items.filter(p=>p.taskID).map(p=>String(p.taskID));if(ids.length)post({type:'select',ids:ids});const expansion=await source.getClusterExpansionZoom(clusterID);if(current<13.75&&expansion>current+.1){map.easeTo({center:feature.geometry.coordinates,zoom:Math.min(expansion,15),duration:animationMs()});return}showMediaPopup(leaves,e.lngLat,total)}catch(_){}});
map.on('click','point',e=>{const features=e.features||[],items=mediaItems(features),ids=items.filter(p=>p.taskID).map(p=>String(p.taskID));post({type:'select',ids:ids,demo:items.length===1&&items[0].demo?items[0].label:''});showMediaPopup(features,e.lngLat,items.length)});map.on('click','current-star',e=>{const items=mediaItems(e.features||[]),ids=items.filter(p=>p.taskID).map(p=>String(p.taskID));post({type:'select',ids:ids});showMediaPopup(e.features||[],e.lngLat,items.length)});map.on('dblclick','point',e=>{e.preventDefault();const items=mediaItems(e.features);if(items.length===1&&items[0].taskID)post({type:'play',ids:[String(items[0].taskID)]})});map.on('dblclick','current-star',e=>{e.preventDefault();const items=mediaItems(e.features);if(items.length===1&&items[0].taskID)post({type:'play',ids:[String(items[0].taskID)]})});
window.mediovaFocus=function(lon,lat){map.easeTo({center:[lon,lat],zoom:Math.max(map.getZoom(),15),duration:animationMs()})};
window.mediovaCache=function(bytes){document.getElementById('cache').textContent='缓存 '+(bytes<1048576?'<1 MB':(bytes/1048576).toFixed(0)+' MB')+' / 1 GB'};
window.mediovaGeocode=function(text,running){geocoding=running;document.getElementById('notice').textContent=text;document.getElementById('geocode').style.display=running?'none':'';document.getElementById('geocode-stop').style.display=running?'':'none'};
window.mediovaMode=function(next){mode=next;document.getElementById('online').classList.toggle('active',next==='online');document.getElementById('offline').classList.toggle('active',next==='offline');if(!geocoding)document.getElementById('notice').textContent=next==='online'?'在线模式仅缓存实际查看过的区域':'离线模式：未缓存区域不会联网';map.setStyle(BASE+'/ofm/styles/liberty?mode='+next+'&t='+Date.now())};
let cameraTimer=null;map.on('moveend',()=>{clearTimeout(cameraTimer);cameraTimer=setTimeout(()=>{const c=map.getCenter();post({type:'camera',longitude:c.lng,latitude:c.lat,zoom:map.getZoom()})},900)});window.addEventListener('keydown',e=>{if(e.key==='Home'){e.preventDefault();fitAll(true)}else if((e.key==='f'||e.key==='F')&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();focusCurrent()}else if(e.key==='+'||e.key==='='){e.preventDefault();map.zoomIn({duration:animationMs()})}else if(e.key==='-'){e.preventDefault();map.zoomOut({duration:animationMs()})}else if(e.key==='Escape'&&mediaPopup){mediaPopup.remove();mediaPopup=null}});
setInterval(()=>fetch(BASE+'/cache-status',{cache:'no-store'}).then(r=>r.json()).then(v=>window.mediovaCache(v.bytes)).catch(()=>{}),2000);function postFolder(){post({type:'folder',folderKey:folderKey,includeSubfolders:includeSubfolders})}folderSelect.onchange=()=>{folderKey=folderSelect.value;applyFolder(true);postFolder()};folderChildren.onchange=()=>{includeSubfolders=folderChildren.checked;applyFolder(true);postFolder()};document.getElementById('folder-select-all').onclick=()=>post({type:'folder-action',action:'select'});document.getElementById('folder-convert').onclick=()=>post({type:'folder-action',action:'convert'});document.getElementById('folder-open').onclick=()=>post({type:'folder-action',action:'source'});document.getElementById('folder-output').onclick=()=>post({type:'folder-action',action:'output'});document.getElementById('fit').onclick=()=>fitAll(true);document.getElementById('current').onclick=focusCurrent;document.getElementById('online').onclick=()=>post({type:'mode',mode:'online'});document.getElementById('offline').onclick=()=>post({type:'mode',mode:'offline'});document.getElementById('clear').onclick=()=>{if(confirm('清除全部离线地图缓存？照片、GPS、历史记录和设置不会受影响。'))post({type:'clear'})};document.getElementById('geocode').onclick=()=>post({type:'geocode-all'});document.getElementById('geocode-stop').onclick=()=>post({type:'geocode-stop'});document.getElementById('geocode-clear').onclick=()=>post({type:'geocode-clear'});post({type:'ready'});
</script></body></html>`
}

type mapRuntimeMessage struct {
	Type              string   `json:"type"`
	Mode              string   `json:"mode"`
	FolderKey         string   `json:"folderKey"`
	Action            string   `json:"action"`
	IncludeSubfolders bool     `json:"includeSubfolders"`
	IDs               []string `json:"ids"`
	Demo              string   `json:"demo"`
	Latitude          float64  `json:"latitude"`
	Longitude         float64  `json:"longitude"`
	Zoom              float64  `json:"zoom"`
}

func (r *mapRuntime) selectTaskIDs(ids []string) int {
	selected := make(map[int64]bool, len(ids))
	for _, rawID := range ids {
		if id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64); err == nil && id != 0 {
			selected[id] = true
		}
	}
	if len(selected) == 0 || r == nil || r.app == nil {
		return 0
	}
	r.app.mapSelectedDemo = ""
	if len(selected) == 1 {
		for id := range selected {
			r.setCurrentTask(id)
		}
	} else {
		r.setCurrentTask(0)
	}
	if r.app.viewMode == mapViewMap {
		r.app.viewMode = mapViewSidebar
		setText(r.app.hViewMode, "侧栏")
		r.app.relayoutForMapMode()
	}
	r.app.selectMapTasks(selected)
	// Refresh immediately so the selected marker changes to the current-item
	// star in the same interaction, without waiting for a later list event.
	r.pushSelection()
	return len(selected)
}

func (r *mapRuntime) onMessage(raw string) {
	var msg mapRuntimeMessage
	if json.Unmarshal([]byte(raw), &msg) != nil || r.app == nil {
		return
	}
	r.app.postUI(func() {
		// The user may disable the map after WebView posts a message but before
		// this UI callback runs. Never touch a controller that has been closed.
		if !r.app.mapFeaturesEnabled() || r.browser == nil {
			return
		}
		switch msg.Type {
		case "ready":
			r.pushPoints(!r.app.settings.MapCameraSet)
			r.applyZoomSpeed()
			r.pushPendingFocus()
			r.pushCacheSize()
			online, _ := r.cache.state()
			mode := "offline"
			if online {
				mode = "online"
			}
			r.browser.Eval("window.mediovaMode(" + strconv.Quote(mode) + ")")
		case "camera":
			if validMapCamera(msg.Longitude, msg.Latitude, msg.Zoom) {
				r.app.readSettingsFromUI()
				r.app.settings.MapCameraSet = true
				r.app.settings.MapCenterLongitude = msg.Longitude
				r.app.settings.MapCenterLatitude = msg.Latitude
				r.app.settings.MapZoom = msg.Zoom
				_ = config.Save(r.app.settings)
			}
		case "mode":
			online := msg.Mode != "offline"
			r.cache.setOnline(online)
			mode := "offline"
			if online {
				mode = "online"
			}
			r.browser.Eval("window.mediovaMode(" + strconv.Quote(mode) + ")")
			setText(r.app.hStatusText, map[string]string{"online": "地图已切换为 OpenFreeMap 在线模式；只缓存实际查看区域。", "offline": "地图已切换为离线模式；未缓存区域不会联网。"}[mode])
		case "folder":
			r.app.v455SetFolderFilter(msg.FolderKey, msg.IncludeSubfolders)
			r.pushPoints(true)
		case "folder-action":
			r.app.v455FolderAction(msg.Action)
		case "demo":
			r.app.toggleMapDemo()
			r.pushPoints(true)
		case "geocode-all":
			r.app.startAllReverseGeocode()
		case "geocode-stop":
			r.app.stopReverseGeocoding()
			r.app.setReverseGeocodeNotice("正在停止地名补全…", true)
		case "geocode-clear":
			r.app.clearReverseGeocodeCache()
		case "clear":
			if err := r.cache.clear(); err != nil {
				setText(r.app.hStatusText, "离线地图清理失败："+err.Error())
				return
			}
			r.pushCacheSize()
			r.cache.setOnline(false)
			r.browser.Eval("window.mediovaMode('offline')")
			setText(r.app.hStatusText, "已一键清除全部离线地图缓存；照片、GPS、历史记录和设置均未改变。")
		case "select":
			if count := r.selectTaskIDs(msg.IDs); count > 0 {
				setText(r.app.hStatusText, fmt.Sprintf("已从地图定位并选中 %d 个媒体任务。", count))
			} else if msg.Demo != "" {
				r.app.mapSelectedDemo = msg.Demo
				setText(r.app.hStatusText, "地图测试点："+msg.Demo+"；该点不会写入任务。")
				r.pushPoints(false)
			}
		case "play":
			if r.selectTaskIDs(msg.IDs) == 1 {
				r.app.playSelected(false)
			}
		}
	})
}

func (r *mapRuntime) pushSelection() {
	if r == nil || r.browser == nil || r.app == nil {
		return
	}
	indices := r.app.selectedTaskIndices()
	ids := make([]int64, 0, len(indices))
	r.app.mu.Lock()
	for _, index := range indices {
		if index < 0 || index >= len(r.app.tasks) || r.app.tasks[index] == nil {
			continue
		}
		ids = append(ids, r.app.tasks[index].ID)
	}
	r.app.mu.Unlock()
	data, err := json.Marshal(ids)
	if err != nil {
		return
	}
	r.browser.Eval("window.mediovaSelection(" + string(data) + "," + strconv.FormatInt(r.currentTask(), 10) + ")")
}

func (r *mapRuntime) pushPoints(fit bool) {
	if r == nil || r.browser == nil || r.app == nil {
		return
	}
	points := r.app.currentMapPoints()
	thumbnailPaths := make(map[int64]string)
	for _, point := range points {
		if point.TaskID != 0 && point.ThumbnailPath != "" {
			thumbnailPaths[point.TaskID] = point.ThumbnailPath
		}
	}
	r.thumbnailMu.Lock()
	r.thumbnailPaths = thumbnailPaths
	r.thumbnailMu.Unlock()
	data, err := json.Marshal(points)
	if err != nil {
		return
	}
	pointSum := sha256.Sum256(data)
	pointState := hex.EncodeToString(pointSum[:])
	r.mu.Lock()
	pointsUnchanged := pointState == r.pointState
	if !pointsUnchanged || fit {
		r.pointState = pointState
	}
	r.mu.Unlock()
	folders, folderErr := json.Marshal(r.app.currentMapFolders())
	if folderErr == nil {
		r.app.mu.Lock()
		folderKey, include := r.app.folderFilterKey, r.app.folderIncludeSubdirs
		r.app.mu.Unlock()
		folderState := string(folders) + "\x00" + folderKey + "\x00" + strconv.FormatBool(include)
		r.mu.Lock()
		changed := folderState != r.folderState
		if changed {
			r.folderState = folderState
		}
		r.mu.Unlock()
		if changed {
			r.browser.Eval("window.mediovaSetFolders(" + string(folders) + "," + strconv.Quote(folderKey) + "," + strconv.FormatBool(include) + ")")
		}
	}
	if !pointsUnchanged || fit {
		r.browser.Eval("window.mediovaSetPoints(" + string(data) + "," + strconv.FormatBool(fit) + ")")
	}
}
func (r *mapRuntime) registerThumbnail(taskID int64, path string) {
	if r == nil || r.browser == nil || taskID <= 0 || strings.TrimSpace(path) == "" {
		return
	}
	r.thumbnailMu.Lock()
	if r.thumbnailPaths == nil {
		r.thumbnailPaths = make(map[int64]string)
	}
	r.thumbnailPaths[taskID] = path
	r.thumbnailMu.Unlock()
	r.browser.Eval("window.mediovaThumbnail(" + strconv.Quote(strconv.FormatInt(taskID, 10)) + ")")
}

func (r *mapRuntime) applyZoomSpeed() {
	if r == nil || r.browser == nil || r.app == nil {
		return
	}
	r.browser.Eval("if(window.mediovaSpeed){window.mediovaSpeed(" + strconv.FormatBool(r.app.settings.MapFastZoom) + ")}")
}

func (r *mapRuntime) pushCacheSize() {
	if r != nil && r.browser != nil && r.cache != nil {
		r.browser.Eval(fmt.Sprintf("window.mediovaCache(%d)", r.cache.sizeBytes()))
	}
}

func (r *mapRuntime) resize() {
	if r != nil && r.browser != nil {
		r.browser.Resize()
		_ = r.browser.Show()
	}
}

type mapControllerABI struct {
	vtable *[26]uintptr
}

// The upstream wrapper does not expose ICoreWebView2Controller::Close. Calling
// the documented COM vtable slot releases the controller immediately, so the
// map can be disabled and later recreated without retaining a hidden WebView.
func closeMapWebView(browser *edge.Chromium) {
	if browser == nil {
		return
	}
	browser.MessageCallback = nil
	browser.WebResourceRequestedCallback = nil
	browser.NavigationCompletedCallback = nil
	browser.AcceleratorKeyCallback = nil
	_ = browser.Hide()
	controller := browser.GetController()
	if controller == nil {
		return
	}
	abi := (*mapControllerABI)(unsafe.Pointer(controller))
	if abi.vtable == nil || abi.vtable[24] == 0 {
		return
	}
	syscall.SyscallN(abi.vtable[24], uintptr(unsafe.Pointer(controller)))
}

func (r *mapRuntime) close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	browser := r.browser
	r.browser = nil
	r.mu.Unlock()
	if r.server != nil {
		_ = r.server.Close()
	}
	if r.listener != nil {
		_ = r.listener.Close()
	}
	closeMapWebView(browser)
	profile := r.profileDir
	if profile != "" {
		go func() {
			time.Sleep(500 * time.Millisecond)
			_ = os.RemoveAll(profile)
		}()
	}
}

const mapRuntimeSubclassID = 0x45D1

var (
	mapRuntimeRegistry         sync.Map
	mapRuntimeSubclassCallback uintptr
)

func init() {
	mapRuntimeSubclassCallback = syscall.NewCallback(mapRuntimeSubclassProc)
}

func mapRuntimeFor(a *application) *mapRuntime {
	if a == nil {
		return nil
	}
	value, ok := mapRuntimeRegistry.Load(a)
	if !ok {
		return nil
	}
	runtime, _ := value.(*mapRuntime)
	return runtime
}

func mapRuntimeSubclassProc(hwnd uintptr, message uint32, wParam, lParam, subclassID, refData uintptr) uintptr {
	a := app
	if message == WM_DESTROY && a != nil {
		if runtime := mapRuntimeFor(a); runtime != nil {
			mapRuntimeRegistry.Delete(a)
			runtime.close()
		}
		v452RemoveSubclass.Call(hwnd, mapRuntimeSubclassCallback, mapRuntimeSubclassID)
	}
	result, _, _ := v452DefSubclassProc.Call(hwnd, uintptr(message), wParam, lParam)
	if message == WM_SIZE && a != nil {
		a.applyMapSidebarColumns()
		if runtime := mapRuntimeFor(a); runtime != nil {
			runtime.resize()
		}
	}
	return result
}

func (a *application) ensureMapRuntime() {
	if a == nil || !a.mapFeaturesEnabled() || mapRuntimeFor(a) != nil || a.hMapSurface == 0 {
		return
	}
	runtime, err := newMapRuntime(a)
	if err != nil {
		setText(a.hStatusText, "真实地图加载失败："+err.Error()+"。请确认已安装 Microsoft Edge WebView2 Runtime。")
		return
	}
	mapRuntimeRegistry.Store(a, runtime)
	v452RemoveSubclass.Call(a.hwnd, mapRuntimeSubclassCallback, mapRuntimeSubclassID)
	v452SetWindowSubclass.Call(a.hwnd, mapRuntimeSubclassCallback, mapRuntimeSubclassID, 0)
}

func (a *application) resizeMapRuntime() {
	if runtime := mapRuntimeFor(a); runtime != nil {
		runtime.resize()
	}
}

func (a *application) shutdownMapRuntime() {
	if runtime := mapRuntimeFor(a); runtime != nil {
		mapRuntimeRegistry.Delete(a)
		runtime.close()
	}
}
