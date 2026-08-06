from __future__ import annotations

import ctypes
import time
from ctypes import wintypes

import round11_flicker_gate as gate

IDC_LIST = 1020
IDC_TAB_VIDEO = 1001
IDC_TAB_IMAGE = 1002
IDC_RIGHT_TOGGLE = 1071
IDC_COLUMN_SETTINGS = 1072
WM_COMMAND = 0x0111
LVM_FIRST = 0x1000
LVM_GETCOLUMNWIDTH = LVM_FIRST + 29
ROUND12_COLUMN_MENU_BASE = 2600
TASK_COL_DURATION = 4
EXPECTED_SELECTION = (231, 243, 255)


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


gate.user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
gate.user32.GetDlgItem.restype = wintypes.HWND
gate.user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(POINT)]
gate.user32.ClientToScreen.restype = wintypes.BOOL
gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
gate.user32.SendMessageW.restype = wintypes.LRESULT


def client_rect_to_screen(hwnd: int, rect: list[int]) -> list[int]:
    first = POINT(rect[0], rect[1])
    second = POINT(rect[2], rect[3])
    if not gate.user32.ClientToScreen(hwnd, ctypes.byref(first)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not gate.user32.ClientToScreen(hwnd, ctypes.byref(second)):
        raise ctypes.WinError(ctypes.get_last_error())
    return [int(first.x), int(first.y), int(second.x), int(second.y)]


def sample_background(image, rect: list[int]) -> tuple[int, int, int]:
    left, top, right, bottom = rect
    candidates = [(left + 3, top + 3), (right - 4, top + 3), (left + 3, bottom - 4), (right - 4, bottom - 4)]
    values: list[tuple[int, int, int]] = []
    for x, y in candidates:
        x = min(max(x, 0), image.width - 1)
        y = min(max(y, 0), image.height - 1)
        pixel = image.getpixel((x, y))
        values.append(tuple(int(value) for value in pixel[:3]))
    values.sort(key=lambda value: sum(abs(value[index] - EXPECTED_SELECTION[index]) for index in range(3)))
    return values[0]


def close_color(value: tuple[int, int, int], expected: tuple[int, int, int], tolerance: int = 18) -> bool:
    return all(abs(value[index] - expected[index]) <= tolerance for index in range(3))


def dark_pixels(image) -> int:
    return sum(1 for pixel in image.convert("RGB").getdata() if max(pixel) < 165)


def saturated_pixels(image) -> int:
    return sum(1 for red, green, blue in image.convert("RGB").getdata() if max(red, green, blue) - min(red, green, blue) >= 18)


def column_width(list_hwnd: int, column: int) -> int:
    return int(gate.user32.SendMessageW(list_hwnd, LVM_GETCOLUMNWIDTH, column, 0))


def send_command(main_hwnd: int, command_id: int) -> None:
    gate.user32.SendMessageW(main_hwnd, WM_COMMAND, command_id, 0)
    time.sleep(0.35)
