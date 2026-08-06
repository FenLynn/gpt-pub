from __future__ import annotations

import os
import sys
import traceback


# P101 CI runs Python from the code root. Intercept only the frozen round-11
# runner's successful sys.exit and chain the round-12 footer stress gate with
# the same command-line arguments. A round-11 failure is preserved unchanged.
if os.path.basename(sys.argv[0]).lower() == "round11_flicker_gate_runner.py":
    _original_exit = sys.exit

    def _round12_chained_exit(code=0):
        final_code = 0 if code is None else int(code)
        if final_code == 0:
            try:
                scripts = os.path.join(os.path.dirname(__file__), "scripts")
                if scripts not in sys.path:
                    sys.path.insert(0, scripts)
                import round12_footer_gate

                final_code = int(round12_footer_gate.main())
            except BaseException:
                traceback.print_exc()
                final_code = 1
        _original_exit(final_code)

    sys.exit = _round12_chained_exit
