from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
CODE = REPO / "projects/1-桌面软件/101-Mediova/代码"
CMD = CODE / "cmd/mediaworkbench"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def replace_regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex replacement, found {count}: {pattern[:120]!r}")
    path.write_text(updated, encoding="utf-8", newline="\n")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    main_file = CMD / "main_windows.go"
    v420 = CMD / "v420_windows.go"
    context_file = CMD / "v420_context_windows.go"
    helper = CMD / "v452_ui_state_windows.go"
    thumb_windows = CMD / "v452_thumbnail_lifecycle_windows.go"

    replace_once(thumb_windows, 'modComctl32.NewProc("ImageList_Remove")', 'comctl32.NewProc("ImageList_Remove")')
    replace_once(
        thumb_windows,
        '''\tif state == nil || index <= 0 || !state.ownership.Current(taskID, generation) {
\t\tif cached && path != "" {
\t\t\t_ = os.Remove(path)
\t\t}
''',
        '''\tif state == nil || index <= 0 || !state.ownership.Current(taskID, generation) {
\t\tif cached && path != "" && state != nil && state.ownership.RefCount(path) == 0 {
\t\t\t_ = os.Remove(path)
\t\t}
''',
    )

    replace_once(
        helper,
        '''\tprocRedrawWindow.Call(a.hwnd, 0, 0, RDW_INVALIDATE|RDW_ERASE|RDW_ALLCHILDREN|RDW_UPDATENOW)
}
''',
        '''\tv452InstallListVisuals(a)
\tprocRedrawWindow.Call(a.hwnd, 0, 0, RDW_INVALIDATE|RDW_ERASE|RDW_ALLCHILDREN|RDW_UPDATENOW)
}
''',
    )

    replace_once(main_file, '\tID_CTX_REMOVE_SAFE        = 2227\n', '\tID_CTX_REMOVE_SAFE        = 2227\n\tID_CTX_EXIT_QUEUE         = 2228\n')

    replace_regex_once(
        main_file,
        r'var taskListColumns = \[\]struct \{.*?\n\}\n\nfunc normalizedTaskColumnWidths\(widths \[\]int\) \[\]int \{.*?\n\}\n',
        '''var taskListColumns = v452TaskListColumns

func normalizedTaskColumnWidths(widths []int) []int {
\treturn v452NormalizedColumnWidths(widths)
}
''',
    )
    replace_once(
        main_file,
        '''\t\tw := int(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(i), 0))
\t\tif w < 45 || w > 900 {
''',
        '''\t\tw := int(send(a.hList, LVM_GETCOLUMNWIDTH, uintptr(i), 0))
\t\tminimum := 45
\t\tif i == taskColNumber {
\t\t\tminimum = 32
\t\t}
\t\tif w < minimum || w > 900 {
''',
    )
    replace_once(
        main_file,
        'LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_INFOTIP)',
        'LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER|LVS_EX_INFOTIP|0x00000002)',
    )

    replace_regex_once(
        main_file,
        r'func compareTaskColumn\(left, right \*model.Task, column int\) int \{.*?\n\}\n\nfunc taskSortLabel',
        '''func compareTaskColumn(left, right *model.Task, column int) int {
\tif left == nil && right == nil { return 0 }
\tif left == nil { return 1 }
\tif right == nil { return -1 }
\tcmpString := func(a, b string) int { return strings.Compare(strings.ToLower(a), strings.ToLower(b)) }
\tcmpInt64 := func(a, b int64) int { if a < b { return -1 }; if a > b { return 1 }; return 0 }
\tcmpFloat := func(a, b float64) int { if a < b { return -1 }; if a > b { return 1 }; return 0 }
\tswitch column {
\tcase taskColNumber:
\t\treturn cmpInt64(left.ID, right.ID)
\tcase taskColFile:
\t\treturn cmpString(filepath.Base(left.Input), filepath.Base(right.Input))
\tcase taskColResolution:
\t\tif left.Width != right.Width { return cmpInt64(int64(left.Width), int64(right.Width)) }
\t\treturn cmpInt64(int64(left.Height), int64(right.Height))
\tcase taskColDuration:
\t\treturn cmpFloat(left.Duration, right.Duration)
\tcase taskColDirection:
\t\treturn cmpInt64(int64(left.Rotation), int64(right.Rotation))
\tcase taskColOutputResolution:
\t\treturn cmpString(left.Options.Resolution+left.Options.ImageSize, right.Options.Resolution+right.Options.ImageSize)
\tcase taskColQuality:
\t\treturn cmpString(left.Options.Quality, right.Options.Quality)
\tcase taskColRotation:
\t\treturn cmpString(left.Options.Rotation, right.Options.Rotation)
\tcase taskColInputSize:
\t\treturn cmpInt64(left.InputSize, right.InputSize)
\tcase taskColOutputSize:
\t\treturn cmpInt64(left.OutputSize, right.OutputSize)
\tcase taskColProgress:
\t\treturn cmpFloat(left.Progress, right.Progress)
\tcase taskColStatus:
\t\treturn cmpInt64(int64(taskStatusRank(left.Status)), int64(taskStatusRank(right.Status)))
\tdefault:
\t\treturn cmpInt64(left.ID, right.ID)
\t}
}

func taskSortLabel''',
    )
    replace_once(
        main_file,
        'labels := []string{"文件名", "分辨率", "时长", "方向", "输出分辨率", "质量", "旋转", "源体积", "输出体积", "进度", "状态"}',
        'labels := []string{"编号", "文件名", "分辨率", "时长", "方向", "输出分辨率", "质量", "旋转", "源体积", "输出体积", "进度", "状态"}',
    )

    replace_regex_once(
        main_file,
        r'func \(a \*application\) insertRow\(row int, t \*model.Task\) \{.*?\n\}\nfunc \(a \*application\) taskTexts',
        '''func (a *application) insertRow(row int, t *model.Task) {
\tbase := a.taskTexts(t)
\ttexts := append([]string{fmt.Sprintf("%d", row+1)}, base...)
\tq := p(texts[taskColNumber])
\titem := lvItem{Mask: LVIF_TEXT, IItem: int32(row), PszText: q}
\tsend(a.hList, LVM_INSERTITEMW, 0, uintptr(unsafe.Pointer(&item)))
\tfor col := 1; col < len(texts); col++ {
\t\tq = p(texts[col])
\t\tif col == taskColFile {
\t\t\tit := lvItem{Mask: LVIF_TEXT | LVIF_IMAGE, IItem: int32(row), ISubItem: int32(col), PszText: q, IImage: int32(t.ThumbnailIndex)}
\t\t\tsend(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&it)))
\t\t\tcontinue
\t\t}
\t\tit := lvItem{ISubItem: int32(col), PszText: q}
\t\tsend(a.hList, LVM_SETITEMTEXTW, uintptr(row), uintptr(unsafe.Pointer(&it)))
\t}
}
func (a *application) taskTexts''',
    )

    replace_once(main_file, 'texts := a.taskTexts(&taskSnapshot)\n\tq := p(texts[0])', 'texts := append([]string{fmt.Sprintf("%d", row+1)}, a.taskTexts(&taskSnapshot)...)\n\tq := p(texts[taskColNumber])')
    replace_once(
        main_file,
        'first := lvItem{Mask: LVIF_TEXT | LVIF_IMAGE, IItem: int32(row), ISubItem: 0, PszText: q, IImage: int32(taskSnapshot.ThumbnailIndex)}',
        'first := lvItem{Mask: LVIF_TEXT, IItem: int32(row), ISubItem: taskColNumber, PszText: q}',
    )
    replace_once(
        main_file,
        '''\tfor col := 1; col < len(texts); col++ {
\t\tq = p(texts[col])
\t\tit := lvItem{ISubItem: int32(col), PszText: q}
\t\tsend(a.hList, LVM_SETITEMTEXTW, uintptr(row), uintptr(unsafe.Pointer(&it)))
\t}
\tsend(a.hList, LVM_REDRAWITEMS, uintptr(row), uintptr(row))
''',
        '''\tfor col := 1; col < len(texts); col++ {
\t\tq = p(texts[col])
\t\tif col == taskColFile {
\t\t\tit := lvItem{Mask: LVIF_TEXT | LVIF_IMAGE, IItem: int32(row), ISubItem: int32(col), PszText: q, IImage: int32(taskSnapshot.ThumbnailIndex)}
\t\t\tsend(a.hList, LVM_SETITEMW, 0, uintptr(unsafe.Pointer(&it)))
\t\t\tcontinue
\t\t}
\t\tit := lvItem{ISubItem: int32(col), PszText: q}
\t\tsend(a.hList, LVM_SETITEMTEXTW, uintptr(row), uintptr(unsafe.Pointer(&it)))
\t}
\tsend(a.hList, LVM_REDRAWITEMS, uintptr(row), uintptr(row))
''',
    )

    replace_once(main_file, 'if cd.ISubItem != 8 && cd.ISubItem != 9 && cd.ISubItem != 10 {', 'if cd.ISubItem != taskColOutputSize && cd.ISubItem != taskColProgress && cd.ISubItem != taskColStatus {')
    replace_once(main_file, 'case 8:\n', 'case taskColOutputSize:\n')
    replace_once(main_file, 'case 9:\n', 'case taskColProgress:\n')
    replace_once(main_file, 'case 10:\n', 'case taskColStatus:\n')

    replace_once(main_file, 'type thumbnailJob struct {\n\tid    int64\n\tinput string\n\tprobe media.ProbeInfo\n}', 'type thumbnailJob struct {\n\tid         int64\n\tinput      string\n\tprobe      media.ProbeInfo\n\tgeneration uint64\n}')
    replace_once(main_file, 'a.generateThumbnail(job.id, job.input, job.probe)', 'a.generateThumbnail(job.id, job.input, job.probe, job.generation)')
    replace_once(main_file, 'case a.thumbnailQueue <- thumbnailJob{id: id, input: input, probe: pinfo}:', 'case a.thumbnailQueue <- thumbnailJob{id: id, input: input, probe: pinfo, generation: v452NextThumbnailGeneration(a, id)}:')
    replace_once(main_file, 'func (a *application) generateThumbnail(id int64, input string, pinfo media.ProbeInfo) {', 'func (a *application) generateThumbnail(id int64, input string, pinfo media.ProbeInfo, generation uint64) {')
    replace_once(main_file, '''\tffmpeg, _, _, _, _ := a.componentSnapshot()
\tif a.hImageList == 0 || ffmpeg == "" {
''', '''\tffmpeg, _, _, _, _ := a.componentSnapshot()
\tif a.hImageList == 0 || ffmpeg == "" || !v452ThumbnailCurrent(a, id, generation) {
''')
    replace_once(main_file, '''\tif err != nil {
\t\tif !cached {
\t\t\t_ = os.Remove(out)
\t\t}
\t\treturn
\t}
\ta.postUI(func() {
''', '''\tif err != nil {
\t\tif !cached {
\t\t\t_ = os.Remove(out)
\t\t}
\t\treturn
\t}
\tif !v452ThumbnailCurrent(a, id, generation) {
\t\tif !cached || v452ThumbnailStateFor(a).ownership.RefCount(out) == 0 {
\t\t\t_ = os.Remove(out)
\t\t}
\t\treturn
\t}
\ta.postUI(func() {
''')
    replace_once(main_file, '''\t\ta.mu.Lock()
\t\tt, _ := a.findTaskByIDLocked(id)
\t\tif t != nil && t.Input == input {
\t\t\tt.ThumbnailIndex = int(int32(idx))
\t\t}
\t\ta.mu.Unlock()
\t\ta.updateTaskRowByID(id)
''', '''\t\timageIndex := int(int32(idx))
\t\tif !v452InstallThumbnailAsset(a, id, generation, input, out, cached, imageIndex) {
\t\t\tprocImageListRemoveV452.Call(a.hImageList, uintptr(imageIndex))
\t\t\treturn
\t\t}
\t\ta.updateTaskRowByID(id)
''')

    replace_regex_once(main_file, r'func \(a \*application\) openSelectedDir\(output bool\) \{.*?\n\}', 'func (a *application) openSelectedDir(output bool) {\n\ta.v452OpenTaskDirectory(output)\n}')

    replace_once(main_file, '''\tcase ID_CTX_HOLD_EDIT:
\t\ta.v420BeginHoldSelected()
''', '''\tcase ID_CTX_HOLD_EDIT:
\t\thandled, activated := a.v452ActivateHeldSelected()
\t\tif activated {
\t\t\ta.refreshAll()
\t\t\tsetText(a.hStatusText, "已进入搁置任务修改状态；应用后重新归队。")
\t\t} else if !handled {
\t\t\ta.v420BeginHoldSelected()
\t\t}
\tcase ID_CTX_EXIT_QUEUE:
\t\ta.v452ExitSelectedQueue()
''')
    replace_once(main_file, '''\tappendMenu(temporary, editFlags, ID_CTX_HOLD_EDIT, "搁置并修改参数")
\tappendMenu(temporary, removeFlags, ID_CTX_REMOVE_SAFE, "从任务列表移除")
''', '''\tappendMenu(temporary, a.v452ExitQueueFlags(), ID_CTX_EXIT_QUEUE, "退出队列")
\tappendMenu(temporary, editFlags, ID_CTX_HOLD_EDIT, "搁置并修改参数")
\tappendMenu(temporary, removeFlags, ID_CTX_REMOVE_SAFE, "从任务列表移除")
''')

    replace_once(main_file, 'fillSolid(dis.HDC, dis.RcItem, colorRef(226, 230, 236))', 'fillSolid(dis.HDC, dis.RcItem, colorRef(214, 220, 228))')

    replace_regex_once(main_file, r'func \(a \*application\) cleanupCurrentWorkspace\(mode string\) \{.*?\n\}', '''func (a *application) cleanupCurrentWorkspace(mode string) {
\ta.mu.Lock()
\tcount := 0
\tremovedIDs := make([]int64, 0)
\tfor _, task := range a.tasks {
\t\tif task != nil && task.Kind == a.currentKind && cleanupMatches(task.Status, mode) {
\t\t\tcount++
\t\t\tremovedIDs = append(removedIDs, task.ID)
\t\t}
\t}
\ta.mu.Unlock()
\tif count == 0 {
\t\tsetText(a.hStatusText, "当前工作区没有符合清理条件的任务。")
\t\treturn
\t}
\tlabel := cleanupModeLabel(mode)
\tif messageBox(a.hwnd, "清理任务", fmt.Sprintf("确定从当前工作区移除 %d 个%s任务？\\r\\n源文件和输出文件不会被删除。", count, label), MB_YESNO|MB_ICONQUESTION) != IDYES {
\t\treturn
\t}
\ta.mu.Lock()
\ta.tasks, count = cleanupTaskList(a.tasks, a.currentKind, mode)
\ta.mu.Unlock()
\tv452ReleaseTaskThumbnails(a, removedIDs)
\ta.saveSession()
\ta.refreshAll()
\tsetText(a.hStatusText, fmt.Sprintf("已从当前工作区移除 %d 个%s任务；媒体文件未删除。", count, label))
}''')

    replace_regex_once(main_file, r'func \(a \*application\) clearCurrent\(\) \{.*?\n\}', '''func (a *application) clearCurrent() {
\ta.mu.Lock()
\tvar keep []*model.Task
\tremovedIDs := make([]int64, 0)
\tfor _, t := range a.tasks {
\t\tif t.Kind != a.currentKind || t.Status == model.StatusProcessing {
\t\t\tkeep = append(keep, t)
\t\t} else {
\t\t\tremovedIDs = append(removedIDs, t.ID)
\t\t}
\t}
\ta.tasks = keep
\ta.mu.Unlock()
\tv452ReleaseTaskThumbnails(a, removedIDs)
\ta.saveSession()
\ta.refreshAll()
}''')

    replace_once(main_file, '''\t\tif app != nil && app.hImageList != 0 {
\t\t\tprocImageListDestroy.Call(app.hImageList)
''', '''\t\tif app != nil && app.hImageList != 0 {
\t\t\tv452ReleaseAllThumbnails(app)
\t\t\tprocImageListDestroy.Call(app.hImageList)
''')

    replace_once(v420, '''\t\tpath := task.OutputPath
\t\ta.tasks = append(a.tasks[:i], a.tasks[i+1:]...)
''', '''\t\tpath := task.OutputPath
\t\ta.tasks = append(a.tasks[:i], a.tasks[i+1:]...)
''')
    replace_once(v420, '''\t\ta.mu.Unlock()
\t\t// Conversion interruption removes its partial output before this method.
''', '''\t\ta.mu.Unlock()
\t\tv452ReleaseTaskThumbnails(a, []int64{id})
\t\t// Conversion interruption removes its partial output before this method.
''')

    replace_once(context_file, 'if task.CanHoldForEdit() {\n\t\t\teditableLocked++\n\t\t}', 'if task.CanHoldForEdit() || (task.Status == model.StatusHeld && task.Hold != nil) {\n\t\t\teditableLocked++\n\t\t}')

    round2 = CMD / "v452_round2_windows.go"
    replace_once(round2, 'func (a *application) v452ActivateHeldSelected() bool {', 'func (a *application) v452ActivateHeldSelected() (handled bool, activated bool) {')
    replace_once(round2, '\t\treturn false\n\t}\n\ta.mu.Lock()', '\t\treturn false, false\n\t}\n\ta.mu.Lock()')
    round_text = round2.read_text(encoding='utf-8')
    round_text = round_text.replace('\t\treturn false\n', '\t\treturn false, false\n')
    round_text = round_text.replace('\t\treturn true\n', '\t\treturn true, false\n')
    round_text = round_text.replace('\treturn true\n}', '\treturn true, true\n}', 1)
    round2.write_text(round_text, encoding='utf-8', newline='\n')

    contract = CMD / "v452_round2_source_test.go"
    contract.write_text('''package main

import (
\t"os"
\t"strings"
\t"testing"
)

func TestV452Round2SourceContracts(t *testing.T) {
\tmainData, err := os.ReadFile("main_windows.go")
\tif err != nil { t.Fatal(err) }
\tmain := string(mainData)
\tfor _, want := range []string{
\t\t"var taskListColumns = v452TaskListColumns",
\t\t"taskColOutputSize && cd.ISubItem != taskColProgress && cd.ISubItem != taskColStatus",
\t\t"v452InstallThumbnailAsset",
\t\t"v452ReleaseTaskThumbnails",
\t\t"ID_CTX_EXIT_QUEUE",
\t\t"a.v452OpenTaskDirectory(output)",
\t} {
\t\tif !strings.Contains(main, want) { t.Fatalf("missing round-two contract %q", want) }
\t}
\tfor _, forbidden := range []string{
\t\t"cd.ISubItem != 8 && cd.ISubItem != 9 && cd.ISubItem != 10",
\t\t"func (a *application) openSelectedDir(output bool) {\\n\\tt, _ := a.selectedTask()",
\t} {
\t\tif strings.Contains(main, forbidden) { t.Fatalf("legacy round-two path returned: %q", forbidden) }
\t}
}
''', encoding='utf-8', newline='\n')

    go_files = [
        main_file, v420, context_file, helper, thumb_windows,
        CMD / "v452_round2_logic.go", CMD / "v452_round2_logic_test.go",
        CMD / "v452_round2_windows.go", CMD / "v452_list_visual_windows.go",
        contract,
        CODE / "internal/workflow/queue_exit.go", CODE / "internal/workflow/queue_exit_test.go",
        CODE / "internal/media/thumbnail_ownership.go", CODE / "internal/media/thumbnail_ownership_test.go",
    ]
    subprocess.run(["gofmt", "-w", *map(str, go_files)], check=True)

    protected = [str(path.relative_to(CODE)).replace('\\\\', '/') for path in go_files]
    manifest = CODE / "V452_ROUND2_LIST_LIFECYCLE_FILES_SHA256.txt"
    manifest.write_text('\n'.join(f'{sha(CODE / rel)}  {rel}' for rel in sorted(protected)) + '\n', encoding='utf-8', newline='\n')

    source_manifest = CODE / "SOURCE_FILES_SHA256.txt"
    source_paths = set(protected)
    source_paths.add("V452_ROUND2_LIST_LIFECYCLE_FILES_SHA256.txt")
    for line in source_manifest.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2:
            source_paths.add(parts[1])
    source_manifest.write_text('\n'.join(f'{sha(CODE / rel)}  {rel}' for rel in sorted(source_paths)) + '\n', encoding='utf-8', newline='\n')

    for temporary in [REPO / ".github/workflows/p101-v452-round2-apply.yml", Path(__file__)]:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
