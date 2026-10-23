"""Restore the distribution in place. Requires Windows CPython 3; no pip packages."""
import argparse
import ast
import base64
import ctypes
import getpass
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import sys
import tempfile
import zipfile

MAX_BYTES = 64 * 1024 * 1024
ITERATIONS = 600_000


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def aes_gcm(data, key, nonce, associated, tag=None):
    if os.name != "nt":
        raise RuntimeError("还原工具需要 Windows 和普通 Python 3，无需安装第三方库。")
    from ctypes import wintypes as w

    class AuthInfo(ctypes.Structure):
        _fields_ = [("size", w.ULONG), ("version", w.ULONG),
                    ("nonce", w.LPVOID), ("nonce_size", w.ULONG),
                    ("associated", w.LPVOID), ("associated_size", w.ULONG),
                    ("tag", w.LPVOID), ("tag_size", w.ULONG),
                    ("mac", w.LPVOID), ("mac_size", w.ULONG),
                    ("aad_size", w.ULONG), ("data_size", ctypes.c_ulonglong),
                    ("flags", w.ULONG)]

    api = ctypes.WinDLL("bcrypt.dll")
    signatures = {
        "BCryptOpenAlgorithmProvider": ([ctypes.POINTER(w.HANDLE), w.LPCWSTR, w.LPCWSTR, w.ULONG]),
        "BCryptSetProperty": ([w.HANDLE, w.LPCWSTR, w.LPVOID, w.ULONG, w.ULONG]),
        "BCryptGetProperty": ([w.HANDLE, w.LPCWSTR, w.LPVOID, w.ULONG, ctypes.POINTER(w.ULONG), w.ULONG]),
        "BCryptGenerateSymmetricKey": ([w.HANDLE, ctypes.POINTER(w.HANDLE), w.LPVOID, w.ULONG, w.LPVOID, w.ULONG, w.ULONG]),
        "BCryptEncrypt": ([w.HANDLE, w.LPVOID, w.ULONG, w.LPVOID, w.LPVOID, w.ULONG, w.LPVOID, w.ULONG, ctypes.POINTER(w.ULONG), w.ULONG]),
        "BCryptDecrypt": ([w.HANDLE, w.LPVOID, w.ULONG, w.LPVOID, w.LPVOID, w.ULONG, w.LPVOID, w.ULONG, ctypes.POINTER(w.ULONG), w.ULONG]),
        "BCryptDestroyKey": ([w.HANDLE]),
        "BCryptCloseAlgorithmProvider": ([w.HANDLE, w.ULONG]),
    }
    for name, args in signatures.items():
        getattr(api, name).argtypes = args
        getattr(api, name).restype = ctypes.c_long

    def checked(status):
        if status != 0:
            raise ValueError("密码错误或封装内容校验失败（原文件未改变）。")

    algorithm, handle = w.HANDLE(), w.HANDLE()
    checked(api.BCryptOpenAlgorithmProvider(ctypes.byref(algorithm), "AES", None, 0))
    try:
        mode = ctypes.create_unicode_buffer("ChainingModeGCM")
        checked(api.BCryptSetProperty(algorithm, "ChainingMode", mode, ctypes.sizeof(mode), 0))
        length, written = w.ULONG(), w.ULONG()
        checked(api.BCryptGetProperty(algorithm, "ObjectLength", ctypes.byref(length), 4, ctypes.byref(written), 0))
        key_object, key_buffer = ctypes.create_string_buffer(length.value), ctypes.create_string_buffer(key)
        checked(api.BCryptGenerateSymmetricKey(algorithm, ctypes.byref(handle), key_object, length.value, key_buffer, len(key), 0))
        try:
            source, output = ctypes.create_string_buffer(data), ctypes.create_string_buffer(len(data))
            nonce_buffer, aad_buffer = ctypes.create_string_buffer(nonce), ctypes.create_string_buffer(associated)
            tag_buffer = ctypes.create_string_buffer(tag, 16) if tag is not None else ctypes.create_string_buffer(16)
            info = AuthInfo(ctypes.sizeof(AuthInfo), 1, ctypes.addressof(nonce_buffer), len(nonce),
                            ctypes.addressof(aad_buffer), len(associated), ctypes.addressof(tag_buffer), 16,
                            None, 0, 0, 0, 0)
            operation = api.BCryptDecrypt if tag is not None else api.BCryptEncrypt
            checked(operation(handle, source, len(data), ctypes.byref(info), None, 0, output, len(data), ctypes.byref(written), 0))
            return output.raw[:written.value], tag_buffer.raw
        finally:
            api.BCryptDestroyKey(handle)
    finally:
        api.BCryptCloseAlgorithmProvider(algorithm, 0)


def safe_relative(name):
    path = PurePosixPath(name)
    devices = {"CON", "PRN", "AUX", "NUL"} | {prefix + str(number) for prefix in ("COM", "LPT") for number in range(1, 10)}
    if (not name or "\\" in name or ":" in name or path.is_absolute() or
            any(part in (".", "..", "") or part.endswith((".", " ")) for part in name.split("/")) or
            any(ord(char) < 32 or char in '<>"|?*' for char in name) or
            any(part.split(".")[0].upper() in devices for part in name.split("/"))):
        raise ValueError("封装含不安全路径")
    return path


def program_files(blob):
    if len(blob) > MAX_BYTES:
        raise ValueError("程序包过大")
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        entries = archive.infolist()
        if len(entries) > 200 or len({entry.filename.casefold() for entry in entries}) != len(entries):
            raise ValueError("程序清单重复或过大")
        if sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("程序解压大小超过限制")
        files = {}
        for entry in entries:
            name = entry.filename
            safe_relative(name)
            if not (name in ("index.html", "README.md", "p109-release-manifest.json") or re.fullmatch(r"src/[a-zA-Z0-9_.\-/]+", name)):
                raise ValueError("程序包含不允许的内容")
            if entry.is_dir() or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("程序包不能包含目录条目或符号链接")
            files[name] = archive.read(entry)
    manifest = json.loads(files["p109-release-manifest.json"])
    if manifest.get("projectId") != "P109-AttendScope" or manifest.get("schemaVersion") != 1:
        raise ValueError("不是受支持的程序包")
    listed = manifest["files"]
    if len(files) != len(listed) + 1 or len({row["path"] for row in listed}) != len(listed):
        raise ValueError("程序清单不完整")
    for row in listed:
        content = files[row["path"]]
        if len(content) != row["bytes"] or hashlib.sha256(content).hexdigest() != row["sha256"]:
            raise ValueError("程序文件哈希不匹配")
    return files


def read_constant(path, name):
    if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("封装文本无效")
    tree = ast.parse(path.read_text(encoding="utf-8"))
    values = [node.value for node in tree.body if isinstance(node, ast.Assign) and
              any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    if len(values) != 1:
        raise ValueError("封装常量缺失或重复")
    value = ast.literal_eval(values[0])
    if not isinstance(value, str):
        raise ValueError("封装常量必须是文本")
    return value


def decode(root, password):
    encoded = read_constant(root / "setup.py", "CONFIG")
    meta = json.loads(base64.b85decode(encoded.encode("ascii")))
    if meta.get("format") != 1 or not 100_000 <= meta.get("iterations", 0) <= 2_000_000:
        raise ValueError("封装格式或派生参数不支持")
    names = meta.get("parts", [])
    if not isinstance(names, list) or not 1 <= len(names) <= 1500 or len(set(names)) != len(names):
        raise ValueError("封装分块无效")
    chunks = []
    for name in names:
        safe_relative(name)
        if not re.fullmatch(r"(?:core|linalg|stats)/[a-z]+_\d{4}\.py", name):
            raise ValueError("封装分块路径不支持")
        at = root / name
        if at.resolve().parent.parent != root.resolve():
            raise ValueError("封装不能通过链接访问外部文件")
        chunks.append(base64.b85decode(read_constant(at, "DATA").encode("ascii")))
    ciphertext = b"".join(chunks)
    if len(ciphertext) > MAX_BYTES:
        raise ValueError("封装过大")
    header = {name: value for name, value in meta.items() if name != "tag"}
    salt, nonce, tag = (base64.b64decode(meta[name], validate=True) for name in ("salt", "nonce", "tag"))
    if len(salt) != 16 or len(nonce) != 12 or len(tag) != 16:
        raise ValueError("封装加密参数无效")
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, meta["iterations"], 32)
    plain, _ = aes_gcm(ciphertext, key, nonce, canonical(header), tag)
    if len(plain) < 4:
        raise ValueError("恢复清单缺失")
    size = struct.unpack("<I", plain[:4])[0]
    if size > 4096:
        raise ValueError("恢复清单过大")
    receipt, blob = json.loads(plain[4:4 + size]), plain[4 + size:]
    if receipt.get("sha256") != hashlib.sha256(blob).hexdigest() or receipt.get("bytes") != len(blob):
        raise ValueError("恢复包哈希不匹配")
    return program_files(blob), set(names) | {"setup.py", "lib/init.py"}, receipt


def cleanup_temp(folder, root):
    resolved = folder.resolve()
    if resolved.parent != root or not resolved.name.startswith(".analysis-") or folder.is_symlink():
        raise ValueError("拒绝清理非本次临时目录")
    shutil.rmtree(resolved)


def restore(root, password, before_verify=None):
    root = root.resolve()
    files, wrappers, receipt = decode(root, password)
    current = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("还原目录不能包含符号链接")
        if path.is_file():
            current.add(path.relative_to(root).as_posix())
    if current != wrappers:
        raise ValueError("当前目录含其他文件或分块缺失；请在新文件夹重新解压，避免覆盖已有文件。")
    stage = Path(tempfile.mkdtemp(prefix=".analysis-stage-", dir=root))
    backup = Path(tempfile.mkdtemp(prefix=".analysis-backup-", dir=root))
    moved, installed, preserve_backup = [], [], False
    try:
        for name, content in files.items():
            at = stage / name
            at.parent.mkdir(parents=True, exist_ok=True)
            at.write_bytes(content)
        for name in sorted(wrappers - {"lib/init.py"}):
            at = backup / name
            at.parent.mkdir(parents=True, exist_ok=True)
            (root / name).replace(at)
            moved.append(name)
        for name in files:
            at = root / name
            at.parent.mkdir(parents=True, exist_ok=True)
            (stage / name).replace(at)
            installed.append(name)
        if before_verify:
            before_verify(root)
        for name, content in files.items():
            if (root / name).read_bytes() != content:
                raise ValueError("还原写入校验失败")
    except BaseException as original:
        try:
            for name in reversed(installed):
                (root / name).unlink(missing_ok=True)
            for name in reversed(moved):
                at = root / name
                at.parent.mkdir(parents=True, exist_ok=True)
                (backup / name).replace(at)
            for folder in sorted((path for path in root.rglob("*") if path.is_dir()), key=lambda path: len(path.parts), reverse=True):
                if folder not in (stage, backup) and not any(folder.iterdir()):
                    folder.rmdir()
        except BaseException as rollback_error:
            preserve_backup = True
            raise RuntimeError("写入失败且系统阻止回滚。备份保留在 " + str(backup) +
                               "；请保留原压缩包，在可写的新目录重新解压还原。") from rollback_error
        raise original
    finally:
        cleanup_temp(stage, root)
        if not preserve_backup:
            cleanup_temp(backup, root)
    (root / "lib/init.py").unlink()
    for name in sorted({str(PurePosixPath(name).parent) for name in wrappers}):
        folder = root / name
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
    return receipt


def main():
    parser = argparse.ArgumentParser(description="展开分析工具包")
    parser.add_argument("--password-file", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    password = args.password_file.read_text(encoding="utf-8").rstrip("\r\n") if args.password_file else getpass.getpass("请输入还原密码：")
    if not password:
        raise ValueError("密码不能为空")
    receipt = restore(Path(__file__).resolve().parent.parent, password)
    print("还原完成，文件已校验，包装与还原脚本已清理。请打开 index.html。")
    print("原程序包 SHA-256：" + receipt["sha256"])


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print("还原未完成：" + str(error), file=sys.stderr)
        sys.exit(1)
