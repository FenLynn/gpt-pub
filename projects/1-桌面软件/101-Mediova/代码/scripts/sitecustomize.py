from __future__ import annotations

import os
import sys
import traceback


# The formal P101 workflow invokes the frozen round-11 runner from this
# directory, so this is the sitecustomize module Python actually imports.
# Stage 1 is independent: preserve the round-11 result, but always run the
# round-12 footer gate once so its evidence exists even when a later-stage
# list/header instability is already known to fail.
if os.path.basename(sys.argv[0]).lower() == "round11_flicker_gate_runner.py":
    _original_exit = sys.exit
    _original_excepthook = sys.excepthook
    _footer_ran = False

    def _run_round12_footer() -> int:
        global _footer_ran
        if _footer_ran:
            return 0
        _footer_ran = True
        import round12_footer_gate

        return int(round12_footer_gate.main())

    def _round12_chained_exit(code=0):
        final_code = 0 if code is None else int(code)
        if final_code == 0:
            try:
                final_code = _run_round12_footer()
            except BaseException:
                traceback.print_exc()
                final_code = 1
        _original_exit(final_code)

    def _round12_chained_excepthook(exc_type, exc_value, exc_traceback):
        try:
            _run_round12_footer()
        except BaseException:
            traceback.print_exc()
        _original_excepthook(exc_type, exc_value, exc_traceback)

    sys.exit = _round12_chained_exit
    sys.excepthook = _round12_chained_excepthook
