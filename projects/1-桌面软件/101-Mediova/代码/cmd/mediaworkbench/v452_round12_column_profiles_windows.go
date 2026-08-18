//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const round12ColumnProfileVersion = 4

type round12ColumnProfile struct {
	Widths  []int  `json:"widths"`
	Visible []bool `json:"visible"`
}

type round12ColumnProfiles struct {
	Version int                  `json:"version"`
	Video   round12ColumnProfile `json:"video"`
	Image   round12ColumnProfile `json:"image"`
}

// round12LegacyWidthProfiles is the read-only shape written by Round7. It is
// accepted only when no current Round12 profile can be recovered.
type round12LegacyWidthProfiles struct {
	Version int   `json:"version"`
	Video   []int `json:"video"`
	Image   []int `json:"image"`
}

var (
	round12ColumnButton  uintptr
	round12ProfileMu     sync.Mutex
	round12Profiles      round12ColumnProfiles
	round12ProfilesReady bool
	// Width messages are synchronous and can re-enter the ListView subclass.
	// A depth counter distinguishes our authoritative profile application from
	// user/header width changes without relying on timing.
	round12ProfileApplyDepth atomic.Int32
)

func round12DefaultProfile() round12ColumnProfile {
	widths := make([]int, round12ColumnCount)
	visible := make([]bool, round12ColumnCount)
	for index, definition := range round12Columns {
		widths[index], visible[index] = definition.width, round12DefaultColumnVisible(index)
	}
	return round12ColumnProfile{Widths: widths, Visible: visible}
}

func round12DefaultProfileFor(kind model.Kind) round12ColumnProfile {
	profile := round12DefaultProfile()
	if kind == model.KindImage {
		profile.Visible[round12ColPictureCrop] = true
	}
	return profile
}

func round12DefaultColumnVisible(column int) bool {
	switch column {
	case round12ColNumber,
		round12ColPreview,
		round12ColFile,
		round12ColOutputSize,
		round12ColProgress,
		round12ColStatus:
		return true
	default:
		return false
	}
}

func round12MinimumColumnWidth(column int) int {
	// These minima are semantic, not arbitrary layout clamps. In particular,
	// the preview cell needs enough room for the 86 px thumbnail plus its
	// physical margins, while the filename column must remain useful instead of
	// collapsing into a narrow text sliver. Less important columns can still be
	// hidden explicitly from the Round12 column menu.
	minimums := [...]int{
		44, 98, 160, 82, 70,
		58, 96, 50, 62, 72,
		96, 88, 84, 100, 82,
	}
	if column < 0 || column >= len(minimums) {
		return 35
	}
	return minimums[column]
}

func round12NormalizeProfile(profile round12ColumnProfile) round12ColumnProfile {
	defaults := round12DefaultProfile()
	if len(profile.Widths) != round12ColumnCount {
		profile.Widths = defaults.Widths
	} else {
		profile.Widths = append([]int(nil), profile.Widths...)
	}
	if len(profile.Visible) != round12ColumnCount {
		profile.Visible = defaults.Visible
	} else {
		profile.Visible = append([]bool(nil), profile.Visible...)
	}
	for index, definition := range round12Columns {
		if index == round12ColNumber {
			// Keep the leading identifier compact and deterministic instead of
			// persisting an accidental drag.
			profile.Widths[index] = definition.width
			continue
		}
		if profile.Widths[index] < round12MinimumColumnWidth(index) || profile.Widths[index] > 900 {
			profile.Widths[index] = definition.width
		}
	}
	for _, fixed := range []int{round12ColNumber, round12ColPreview, round12ColFile} {
		profile.Visible[fixed] = true
	}
	return profile
}

func round12NormalizeProfileFor(kind model.Kind, profile round12ColumnProfile) round12ColumnProfile {
	hadCompleteVisibility := len(profile.Visible) == round12ColumnCount
	profile = round12NormalizeProfile(profile)
	if kind == model.KindImage && !hadCompleteVisibility {
		profile.Visible[round12ColPictureCrop] = true
	}
	return profile
}

func round12MigrateLegacyProfile(profile round12ColumnProfile) round12ColumnProfile {
	hadCompleteVisibility := len(profile.Visible) == round12ColumnCount
	allVisible := hadCompleteVisibility
	if hadCompleteVisibility {
		for _, visible := range profile.Visible {
			if !visible {
				allVisible = false
				break
			}
		}
	}

	profile = round12NormalizeProfile(profile)
	// Versions 1 and 2 shipped with every column visible. Treat that exact
	// shape as the old default and migrate it to the compact core set. If a
	// user had hidden even one optional column, their explicit choices win.
	if !hadCompleteVisibility || allVisible {
		profile.Visible = append([]bool(nil), round12DefaultProfile().Visible...)
	}
	return profile
}

func round12DecodeStoredProfiles(data []byte) (round12ColumnProfiles, bool, bool) {
	var stored round12ColumnProfiles
	if json.Unmarshal(data, &stored) != nil {
		return round12ColumnProfiles{}, false, false
	}
	if stored.Version < 1 || stored.Version > round12ColumnProfileVersion {
		return round12ColumnProfiles{}, false, false
	}
	normalize := round12NormalizeProfile
	if stored.Version < round12ColumnProfileVersion {
		normalize = round12MigrateLegacyProfile
	}
	profiles := round12ColumnProfiles{
		Version: round12ColumnProfileVersion,
		Video:   normalize(stored.Video),
		Image:   round12NormalizeProfileFor(model.KindImage, normalize(stored.Image)),
	}
	if stored.Version < 4 {
		// v3 did not expose the image crop-area ratio by default. Promote it
		// once, while v4 and later continue to respect an explicit user hide.
		profiles.Image.Visible[round12ColPictureCrop] = true
	}
	return profiles, true, stored.Version != round12ColumnProfileVersion
}

func round12LoadStoredProfiles(path string) (round12ColumnProfiles, bool, bool) {
	var stored round12ColumnProfiles
	if err := config.LoadJSON(path, &stored); err != nil {
		return round12ColumnProfiles{}, false, false
	}
	data, err := json.Marshal(stored)
	if err != nil {
		return round12ColumnProfiles{}, false, false
	}
	return round12DecodeStoredProfiles(data)
}

func round12WriteStoredProfiles(path string, profiles round12ColumnProfiles) error {
	profiles.Version = round12ColumnProfileVersion
	profiles.Video = round12NormalizeProfile(profiles.Video)
	profiles.Image = round12NormalizeProfileFor(model.KindImage, profiles.Image)
	return config.SaveJSON(path, profiles)
}

func round12ProfilePath() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ui-columns-round12.json"), nil
}

func round12LegacyProfilePath() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ui-column-widths-v452.json"), nil
}

func round12ProfileFromLegacyWidths(widths []int) round12ColumnProfile {
	profile := round12DefaultProfile()
	legacy := normalizedTaskColumnWidths(widths)
	// Round7 combined preview and filename in column 1. Round12 owns a fixed
	// preview column, while the old combined width remains useful for filename.
	for oldColumn := taskColFile; oldColumn < len(legacy); oldColumn++ {
		newColumn := oldColumn + 1
		if newColumn < len(profile.Widths) {
			profile.Widths[newColumn] = legacy[oldColumn]
		}
	}
	return round12NormalizeProfile(profile)
}

func round12LoadLegacyWidthProfiles() (round12ColumnProfiles, bool) {
	path, err := round12LegacyProfilePath()
	if err != nil {
		return round12ColumnProfiles{}, false
	}
	var legacy round12LegacyWidthProfiles
	if err := config.LoadJSON(path, &legacy); err != nil || legacy.Version < 1 || legacy.Version > 2 {
		return round12ColumnProfiles{}, false
	}
	return round12ColumnProfiles{
		Version: round12ColumnProfileVersion,
		Video:   round12ProfileFromLegacyWidths(legacy.Video),
		Image: func() round12ColumnProfile {
			profile := round12ProfileFromLegacyWidths(legacy.Image)
			profile.Visible[round12ColPictureCrop] = true
			return profile
		}(),
	}, true
}

func round12LoadProfiles() {
	round12ProfileMu.Lock()
	if round12ProfilesReady {
		round12ProfileMu.Unlock()
		return
	}
	round12Profiles = round12ColumnProfiles{
		Version: round12ColumnProfileVersion,
		Video:   round12DefaultProfileFor(model.KindVideo),
		Image:   round12DefaultProfileFor(model.KindImage),
	}
	migrated, loaded := false, false
	if path, err := round12ProfilePath(); err == nil {
		if stored, accepted, wasMigrated := round12LoadStoredProfiles(path); accepted {
			round12Profiles = stored
			migrated = wasMigrated
			loaded = true
		}
	}
	if !loaded {
		if legacy, ok := round12LoadLegacyWidthProfiles(); ok {
			round12Profiles = legacy
			migrated = true
		}
	}
	round12ProfilesReady = true
	round12ProfileMu.Unlock()

	// Persist migrations immediately so repaired widths and the compact default
	// become the next launch's stable per-kind configuration.
	if migrated {
		round12PersistProfiles(app)
	}
}

func round12ProfileFor(kind model.Kind) round12ColumnProfile {
	round12LoadProfiles()
	round12ProfileMu.Lock()
	defer round12ProfileMu.Unlock()
	if kind == model.KindImage {
		return round12NormalizeProfileFor(model.KindImage, round12Profiles.Image)
	}
	return round12NormalizeProfile(round12Profiles.Video)
}

func round12SetProfile(kind model.Kind, profile round12ColumnProfile) {
	round12LoadProfiles()
	round12ProfileMu.Lock()
	if kind == model.KindImage {
		profile = round12NormalizeProfileFor(model.KindImage, profile)
		round12Profiles.Image = profile
	} else {
		profile = round12NormalizeProfile(profile)
		round12Profiles.Video = profile
	}
	round12Profiles.Version = round12ColumnProfileVersion
	round12ProfileMu.Unlock()
}

func round12SaveProfiles() error {
	round12ProfileMu.Lock()
	profiles := round12Profiles
	profiles.Version = round12ColumnProfileVersion
	profiles.Video = round12NormalizeProfile(profiles.Video)
	profiles.Image = round12NormalizeProfileFor(model.KindImage, profiles.Image)
	round12ProfileMu.Unlock()
	path, err := round12ProfilePath()
	if err != nil {
		return err
	}
	return round12WriteStoredProfiles(path, profiles)
}

func round12PersistProfiles(a *application) {
	if err := round12SaveProfiles(); err != nil && a != nil && a.hStatusText != 0 {
		setText(a.hStatusText, fmt.Sprintf("列配置保存失败：%v", err))
	}
}

func round12CaptureProfile(a *application, kind model.Kind, save bool) {
	if a == nil || a.hList == 0 || int(send(send(a.hList, LVM_GETHEADER, 0, 0), round12HDMGetItemCount, 0, 0)) != round12ColumnCount {
		return
	}
	profile := round12ProfileFor(kind)
	for column := 0; column < round12ColumnCount; column++ {
		if !profile.Visible[column] {
			continue
		}
		width := int(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(column), 0))
		if column == round12ColNumber || width < round12MinimumColumnWidth(column) || width > 900 {
			repaired := round12Columns[column].width
			profile.Widths[column] = repaired
			if width != repaired {
				send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(column), uintptr(repaired))
			}
			continue
		}
		profile.Widths[column] = width
	}
	round12SetProfile(kind, profile)
	if save {
		round12PersistProfiles(a)
	}
}

func round12ApplyProfile(a *application, kind model.Kind) {
	if a == nil || a.hList == 0 {
		return
	}
	profile := round12ProfileFor(kind)
	round12ProfileApplyDepth.Add(1)
	defer round12ProfileApplyDepth.Add(-1)
	for column, width := range profile.Widths {
		if !profile.Visible[column] {
			width = 0
		}
		send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(column), uintptr(width))
	}
	procInvalidateRect.Call(a.hList, 0, 1)
}

func round12ColumnWidthChangeAllowed(profile round12ColumnProfile, column, width int) bool {
	if column < 0 || column >= round12ColumnCount {
		return true
	}
	profile = round12NormalizeProfile(profile)
	return profile.Visible[column] || width == 0
}

// round12EnforceProfileVisibility repairs any geometry drift without touching
// user-sized visible columns. In particular, zero-width Header dividers can be
// dragged by comctl32 even though the column menu still says they are hidden.
func round12EnforceProfileVisibility(a *application) {
	if a == nil || a.hList == 0 {
		return
	}
	profile := round12ProfileFor(a.currentKind)
	round12ProfileApplyDepth.Add(1)
	defer round12ProfileApplyDepth.Add(-1)
	for column, visible := range profile.Visible {
		if !visible && int(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(column), 0)) != 0 {
			send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(column), 0)
		}
	}
}

func round12ToggleAllowed(column int) bool {
	return column >= 0 && column < round12ColumnCount && column != round12ColNumber && column != round12ColPreview && column != round12ColFile
}

func round12EnsureColumnButton(a *application) {
	if a == nil || a.hwnd == 0 || round12ColumnButton != 0 {
		return
	}
	round12ColumnButton = createControl("BUTTON", "", WS_CHILD|WS_VISIBLE|BS_OWNERDRAW, 0, 0, 22, 25, a.hwnd, round12IDCColumnSettings)
}

func round12LayoutTopButtons(a *application) {
	if a == nil || a.hwnd == 0 || a.hRightToggle == 0 {
		return
	}
	round12EnsureColumnButton(a)
	var rc rect
	if ok, _, _ := procGetClientRect.Call(a.hwnd, uintptr(unsafe.Pointer(&rc))); ok == 0 {
		return
	}
	width := unscaleDPI(rc.Right - rc.Left)
	buttonWidth := int32(22)
	if width < 1120 {
		buttonWidth = 20
	}
	x := width - 8 - buttonWidth
	move(round12ColumnButton, x, 5, buttonWidth, 25)
	move(a.hRightToggle, x, 34, buttonWidth, 25)
	show(round12ColumnButton, true)
}

func round12DrawColumnButton(dis *drawItemStruct) bool {
	if dis == nil || round12ColumnButton == 0 || dis.HwndItem != round12ColumnButton {
		return false
	}
	canvas := colorRef(250, 251, 253)
	fillSolid(dis.HDC, dis.RcItem, canvas)
	textColor := colorRef(68, 79, 94)
	if dis.ItemState&ODS_SELECTED != 0 {
		inner := rect{Left: dis.RcItem.Left + 1, Top: dis.RcItem.Top + 1, Right: dis.RcItem.Right - 1, Bottom: dis.RcItem.Bottom - 1}
		withRoundedClip(dis.HDC, inner, 4, func() { fillSolid(dis.HDC, inner, colorRef(228, 240, 253)) })
		drawRoundedBorder(dis.HDC, inner, 4, colorRef(111, 157, 211))
	}
	drawCenteredText(dis.HDC, "\uE713", dis.RcItem, iconFont, textColor)
	return true
}

func round12ToggleColumn(a *application, column int) {
	if a == nil || !round12ToggleAllowed(column) {
		return
	}
	round12CaptureProfile(a, a.currentKind, false)
	profile := round12ProfileFor(a.currentKind)
	profile.Visible[column] = !profile.Visible[column]
	round12SetProfile(a.currentKind, profile)
	round12ApplyProfile(a, a.currentKind)
	round12PersistProfiles(a)
}

func round12ShowColumnSettings(a *application) {
	if a == nil || round12ColumnButton == 0 {
		return
	}
	// The menu and the physical Header must describe the same state even if an
	// older build already allowed a hidden zero-width divider to drift open.
	round12EnforceProfileVisibility(a)
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	profile := round12ProfileFor(a.currentKind)
	for column, definition := range round12Columns {
		flags := uintptr(MF_STRING)
		if !round12ToggleAllowed(column) {
			flags |= MF_GRAYED
		}
		id := round12ColumnMenuBase + column
		appendMenu(menu, flags, uintptr(id), definition.name)
		setCheck(menu, id, profile.Visible[column])
	}
	appendMenu(menu, MF_SEPARATOR, 0, "")
	appendMenu(menu, MF_STRING, ID_VIEW_RESET_COLUMNS, "恢复当前类型默认列")
	var rc rect
	if ok, _, _ := procGetWindowRect.Call(round12ColumnButton, uintptr(unsafe.Pointer(&rc))); ok == 0 {
		return
	}
	command, _, _ := procTrackPopupMenu.Call(menu, TPM_RIGHTBUTTON|TPM_RETURNCMD|TPM_NONOTIFY, uintptr(rc.Left), uintptr(rc.Bottom+2), 0, a.hwnd, 0)
	if command == 0 {
		return
	}
	id := int(command)
	if id == ID_VIEW_RESET_COLUMNS {
		round12SetProfile(a.currentKind, round12DefaultProfileFor(a.currentKind))
		round12ApplyProfile(a, a.currentKind)
		round12PersistProfiles(a)
		return
	}
	column := id - round12ColumnMenuBase
	if !round12ToggleAllowed(column) {
		return
	}
	round12ToggleColumn(a, column)
}
