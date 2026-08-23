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
	m.mu.Lock()
	defer m.mu.Unlock()
	data, err := os.ReadFile(m.cachePath(rawURL))
	if err != nil {
		return nil, false
	}
	now := time.Now()
	_ = os.Chtimes(m.cachePath(rawURL), now, now)
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
	if _, err = tmpFile.Write(data); err == nil {
		err = tmpFile.Sync()
	}
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
	closed         bool
	hasFocus       bool
	focusLongitude float64
	focusLatitude  float64
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
	r := &mapRuntime{app: a, cache: cache, listener: listener}
	r.prefix = "/" + token
	r.baseURL = "http://" + listener.Addr().String() + "/" + token
	r.client = &http.Client{
		Timeout: 20 * time.Second,
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
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// The unguessable prefix prevents unrelated local pages from using the
	// loopback cache endpoint while Mediova is running.
	path := strings.TrimPrefix(req.URL.Path, r.prefix)
	switch path {
	case "/map", "/map/":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, r.mapHTML())
	case "/maplibre.js":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = w.Write(mapLibreJS)
	case "/maplibre.css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		_, _ = w.Write(mapLibreCSS)
	case "/maplibre-license.txt":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(mapLibreLicense)
	case "/cache-status":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = fmt.Fprintf(w, "{\"bytes\":%d}", r.cache.sizeBytes())
	default:
		if strings.HasPrefix(path, "/ofm/") {
			r.serveOpenFreeMap(w, req, strings.TrimPrefix(path, "/ofm/"))
			return
		}
		http.NotFound(w, req)
	}
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

func (r *mapRuntime) mapHTML() string {
	base, _ := json.Marshal(r.baseURL)
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="` + r.baseURL + `/maplibre.css"><style>
html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#eef4f8}.toolbar{position:absolute;z-index:5;top:10px;left:10px;right:10px;display:flex;gap:6px;align-items:center;pointer-events:none}.brand,.tools{pointer-events:auto;background:rgba(255,255,255,.94);box-shadow:0 1px 5px rgba(31,57,76,.18);border-radius:5px;height:34px;display:flex;align-items:center}.brand{padding:0 11px;color:#29465a;font-size:13px}.tools{margin-left:6px;padding:0 5px;gap:3px}.tools button{border:0;background:transparent;color:#355a73;height:26px;padding:0 9px;border-radius:4px;font:12px "Segoe UI","Microsoft YaHei";cursor:pointer}.tools button.active{background:#dcecff;color:#125a9a}.tools button:hover{background:#e8f2fa}.cache{color:#6f8492;font-size:11px;padding:0 5px}.notice{position:absolute;z-index:4;left:12px;bottom:12px;background:rgba(255,255,255,.92);color:#5b7180;padding:6px 9px;border-radius:4px;font-size:11px;box-shadow:0 1px 4px rgba(31,57,76,.13)}
</style></head><body><div id="map"></div><div class="toolbar"><div class="brand">媒体位置</div><div class="tools"><button id="online" class="active">在线 · OpenFreeMap</button><button id="offline">离线地图</button><span id="cache" class="cache">缓存 0 MB / 1 GB</span><button id="clear">清除离线地图</button></div></div><div id="notice" class="notice">在线模式仅缓存实际查看过的区域</div><script src="` + r.baseURL + `/maplibre.js"></script><script>
const BASE=` + string(base) + `;let mode='online',points=[];const post=o=>window.chrome.webview.postMessage(JSON.stringify(o));
const map=new maplibregl.Map({container:'map',style:BASE+'/ofm/styles/liberty',center:[105,35],zoom:3,attributionControl:true});map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
function install(){if(map.getSource('media'))return;map.addSource('media',{type:'geojson',data:{type:'FeatureCollection',features:points},cluster:true,clusterMaxZoom:14,clusterRadius:36,clusterProperties:{selected_count:['+',['case',['get','selected'],1,0]]}});const selected=['>', ['get','selected_count'],0];map.addLayer({id:'clusters',type:'circle',source:'media',filter:['has','point_count'],paint:{'circle-color':['case',selected,'#fff4e8','#167fba'],'circle-radius':['step',['get','point_count'],15,10,19,50,23],'circle-stroke-color':['case',selected,'#f07a18','#fff'],'circle-stroke-width':['case',selected,3,2]}});map.addLayer({id:'cluster-count',type:'symbol',source:'media',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},paint:{'text-color':['case',selected,'#e86f00','#fff']}});map.addLayer({id:'point',type:'circle',source:'media',filter:['!',['has','point_count']],paint:{'circle-color':['case',['get','selected'],'#ff8b24',['get','demo'],'#d6862e','#159783'],'circle-radius':['case',['get','selected'],9,7],'circle-stroke-color':'#fff','circle-stroke-width':2}});map.on('click','clusters',async e=>{const f=e.features[0],leaves=await map.getSource('media').getClusterLeaves(f.properties.cluster_id,1000,0);post({type:'select',ids:leaves.map(x=>x.properties.taskID).filter(Boolean),demo:leaves.find(x=>x.properties.demo)?.properties.label||''})});map.on('click','point',e=>post({type:'select',ids:e.features.map(x=>x.properties.taskID).filter(Boolean),demo:e.features[0].properties.demo?e.features[0].properties.label:''}));for(const id of ['clusters','point']){map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',id,()=>map.getCanvas().style.cursor='')}}
map.on('style.load',install);window.mediovaSetPoints=function(data,fit){points=data.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:p}));if(map.isStyleLoaded()){const s=map.getSource('media');if(s)s.setData({type:'FeatureCollection',features:points});else install()}if(fit&&points.length){const b=new maplibregl.LngLatBounds();points.forEach(p=>b.extend(p.geometry.coordinates));map.fitBounds(b,{padding:70,maxZoom:14,duration:0})}};
window.mediovaFocus=function(lon,lat){map.easeTo({center:[lon,lat],zoom:Math.max(map.getZoom(),15),duration:420})};
window.mediovaCache=function(bytes){document.getElementById('cache').textContent='缓存 '+(bytes<1048576?'<1 MB':(bytes/1048576).toFixed(0)+' MB')+' / 1 GB'};
window.mediovaMode=function(next){mode=next;document.getElementById('online').classList.toggle('active',next==='online');document.getElementById('offline').classList.toggle('active',next==='offline');document.getElementById('notice').textContent=next==='online'?'在线模式仅缓存实际查看过的区域':'离线模式：未缓存区域不会联网';map.setStyle(BASE+'/ofm/styles/liberty?mode='+next+'&t='+Date.now())};
setInterval(()=>fetch(BASE+'/cache-status',{cache:'no-store'}).then(r=>r.json()).then(v=>window.mediovaCache(v.bytes)).catch(()=>{}),2000);document.getElementById('online').onclick=()=>post({type:'mode',mode:'online'});document.getElementById('offline').onclick=()=>post({type:'mode',mode:'offline'});document.getElementById('clear').onclick=()=>{if(confirm('清除全部离线地图缓存？照片、GPS、历史记录和设置不会受影响。'))post({type:'clear'})};post({type:'ready'});
</script></body></html>`
}

type mapRuntimeMessage struct {
	Type string  `json:"type"`
	Mode string  `json:"mode"`
	IDs  []int64 `json:"ids"`
	Demo string  `json:"demo"`
}

func (r *mapRuntime) onMessage(raw string) {
	var msg mapRuntimeMessage
	if json.Unmarshal([]byte(raw), &msg) != nil || r.app == nil {
		return
	}
	r.app.postUI(func() {
		switch msg.Type {
		case "ready":
			r.pushPoints(true)
			r.pushPendingFocus()
			r.pushCacheSize()
			online, _ := r.cache.state()
			mode := "offline"
			if online {
				mode = "online"
			}
			r.browser.Eval("window.mediovaMode(" + strconv.Quote(mode) + ")")
		case "mode":
			online := msg.Mode != "offline"
			r.cache.setOnline(online)
			mode := "offline"
			if online {
				mode = "online"
			}
			r.browser.Eval("window.mediovaMode(" + strconv.Quote(mode) + ")")
			setText(r.app.hStatusText, map[string]string{"online": "地图已切换为 OpenFreeMap 在线模式；只缓存实际查看区域。", "offline": "地图已切换为离线模式；未缓存区域不会联网。"}[mode])
		case "demo":
			r.app.toggleMapDemo()
			r.pushPoints(true)
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
			ids := make(map[int64]bool, len(msg.IDs))
			for _, id := range msg.IDs {
				if id != 0 {
					ids[id] = true
				}
			}
			if len(ids) > 0 {
				r.app.selectMapTasks(ids)
				setText(r.app.hStatusText, fmt.Sprintf("已从地图定位并选中 %d 个媒体任务。", len(ids)))
			} else if msg.Demo != "" {
				r.app.mapSelectedDemo = msg.Demo
				setText(r.app.hStatusText, "地图测试点："+msg.Demo+"；该点不会写入任务。")
				r.pushPoints(false)
			}
		}
	})
}

func (r *mapRuntime) pushPoints(fit bool) {
	if r == nil || r.browser == nil || r.app == nil {
		return
	}
	data, err := json.Marshal(r.app.currentMapPoints())
	if err != nil {
		return
	}
	r.browser.Eval("window.mediovaSetPoints(" + string(data) + "," + strconv.FormatBool(fit) + ")")
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
	r.mu.Unlock()
	if r.browser != nil {
		_ = r.browser.Hide()
	}
	if r.server != nil {
		_ = r.server.Close()
	}
	if r.listener != nil {
		_ = r.listener.Close()
	}
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
	if a == nil || mapRuntimeFor(a) != nil || a.hMapSurface == 0 {
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
