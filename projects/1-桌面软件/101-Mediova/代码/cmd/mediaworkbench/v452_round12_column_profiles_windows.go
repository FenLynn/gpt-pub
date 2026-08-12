//go:build windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"mediaworkbench/internal/config"
	"mediaworkbench/internal/model"
)

const round12ColumnProfileVersion = 2

type round12ColumnProfile struct {
	Widths  []int  `json:"widths"`
	Visible []bool `json:"visible"`
}

type round12ColumnProfiles struct {
	Version int                  `json:"version"`
	Video   round12ColumnProfile `json:"video"`
	Image   round12ColumnProfile `json:"image"`
}

var (
	round12ColumnButton  uintptr
	round12ProfileMu     sync.Mutex
	round12Profiles      round12ColumnProfiles
	round12ProfilesReady bool
)

func round12DefaultProfile() round12ColumnProfile {
	widths := make([]int, round12ColumnCount)
	visible := make([]bool, round12ColumnCount)
	for index, definition := range round12Columns {
		widths[index], visible[index] = definition.width, true
	}
	return round12ColumnProfile{Widths: widths, Visible: visible}
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
			// The number column is also the frozen horizontal-scroll anchor. Keep
			// its geometry deterministic instead of persisting an accidental drag.
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

func round12DecodeStoredProfiles(data []byte) (round12ColumnProfiles, bool, bool) {
	var stored round12ColumnProfiles
	if json.Unmarshal(data, &stored) != nil {
		return round12ColumnProfiles{}, false, false
	}
	if stored.Version != 1 && stored.Version != round12ColumnProfileVersion {
		return round12ColumnProfiles{}, false, false
	}
	profiles := round12ColumnProfiles{
		Version: round12ColumnProfileVersion,
		Video:   round12NormalizeProfile(stored.Video),
		Image:   round12NormalizeProfile(stored.Image),
	}
	return profiles, true, stored.Version != round12ColumnProfileVersion
}

func round12ProfilePath() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ui-columns-round12.json"), nil
}

func round12LoadProfiles() {
	round12ProfileMu.Lock()
	if round12ProfilesReady {
		round12ProfileMu.Unlock()
		return
	}
	defaults := round12DefaultProfile()
	round12Profiles = round12ColumnProfiles{
		Version: round12ColumnProfileVersion,
		Video:   defaults,
		Image:   round12DefaultProfile(),
	}
	migrated := false
	if path, err := round12ProfilePath(); err == nil {
		if data, readErr := os.ReadFile(path); readErr == nil {
			if stored, accepted, wasMigrated := round12DecodeStoredProfiles(data); accepted {
				round12Profiles = stored
				migrated = wasMigrated
			}
		}
	}
	round12ProfilesReady = true
	round12ProfileMu.Unlock()

	// Persist the repaired Version 2 profile immediately. This is what makes a
	// real user's previously collapsed Version 1 preview/filename widths heal
	// once and stay healed on the next launch instead of only looking correct in
	// a clean CI data directory.
	if migrated {
		round12SaveProfiles()
	}
}

func round12ProfileFor(kind model.Kind) round12ColumnProfile {
	round12LoadProfiles()
	round12ProfileMu.Lock()
	defer round12ProfileMu.Unlock()
	if kind == model.KindImage {
		return round12NormalizeProfile(round12Profiles.Image)
	}
	return round12NormalizeProfile(round12Profiles.Video)
}

func round12SetProfile(kind model.Kind, profile round12ColumnProfile) {
	round12LoadProfiles()
	round12ProfileMu.Lock()
	profile = round12NormalizeProfile(profile)
	if kind == model.KindImage {
		round12Profiles.Image = profile
	} else {
		round12Profiles.Video = profile
	}
	round12Profiles.Version = round12ColumnProfileVersion
	round12ProfileMu.Unlock()
}

func round12SaveProfiles() {
	round12ProfileMu.Lock()
	profiles := round12Profiles
	profiles.Version = round12ColumnProfileVersion
	profiles.Video = round12NormalizeProfile(profiles.Video)
	profiles.Image = round12NormalizeProfile(profiles.Image)
	round12ProfileMu.Unlock()
	path, err := round12ProfilePath()
	if err != nil {
		return
	}
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return
	}
	data = append(data, '\n')
	tmp := path + ".tmp"
	if os.WriteFile(tmp, data, 0o644) == nil {
		_ = os.Rename(tmp, path)
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
		round12SaveProfiles()
	}
}

func round12ApplyProfile(a *application, kind model.Kind) {
	if a == nil || a.hList == 0 {
		return
	}
	profile := round12ProfileFor(kind)
	for column, width := range profile.Widths {
		if !profile.Visible[column] {
			width = 0
		}
		send(a.hList, LVM_SETCOLUMNWIDTH, uintptr(column), uintptr(width))
	}
	procInvalidateRect.Call(a.hList, 0, 1)
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
	round12SaveProfiles()
}

func round12ShowColumnSettings(a *application) {
	if a == nil || round12ColumnButton == 0 {
		return
	}
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
		round12SetProfile(a.currentKind, round12DefaultProfile())
		round12ApplyProfile(a, a.currentKind)
		round12SaveProfiles()
		return
	}
	column := id - round12ColumnMenuBase
	if !round12ToggleAllowed(column) {
		return
	}
	round12ToggleColumn(a, column)
}
