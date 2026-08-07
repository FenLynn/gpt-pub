from __future__ import annotations

import argparse
import collections
import ctypes
import json
import os
import shutil
import subprocess
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_list_gate_helpers import IDC_LIST, client_rect_to_screen
from round12_remote_header import RemoteHeaderReader
from round12_remote_memory import RemoteMemoryBlock

WM_COMMAND = 0x0111
WM_SETTEXT = 0x000C
BM_CLICK = 0x00F5
IDC_ADD_FILES = 1010
IDOK = 1
EDT1 = 0x0480
LVM_FIRST = 0x1000
LVM_GETIMAGELIST = LVM_FIRST + 2
LVM_GETITEMCOUNT = LVM_FIRST + 4
LVM_GETITEMW = LVM_FIRST + 75
LVSIL_SMALL = 1
LVIF_IMAGE = 0x0002


gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t
gate.user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.PostMessageW.restype = wintypes.BOOL
gate.user32.GetDlgCtrlID.argtypes = [wintypes.HWND]
gate.user32.GetDlgCtrlID.restype = ctypes.c_int


class LVITEMW(ctypes.Structure):
    _fields_ = [
        ("mask", ctypes.c_uint32),
        ("iItem", ctypes.c_int32),
        ("iSubItem", ctypes.c_int32),
        ("state", ctypes.c_uint32),
        ("stateMask", ctypes.c_uint32),
        ("pszText", ctypes.c_void_p),
        ("cchTextMax", ctypes.c_int32),
        ("iImage", ctypes.c_int32),
        ("lParam", ctypes.c_ssize_t),
        ("iIndent", ctypes.c_int32),
        ("iGroupId", ctypes.c_int32),
        ("cColumns", ctypes.c_uint32),
        ("puColumns", ctypes.c_void_p),
        ("piColFmt", ctypes.c_void_p),
        ("iGroup", ctypes.c_int32),
    ]


def child_by_handle(main_hwnd: int, handle: int) -> dict[str, object]:
    return next(child for child in gate.enumerate_children(main_hwnd) if int(child["hwnd"]) == handle)


def generate_fixture(ffmpeg: Path, destination: Path) -> None:
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=12",
        "-t",
        "2",
        "-c:v",
        "mpeg4",
        "-q:v",
        "2",
        "-pix_fmt",
        "yuv420p",
        str(destination),
    ]
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
    if completed.returncode != 0 or not destination.is_file() or destination.stat().st_size < 4096:
        raise RuntimeError(f"unable to generate real thumbnail fixture: rc={completed.returncode} stderr={completed.stderr[-1200:]}")


def choose_real_file(main_hwnd: int, pid: int, path: Path) -> dict[str, object]:
    # Trigger the exact production path: IDC_ADD_FILES -> chooseFiles(false) ->
    # GetOpenFileNameW. PostMessage is required because the main UI thread is
    # blocked inside the modal common-file dialog until the selection closes.
    if not gate.user32.PostMessageW(main_hwnd, WM_COMMAND, IDC_ADD_FILES, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    dialog = gate.find_window(pid, "添加媒体文件", 15.0)
    children = gate.enumerate_children(dialog)

    edit = 0
    edit_id = 0
    for child in children:
        hwnd = int(child["hwnd"])
        control_id = int(gate.user32.GetDlgCtrlID(hwnd))
        if control_id == EDT1:
            edit = hwnd
            edit_id = control_id
            break
    if not edit:
        visible_edits = [child for child in children if bool(child["visible"]) and str(child["class"]).lower() == "edit"]
        if len(visible_edits) == 1:
            edit = int(visible_edits[0]["hwnd"])
            edit_id = int(gate.user32.GetDlgCtrlID(edit))
    if not edit:
        summary = [(child["class"], child["text"], gate.user32.GetDlgCtrlID(int(child["hwnd"]))) for child in children]
        raise RuntimeError(f"file-name edit control not found in common dialog: children={summary!r}")

    value = ctypes.create_unicode_buffer(str(path.resolve()))
    gate.user32.SendMessageW(edit, WM_SETTEXT, 0, ctypes.addressof(value))
    time.sleep(0.20)

    open_button = int(gate.user32.GetDlgItem(dialog, IDOK))
    if not open_button:
        candidates = [
            child for child in children
            if bool(child["visible"]) and str(child["class"]).lower() == "button" and "打开" in str(child["text"])
        ]
        if candidates:
            open_button = int(candidates[0]["hwnd"])
    if not open_button:
        summary = [(child["class"], child["text"], gate.user32.GetDlgCtrlID(int(child["hwnd"]))) for child in children]
        raise RuntimeError(f"Open button not found in common dialog: children={summary!r}")

    gate.user32.SendMessageW(open_button, BM_CLICK, 0, 0)
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if not gate.user32.IsWindowVisible(dialog):
            return {"dialog_edit_id": edit_id, "open_button_text": gate.window_text(open_button)}
        time.sleep(0.05)
    raise RuntimeError("common file dialog did not close after clicking Open")


def read_subitem_image_index(remote: RemoteMemoryBlock, list_hwnd: int, row: int, subitem: int) -> tuple[int, int]:
    item = LVITEMW(mask=LVIF_IMAGE, iItem=row, iSubItem=subitem, iImage=-999)
    remote.write(int(remote.address), item, ctypes.sizeof(item))
    result = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMW, 0, int(remote.address)))
    returned = LVITEMW()
    read = remote.read_into(int(remote.address), returned, ctypes.sizeof(returned))
    if read != ctypes.sizeof(returned):
        raise RuntimeError(f"short LVITEMW read: {read} != {ctypes.sizeof(returned)}")
    return int(returned.iImage), result


def preview_metrics(image, cell: list[int]) -> dict[str, float | int]:
    left, top, right, bottom = cell
    if left < 0 or top < 0 or right > image.width or bottom > image.height or right <= left or bottom <= top:
        return {"unique_colors": 0, "quantized_unique": 0, "saturated_pixels": 0, "dominant_ratio": 1.0, "luma_span": 0}
    margin_x = max(3, (right - left - 86) // 2)
    crop = image.crop((left + margin_x, top + 2, right - margin_x, bottom - 2)).convert("RGB")
    try:
        pixels = list(crop.getdata())
    finally:
        crop.close()
    if not pixels:
        return {"unique_colors": 0, "quantized_unique": 0, "saturated_pixels": 0, "dominant_ratio": 1.0, "luma_span": 0}
    unique_colors = len(set(pixels))
    quantized = [(r // 32, g // 32, b // 32) for r, g, b in pixels]
    counts = collections.Counter(quantized)
    dominant_ratio = counts.most_common(1)[0][1] / len(quantized)
    saturated = sum(1 for r, g, b in pixels if max(r, g, b) - min(r, g, b) >= 80)
    lumas = [(77 * r + 150 * g + 29 * b) >> 8 for r, g, b in pixels]
    return {
        "unique_colors": unique_colors,
        "quantized_unique": len(counts),
        "saturated_pixels": saturated,
        "dominant_ratio": round(dominant_ratio, 6),
        "luma_span": max(lumas) - min(lumas),
    }


def metrics_are_real(metrics: dict[str, float | int]) -> bool:
    return (
        int(metrics["unique_colors"]) >= 120
        and int(metrics["quantized_unique"]) >= 10
        and int(metrics["saturated_pixels"]) >= 250
        and float(metrics["dominant_ratio"]) <= 0.60
        and int(metrics["luma_span"]) >= 100
    )


def save_preview_evidence(image, cell: list[int], evidence: Path, prefix: str) -> None:
    image.save(evidence / f"{prefix}-list.png")
    left, top, right, bottom = cell
    if left < 0 or top < 0 or right > image.width or bottom > image.height or right <= left or bottom <= top:
        return
    margin_x = max(3, (right - left - 86) // 2)
    crop = image.crop((left + margin_x, top + 2, right - margin_x, bottom - 2))
    try:
        crop.save(evidence / f"{prefix}-cell.png")
    finally:
        crop.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    ffmpeg = exe.parent / "Components" / "FFmpeg" / "bin" / "ffmpeg.exe"
    if not ffmpeg.is_file():
        raise RuntimeError(f"bundled FFmpeg not found: {ffmpeg}")

    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-real-thumb-"))
    fixture = isolated / "round12-real-thumbnail-testsrc.mp4"
    generate_fixture(ffmpeg, fixture)

    env = os.environ.copy()
    env["APPDATA"] = str(isolated / "AppData")
    env["LOCALAPPDATA"] = str(isolated / "LocalAppData")
    env["XDG_CONFIG_HOME"] = str(isolated / "XDG")
    process = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env)
    reader: RemoteHeaderReader | None = None
    remote: RemoteMemoryBlock | None = None
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 25.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1200, 760, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.5)
        list_hwnd = int(gate.user32.GetDlgItem(main_hwnd, IDC_LIST))
        add_button = int(gate.user32.GetDlgItem(main_hwnd, IDC_ADD_FILES))
        if not list_hwnd or not add_button:
            raise RuntimeError("task list or Add Files button not found in normal runtime")
        if not gate.user32.IsWindowVisible(add_button):
            raise RuntimeError("Add Files button is not visible in normal runtime")

        dialog_result = choose_real_file(main_hwnd, process.pid, fixture)
        reader = RemoteHeaderReader(process.pid)
        remote = RemoteMemoryBlock(process.pid, ctypes.sizeof(LVITEMW))
        image_list_handle = int(gate.user32.SendMessageW(list_hwnd, LVM_GETIMAGELIST, LVSIL_SMALL, 0))
        best: dict[str, float | int] = {
            "unique_colors": 0,
            "quantized_unique": 0,
            "saturated_pixels": 0,
            "dominant_ratio": 1.0,
            "luma_span": 0,
        }
        image_indices: list[int] = []
        getitem_results: list[int] = []
        final_image = None
        final_cell: list[int] | None = None
        item_count = 0
        deadline = time.monotonic() + 25.0
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Mediova exited during real-thumbnail gate: rc={process.returncode}")
            item_count = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0))
            if item_count > 0:
                image_index, getitem_result = read_subitem_image_index(remote, list_hwnd, 0, 1)
                if not image_indices or image_indices[-1] != image_index:
                    image_indices.append(image_index)
                if not getitem_results or getitem_results[-1] != getitem_result:
                    getitem_results.append(getitem_result)

                list_info = child_by_handle(main_hwnd, list_hwnd)
                raw_cell = reader.list_subitem_rect(list_hwnd, 0, 1)
                screen_cell = client_rect_to_screen(list_hwnd, raw_cell)
                origin_x, origin_y = int(list_info["rect"][0]), int(list_info["rect"][1])
                cell = [
                    screen_cell[0] - origin_x,
                    screen_cell[1] - origin_y,
                    screen_cell[2] - origin_x,
                    screen_cell[3] - origin_y,
                ]
                image = runner.capture_screen_rect(list_info["rect"])
                metrics = preview_metrics(image, cell)
                if int(metrics["unique_colors"]) > int(best["unique_colors"]):
                    best = metrics
                    save_preview_evidence(image, cell, evidence, "round12-real-thumbnail-best")
                if metrics_are_real(metrics):
                    final_image = image
                    final_cell = cell
                    break
                image.close()
            time.sleep(0.20)

        report = {
            "normal_runtime": True,
            "real_file_dialog_used": True,
            "dialog": dialog_result,
            "file_imported": item_count > 0,
            "item_count": item_count,
            "fixture_size": fixture.stat().st_size,
            "image_list_handle": image_list_handle,
            "preview_subitem_image_indices": image_indices,
            "lvm_getitem_results": getitem_results,
            "lvitem_size": ctypes.sizeof(LVITEMW),
            "preview_cell": final_cell,
            "metrics": best,
            "real_thumbnail_visible": final_image is not None and final_cell is not None and metrics_are_real(best),
        }
        (evidence / "round12-real-thumbnail-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        if final_image is None or final_cell is None:
            raise RuntimeError(f"real media thumbnail never appeared in home preview column: {report}")

        try:
            save_preview_evidence(final_image, final_cell, evidence, "round12-real-thumbnail")
        finally:
            final_image.close()

        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        if remote is not None:
            remote.close()
        if reader is not None:
            reader.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
