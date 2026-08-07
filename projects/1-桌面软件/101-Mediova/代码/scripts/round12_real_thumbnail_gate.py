from __future__ import annotations

import argparse
import collections
import ctypes
import json
import os
import shutil
import struct
import subprocess
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_list_gate_helpers import IDC_LIST, client_rect_to_screen
from round12_remote_header import RemoteHeaderReader

WM_DROPFILES = 0x0233
LVM_FIRST = 0x1000
LVM_GETITEMCOUNT = LVM_FIRST + 4
GMEM_MOVEABLE = 0x0002
GMEM_ZEROINIT = 0x0040

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = wintypes.LPVOID
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalUnlock.restype = wintypes.BOOL
kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalFree.restype = wintypes.HGLOBAL

gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t


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


def send_dropfiles(main_hwnd: int, path: Path) -> None:
    # DROPFILES is a 20-byte header followed by a double-NUL-terminated UTF-16
    # path list. Ownership transfers to the receiving window, whose normal
    # WM_DROPFILES path calls DragFinish/GlobalFree.
    encoded = str(path.resolve()).encode("utf-16le") + b"\x00\x00\x00\x00"
    payload = struct.pack("<IiiII", 20, 0, 0, 0, 1) + encoded
    handle = kernel32.GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, len(payload))
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    pointer = kernel32.GlobalLock(handle)
    if not pointer:
        kernel32.GlobalFree(handle)
        raise ctypes.WinError(ctypes.get_last_error())
    ctypes.memmove(pointer, payload, len(payload))
    kernel32.GlobalUnlock(handle)
    gate.user32.SendMessageW(main_hwnd, WM_DROPFILES, int(handle), 0)


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
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 25.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1200, 760, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.5)
        list_hwnd = int(gate.user32.GetDlgItem(main_hwnd, IDC_LIST))
        if not list_hwnd:
            raise RuntimeError("task list not found in normal runtime")

        send_dropfiles(main_hwnd, fixture)
        reader = RemoteHeaderReader(process.pid)
        best: dict[str, float | int] = {
            "unique_colors": 0,
            "quantized_unique": 0,
            "saturated_pixels": 0,
            "dominant_ratio": 1.0,
            "luma_span": 0,
        }
        final_image = None
        final_cell: list[int] | None = None
        item_count = 0
        deadline = time.monotonic() + 25.0
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Mediova exited during real-thumbnail gate: rc={process.returncode}")
            item_count = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0))
            if item_count > 0:
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
                if metrics_are_real(metrics):
                    final_image = image
                    final_cell = cell
                    break
                image.close()
            time.sleep(0.20)

        if final_image is None or final_cell is None:
            raise RuntimeError(f"real media thumbnail never appeared in home preview column: items={item_count} best={best}")

        try:
            final_image.save(evidence / "round12-real-thumbnail-list.png")
            left, top, right, bottom = final_cell
            margin_x = max(3, (right - left - 86) // 2)
            crop = final_image.crop((left + margin_x, top + 2, right - margin_x, bottom - 2))
            try:
                crop.save(evidence / "round12-real-thumbnail-cell.png")
            finally:
                crop.close()
        finally:
            final_image.close()

        report = {
            "normal_runtime": True,
            "dropfiles_imported": item_count > 0,
            "item_count": item_count,
            "fixture_size": fixture.stat().st_size,
            "preview_cell": final_cell,
            "metrics": best,
            "real_thumbnail_visible": metrics_are_real(best),
        }
        (evidence / "round12-real-thumbnail-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return 0
    finally:
        if reader is not None:
            reader.close()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
