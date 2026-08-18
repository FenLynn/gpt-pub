from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

from PIL import Image

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner
from round12_real_thumbnail_gate import choose_real_file, generate_fixture
from round12_remote_header import RemoteHeaderReader

BM_CLICK = 0x00F5
WM_SETTEXT = 0x000C
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001
LVM_FIRST = 0x1000
LVM_GETITEMCOUNT = LVM_FIRST + 4
LVM_GETITEMSTATE = LVM_FIRST + 44
LVIS_SELECTED = 0x0002
IDC_LIST = 1020
IDC_TRIM_CROP = 1068
IDC_PREVIEW_CANVAS = 4013
IDC_CURRENT_TIME = 4015
IDC_JUMP_TIME = 4016
VISUAL_W = 64
VISUAL_H = 36
MIN_VISUAL_CHANGE_RATIO = 0.03
STABLE_MATCHES_REQUIRED = 3
STABLE_MAX_DRIFT_RATIO = 0.01
SMTO_ABORTIFHUNG = 0x0002

gate.user32.SendMessageTimeoutW.argtypes = [
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
    wintypes.UINT,
    wintypes.UINT,
    ctypes.POINTER(ctypes.c_size_t),
]
gate.user32.SendMessageTimeoutW.restype = wintypes.LPARAM


def child_by_handle(parent: int, handle: int) -> dict[str, object]:
    return next(child for child in gate.enumerate_children(parent) if int(child["hwnd"]) == handle)


def find_editor(pid: int, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = 0

        @gate.WNDENUMPROC
        def callback(hwnd: int, _lparam: int) -> bool:
            nonlocal found
            candidate = wintypes.DWORD()
            gate.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(candidate))
            if candidate.value != pid or not gate.user32.IsWindowVisible(hwnd):
                return True
            if gate.class_name(hwnd) == "MWRound7Editor":
                found = int(hwnd)
                return False
            return True

        gate.user32.EnumWindows(callback, 0)
        if found:
            return found
        time.sleep(0.05)
    return 0


def find_stable_editor_controls(pid: int, timeout: float) -> tuple[int, int, int, int]:
    deadline = time.monotonic() + timeout
    previous: tuple[int, int, int, int] | None = None
    matches = 0
    observed: list[tuple[int, int, int, int]] = []
    while time.monotonic() < deadline:
        editor = find_editor(pid, min(0.25, max(0.05, deadline - time.monotonic())))
        current = (
            editor,
            int(gate.user32.GetDlgItem(editor, IDC_PREVIEW_CANVAS) or 0) if editor else 0,
            int(gate.user32.GetDlgItem(editor, IDC_CURRENT_TIME) or 0) if editor else 0,
            int(gate.user32.GetDlgItem(editor, IDC_JUMP_TIME) or 0) if editor else 0,
        )
        if current not in observed:
            observed.append(current)
        if all(current):
            matches = matches + 1 if current == previous else 1
            previous = current
            if matches >= 4:
                return current
        else:
            matches = 0
            previous = None
        time.sleep(0.10)
    raise RuntimeError(f"stable trim editor controls not found; observed={observed[-12:]!r}")


def open_stable_editor(trim_button: int, pid: int, timeout: float) -> tuple[int, int, int, int]:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        if not gate.user32.PostMessageW(trim_button, BM_CLICK, 0, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return find_stable_editor_controls(pid, min(2.5, max(0.5, deadline - time.monotonic())))
        except RuntimeError as exc:
            # A task becomes visible before its asynchronous probe necessarily
            # has duration/dimensions. Mediova intentionally closes that
            # transient editor; retry the real user action after probe advances.
            last_error = str(exc)
            time.sleep(0.35)
    raise RuntimeError(f"trim editor never became ready after media probe; last={last_error}")


def quantized_visual_signature(rgb: Image.Image) -> bytes:
    small = rgb.resize((VISUAL_W, VISUAL_H), Image.Resampling.BILINEAR)
    try:
        raw = small.tobytes()
    finally:
        small.close()
    return bytes((value // 16) * 16 for value in raw)


def visual_change_ratio(previous: bytes | None, current: bytes) -> float:
    if previous is None:
        return 1.0
    if len(previous) != len(current) or not current:
        return 1.0
    pixels = len(current) // 3
    changed = 0
    for offset in range(0, len(current), 3):
        if current[offset : offset + 3] != previous[offset : offset + 3]:
            changed += 1
    return changed / max(1, pixels)


def public_snapshot(value: dict[str, object]) -> dict[str, object]:
    return {key: item for key, item in value.items() if not key.startswith("_")}


def canvas_snapshot(editor: int, canvas: int, evidence: Path | None = None) -> dict[str, object]:
    try:
        info = child_by_handle(editor, canvas)
    except StopIteration:
        # The final Round12 preview owner can replace the inherited canvas once
        # while the modal editor is settling. Always follow the current control
        # ID instead of treating the retired handle as a preview failure.
        canvas = int(gate.user32.GetDlgItem(editor, IDC_PREVIEW_CANVAS) or 0)
        if not canvas:
            raise RuntimeError("trim preview canvas disappeared")
        info = child_by_handle(editor, canvas)
    image = runner.capture_screen_rect(info["rect"])
    try:
        rgb = image.convert("RGB")
        try:
            pixels = list(rgb.getdata())
            unique = len(set(pixels))
            saturated = sum(1 for r, g, b in pixels if max(r, g, b) - min(r, g, b) >= 70)
            lumas = [(77 * r + 150 * g + 29 * b) >> 8 for r, g, b in pixels]
            luma_span = max(lumas) - min(lumas) if lumas else 0
            signature = quantized_visual_signature(rgb)
        finally:
            rgb.close()
        if evidence is not None:
            image.save(evidence)
        return {
            "hash": hashlib.sha256(image.tobytes()).hexdigest(),
            "visual_hash": hashlib.sha256(signature).hexdigest(),
            "unique_colors": unique,
            "saturated_pixels": saturated,
            "luma_span": luma_span,
            "_visual_signature": signature,
        }
    finally:
        image.close()


def snapshot_is_real(value: dict[str, object]) -> bool:
    return int(value["unique_colors"]) >= 100 and int(value["saturated_pixels"]) >= 500 and int(value["luma_span"]) >= 80


def preview_failure_texts(editor: int) -> list[str]:
    failures: list[str] = []
    for child in gate.enumerate_children(editor):
        text = str(child["text"])
        if "预览帧生成失败" in text or "预览帧加载失败" in text or "预览帧自动恢复失败" in text:
            failures.append(text)
    return failures


def wait_for_real_canvas(
    editor: int,
    canvas: int,
    timeout: float,
    previous_signature: bytes | None = None,
    evidence: Path | None = None,
    label: str = "preview",
) -> dict[str, object]:
    """Wait for a materially changed frame and then prove it has settled.

    A new seek must differ materially from the last accepted target. Once a
    candidate appears, three spaced samples may contain small capture/repaint
    drift, but they must remain within a tight 1% visual envelope. This rejects
    transient stale frames without requiring byte-identical PrintWindow output.
    """

    deadline = time.monotonic() + timeout
    best: dict[str, object] = {
        "hash": "",
        "visual_hash": "",
        "unique_colors": 0,
        "saturated_pixels": 0,
        "luma_span": 0,
        "visual_change_ratio": 0.0,
        "stable_drift_ratio": 1.0,
        "stable_matches": 0,
    }
    candidate_signature: bytes | None = None
    candidate_matches = 0
    best_stable_matches = 0
    lowest_drift = 1.0

    while time.monotonic() < deadline:
        current = canvas_snapshot(editor, canvas)
        signature = current["_visual_signature"]
        assert isinstance(signature, bytes)
        change_ratio = visual_change_ratio(previous_signature, signature)
        current["visual_change_ratio"] = change_ratio

        changed = previous_signature is None or change_ratio >= MIN_VISUAL_CHANGE_RATIO
        eligible = changed and snapshot_is_real(current) and not preview_failure_texts(editor)
        if eligible:
            if candidate_signature is None:
                candidate_signature = signature
                candidate_matches = 1
                drift_ratio = 0.0
            else:
                drift_ratio = visual_change_ratio(candidate_signature, signature)
                lowest_drift = min(lowest_drift, drift_ratio)
                if drift_ratio <= STABLE_MAX_DRIFT_RATIO:
                    candidate_matches += 1
                else:
                    candidate_signature = signature
                    candidate_matches = 1
                    drift_ratio = 0.0
            current["stable_drift_ratio"] = drift_ratio
            current["stable_matches"] = candidate_matches
            best_stable_matches = max(best_stable_matches, candidate_matches)

            if candidate_matches >= STABLE_MATCHES_REQUIRED:
                if evidence is not None:
                    accepted = canvas_snapshot(editor, canvas, evidence)
                    accepted_signature = accepted["_visual_signature"]
                    assert isinstance(accepted_signature, bytes)
                    accepted_change = visual_change_ratio(previous_signature, accepted_signature)
                    accepted_drift = visual_change_ratio(candidate_signature, accepted_signature)
                    if (
                        snapshot_is_real(accepted)
                        and accepted_drift <= STABLE_MAX_DRIFT_RATIO
                        and accepted_change >= (MIN_VISUAL_CHANGE_RATIO if previous_signature is not None else 0.0)
                        and not preview_failure_texts(editor)
                    ):
                        accepted["visual_change_ratio"] = accepted_change
                        accepted["stable_drift_ratio"] = accepted_drift
                        accepted["stable_matches"] = candidate_matches
                        return accepted
                    candidate_signature = None
                    candidate_matches = 0
                else:
                    return current
        else:
            candidate_signature = None
            candidate_matches = 0

        public_current = public_snapshot(current)
        if (
            int(public_current.get("stable_matches", 0)) > int(best.get("stable_matches", 0))
            or int(current["unique_colors"]) > int(best["unique_colors"])
        ):
            best = public_current
        time.sleep(0.15)

    best["stable_matches"] = max(int(best.get("stable_matches", 0)), best_stable_matches)
    best["lowest_stable_drift_ratio"] = lowest_drift
    raise RuntimeError(
        f"trim preview did not reach a materially new stable frame: label={label} "
        f"min_change={MIN_VISUAL_CHANGE_RATIO:.3f} max_drift={STABLE_MAX_DRIFT_RATIO:.3f} "
        f"stable_required={STABLE_MATCHES_REQUIRED} best={best} failures={preview_failure_texts(editor)!r}"
    )


def set_current_and_jump(editor: int, current_edit: int, jump_button: int, value: str) -> None:
    text = ctypes.create_unicode_buffer(value)
    gate.user32.SendMessageW(current_edit, WM_SETTEXT, 0, ctypes.addressof(text))
    gate.user32.SendMessageW(jump_button, BM_CLICK, 0, 0)


def select_first_row(list_hwnd: int, reader: RemoteHeaderReader) -> None:
    row = reader.list_item_rect(list_hwnd, 0)
    x = max(8, min(int(row[2]) - 8, 180))
    y = max(4, (int(row[1]) + int(row[3])) // 2)
    lparam = (y & 0xFFFF) << 16 | (x & 0xFFFF)
    # Hardware mouse input is queued. Cross-process SendMessage creates an
    # artificial nested wait between the gate and the UI thread, so exercise
    # the real queue semantics and keep every observation time-bounded.
    if not gate.user32.PostMessageW(list_hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lparam):
        raise ctypes.WinError(ctypes.get_last_error())
    if not gate.user32.PostMessageW(list_hwnd, WM_LBUTTONUP, 0, lparam):
        raise ctypes.WinError(ctypes.get_last_error())
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        result = ctypes.c_size_t()
        responsive = gate.user32.SendMessageTimeoutW(
            list_hwnd, LVM_GETITEMSTATE, 0, LVIS_SELECTED,
            SMTO_ABORTIFHUNG, 250, ctypes.byref(result),
        )
        state = int(result.value) if responsive else 0
        if state & LVIS_SELECTED:
            return
        time.sleep(0.05)
    raise RuntimeError("first imported task could not be selected")


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

    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-trim-preview-"))
    fixture = isolated / "round12-trim-preview-testsrc.mp4"
    generate_fixture(ffmpeg, fixture)
    env = os.environ.copy()
    env["APPDATA"] = str(isolated / "AppData")
    env["LOCALAPPDATA"] = str(isolated / "LocalAppData")
    process = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env)
    reader: RemoteHeaderReader | None = None
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 25.0)
        if not gate.user32.MoveWindow(main_hwnd, 0, 0, 1250, 800, True):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(1.5)
        list_hwnd = int(gate.user32.GetDlgItem(main_hwnd, IDC_LIST))
        trim_button = int(gate.user32.GetDlgItem(main_hwnd, IDC_TRIM_CROP))
        if not list_hwnd or not trim_button:
            raise RuntimeError("task list or trim button not found")
        choose_real_file(main_hwnd, process.pid, fixture)
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            if int(gate.user32.SendMessageW(list_hwnd, LVM_GETITEMCOUNT, 0, 0)) > 0:
                break
            time.sleep(0.10)
        else:
            raise RuntimeError("real trim fixture did not enter task list")

        reader = RemoteHeaderReader(process.pid)
        select_first_row(list_hwnd, reader)
        editor, canvas, current_edit, jump_button = open_stable_editor(trim_button, process.pid, 15.0)

        initial = wait_for_real_canvas(
            editor,
            canvas,
            12.0,
            evidence=evidence / "round12-trim-preview-initial.png",
            label="initial",
        )
        previous_signature = initial["_visual_signature"]
        assert isinstance(previous_signature, bytes)

        set_current_and_jump(editor, current_edit, jump_button, "00:00:02.000")
        terminal = wait_for_real_canvas(
            editor,
            canvas,
            16.0,
            previous_signature,
            evidence / "round12-trim-preview-terminal.png",
            "exact-end-2.000",
        )
        previous_signature = terminal["_visual_signature"]
        assert isinstance(previous_signature, bytes)

        snapshots: list[dict[str, object]] = [initial, terminal]
        seek_values = (
            ("00:00:00.250", "0250"),
            ("00:00:01.750", "1750"),
            ("00:00:00.600", "0600"),
            ("00:00:01.950", "1950"),
            ("00:00:01.100", "1100"),
        )
        for value, suffix in seek_values:
            set_current_and_jump(editor, current_edit, jump_button, value)
            current = wait_for_real_canvas(
                editor,
                canvas,
                12.0,
                previous_signature,
                evidence / f"round12-trim-preview-seek-{suffix}.png",
                value,
            )
            previous_signature = current["_visual_signature"]
            assert isinstance(previous_signature, bytes)
            snapshots.append(current)

        failures = preview_failure_texts(editor)
        if failures:
            raise RuntimeError(f"trim preview still exposes failure text after stress sequence: {failures!r}")

        public_snapshots = [public_snapshot(item) for item in snapshots]
        visual_hashes = [str(item["visual_hash"]) for item in public_snapshots]

        # 1.950 s and the exact 2.000 s endpoint can legitimately resolve to
        # the same final decodable frame in the 12-fps fixture. All other
        # deliberately separated targets must settle on distinct visuals.
        required_distinct_indices = (0, 1, 2, 3, 4, 6)
        required_distinct_hashes = [visual_hashes[index] for index in required_distinct_indices]
        if len(set(required_distinct_hashes)) != len(required_distinct_hashes):
            raise RuntimeError(
                "trim preview settled on a stale/reused frame across separated seek targets: "
                f"required_hashes={required_distinct_hashes} all_hashes={visual_hashes}"
            )

        report = {
            "real_file_imported": True,
            "editor_class": gate.class_name(editor),
            "visual_signature": {"width": VISUAL_W, "height": VISUAL_H, "quantization": 16},
            "minimum_visual_change_ratio": MIN_VISUAL_CHANGE_RATIO,
            "stable_matches_required": STABLE_MATCHES_REQUIRED,
            "stable_max_drift_ratio": STABLE_MAX_DRIFT_RATIO,
            "initial": public_snapshots[0],
            "terminal_exact_end": public_snapshots[1],
            "seek_results": public_snapshots[2:],
            "seek_sequence_count": len(snapshots) - 1,
            "unique_visual_hashes": len(set(visual_hashes)),
            "required_distinct_visual_hashes": len(set(required_distinct_hashes)),
            "near_end_alias_allowed": True,
            "failure_texts": failures,
            "exact_end_preview_recovered": True,
            "continuous_seek_preview_stable": True,
        }
        (evidence / "round12-trim-preview-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
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
