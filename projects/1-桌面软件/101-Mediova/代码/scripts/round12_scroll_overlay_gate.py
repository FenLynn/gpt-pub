from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

import round11_flicker_gate as gate
import round11_flicker_gate_runner_base as runner


def changed_metrics(before: Image.Image, after: Image.Image) -> dict[str, object]:
    if before.size != after.size:
        raise RuntimeError(f"overlay evidence size changed: before={before.size} after={after.size}")
    diff = ImageChops.difference(before.convert("RGB"), after.convert("RGB"))
    try:
        # Ignore tiny capture/compositor noise while preserving the deliberately
        # darker Round12 thumb. A true rail/gutter would still light up across
        # almost the full surface at this threshold.
        mask = diff.convert("L").point(lambda value: 255 if value >= 12 else 0)
        try:
            bbox = mask.getbbox()
            changed = sum(1 for value in mask.getdata() if value)
        finally:
            mask.close()
    finally:
        diff.close()
    width, height = before.size
    total = max(1, width * height)
    return {
        "changed_pixels": changed,
        "changed_ratio": changed / total,
        "changed_bbox": list(bbox) if bbox else None,
        "surface_size": [width, height],
    }


def validate_localized_thumb(axis: str, metrics: dict[str, object]) -> None:
    bbox = metrics["changed_bbox"]
    if not bbox or int(metrics["changed_pixels"]) <= 0:
        raise RuntimeError(f"{axis} visible overlay produced no localized visual change: {metrics!r}")
    left, top, right, bottom = [int(value) for value in bbox]
    width, height = [int(value) for value in metrics["surface_size"]]
    changed_width = right - left
    changed_height = bottom - top
    ratio = float(metrics["changed_ratio"])

    # Only the thumb may be added. A rail or opaque scrollbar track would span
    # most of the long axis. Keep generous limits for DPI rounding and
    # anti-aliasing but reject any full-track visual owner immediately.
    if axis == "horizontal":
        if changed_width >= max(1, int(width * 0.70)):
            raise RuntimeError(f"horizontal overlay change spans the rail: {metrics!r}")
        if changed_height > height:
            raise RuntimeError(f"horizontal overlay change escaped surface: {metrics!r}")
    else:
        if changed_height >= max(1, int(height * 0.70)):
            raise RuntimeError(f"vertical overlay change spans the rail: {metrics!r}")
        if changed_width > width:
            raise RuntimeError(f"vertical overlay change escaped surface: {metrics!r}")
    if ratio >= 0.55:
        raise RuntimeError(f"{axis} overlay changed too much of transparent surface: {metrics!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    exe = args.exe.resolve()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    isolated = Path(tempfile.mkdtemp(prefix="mediova-round12-scroll-overlay-"))
    env = os.environ.copy()
    env["APPDATA"] = str(isolated)
    env["LOCALAPPDATA"] = str(isolated)
    env["XDG_CONFIG_HOME"] = str(isolated)
    process = subprocess.Popen(
        [str(exe), "--ui-preview=video", runner.ROUND11_SCROLL_PREVIEW_ARG],
        cwd=str(exe.parent),
        env=env,
    )
    try:
        main_hwnd = gate.find_window(process.pid, "Mediova", 20.0)
        records = runner.direct_surface_hover(main_hwnd, [], evidence)
        if len(records) != 2:
            raise RuntimeError(f"expected two overlay hover records, got {records!r}")

        report_records: list[dict[str, object]] = []
        for record in records:
            axis = str(record["axis"])
            baseline_path = evidence / f"hover-{axis}-baseline-hidden.png"
            pending_path = evidence / f"hover-{axis}-300ms-hidden.png"
            visible_path = evidence / f"hover-{axis}-650ms-visible.png"
            hidden_path = evidence / f"hover-{axis}-left-hidden.png"
            with Image.open(baseline_path) as baseline, Image.open(pending_path) as pending, Image.open(visible_path) as visible, Image.open(hidden_path) as hidden:
                pending_metrics = changed_metrics(baseline, pending)
                visible_metrics = changed_metrics(baseline, visible)
                hidden_metrics = changed_metrics(baseline, hidden)

            # Before the 500 ms delay and after leaving, the overlay must be
            # visually equivalent to the underlying ListView. Small compositor
            # noise is tolerated, but no persistent track/rail is allowed.
            if float(pending_metrics["changed_ratio"]) > 0.03:
                raise RuntimeError(f"{axis} overlay became visible before 500 ms: {pending_metrics!r}")
            if float(hidden_metrics["changed_ratio"]) > 0.03:
                raise RuntimeError(f"{axis} overlay did not return to transparent state: {hidden_metrics!r}")
            validate_localized_thumb(axis, visible_metrics)

            item = dict(record)
            item.update(
                {
                    "pending_change": pending_metrics,
                    "visible_change": visible_metrics,
                    "hidden_after_leave_change": hidden_metrics,
                    "show_delay_contract_ms": 500,
                    "thumb_overlay_visible": True,
                    "track_transparent": True,
                    "hidden_state_transparent": True,
                }
            )
            report_records.append(item)

        report = {
            "surface_class": "MWRound11StableScrollSurface",
            "axis_count": len(report_records),
            "native_track_absent": True,
            "transparent_track_required": True,
            "localized_thumb_required": True,
            "hover_delay_ms": 500,
            "records": report_records,
        }
        (evidence / "round12-scroll-overlay-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
        return 0
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5.0)
        shutil.rmtree(isolated, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
