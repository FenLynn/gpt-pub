#!/usr/bin/env python3
"""FigureStudio publication renderer.

Input: a JSON job containing Dataset / FigureSpec / PresetDefinition.
Output format is inferred from --out (.svg/.pdf/.eps/.png/.tiff/.tif).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np


MARKERS = {
    "circle": "o",
    "square": "s",
    "diamond": "D",
    "triangle-up": "^",
    "triangle-down": "v",
    "cross": "+",
    "x": "x",
}

LINESTYLES = {
    "solid": "-",
    "dash": "--",
    "dot": ":",
    "dashdot": "-.",
}


def aspect_ratio(overrides: dict[str, Any]) -> float:
    mode = overrides.get("aspectMode", "4:3")
    if mode == "16:9":
        return 16 / 9
    if mode == "3:2":
        return 3 / 2
    if mode == "custom":
        width = float(overrides.get("customAspectWidth", 4) or 4)
        height = float(overrides.get("customAspectHeight", 3) or 3)
        return width / max(height, 1e-9)
    return 4 / 3


def ordered_columns(dataset: dict[str, Any], figure: dict[str, Any]) -> list[dict[str, Any]]:
    lookup = {column["id"]: column for column in dataset.get("ys", [])}
    result: list[dict[str, Any]] = []
    for column_id in figure.get("seriesOrder", []):
        column = lookup.get(column_id)
        if column is not None:
            result.append(column)
    for column in dataset.get("ys", []):
        if not any(existing["id"] == column["id"] for existing in result):
            result.append(column)
    return result


def visible_columns(dataset: dict[str, Any], figure: dict[str, Any]) -> list[dict[str, Any]]:
    overrides = figure.get("seriesOverrides", {})
    return [
        column
        for column in ordered_columns(dataset, figure)
        if overrides.get(column["id"], {}).get("visible", True)
    ]


def render(job: dict[str, Any], output_path: Path) -> None:
    dataset = job["dataset"]
    figure = job["figure"]
    preset = job["preset"]
    overrides = figure.get("figureOverrides", {})
    template = figure.get("templateId", "xy-line")
    series_overrides = figure.get("seriesOverrides", {})
    palette = preset.get(
        "palette",
        ["#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2", "#B279A2"],
    )

    width_mm = float(preset.get("widthMm", 118))
    width_in = width_mm / 25.4
    height_in = width_in / aspect_ratio(overrides)

    font_family = overrides.get("fontFamily") or preset.get("fontFamily", "Arial")
    font_size = float(overrides.get("fontSizePt") or preset.get("fontSizePt", 7))
    axis_width = float(preset.get("axisWidthPt", 0.72))
    background = overrides.get("background", "#ffffff")

    plt.rcParams.update(
        {
            "font.family": font_family,
            "font.size": font_size,
            "axes.linewidth": axis_width,
            "svg.fonttype": "none",
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
        }
    )

    fig = plt.figure(figsize=(width_in, height_in), facecolor=background)
    x = np.asarray(dataset["x"]["values"], dtype=float)
    columns = visible_columns(dataset, figure)

    if template == "surface-3d":
        ax = fig.add_subplot(111, projection="3d")
        z = np.asarray([column["values"] for column in columns], dtype=float)
        y = np.asarray(dataset.get("metadata", {}).get("rowCoordinates", []), dtype=float)
        if y.size != z.shape[0]:
            y = np.arange(z.shape[0], dtype=float)
        xx, yy = np.meshgrid(x, y)
        cmap = str(overrides.get("colorScale", "viridis")).lower()
        if overrides.get("reverseColorScale"):
            cmap += "_r"
        ax.plot_surface(xx, yy, z, cmap=cmap, linewidth=0, antialiased=True)
        ax.set_xlabel(overrides.get("xTitle", dataset["x"].get("name", "X")))
        ax.set_ylabel(
            overrides.get("yTitle", dataset.get("metadata", {}).get("rowAxisName", "Y"))
        )
        ax.set_zlabel("Z")
    elif template == "heatmap":
        ax = fig.add_subplot(111)
        z = np.asarray([column["values"] for column in columns], dtype=float)
        y = np.asarray(dataset.get("metadata", {}).get("rowCoordinates", []), dtype=float)
        extent = None
        if y.size == z.shape[0] and x.size:
            extent = [
                float(np.nanmin(x)),
                float(np.nanmax(x)),
                float(np.nanmin(y)),
                float(np.nanmax(y)),
            ]
        cmap = str(overrides.get("colorScale", "viridis")).lower()
        if overrides.get("reverseColorScale"):
            cmap += "_r"
        image = ax.imshow(
            z,
            origin="lower",
            aspect="auto",
            extent=extent,
            cmap=cmap,
            interpolation="nearest",
        )
        fig.colorbar(image, ax=ax)
        ax.set_xlabel(overrides.get("xTitle", dataset["x"].get("name", "X")))
        ax.set_ylabel(
            overrides.get("yTitle", dataset.get("metadata", {}).get("rowAxisName", "Y"))
        )
    else:
        ax = fig.add_subplot(111)
        offset_step = float(overrides.get("offsetStep", 5))
        bottom = np.zeros_like(x, dtype=float)

        for visible_index, column in enumerate(columns):
            source_index = next(
                (
                    index
                    for index, source in enumerate(dataset.get("ys", []))
                    if source.get("id") == column.get("id")
                ),
                visible_index,
            )
            style = series_overrides.get(column["id"], {})
            y = np.asarray(column["values"], dtype=float)
            if template == "offset-spectrum":
                y = y + visible_index * offset_step

            color = style.get("color", palette[source_index % len(palette)])
            alpha = float(style.get("opacity", 1.0))
            linewidth = float(style.get("lineWidthPt", preset.get("lineWidthPt", 1.0)))
            linestyle = LINESTYLES.get(style.get("lineStyle", "solid"), "-")
            marker = (
                MARKERS.get(style.get("markerSymbol", "circle"))
                if style.get(
                    "markerVisible",
                    template in ("xy-scatter", "xy-line-marker", "xy-errorbar"),
                )
                else None
            )
            markersize = float(style.get("markerSizePt", preset.get("markerSizePt", 4.0)))
            label = column.get("name", column["id"])

            if template in ("bar", "grouped-bar", "stacked-bar"):
                kwargs: dict[str, Any] = {}
                if template == "stacked-bar":
                    kwargs["bottom"] = bottom
                ax.bar(x, y, color=color, alpha=alpha, label=label, **kwargs)
                if template == "stacked-bar":
                    bottom = bottom + np.nan_to_num(y)
            else:
                line_visible = style.get("lineVisible", template != "xy-scatter")
                ax.plot(
                    x,
                    y,
                    color=color,
                    alpha=alpha,
                    linewidth=linewidth,
                    linestyle=linestyle if line_visible else "None",
                    marker=marker,
                    markersize=markersize,
                    label=label,
                )

                if template == "xy-errorbar":
                    error_id = overrides.get("errorSeriesId")
                    error_column = next(
                        (
                            candidate
                            for candidate in dataset.get("ys", [])
                            if candidate.get("id") == error_id
                        ),
                        None,
                    )
                    if error_column is not None:
                        ax.errorbar(
                            x,
                            y,
                            yerr=np.asarray(error_column["values"], dtype=float),
                            fmt="none",
                            ecolor=color,
                            elinewidth=max(0.6, linewidth * 0.8),
                            capsize=2,
                            alpha=alpha,
                        )

        x_title = overrides.get("xTitle")
        if not x_title:
            x_meta = dataset.get("x", {})
            x_title = x_meta.get("name", "X")
            if x_meta.get("unit"):
                x_title += f" ({x_meta['unit']})"

        y_title = overrides.get("yTitle")
        if not y_title:
            y_meta = dataset.get("ys", [{}])[0]
            y_title = y_meta.get("name", "Y")
            if y_meta.get("unit"):
                y_title += f" ({y_meta['unit']})"

        ax.set_xlabel(x_title)
        ax.set_ylabel(y_title)
        ax.set_xscale(overrides.get("xScale", "linear"))
        ax.set_yscale(overrides.get("yScale", "linear"))

        if overrides.get("xAutoRange") is False:
            x_min, x_max = overrides.get("xMin"), overrides.get("xMax")
            if x_min is not None and x_max is not None:
                ax.set_xlim(float(x_min), float(x_max))
        if overrides.get("yAutoRange") is False:
            y_min, y_max = overrides.get("yMin"), overrides.get("yMax")
            if y_min is not None and y_max is not None:
                ax.set_ylim(float(y_min), float(y_max))

        if overrides.get("gridVisible", preset.get("showGrid", False)):
            ax.grid(True, alpha=0.18, linewidth=0.5)

        ax.tick_params(
            direction="in" if overrides.get("tickDirection", "inside") == "inside" else "out",
            which="both",
        )
        if overrides.get("minorTicks"):
            ax.minorticks_on()

        if overrides.get("legendVisible", True):
            ax.legend(frameon=bool(overrides.get("legendFrame", False)))

    if hasattr(ax, "set_facecolor"):
        ax.set_facecolor(background)

    fig.tight_layout()

    suffix = output_path.suffix.lower()
    dpi = 600 if suffix in {".png", ".tif", ".tiff"} else None
    save_kwargs: dict[str, Any] = {
        "bbox_inches": "tight",
        "facecolor": background,
    }
    if dpi is not None:
        save_kwargs["dpi"] = dpi

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, **save_kwargs)
    plt.close(fig)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    job_path = Path(args.job)
    output_path = Path(args.out)
    with job_path.open("r", encoding="utf-8") as handle:
        job = json.load(handle)

    render(job, output_path)
    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
