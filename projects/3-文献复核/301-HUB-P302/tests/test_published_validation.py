from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "src"))

from published_validation import (  # noqa: E402
    fit_ambient_threshold_line,
    predict_threshold_power,
    residual_secant_audit,
)


def test_exact_affine_dataset_recovers_turning_state():
    ambient = np.array([5.0, 10.0, 15.0, 20.0])
    turning_temperature = 60.0
    effective_gain = 4.5
    threshold = predict_threshold_power(
        ambient,
        turning_temperature=turning_temperature,
        effective_gain=effective_gain,
    )
    fit = fit_ambient_threshold_line(ambient, threshold)
    assert np.isclose(fit.turning_temperature, turning_temperature, rtol=1e-13)
    assert np.isclose(fit.effective_gain, effective_gain, rtol=1e-13)
    assert fit.rmse < 1e-12
    assert fit.condition_gain_cv < 1e-13


def test_li2026_fig9_three_point_audit_is_stable():
    ambient = np.array([13.0, 10.0, 7.0])
    threshold = np.array([7.30, 8.37, 8.45])
    fit = fit_ambient_threshold_line(ambient, threshold)

    assert np.isclose(fit.turning_temperature, 51.94782608695632, rtol=1e-10)
    assert np.isclose(fit.effective_gain, 5.217391304347803, rtol=1e-10)
    assert np.isclose(fit.rmse, 0.23334523779156052, rtol=1e-10)
    assert np.isclose(fit.max_abs_residual, 0.33, rtol=1e-10)
    assert fit.relative_rmse < 0.03
    assert fit.condition_gain_span_fraction < 0.07



def test_2023_precursor_residual_secant_audit():
    audit = residual_secant_audit(
        input_power_1=7.2,
        input_power_2=11.77,
        residual_ratio_1=0.0405,
        residual_ratio_2=0.1101,
    )
    assert np.isclose(audit.residual_power_1, 0.2916, rtol=1e-13)
    assert np.isclose(audit.residual_power_2, 1.295877, rtol=1e-13)
    assert np.isclose(
        audit.absolute_residual_secant,
        0.2197542669584245,
        rtol=1e-12,
    )
    assert np.isclose(
        audit.log_ratio_log_power_secant,
        2.0348773641058355,
        rtol=1e-12,
    )
