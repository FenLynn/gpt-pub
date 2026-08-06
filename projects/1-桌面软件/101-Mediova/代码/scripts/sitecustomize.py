from __future__ import annotations

import os
import sys
import traceback


# The formal P101 workflow already invokes round11_flicker_gate_runner.py.
# Keep that frozen gate unchanged; when and only when it exits successfully,
# chain the round-12 footer stress gate with the same --exe/--evidence inputs.
if os.path.basename(sys.argv[0]).lower() == "round11_flicker_gate_runner.py":
    _original_exit = sys.exit

    def _round12_chained_exit(code=0):
        final_code = 0 if code is None else int(code)
        if final_code == 0:
            try:
                import round12_footer_gate

                final_code = int(round12_footer_gate.main())
            except BaseException:
                traceback.print_exc()
                final_code = 1
        _original_exit(final_code)

    sys.exit = _round12_chained_exit
