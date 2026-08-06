from __future__ import annotations

import os
import sys
import traceback


# P101 CI runs Python from the code root. Intercept only the frozen round-11
# runner. The round-12 footer gate is independent: it runs after a successful
# round-11 exit, and also runs before an unhandled round-11 exception is
# propagated. This preserves the original failure while still producing the
# footer evidence required to decide whether stage 1 itself passed.
if os.path.basename(sys.argv[0]).lower() == "round11_flicker_gate_runner.py":
    _original_exit = sys.exit
    _original_excepthook = sys.excepthook
    _footer_ran = False

    def _run_round12_footer() -> int:
        global _footer_ran
        if _footer_ran:
            return 0
        _footer_ran = True
        scripts = os.path.join(os.path.dirname(__file__), "scripts")
        if scripts not in sys.path:
            sys.path.insert(0, scripts)
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
