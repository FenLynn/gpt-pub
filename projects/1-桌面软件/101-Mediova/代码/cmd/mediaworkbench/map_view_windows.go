//go:build windows

package main

import (
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"unsafe"

	"mediaworkbench/internal/model"
)

const (
	mapViewList    = "list"
	mapViewSplit   = "split"
	mapViewMap     = "map"
	mapViewSidebar = "sidebar"
)

type mapMediaPoint struct {
	TaskID    int64   `json:"taskID"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Label     string  `json:"label"`
	Demo      bool    `json:"demo"`
	Selected  bool    `json:"selected"`
}

type mapPointScreen struct {
	point mapMediaPoint
	x, y  int32
}

type mapCluster struct {
	x, y     int32
	members  []mapPointScreen
	selected bool
}

type mapCoordinateBounds struct {
	minLat, maxLat float64
	minLon, maxLon float64
}

func mapViewToolbarSpec(mode string) (icon, label string, active bool, ok bool) {
	switch mode {
	case mapViewSplit:
		return "\uECA5", "分屏", true, true
	case mapViewMap:
		return "\uE707", "地图", true, true
	case mapViewSidebar:
		return "\uE8A9", "侧栏", true, true
	default:
		return "\uE8FD", "列表", false, true
	}
}

func mapPlotRect(rc rect) rect {
	plot := rect{
		Left:   rc.Left + scaleDPI(48),
		Top:    rc.Top + scaleDPI(52),
		Right:  rc.Right - scaleDPI(22),
		Bottom: rc.Bottom - scaleDPI(38),
	}
	if plot.Right < plot.Left+scaleDPI(80) {
		plot.Right = plot.Left + scaleDPI(80)
	}
	if plot.Bottom < plot.Top+scaleDPI(54) {
		plot.Bottom = plot.Top + scaleDPI(54)
	}
	return plot
}

func mapBoundsForPoints(points []mapMediaPoint) mapCoordinateBounds {
	if len(points) == 0 {
		return mapCoordinateBounds{minLat: 18, maxLat: 54, minLon: 73, maxLon: 135}
	}
	b := mapCoordinateBounds{
		minLat: points[0].Latitude, maxLat: points[0].Latitude,
		minLon: points[0].Longitude, maxLon: points[0].Longitude,
	}
	for _, p := range points[1:] {
		b.minLat = math.Min(b.minLat, p.Latitude)
		b.maxLat = math.Max(b.maxLat, p.Latitude)
		b.minLon = math.Min(b.minLon, p.Longitude)
		b.maxLon = math.Max(b.maxLon, p.Longitude)
	}
	latSpan := b.maxLat - b.minLat
	lonSpan := b.maxLon - b.minLon
	if latSpan < .08 {
		center := (b.minLat + b.maxLat) / 2
		b.minLat, b.maxLat = center-.04, center+.04
	} else {
		margin := latSpan * .14
		b.minLat -= margin
		b.maxLat += margin
	}
	if lonSpan < .08 {
		center := (b.minLon + b.maxLon) / 2
		b.minLon, b.maxLon = center-.04, center+.04
	} else {
		margin := lonSpan * .14
		b.minLon -= margin
		b.maxLon += margin
	}
	b.minLat = math.Max(-85, b.minLat)
	b.maxLat = math.Min(85, b.maxLat)
	b.minLon = math.Max(-180, b.minLon)
	b.maxLon = math.Min(180, b.maxLon)
	return b
}

func projectMapCoordinate(latitude, longitude float64, b mapCoordinateBounds, plot rect) (int32, int32) {
	lonSpan := b.maxLon - b.minLon
	latSpan := b.maxLat - b.minLat
	if lonSpan <= 0 {
		lonSpan = 1
	}
	if latSpan <= 0 {
		latSpan = 1
	}
	x := float64(plot.Left) + (longitude-b.minLon)/lonSpan*float64(plot.Right-plot.Left)
	y := float64(plot.Bottom) - (latitude-b.minLat)/latSpan*float64(plot.Bottom-plot.Top)
	return int32(math.Round(x)), int32(math.Round(y))
}

func clusterMapPoints(points []mapMediaPoint, plot rect) []mapCluster {
	bounds := mapBoundsForPoints(points)
	clusters := make([]mapCluster, 0, len(points))
	threshold := float64(scaleDPI(22))
	for _, p := range points {
		x, y := projectMapCoordinate(p.Latitude, p.Longitude, bounds, plot)
		screen := mapPointScreen{point: p, x: x, y: y}
		found := -1
		for i := range clusters {
			dx := float64(clusters[i].x - x)
			dy := float64(clusters[i].y - y)
			if math.Hypot(dx, dy) <= threshold {
				found = i
				break
			}
		}
		if found < 0 {
			clusters = append(clusters, mapCluster{x: x, y: y, members: []mapPointScreen{screen}, selected: p.Selected})
			continue
		}
		c := &clusters[found]
		n := int32(len(c.members))
		c.x = (c.x*n + x) / (n + 1)
		c.y = (c.y*n + y) / (n + 1)
		c.members = append(c.members, screen)
		c.selected = c.selected || p.Selected
	}
	return clusters
}

func (a *application) currentMapPoints() []mapMediaPoint {
	if a == nil {
		return nil
	}
	selected := a.selectedTaskIDsSnapshot()
	a.mu.Lock()
	visible := append([]int(nil), a.visible...)
	points := make([]mapMediaPoint, 0, len(visible)+4)
	for _, index := range visible {
		if index < 0 || index >= len(a.tasks) {
			continue
		}
		task := a.tasks[index]
		if task == nil || task.Kind != a.currentKind || !task.Location.Valid() {
			continue
		}
		label := strings.TrimSpace(round12LocationText(task))
		if label == "" || label == "—" {
			label = filepath.Base(task.Input)
		}
		points = append(points, mapMediaPoint{
			TaskID: task.ID, Latitude: task.Location.Latitude,
			Longitude: task.Location.Longitude, Label: label,
			Selected: selected[task.ID],
		})
	}
	a.mu.Unlock()
	if a.mapDemo {
		points = append(points,
			mapMediaPoint{Latitude: 36.1741, Longitude: 120.3865, Label: "青岛 · iPhone GPS 样例", Demo: true, Selected: a.mapSelectedDemo == "青岛 · iPhone GPS 样例"},
			mapMediaPoint{Latitude: 39.9042, Longitude: 116.4074, Label: "北京 · 测试点", Demo: true, Selected: a.mapSelectedDemo == "北京 · 测试点"},
			mapMediaPoint{Latitude: 34.3416, Longitude: 108.9398, Label: "西安 · 测试点 A", Demo: true, Selected: a.mapSelectedDemo == "西安 · 测试点 A"},
			mapMediaPoint{Latitude: 34.3421, Longitude: 108.9402, Label: "西安 · 测试点 B", Demo: true, Selected: a.mapSelectedDemo == "西安 · 测试点 B"},
		)
	}
	return points
}

func drawMapText(hdc uintptr, text string, rc rect, font, color, flags uintptr) {
	old, _, _ := procSelectObject.Call(hdc, font)
	procSetBkMode.Call(hdc, TRANSPARENT)
	procSetTextColor.Call(hdc, color)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p(text))), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), flags)
	if old != 0 {
		procSelectObject.Call(hdc, old)
	}
}

func drawMapCircle(hdc uintptr, x, y, radius int32, fill, border uintptr) {
	brush, _, _ := procCreateSolidBrush.Call(fill)
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, border)
	oldBrush, _, _ := procSelectObject.Call(hdc, brush)
	oldPen, _, _ := procSelectObject.Call(hdc, pen)
	procEllipse.Call(hdc, uintptr(x-radius), uintptr(y-radius), uintptr(x+radius+1), uintptr(y+radius+1))
	procSelectObject.Call(hdc, oldBrush)
	procSelectObject.Call(hdc, oldPen)
	procDeleteObject.Call(brush)
	procDeleteObject.Call(pen)
}

func (a *application) drawMapTestButton(dis *drawItemStruct) bool {
	if dis == nil || dis.HwndItem != a.hMapTest {
		return false
	}
	rc := dis.RcItem
	fill := colorRef(247, 250, 253)
	if a.mapDemo {
		fill = colorRef(229, 241, 255)
	}
	if dis.ItemState&ODS_SELECTED != 0 {
		fill = colorRef(215, 233, 253)
	}
	fillSolid(dis.HDC, rc, colorRef(244, 248, 252))
	inner := rect{Left: rc.Left + 1, Top: rc.Top + 1, Right: rc.Right - 1, Bottom: rc.Bottom - 1}
	fillSolid(dis.HDC, inner, fill)
	drawRoundedBorder(dis.HDC, inner, 4, colorRef(174, 195, 219))
	drawCenteredText(dis.HDC, getText(a.hMapTest), inner, uiFontSmall, colorRef(38, 82, 132))
	return true
}

func (a *application) drawMapSurface(dis *drawItemStruct) bool {
	if a.drawMapTestButton(dis) {
		return true
	}
	if dis == nil || dis.HwndItem != a.hMapSurface {
		return false
	}
	rc := dis.RcItem
	fillSolid(dis.HDC, rc, colorRef(231, 240, 248))
	inner := rect{Left: rc.Left + 1, Top: rc.Top + 1, Right: rc.Right - 1, Bottom: rc.Bottom - 1}
	fillSolid(dis.HDC, inner, colorRef(244, 249, 252))
	drawRoundedBorder(dis.HDC, inner, 3, colorRef(176, 196, 211))

	title := "媒体位置 · WGS84 定位预览"
	summary := "点击媒体点可定位到任务；相近位置会自动聚合。"
	drawMapText(dis.HDC, title, rect{Left: rc.Left + scaleDPI(16), Top: rc.Top + scaleDPI(10), Right: rc.Right - scaleDPI(124), Bottom: rc.Top + scaleDPI(34)}, uiFontBold, colorRef(36, 62, 82), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	drawMapText(dis.HDC, summary, rect{Left: rc.Left + scaleDPI(16), Top: rc.Top + scaleDPI(31), Right: rc.Right - scaleDPI(124), Bottom: rc.Top + scaleDPI(50)}, uiFontSmall, colorRef(91, 111, 126), DT_LEFT|DT_VCENTER|DT_SINGLELINE)

	points := a.currentMapPoints()
	plot := mapPlotRect(rc)
	if len(points) == 0 {
		fillSolid(dis.HDC, plot, colorRef(239, 246, 250))
		drawRoundedBorder(dis.HDC, plot, 4, colorRef(191, 209, 221))
		drawMapText(dis.HDC, "当前筛选结果中没有 GPS 位置", rect{Left: plot.Left, Top: plot.Top + (plot.Bottom-plot.Top)/2 - scaleDPI(22), Right: plot.Right, Bottom: plot.Top + (plot.Bottom-plot.Top)/2}, uiFontBold, colorRef(71, 92, 109), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		drawMapText(dis.HDC, "可导入带 GPS 的照片/视频，或点击右上角“显示测试点”验证地图交互。", rect{Left: plot.Left + 8, Top: plot.Top + (plot.Bottom-plot.Top)/2, Right: plot.Right - 8, Bottom: plot.Top + (plot.Bottom-plot.Top)/2 + scaleDPI(30)}, uiFontSmall, colorRef(105, 122, 136), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
		return true
	}

	fillSolid(dis.HDC, plot, colorRef(235, 245, 249))
	pen, _, _ := procCreatePen.Call(PS_SOLID, 1, colorRef(201, 219, 228))
	oldPen, _, _ := procSelectObject.Call(dis.HDC, pen)
	bounds := mapBoundsForPoints(points)
	for i := 0; i <= 5; i++ {
		x := plot.Left + int32(i)*(plot.Right-plot.Left)/5
		y := plot.Top + int32(i)*(plot.Bottom-plot.Top)/5
		drawGDIline(dis.HDC, x, plot.Top, x, plot.Bottom)
		drawGDIline(dis.HDC, plot.Left, y, plot.Right, y)
		if i < 5 {
			lon := bounds.minLon + float64(i)*(bounds.maxLon-bounds.minLon)/5
			lat := bounds.maxLat - float64(i)*(bounds.maxLat-bounds.minLat)/5
			drawMapText(dis.HDC, fmt.Sprintf("%.3f°", lon), rect{Left: x - scaleDPI(32), Top: plot.Bottom + 2, Right: x + scaleDPI(32), Bottom: plot.Bottom + scaleDPI(22)}, uiFontSmall, colorRef(105, 124, 137), DT_CENTER|DT_VCENTER|DT_SINGLELINE)
			drawMapText(dis.HDC, fmt.Sprintf("%.3f°", lat), rect{Left: rc.Left + 2, Top: y - scaleDPI(10), Right: plot.Left - 4, Bottom: y + scaleDPI(10)}, uiFontSmall, colorRef(105, 124, 137), DT_RIGHT|DT_VCENTER|DT_SINGLELINE)
		}
	}
	procSelectObject.Call(dis.HDC, oldPen)
	procDeleteObject.Call(pen)

	clusters := clusterMapPoints(points, plot)
	for _, cluster := range clusters {
		isDemo := true
		for _, member := range cluster.members {
			if !member.point.Demo {
				isDemo = false
				break
			}
		}
		fill := colorRef(35, 120, 205)
		border := colorRef(20, 92, 166)
		if a.currentKind == model.KindImage {
			fill, border = colorRef(29, 153, 137), colorRef(16, 115, 104)
		}
		if isDemo {
			fill, border = colorRef(214, 134, 46), colorRef(171, 95, 25)
		}
		if cluster.selected {
			drawMapCircle(dis.HDC, cluster.x, cluster.y, scaleDPI(14), colorRef(255, 255, 255), colorRef(32, 91, 171))
		}
		radius := scaleDPI(7)
		if len(cluster.members) > 1 {
			radius = scaleDPI(12)
		}
		drawMapCircle(dis.HDC, cluster.x, cluster.y, radius, fill, border)
		if len(cluster.members) > 1 {
			drawCenteredText(dis.HDC, fmt.Sprintf("%d", len(cluster.members)), rect{Left: cluster.x - radius, Top: cluster.y - radius, Right: cluster.x + radius + 1, Bottom: cluster.y + radius + 1}, uiFontSmall, colorRef(255, 255, 255))
		}
	}

	realCount := 0
	for _, point := range points {
		if !point.Demo {
			realCount++
		}
	}
	footer := fmt.Sprintf("%d 个 GPS 媒体 · %d 个位置聚合", realCount, len(clusters))
	if a.mapDemo {
		footer += " · 已显示 4 个内置测试点（不写入任务）"
	}
	drawMapText(dis.HDC, footer, rect{Left: plot.Left, Top: rc.Bottom - scaleDPI(31), Right: plot.Right, Bottom: rc.Bottom - scaleDPI(8)}, uiFontSmall, colorRef(78, 100, 116), DT_LEFT|DT_VCENTER|DT_SINGLELINE)
	return true
}

func (a *application) relayoutForMapMode() {
	if a == nil || a.hwnd == 0 {
		return
	}
	var rc rect
	if ok, _, _ := procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&rc))); ok != 0 {
		a.layout(rc.Right-rc.Left, rc.Bottom-rc.Top)
	}
	a.applyMapSidebarColumns()
	procInvalidateRect.Call(a.hViewMode, 0, 1)
	a.resizeMapRuntime()
}

func (a *application) cycleMapViewMode() {
	switch a.viewMode {
	case mapViewSplit:
		a.viewMode = mapViewMap
	case mapViewMap:
		a.viewMode = mapViewSidebar
	case mapViewSidebar:
		a.viewMode = mapViewList
	default:
		a.viewMode = mapViewSplit
	}
	setText(a.hViewMode, mapViewLabel(a.viewMode))
	if a.viewMode != mapViewList {
		a.ensureMapRuntime()
	}
	a.relayoutForMapMode()
	setText(a.hStatusText, "视图已切换为"+mapViewLabel(a.viewMode)+"；顶部按钮按“列表 → 分屏 → 地图 → 侧栏”循环。")
}

func mapViewLabel(mode string) string {
	switch mode {
	case mapViewSplit:
		return "分屏"
	case mapViewMap:
		return "地图"
	case mapViewSidebar:
		return "侧栏"
	default:
		return "列表"
	}
}

func (a *application) toggleMapDemo() {
	a.mapDemo = !a.mapDemo
	a.mapSelectedDemo = ""
	if a.mapDemo {
		setText(a.hMapTest, "隐藏测试点")
		setText(a.hStatusText, "已显示地图内置测试点；它们只用于验证界面，不会进入任务、配置或转换队列。")
	} else {
		setText(a.hMapTest, "显示测试点")
		setText(a.hStatusText, "已隐藏地图内置测试点。")
	}
	procInvalidateRect.Call(a.hMapTest, 0, 1)
	if runtime := mapRuntimeFor(a); runtime != nil {
		runtime.pushPoints(true)
	}
}

func (a *application) mapClusterAtCursor() (mapCluster, bool) {
	var cursor point
	if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&cursor))); ok == 0 {
		return mapCluster{}, false
	}
	procScreenToClient.Call(a.hMapSurface, uintptr(unsafe.Pointer(&cursor)))
	var rc rect
	if ok, _, _ := procGetClientRect.Call(a.hMapSurface, uintptr(unsafe.Pointer(&rc))); ok == 0 {
		return mapCluster{}, false
	}
	points := a.currentMapPoints()
	if len(points) == 0 {
		return mapCluster{}, false
	}
	clusters := clusterMapPoints(points, mapPlotRect(rc))
	best := -1
	bestDistance := float64(scaleDPI(18))
	for i := range clusters {
		distance := math.Hypot(float64(clusters[i].x-cursor.X), float64(clusters[i].y-cursor.Y))
		if distance <= bestDistance {
			best = i
			bestDistance = distance
		}
	}
	if best < 0 {
		return mapCluster{}, false
	}
	return clusters[best], true
}

func (a *application) selectMapTasks(ids map[int64]bool) {
	clear := lvItem{State: 0, StateMask: LVIS_SELECTED | LVIS_FOCUSED}
	send(a.hList, LVM_SETITEMSTATE, ^uintptr(0), uintptr(unsafe.Pointer(&clear)))
	firstRow := -1
	a.mu.Lock()
	for row, index := range a.visible {
		if index < 0 || index >= len(a.tasks) || a.tasks[index] == nil || !ids[a.tasks[index].ID] {
			continue
		}
		state := uint32(LVIS_SELECTED)
		if firstRow < 0 {
			firstRow = row
			state |= LVIS_FOCUSED
		}
		item := lvItem{State: state, StateMask: LVIS_SELECTED | LVIS_FOCUSED}
		send(a.hList, LVM_SETITEMSTATE, uintptr(row), uintptr(unsafe.Pointer(&item)))
	}
	a.mu.Unlock()
	if firstRow >= 0 {
		send(a.hList, LVM_ENSUREVISIBLE, uintptr(firstRow), 0)
	}
	a.updateRightPanel()
}

func (a *application) activateMapPointAtCursor() {
	cluster, ok := a.mapClusterAtCursor()
	if !ok {
		return
	}
	ids := map[int64]bool{}
	demoLabel := ""
	for _, member := range cluster.members {
		if member.point.TaskID != 0 {
			ids[member.point.TaskID] = true
		}
		if member.point.Demo && demoLabel == "" {
			demoLabel = member.point.Label
		}
	}
	if len(ids) > 0 {
		a.mapSelectedDemo = ""
		a.selectMapTasks(ids)
		if a.viewMode == mapViewMap {
			a.viewMode = mapViewSplit
			setText(a.hViewMode, "分屏")
			a.relayoutForMapMode()
		}
		setText(a.hStatusText, fmt.Sprintf("已从地图定位并选中 %d 个媒体任务。", len(ids)))
	} else if demoLabel != "" {
		a.mapSelectedDemo = demoLabel
		setText(a.hStatusText, "地图测试点："+demoLabel+"；该点不会写入任务。")
	}
	procInvalidateRect.Call(a.hMapSurface, 0, 1)
}

func (a *application) invalidateMapView() {
	if a != nil && a.hMapSurface != 0 && a.viewMode != mapViewList {
		if runtime := mapRuntimeFor(a); runtime != nil {
			runtime.pushPoints(false)
		}
	}
}
