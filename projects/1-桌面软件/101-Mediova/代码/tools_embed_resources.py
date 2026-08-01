#!/usr/bin/env python3
"""Embed the recovered v2.8.4 icon and fresh Windows resources.

The source package contains a resource-only bundle under assets/. It stores the
original icon/group-icon resources extracted from v2.8.4, not executable code.
This tool rebuilds a new .rsrc section for the current executable and adds:

- the original multi-size icon and group icon;
- a current VERSIONINFO resource;
- an asInvoker, PerMonitorV2 application manifest.

No MinGW/RC toolchain is required.
"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path
from typing import Dict, Tuple

FILE_ALIGN = 0x200
SECT_ALIGN = 0x1000
MAGIC = b"MWRSRC1\0"
ResourceKey = Tuple[int, int, int]  # type, id, language


def align(v: int, a: int) -> int:
    return (v + a - 1) // a * a


def pe_info(data: bytearray):
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe : pe + 4] != b"PE\0\0":
        raise ValueError("not PE")
    n = struct.unpack_from("<H", data, pe + 6)[0]
    szopt = struct.unpack_from("<H", data, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    if magic != 0x20B:
        raise ValueError("expected PE32+")
    sect = opt + szopt
    sections = []
    for i in range(n):
        o = sect + i * 40
        name = bytes(data[o : o + 8]).rstrip(b"\0")
        vs, va, rs, ptr = struct.unpack_from("<IIII", data, o + 8)
        characteristics = struct.unpack_from("<I", data, o + 36)[0]
        sections.append((name, o, vs, va, rs, ptr, characteristics))
    return pe, n, opt, sect, sections


def resource_from_pe(path: Path) -> tuple[bytearray, bytearray]:
    data = bytearray(path.read_bytes())
    _, _, _, _, sections = pe_info(data)
    matches = [x for x in sections if x[0] == b".rsrc"]
    if not matches:
        raise ValueError("template has no .rsrc")
    _, header_off, _, _, raw_size, raw_ptr, _ = matches[0]
    return bytearray(data[header_off : header_off + 40]), bytearray(data[raw_ptr : raw_ptr + raw_size])


def resource_from_bundle(path: Path) -> tuple[bytearray, bytearray]:
    data = path.read_bytes()
    if not data.startswith(MAGIC) or len(data) < len(MAGIC) + 44:
        raise ValueError("invalid MWRSRC bundle")
    raw_len = struct.unpack_from("<I", data, len(MAGIC))[0]
    start = len(MAGIC) + 4
    header = bytearray(data[start : start + 40])
    raw = bytearray(data[start + 40 : start + 40 + raw_len])
    if len(raw) != raw_len:
        raise ValueError("truncated MWRSRC bundle")
    return header, raw


def load_resource(path: Path) -> tuple[bytearray, bytearray]:
    first = path.read_bytes()[:8]
    if first == MAGIC:
        return resource_from_bundle(path)
    return resource_from_pe(path)


def write_bundle(template: Path, output: Path) -> None:
    header, raw = resource_from_pe(template)
    output.write_bytes(MAGIC + struct.pack("<I", len(raw)) + header + raw)


def extract_numeric_resources(header: bytearray, raw: bytearray) -> Dict[ResourceKey, bytes]:
    """Extract numeric type/id/lang leaves from a PE resource section."""
    _, section_rva, _, _ = struct.unpack_from("<IIII", header, 8)
    out: Dict[ResourceKey, bytes] = {}

    def walk(directory_offset: int, path: list[int]) -> None:
        if directory_offset + 16 > len(raw):
            raise ValueError("truncated resource directory")
        _, _, _, _, named, ids = struct.unpack_from("<IIHHHH", raw, directory_offset)
        count = named + ids
        for i in range(count):
            name_or_id, child = struct.unpack_from("<II", raw, directory_offset + 16 + i * 8)
            if name_or_id & 0x80000000:
                # The recovered icon bundle uses numeric entries only. Ignore
                # named entries rather than accidentally copying malformed data.
                continue
            value = int(name_or_id)
            child_offset = child & 0x7FFFFFFF
            if child & 0x80000000:
                walk(child_offset, path + [value])
                continue
            if child_offset + 16 > len(raw) or len(path) < 2:
                continue
            data_rva, size, _, _ = struct.unpack_from("<IIII", raw, child_offset)
            data_offset = data_rva - section_rva
            if data_offset < 0 or data_offset + size > len(raw):
                raise ValueError("resource data points outside section")
            type_id, resource_id = path[0], path[1]
            language = value
            out[(type_id, resource_id, language)] = bytes(raw[data_offset : data_offset + size])

    walk(0, [])
    return out


def pad4(buf: bytearray) -> None:
    while len(buf) % 4:
        buf.append(0)


def utf16z(text: str) -> bytes:
    return text.encode("utf-16le") + b"\0\0"


def version_block(key: str, value: bytes, value_length: int, value_type: int, children: list[bytes] | None = None) -> bytes:
    children = children or []
    buf = bytearray(b"\0" * 6)
    buf += utf16z(key)
    pad4(buf)
    buf += value
    pad4(buf)
    for child in children:
        buf += child
        pad4(buf)
    struct.pack_into("<HHH", buf, 0, len(buf), value_length, value_type)
    return bytes(buf)


def string_value(key: str, value: str) -> bytes:
    encoded = utf16z(value)
    return version_block(key, encoded, len(value) + 1, 1)


def build_version_info(version: str) -> bytes:
    parts = [int(x) for x in version.split(".")]
    if len(parts) != 3:
        raise ValueError("version must be major.minor.patch")
    major, minor, patch = parts
    file_ms = (major << 16) | minor
    file_ls = patch << 16
    fixed = struct.pack(
        "<13I",
        0xFEEF04BD,  # signature
        0x00010000,  # structure version
        file_ms,
        file_ls,
        file_ms,
        file_ls,
        0x0000003F,  # flags mask
        0,
        0x00040004,  # VOS_NT_WINDOWS32
        0x00000001,  # VFT_APP
        0,
        0,
        0,
    )
    display = f"{major}.{minor}.{patch}.0"
    strings = [
        string_value("CompanyName", "Mediova"),
        string_value("FileDescription", "Mediova 本地媒体工作站"),
        string_value("FileVersion", display),
        string_value("InternalName", "mediova"),
        string_value("OriginalFilename", f"Mediova_v{version}.exe"),
        string_value("ProductName", "Mediova"),
        string_value("ProductVersion", display),
    ]
    table = version_block("080404B0", b"", 0, 1, strings)
    string_file = version_block("StringFileInfo", b"", 0, 1, [table])
    translation = version_block("Translation", struct.pack("<HH", 0x0804, 0x04B0), 4, 0)
    var_file = version_block("VarFileInfo", b"", 0, 1, [translation])
    return version_block("VS_VERSION_INFO", fixed, len(fixed), 0, [string_file, var_file])


def build_manifest() -> bytes:
    return b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">\r\n  <assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="Mediova.Desktop" type="win32"/>\r\n  <description>Mediova Local Media Workstation</description>\r\n  <dependency>\r\n    <dependentAssembly>\r\n      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="amd64" publicKeyToken="6595b64144ccf1df" language="*"/>\r\n    </dependentAssembly>\r\n  </dependency>\r\n  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">\r\n    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>\r\n  </trustInfo>\r\n  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>\r\n    <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"/>\r\n    <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"/>\r\n    <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>\r\n    <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>\r\n  </application></compatibility>\r\n  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>\r\n    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>\r\n    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>\r\n    <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>\r\n  </windowsSettings></application>\r\n</assembly>\r\n'''


class DirectoryNode:
    def __init__(self) -> None:
        self.children: dict[int, DirectoryNode | bytes] = {}
        self.offset = 0


def build_resource_section(resources: Dict[ResourceKey, bytes], section_rva: int) -> bytes:
    root = DirectoryNode()
    for (type_id, resource_id, language), data in sorted(resources.items()):
        type_node = root.children.setdefault(type_id, DirectoryNode())
        assert isinstance(type_node, DirectoryNode)
        id_node = type_node.children.setdefault(resource_id, DirectoryNode())
        assert isinstance(id_node, DirectoryNode)
        id_node.children[language] = data

    directories: list[DirectoryNode] = []

    def collect(node: DirectoryNode) -> None:
        directories.append(node)
        for child in node.children.values():
            if isinstance(child, DirectoryNode):
                collect(child)

    collect(root)
    cursor = 0
    for node in directories:
        node.offset = cursor
        cursor += 16 + len(node.children) * 8
    cursor = align(cursor, 4)

    leaves: list[tuple[DirectoryNode, int, bytes]] = []
    for node in directories:
        for key, child in sorted(node.children.items()):
            if isinstance(child, bytes):
                leaves.append((node, key, child))

    data_entry_offsets: dict[tuple[int, int], int] = {}
    for node, key, _ in leaves:
        data_entry_offsets[(id(node), key)] = cursor
        cursor += 16
    cursor = align(cursor, 4)

    data_offsets: dict[tuple[int, int], int] = {}
    for node, key, data in leaves:
        cursor = align(cursor, 4)
        data_offsets[(id(node), key)] = cursor
        cursor += len(data)

    buf = bytearray(b"\0" * cursor)
    for node in directories:
        struct.pack_into("<IIHHHH", buf, node.offset, 0, 0, 0, 0, 0, len(node.children))
        for i, (key, child) in enumerate(sorted(node.children.items())):
            entry_off = node.offset + 16 + i * 8
            if isinstance(child, DirectoryNode):
                struct.pack_into("<II", buf, entry_off, key, 0x80000000 | child.offset)
            else:
                struct.pack_into("<II", buf, entry_off, key, data_entry_offsets[(id(node), key)])

    for node, key, data in leaves:
        entry_off = data_entry_offsets[(id(node), key)]
        data_off = data_offsets[(id(node), key)]
        struct.pack_into("<IIII", buf, entry_off, section_rva + data_off, len(data), 0, 0)
        buf[data_off : data_off + len(data)] = data
    return bytes(buf)


def embed(resource: Path, target: Path, output: Path, version: str) -> None:
    source_header, source_raw = load_resource(resource)
    resources = extract_numeric_resources(source_header, source_raw)
    # Replace or add current executable metadata. RT_VERSION=16, RT_MANIFEST=24.
    resources[(16, 1, 0x0804)] = build_version_info(version)
    resources[(24, 1, 0x0409)] = build_manifest()

    new = bytearray(target.read_bytes())
    pe, section_count, opt, section_table, sections = pe_info(new)
    if any(x[0] == b".rsrc" for x in sections):
        raise ValueError("target already has .rsrc; embed into a raw Go executable")

    first_raw = min(x[5] for x in sections if x[5])
    new_header_off = section_table + section_count * 40
    if new_header_off + 40 > first_raw:
        raise ValueError("no section header room")

    section_rva = align(max(x[3] + max(x[2], x[4]) for x in sections), SECT_ALIGN)
    resource_bytes = build_resource_section(resources, section_rva)
    virtual_size = len(resource_bytes)
    raw_size = align(virtual_size, FILE_ALIGN)
    raw_off = align(len(new), FILE_ALIGN)
    if len(new) < raw_off:
        new.extend(b"\0" * (raw_off - len(new)))
    new.extend(resource_bytes)
    if len(resource_bytes) < raw_size:
        new.extend(b"\0" * (raw_size - len(resource_bytes)))

    header = bytearray(40)
    header[:8] = b".rsrc\0\0\0"
    struct.pack_into("<IIIIIIHHI", header, 8, virtual_size, section_rva, raw_size, raw_off, 0, 0, 0, 0, 0x40000040)
    new[new_header_off : new_header_off + 40] = header
    struct.pack_into("<H", new, pe + 6, section_count + 1)

    # PE32+ data directory starts at optional-header +112; entry 2 is resources.
    struct.pack_into("<II", new, opt + 112 + 16, section_rva, virtual_size)
    old_init = struct.unpack_from("<I", new, opt + 8)[0]
    struct.pack_into("<I", new, opt + 8, old_init + raw_size)
    struct.pack_into("<I", new, opt + 56, align(section_rva + virtual_size, SECT_ALIGN))
    struct.pack_into("<I", new, opt + 64, 0)  # checksum
    output.write_bytes(new)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("resource", nargs="?", help="resource bundle or v2.8.4 PE template")
    ap.add_argument("target", nargs="?", help="raw rebuilt EXE")
    ap.add_argument("output", nargs="?", help="final EXE")
    ap.add_argument("--version", default="3.5.3", help="semantic version such as 3.2.0")
    ap.add_argument("--make-bundle", nargs=2, metavar=("TEMPLATE_EXE", "OUTPUT_BUNDLE"))
    args = ap.parse_args()
    if args.make_bundle:
        write_bundle(Path(args.make_bundle[0]), Path(args.make_bundle[1]))
        return
    if not (args.resource and args.target and args.output):
        ap.error("resource, target and output are required")
    embed(Path(args.resource), Path(args.target), Path(args.output), args.version)


if __name__ == "__main__":
    main()
