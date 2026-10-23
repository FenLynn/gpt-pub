"""Create a password-protected Python-shaped distribution using Windows CNG."""
import argparse
import base64
import getpass
import hashlib
import importlib.util
import json
from pathlib import Path
import secrets
import struct
import sys
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("package_restore", Path(__file__).with_name("restore-package.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def build(source, destination, password):
    if len(password) < 12:
        raise ValueError("封装密码至少 12 个字符")
    if destination.exists():
        raise ValueError("输出文件已存在，请选择新文件名")
    blob = source.read_bytes()
    runtime.program_files(blob)
    receipt = runtime.canonical({"bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "name": source.name})
    plain = struct.pack("<I", len(receipt)) + receipt + blob
    size = 48_000
    names = []
    for index in range((len(plain) + size - 1) // size):
        folder, stem = [("core", "numeric"), ("linalg", "routines"), ("stats", "estimators")][index % 3]
        names.append(f"{folder}/{stem}_{index:04d}.py")
    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    header = {"format": 1, "iterations": runtime.ITERATIONS,
              "salt": base64.b64encode(salt).decode(), "nonce": base64.b64encode(nonce).decode(), "parts": names}
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, runtime.ITERATIONS, 32)
    ciphertext, tag = runtime.aes_gcm(plain, key, nonce, runtime.canonical(header))
    meta = {**header, "tag": base64.b64encode(tag).decode()}
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED) as archive:
            root = "analysis_toolkit/"
            archive.writestr(root + "setup.py", "# Analysis toolkit configuration\nCONFIG = " + repr(base64.b85encode(runtime.canonical(meta)).decode()) + "\n")
            for index, name in enumerate(names):
                text = base64.b85encode(ciphertext[index * size:(index + 1) * size]).decode()
                archive.writestr(root + name, "# Numerical coefficient table\nDATA = (\n" + "\n".join("    " + repr(text[pos:pos + 100]) for pos in range(0, len(text), 100)) + "\n)\n")
            archive.writestr(root + "lib/init.py", Path(runtime.__file__).read_bytes())
        with zipfile.ZipFile(destination) as archive:
            if archive.testzip():
                raise ValueError("封装 ZIP 校验失败")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return {"bytes": destination.stat().st_size, "parts": len(names), "sourceSha256": hashlib.sha256(blob).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="生成 Python 外观的加密程序分发包（Windows）")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--password-file", type=Path)
    args = parser.parse_args()
    try:
        password = args.password_file.read_text(encoding="utf-8").rstrip("\r\n") if args.password_file else getpass.getpass("设置封装密码（至少 12 位）：")
        print(json.dumps(build(args.source, args.destination, password)))
    except (Exception, KeyboardInterrupt) as error:
        print("封装失败：" + str(error), file=sys.stderr)
        sys.exit(1)
