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
import struct
import sys
import tempfile
import zipfile
MAX_BYTES = 64 * 1024 * 1024
ITERATIONS = 600000

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8')

def aes_gcm(data, key, nonce, associated, tag=None):
    if os.name != 'nt':
        raise RuntimeError('error input')
    from ctypes import wintypes as w

    class AuthInfo(ctypes.Structure):
        _fields_ = [('size', w.ULONG), ('version', w.ULONG), ('nonce', w.LPVOID), ('nonce_size', w.ULONG), ('associated', w.LPVOID), ('associated_size', w.ULONG), ('tag', w.LPVOID), ('tag_size', w.ULONG), ('mac', w.LPVOID), ('mac_size', w.ULONG), ('aad_size', w.ULONG), ('data_size', ctypes.c_ulonglong), ('flags', w.ULONG)]
    api = ctypes.WinDLL('bcrypt.dll')
    signatures = {'BCryptOpenAlgorithmProvider': [ctypes.POINTER(w.HANDLE), w.LPCWSTR, w.LPCWSTR, w.ULONG], 'BCryptSetProperty': [w.HANDLE, w.LPCWSTR, w.LPVOID, w.ULONG, w.ULONG], 'BCryptGetProperty': [w.HANDLE, w.LPCWSTR, w.LPVOID, w.ULONG, ctypes.POINTER(w.ULONG), w.ULONG], 'BCryptGenerateSymmetricKey': [w.HANDLE, ctypes.POINTER(w.HANDLE), w.LPVOID, w.ULONG, w.LPVOID, w.ULONG, w.ULONG], 'BCryptEncrypt': [w.HANDLE, w.LPVOID, w.ULONG, w.LPVOID, w.LPVOID, w.ULONG, w.LPVOID, w.ULONG, ctypes.POINTER(w.ULONG), w.ULONG], 'BCryptDecrypt': [w.HANDLE, w.LPVOID, w.ULONG, w.LPVOID, w.LPVOID, w.ULONG, w.LPVOID, w.ULONG, ctypes.POINTER(w.ULONG), w.ULONG], 'BCryptDestroyKey': [w.HANDLE], 'BCryptCloseAlgorithmProvider': [w.HANDLE, w.ULONG]}
    for name, args in signatures.items():
        getattr(api, name).argtypes = args
        getattr(api, name).restype = ctypes.c_long

    def checked(status):
        if status != 0:
            raise ValueError('error input')
    algorithm, handle = (w.HANDLE(), w.HANDLE())
    checked(api.BCryptOpenAlgorithmProvider(ctypes.byref(algorithm), 'AES', None, 0))
    try:
        mode = ctypes.create_unicode_buffer('ChainingModeGCM')
        checked(api.BCryptSetProperty(algorithm, 'ChainingMode', mode, ctypes.sizeof(mode), 0))
        length, written = (w.ULONG(), w.ULONG())
        checked(api.BCryptGetProperty(algorithm, 'ObjectLength', ctypes.byref(length), 4, ctypes.byref(written), 0))
        key_object, key_buffer = (ctypes.create_string_buffer(length.value), ctypes.create_string_buffer(key))
        checked(api.BCryptGenerateSymmetricKey(algorithm, ctypes.byref(handle), key_object, length.value, key_buffer, len(key), 0))
        try:
            source, output = (ctypes.create_string_buffer(data), ctypes.create_string_buffer(len(data)))
            nonce_buffer, aad_buffer = (ctypes.create_string_buffer(nonce), ctypes.create_string_buffer(associated))
            tag_buffer = ctypes.create_string_buffer(tag, 16) if tag is not None else ctypes.create_string_buffer(16)
            info = AuthInfo(ctypes.sizeof(AuthInfo), 1, ctypes.addressof(nonce_buffer), len(nonce), ctypes.addressof(aad_buffer), len(associated), ctypes.addressof(tag_buffer), 16, None, 0, 0, 0, 0)
            operation = api.BCryptDecrypt if tag is not None else api.BCryptEncrypt
            checked(operation(handle, source, len(data), ctypes.byref(info), None, 0, output, len(data), ctypes.byref(written), 0))
            return (output.raw[:written.value], tag_buffer.raw)
        finally:
            api.BCryptDestroyKey(handle)
    finally:
        api.BCryptCloseAlgorithmProvider(algorithm, 0)

def safe_relative(name):
    path = PurePosixPath(name)
    devices = {'CON', 'PRN', 'AUX', 'NUL'} | {prefix + str(number) for prefix in ('COM', 'LPT') for number in range(1, 10)}
    if not name or '\\' in name or ':' in name or path.is_absolute() or any((part in ('.', '..', '') or part.endswith(('.', ' ')) for part in name.split('/'))) or any((ord(char) < 32 or char in '<>"|?*' for char in name)) or any((part.split('.')[0].upper() in devices for part in name.split('/'))):
        raise ValueError('error input')
    return path

def program_files(blob):
    if len(blob) > MAX_BYTES:
        raise ValueError('error input')
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        entries = archive.infolist()
        if len(entries) > 200 or len({entry.filename.casefold() for entry in entries}) != len(entries):
            raise ValueError('error input')
        if sum((entry.file_size for entry in entries)) > MAX_BYTES:
            raise ValueError('error input')
        files = {}
        for entry in entries:
            name = entry.filename
            safe_relative(name)
            if not (name in ('index.html', 'README.md', 'p109-release-manifest.json') or re.fullmatch('src/[a-zA-Z0-9_.\\-/]+', name)):
                raise ValueError('error input')
            if entry.is_dir() or entry.external_attr >> 16 & 61440 == 40960:
                raise ValueError('error input')
            files[name] = archive.read(entry)
    manifest = json.loads(files['p109-release-manifest.json'])
    if manifest.get('projectId') != 'P109-AttendScope' or manifest.get('schemaVersion') != 1:
        raise ValueError('error input')
    listed = manifest['files']
    if len(files) != len(listed) + 1 or len({row['path'] for row in listed}) != len(listed):
        raise ValueError('error input')
    for row in listed:
        content = files[row['path']]
        if len(content) != row['bytes'] or hashlib.sha256(content).hexdigest() != row['sha256']:
            raise ValueError('error input')
    return files

def read_constant(path, name):
    if path.is_symlink() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('error input')
    tree = ast.parse(path.read_text(encoding='utf-8'))
    values = [node.value for node in tree.body if isinstance(node, ast.Assign) and any((isinstance(target, ast.Name) and target.id == name for target in node.targets))]
    if len(values) != 1:
        raise ValueError('error input')
    value = ast.literal_eval(values[0])
    if not isinstance(value, str):
        raise ValueError('error input')
    return value

def decode(root, password):
    encoded = read_constant(root / 'setup.py', 'CONFIG')
    meta = json.loads(base64.b85decode(encoded.encode('ascii')))
    if meta.get('format') != 1 or not 100000 <= meta.get('iterations', 0) <= 2000000:
        raise ValueError('error input')
    names = meta.get('parts', [])
    if not isinstance(names, list) or not 1 <= len(names) <= 1500 or len(set(names)) != len(names):
        raise ValueError('error input')
    chunks = []
    for name in names:
        safe_relative(name)
        if not re.fullmatch('(?:core|linalg|stats)/[a-z]+_\\d{4}\\.py', name):
            raise ValueError('error input')
        at = root / name
        if at.resolve().parent.parent != root.resolve():
            raise ValueError('error input')
        chunks.append(base64.b85decode(read_constant(at, 'DATA').encode('ascii')))
    ciphertext = b''.join(chunks)
    if len(ciphertext) > MAX_BYTES:
        raise ValueError('error input')
    header = {name: value for name, value in meta.items() if name != 'tag'}
    salt, nonce, tag = (base64.b64decode(meta[name], validate=True) for name in ('salt', 'nonce', 'tag'))
    if len(salt) != 16 or len(nonce) != 12 or len(tag) != 16:
        raise ValueError('error input')
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, meta['iterations'], 32)
    plain, _ = aes_gcm(ciphertext, key, nonce, canonical(header), tag)
    if len(plain) < 4:
        raise ValueError('error input')
    size = struct.unpack('<I', plain[:4])[0]
    if size > 4096:
        raise ValueError('error input')
    receipt, blob = (json.loads(plain[4:4 + size]), plain[4 + size:])
    if receipt.get('sha256') != hashlib.sha256(blob).hexdigest() or receipt.get('bytes') != len(blob):
        raise ValueError('error input')
    return (program_files(blob), set(names) | {'setup.py', 'lib/init.py'}, receipt, blob)

def restore(root, password, before_verify=None):
    root = root.resolve()
    files, wrappers, receipt, blob = decode(root, password)
    name = receipt.get('name', 'P109-upgrade.zip')
    if len(safe_relative(name).parts) != 1 or not name.lower().endswith('.zip'):
        raise ValueError('error input')
    output = root / name
    current = set()
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError('error input')
        if path.is_file():
            current.add(path.relative_to(root).as_posix())
    if current - {name} != wrappers:
        raise ValueError('error input')
    if output.exists():
        if output.is_file() and output.read_bytes() == blob:
            return receipt
        raise ValueError('error input')
    stage = None
    installed = False
    try:
        with tempfile.NamedTemporaryFile(prefix='.analysis-', suffix='.tmp', dir=root, delete=False) as stream:
            stage = Path(stream.name)
            stream.write(blob)
            stream.flush()
            os.fsync(stream.fileno())
        if before_verify:
            before_verify(stage)
        if stage.read_bytes() != blob:
            raise ValueError('error input')
        if os.name != 'nt':
            raise RuntimeError('error input')
        stage.rename(output)
        installed = True
        if output.read_bytes() != blob:
            raise ValueError('error input')
        return receipt
    except BaseException:
        if installed:
            output.unlink(missing_ok=True)
        raise
    finally:
        if stage is not None:
            stage.unlink(missing_ok=True)

def main():
    password = getpass.getpass('please input: ') if sys.stdin.isatty() else input('please input: ')
    if not password:
        raise ValueError('error input')
    restore(Path(__file__).resolve().parent.parent, password)
    print('done')
if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('error input', file=sys.stderr)
        sys.exit(1)
