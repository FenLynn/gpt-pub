from __future__ import annotations

import ctypes
import sys
import time
from ctypes import wintypes
from pathlib import Path

import round11_flicker_gate as gate


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


gate.user32.ScreenToClient.argtypes = [wintypes.HWND, ctypes.POINTER(POINT)]
gate.user32.ScreenToClient.restype = wintypes.BOOL


def window_hash(hwnd: int, save_path: Path | None = None) -> str:
    image = gate.capture_window(hwnd)
    try:
        if save_path is not None:
            image.save(save_path)
        return gate.hashlib.sha256(image.tobytes()).hexdigest()
    finally:
        image.close()


def force_two_axis_overflow(main_hwnd: int) -> None:
    children = gate.enumerate_children(main_hwnd)
    listviews = [child for child in children if child["class"] == "SysListView32"]
    if len(listviews) != 1:
        raise RuntimeError(f"expected one ListView, got {listviews!r}")
    listview = listviews[0]
    left, top, _right, _bottom = listview["rect"]
    point = POINT(left, top)
    if not gate.user32.ScreenToClient(main_hwnd, ctypes.byref(point)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not gate.user32.MoveWindow(listview["hwnd"], point.x, point.y, 600, 140, True):
        raise ctypes.WinError(ctypes.get_last_error())
    time.sleep(0.8)


def direct_surface_hover(
    hwnd: int,
    _surfaces: list[dict[str, object]],
    evidence: Path,
) -> list[dict[str, object]]:
    force_two_axis_overflow(hwnd)
    gate.user32.SetCursorPos(300, 300)
    time.sleep(1.0)

    surfaces = [
        child
        for child in gate.enumerate_children(hwnd)
        if child["class"] == "MWRound11StableScrollSurface" and child["visible"]
    ]
    if len(surfaces) != 2:
        raise RuntimeError(f"expected two stable surfaces, got {surfaces!r}")

    records: list[dict[str, object]] = []
    for surface in sorted(surfaces, key=gate.surface_axis):
        axis = gate.surface_axis(surface)
        surface_hwnd = int(surface["hwnd"])
        left, top, right, bottom = surface["rect"]
        baseline = window_hash(surface_hwnd, evidence / f"hover-{axis}-baseline-hidden.png")

        gate.user32.SetCursorPos((left + right) // 2, (top + bottom) // 2)
        time.sleep(0.30)
        pending = window_hash(surface_hwnd, evidence / f"hover-{axis}-300ms-hidden.png")
        if pending != baseline:
            raise RuntimeError(f"{axis} thumb appeared before 500 ms")

        time.sleep(0.30)
        visible = window_hash(surface_hwnd, evidence / f"hover-{axis}-600ms-visible.png")
        if visible == baseline:
            raise RuntimeError(f"{axis} thumb did not appear after 500 ms")

        hovered = [visible]
        for _ in range(19):
            time.sleep(0.05)
            hovered.append(window_hash(surface_hwnd))
        unique_hovered = list(dict.fromkeys(hovered))
        if len(unique_hovered) != 1:
            raise RuntimeError(f"{axis} thumb flickered while hovered: {len(unique_hovered)} hashes")

        gate.user32.SetCursorPos(300, 300)
        time.sleep(0.30)
        hidden = window_hash(surface_hwnd, evidence / f"hover-{axis}-left-hidden.png")
        if hidden != baseline:
            raise RuntimeError(f"{axis} thumb did not hide after leaving")

        records.append(
            {
                "axis": axis,
                "pending_300ms_hidden": True,
                "visible_after_600ms": True,
                "hover_frames": 20,
                "hover_unique_hashes": 1,
                "hidden_after_leave": True,
            }
        )
    return records


def main() -> int:
    gate.check_surface_hover = direct_surface_hover
    return gate.main()


if __name__ == "__main__":
    sys.exit(main())
