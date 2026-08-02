from __future__ import annotations

import pathlib
import runpy

path = pathlib.Path(__file__).resolve().with_name("tools_v420_transform.py")
text = path.read_text(encoding="utf-8")

helper_start = text.index("def replace_function(")
helper_end = text.index("\n\n\nmain =", helper_start)
helper = '''def replace_function(text: str, signature: str, next_signature: str, replacement: str, label: str) -> str:
    start = text.find(signature)
    if start < 0 or text.find(signature, start + 1) >= 0:
        count = text.count(signature)
        raise RuntimeError(f"{label}: expected 1 function signature, found {count}")
    brace = text.find("{", start + len(signature) - 1)
    if brace < 0:
        raise RuntimeError(f"{label}: opening brace not found")
    depth = 0
    in_string = False
    in_rune = False
    escaped = False
    i = brace
    while i < len(text):
        ch = text[i]
        if escaped:
            escaped = False
        elif ch == "\\\\" and (in_string or in_rune):
            escaped = True
        elif ch == '"' and not in_rune:
            in_string = not in_string
        elif ch == "'" and not in_string:
            in_rune = not in_rune
        elif not in_string and not in_rune:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[:start] + replacement.rstrip() + text[i + 1:]
        i += 1
    raise RuntimeError(f"{label}: matching closing brace not found")
'''
text = text[:helper_start] + helper + text[helper_end:]

context_start = text.index("# New context-menu commands.")
context_end = text.index("# Runtime fields for dynamic queue", context_start)
context = '''# New context-menu commands.\ncontext_pattern = re.compile(r"(\\tID_CTX_MOVE_BOTTOM\\s*=\\s*2225\\n)")\nmain, context_count = context_pattern.subn(r"\\1\\tID_CTX_HOLD_EDIT             = 2226\\n\\tID_CTX_REMOVE_SAFE           = 2227\\n", main, count=1)\nif context_count != 1:\n    raise RuntimeError(f"context command ids: expected 1 match, found {context_count}")\n\n'''
text = text[:context_start] + context + text[context_end:]

label = '    "normalize image output",\n)'
label_pos = text.index(label)
block_start = text.rfind("config = replace_once(", 0, label_pos)
block_end = label_pos + len(label)
replacement = '''normalize_start = config.index("func normalize(s *model.Settings) {")
image_format_pos = config.index("\\tif s.ImageFormat == \\\"\\\" {", normalize_start)
image_output_insert = "\\tif s.ImageOutputDir == \\\"\\\" {\\n\\t\\ts.ImageOutputDir = s.OutputDir\\n\\t}\\n\\tif len(s.RecentImageOutputDirs) == 0 && len(s.RecentOutputDirs) > 0 {\\n\\t\\ts.RecentImageOutputDirs = append([]string(nil), s.RecentOutputDirs...)\\n\\t}\\n\\tif s.LastImageOutputDir == \\\"\\\" {\\n\\t\\ts.LastImageOutputDir = s.ImageOutputDir\\n\\t}\\n"
config = config[:image_format_pos] + image_output_insert + config[image_format_pos:]'''
text = text[:block_start] + replacement + text[block_end:]

path.write_text(text, encoding="utf-8")
runpy.run_path(str(path), run_name="__main__")
