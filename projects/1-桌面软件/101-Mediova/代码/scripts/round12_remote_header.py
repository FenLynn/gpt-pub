from __future__ import annotations

import ctypes
from ctypes import wintypes

import round11_flicker_gate as gate
from round12_remote_memory import RemoteMemoryBlock

HDM_FIRST = 0x1200
HDM_GETITEMCOUNT = HDM_FIRST
HDM_GETITEMW = HDM_FIRST + 11
HDM_GETITEMRECT = HDM_FIRST + 7
LVM_FIRST = 0x1000
LVM_GETITEMRECT = LVM_FIRST + 14
LVM_GETSUBITEMRECT = LVM_FIRST + 56
LVIR_BOUNDS = 0
HDI_TEXT = 0x0002

EXPECTED_CAPTIONS = ["#", "预览", "文件名", "分辨率", "时长", "方向", "位置", "输出分辨率", "质量", "旋转", "体积", "压缩后", "进度", "状态", "时间剪裁", "画面剪裁"]


class HDITEMW(ctypes.Structure):
    _fields_ = [
        ("mask", ctypes.c_uint32),
        ("cxy", ctypes.c_int32),
        ("pszText", ctypes.c_void_p),
        ("hbm", ctypes.c_void_p),
        ("cchTextMax", ctypes.c_int32),
        ("fmt", ctypes.c_int32),
        ("lParam", ctypes.c_ssize_t),
        ("iImage", ctypes.c_int32),
        ("iOrder", ctypes.c_int32),
        ("type", ctypes.c_uint32),
        ("pvFilter", ctypes.c_void_p),
        ("state", ctypes.c_uint32),
    ]


if ctypes.sizeof(ctypes.c_void_p) == 8 and ctypes.sizeof(HDITEMW) != 72:
    raise RuntimeError(f"unexpected Win64 HDITEMW size: {ctypes.sizeof(HDITEMW)}")


gate.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_ssize_t]
gate.user32.SendMessageW.restype = ctypes.c_ssize_t


class RemoteHeaderReader:
    def __init__(self, pid: int) -> None:
        self.item_size = ctypes.sizeof(HDITEMW)
        self.text_chars = 256
        self.text_bytes = self.text_chars * ctypes.sizeof(ctypes.c_wchar)
        self.memory = RemoteMemoryBlock(pid, self.item_size + self.text_bytes)
        self.remote_text = int(self.memory.address) + self.item_size

    def close(self) -> None:
        self.memory.close()

    def titles(self, hwnd: int) -> list[str]:
        count = int(gate.user32.SendMessageW(hwnd, HDM_GETITEMCOUNT, 0, 0))
        if count < 1:
            raise RuntimeError(f"invalid header item count: {count}")
        values: list[str] = []
        for index in range(count):
            item = HDITEMW(mask=HDI_TEXT, pszText=self.remote_text, cchTextMax=self.text_chars)
            self.memory.write(int(self.memory.address), item, self.item_size)
            zero_text = ctypes.create_string_buffer(self.text_bytes)
            self.memory.write(self.remote_text, zero_text, self.text_bytes)
            result = gate.user32.SendMessageW(hwnd, HDM_GETITEMW, index, int(self.memory.address))
            if result == 0:
                raise RuntimeError(f"HDM_GETITEMW failed for column {index}; sizeof(HDITEMW)={self.item_size}")
            local_text = ctypes.create_string_buffer(self.text_bytes)
            read = self.memory.read_into(self.remote_text, local_text, self.text_bytes)
            text = bytes(local_text.raw[:read]).decode("utf-16-le", errors="strict").split("\x00", 1)[0].strip()
            if not text:
                raise RuntimeError(f"empty header caption at column {index}")
            values.append(text)
        return values

    def _read_rect(self) -> list[int]:
        local = gate.RECT()
        self.memory.read_into(int(self.memory.address), local, ctypes.sizeof(local))
        return [int(local.left), int(local.top), int(local.right), int(local.bottom)]

    def rects(self, hwnd: int) -> list[list[int]]:
        count = int(gate.user32.SendMessageW(hwnd, HDM_GETITEMCOUNT, 0, 0))
        values: list[list[int]] = []
        for index in range(count):
            zero = gate.RECT()
            self.memory.write(int(self.memory.address), zero, ctypes.sizeof(zero))
            if gate.user32.SendMessageW(hwnd, HDM_GETITEMRECT, index, int(self.memory.address)) == 0:
                raise RuntimeError(f"HDM_GETITEMRECT failed for column {index}")
            values.append(self._read_rect())
        return values

    def list_item_rect(self, hwnd: int, row: int) -> list[int]:
        value = gate.RECT(left=LVIR_BOUNDS)
        self.memory.write(int(self.memory.address), value, ctypes.sizeof(value))
        if gate.user32.SendMessageW(hwnd, LVM_GETITEMRECT, row, int(self.memory.address)) == 0:
            raise RuntimeError(f"LVM_GETITEMRECT failed for row {row}")
        return self._read_rect()

    def list_subitem_rect(self, hwnd: int, row: int, column: int) -> list[int]:
        value = gate.RECT(left=LVIR_BOUNDS, top=column)
        self.memory.write(int(self.memory.address), value, ctypes.sizeof(value))
        if gate.user32.SendMessageW(hwnd, LVM_GETSUBITEMRECT, row, int(self.memory.address)) == 0:
            raise RuntimeError(f"LVM_GETSUBITEMRECT failed for row={row} column={column}")
        return self._read_rect()


def header_handle(main_hwnd: int) -> dict[str, object]:
    headers = [child for child in gate.enumerate_children(main_hwnd) if child["class"] == "SysHeader32"]
    if len(headers) != 1:
        raise RuntimeError(f"expected exactly one header, got {headers!r}")
    return headers[0]
