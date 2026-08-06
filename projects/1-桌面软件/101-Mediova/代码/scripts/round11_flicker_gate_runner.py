from __future__ import annotations

import ctypes
import sys
import time
from ctypes import wintypes
from pathlib import Path

import round11_flicker_gate as gate


LVM_FIRST = 0x1000
LVM_GETITEMCOUNT = LVM_FIRST + 4
LVM_GETCOLUMNWIDTH = LVM_FIRST + 29
LVM_GETCOUNTPERPAGE = LVM_FIRST + 40
LVM_INSERTITEMW = LVM_FIRST + 77
HDM_FIRST = 0x1200
HDM_GETITEMCOUNT = HDM_FIRST + 0
LVIF_TEXT = 0x0001
SRCCOPY = 0x00CC0020


class LVITEMW(ctypes.Structure):
    _fields_ = [
        ("mask", wintypes.UINT),
        ("iItem", ctypes.c_int),
        ("iSubItem", ctypes.c_int),
        ("state", wintypes.UINT),
        ("stateMask", wintypes.UINT),
        ("pszText", wintypes.LPWSTR),
        ("cchTextMax", ctypes.c_int),
        ("iImage", ctypes.c_int),
        ("lParam", wintypes.LPARAM),
        ("iIndent", ctypes.c_int),
        ("iGroupId", ctypes.c_int),
        ("cColumns", wintypes.UINT),
        ("puColumns", ctypes.POINTER(wintypes.UINT)),
        ("piColFmt", ctypes.POINTER(ctypes.c_int)),
        ("iGroup", ctypes.c_int),
    ]


gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t
gate.user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(gate.RECT)]
gate.user32.GetClientRect.restype = wintypes.BOOL
gate.gdi32.BitBlt.argtypes = [
    wintypes.HDC,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.HDC,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.DWORD,
]
gate.gdi32.BitBlt.restype = wintypes.BOOL


def capture_screen_rect(rect: list[int]):
    left, top, right, bottom = [int(value) for value in rect]
    width = right - left
    height = bottom - top
    if width < 1 or height < 1:
        raise RuntimeError(f"invalid screen region: {width}x{height}")

    screen_dc = gate.user32.GetDC(0)
    memory_dc = gate.gdi32.CreateCompatibleDC(screen_dc)
    bitmap = gate.gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    old = gate.gdi32.SelectObject(memory_dc, bitmap)
    try:
        if not gate.gdi32.BitBlt(memory_dc, 0, 0, width, height, screen_dc, left, top, SRCCOPY):
            raise ctypes.WinError(ctypes.get_last_error())
        info = gate.BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(gate.BITMAPINFOHEADER)
        info.bmiHeader.biWidth = width
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = gate.BI_RGB
        buffer = ctypes.create_string_buffer(width * height * 4)
        rows = gate.gdi32.GetDIBits(
            memory_dc,
            bitmap,
            0,
            height,
            buffer,
            ctypes.byref(info),
            gate.DIB_RGB_COLORS,
        )
        if rows != height:
            raise RuntimeError(f"GetDIBits rows={rows}, want={height}")
        return gate.Image.frombuffer(
            "RGBA", (width, height), buffer.raw, "raw", "BGRA", 0, 1
        ).copy()
    finally:
        gate.gdi32.SelectObject(memory_dc, old)
        gate.gdi32.DeleteObject(bitmap)
        gate.gdi32.DeleteDC(memory_dc)
        gate.user32.ReleaseDC(0, screen_dc)


def surface_hash(surface: dict[str, object], save_path: Path | None = None) -> str:
    image = capture_screen_rect(surface["rect"])
    try:
        if save_path is not None:
            image.save(save_path)
        return gate.hashlib.sha256(image.tobytes()).hexdigest()
    finally:
        image.close()


def list_handles(main_hwnd: int) -> tuple[int, int]:
    children = gate.enumerate_children(main_hwnd)
    listviews = [child for child in children if child["class"] == "SysListView32"]
    headers = [child for child in children if child["class"] == "SysHeader32"]
    if len(listviews) != 1 or len(headers) != 1:
        raise RuntimeError(f"expected one ListView/header, got {listviews!r} / {headers!r}")
    return int(listviews[0]["hwnd"]), int(headers[0]["hwnd"])


def list_overflow_state(main_hwnd: int) -> dict[str, int | bool]:
    list_hwnd, header_hwnd = list_handles(main_hwnd)
    item_count = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0))
    per_page = int(gate.user32.SendMessageW(list_hwnd, LVM_GETCOUNTPERPAGE, 0, 0))
    column_count = int(gate.user32.SendMessageW(header_hwnd, HDM_GETITEMCOUNT, 0, 0))
    total_width = sum(
        int(gate.user32.SendMessageW(list_hwnd, LVM_GETCOLUMNWIDTH, index, 0))
        for index in range(max(0, column_count))
    )
    client = gate.RECT()
    if not gate.user32.GetClientRect(list_hwnd, ctypes.byref(client)):
        raise ctypes.WinError(ctypes.get_last_error())
    client_width = int(client.right - client.left)
    return {
        "item_count": item_count,
        "per_page": per_page,
        "column_count": column_count,
        "total_width": total_width,
        "client_width": client_width,
        "vertical": item_count > 0 and per_page > 0 and item_count > per_page,
        "horizontal": total_width > client_width,
    }


def inject_vertical_overflow(main_hwnd: int, target_count: int = 28) -> None:
    list_hwnd, _header_hwnd = list_handles(main_hwnd)
    current = int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0))
    for index in range(current, target_count):
        text = ctypes.create_unicode_buffer(f"Round 11 滚动稳定性验证任务 {index + 1:02d}")
        item = LVITEMW(
            mask=LVIF_TEXT,
            iItem=0x7FFFFFFF,
            iSubItem=0,
            pszText=ctypes.cast(text, wintypes.LPWSTR),
            cchTextMax=len(text),
            iImage=-1,
        )
        result = int(
            gate.user32.SendMessageW(
                list_hwnd,
                LVM_INSERTITEMW,
                0,
                ctypes.addressof(item),
            )
        )
        if result < 0:
            raise RuntimeError(f"LVM_INSERTITEMW failed at row {index}")


def establish_real_overflow(main_hwnd: int) -> dict[str, int | bool]:
    if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1120, 520, True):
        raise ctypes.WinError(ctypes.get_last_error())
    time.sleep(0.8)
    state = list_overflow_state(main_hwnd)
    if not bool(state["horizontal"]):
        raise RuntimeError(f"normal layout did not produce horizontal overflow: {state!r}")
    if not bool(state["vertical"]):
        inject_vertical_overflow(main_hwnd)
        time.sleep(1.0)
        state = list_overflow_state(main_hwnd)
    if not bool(state["vertical"]) or not bool(state["horizontal"]):
        raise RuntimeError(f"real ListView messages did not produce two-axis overflow: {state!r}")
    return state


def direct_surface_hover(
    hwnd: int,
    _surfaces: list[dict[str, object]],
    evidence: Path,
) -> list[dict[str, object]]:
    overflow = establish_real_overflow(hwnd)
    gate.user32.SetCursorPos(900, 40)
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
        left, top, right, bottom = [int(value) for value in surface["rect"]]
        baseline = surface_hash(surface, evidence / f"hover-{axis}-baseline-hidden.png")

        gate.user32.SetCursorPos((left + right) // 2, (top + bottom) // 2)
        time.sleep(0.30)
        pending = surface_hash(surface, evidence / f"hover-{axis}-300ms-hidden.png")
        if pending != baseline:
            raise RuntimeError(f"{axis} thumb appeared before 500 ms")

        time.sleep(0.35)
        visible = surface_hash(surface, evidence / f"hover-{axis}-650ms-visible.png")
        if visible == baseline:
            raise RuntimeError(f"{axis} thumb did not appear after 500 ms")

        hovered = [visible]
        for _ in range(19):
            time.sleep(0.05)
            hovered.append(surface_hash(surface))
        unique_hovered = list(dict.fromkeys(hovered))
        if len(unique_hovered) != 1:
            raise RuntimeError(f"{axis} thumb flickered while hovered: {len(unique_hovered)} hashes")

        gate.user32.SetCursorPos(900, 40)
        time.sleep(0.35)
        hidden = surface_hash(surface, evidence / f"hover-{axis}-left-hidden.png")
        if hidden != baseline:
            raise RuntimeError(f"{axis} thumb did not hide after leaving")

        records.append(
            {
                "axis": axis,
                "overflow": overflow,
                "pending_300ms_hidden": True,
                "visible_after_650ms": True,
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
