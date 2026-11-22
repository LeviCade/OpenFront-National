#!/usr/bin/env python3
"""Read embedded notices from pinned, already-present media; never infer rights."""
import hashlib
import json
import pathlib
import shutil
import struct
import subprocess
import zlib

NAMES = {
    0: "copyright", 1: "family", 2: "style", 3: "unique_id",
    4: "full_name", 5: "version", 7: "trademark", 8: "manufacturer",
    9: "designer", 10: "description", 11: "vendor_url",
    12: "designer_url", 13: "license", 14: "license_url",
}
AUDIO_KEYS = {
    "artist", "album_artist", "composer", "copyright", "license", "licence",
    "title", "encoder", "encoded_by", "publisher", "organization", "comment",
    "date", "isrc",
}


def font_notices(data):
    if data[:4] != b"wOFF" or len(data) < 44:
        raise ValueError("not WOFF1")
    count = struct.unpack_from(">H", data, 12)[0]
    for index in range(count):
        tag, offset, packed, expanded, _ = struct.unpack_from(
            ">4sIIII", data, 44 + index * 20
        )
        if tag != b"name":
            continue
        if expanded > 1024 * 1024 or offset + packed > len(data):
            raise ValueError("invalid name table bounds")
        table = data[offset:offset + packed]
        if packed != expanded:
            decoder = zlib.decompressobj()
            table = decoder.decompress(table, expanded + 1)
            if not decoder.eof or len(table) != expanded:
                raise ValueError("invalid compressed name table")
        if len(table) != expanded:
            raise ValueError("invalid name table length")
        _, records, strings = struct.unpack_from(">HHH", table)
        findings = []
        for record in range(records):
            platform, encoding, language, name, length, relative = struct.unpack_from(
                ">HHHHHH", table, 6 + 12 * record
            )
            if name not in NAMES:
                continue
            start = strings + relative
            if start + length > len(table):
                raise ValueError("invalid name record")
            if platform in (0, 3):
                codec = "utf-16-be"
            elif platform == 1 and encoding == 0:
                codec = "mac_roman"
            else:
                continue
            value = table[start:start + length].decode(codec, errors="replace")
            if value.strip():
                findings.append({
                    "field": NAMES[name], "platform": platform,
                    "language": language, "value": value[:4096],
                })
        return findings
    raise ValueError("no name table")


def audio_notices(path):
    tool = shutil.which("ffprobe")
    if not tool:
        raise RuntimeError("ffprobe unavailable")
    task = subprocess.run(
        [tool, "-v", "error", "-show_entries", "format_tags",
         "-of", "json", str(path)],
        capture_output=True, timeout=15, check=True,
    )
    tags = json.loads(task.stdout).get("format", {}).get("tags", {})
    return [
        {"field": str(key), "value": str(value)[:4096]}
        for key, value in tags.items() if key.lower() in AUDIO_KEYS
    ]


def main():
    manifest = json.loads(pathlib.Path(
        "docs/release/c4-class2-media-provenance.json"
    ).read_text())
    results = []
    for entry in manifest["records"]:
        path = pathlib.Path(entry["path"])
        row = {"path": str(path), "rightsClearance": "UNVERIFIED"}
        try:
            data = path.read_bytes()
            blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            if blob != entry["gitBlobSha1"] or blob != entry["upstreamBlobSha1"]:
                raise ValueError("pinned byte identity mismatch")
            row["sha256"] = hashlib.sha256(data).hexdigest()
            row["notices"] = font_notices(data) if path.suffix == ".woff" else audio_notices(path)
            row["status"] = "READ" if row["notices"] else "NO_RECOGNIZED_NOTICE"
        except (OSError, ValueError, RuntimeError, struct.error, zlib.error,
                subprocess.SubprocessError) as error:
            row["status"] = "BLOCKED"
            row["reason"] = type(error).__name__
        results.append(row)
    output = {
        "scope": "Embedded metadata is a claim in the binary, not proof of license ownership or grant.",
        "upstreamSha": manifest["upstreamSha"],
        "records": results,
    }
    directory = pathlib.Path("national-qa-artifacts")
    directory.mkdir(exist_ok=True)
    (directory / "embedded-media-notices.json").write_text(json.dumps(output, indent=2) + "\n")
    print("MEDIA_NOTICES " + json.dumps({
        "total": len(results),
        "read": sum(row["status"] == "READ" for row in results),
        "noRecognizedNotice": sum(row["status"] == "NO_RECOGNIZED_NOTICE" for row in results),
        "blocked": sum(row["status"] == "BLOCKED" for row in results),
        "fontNotices": [row for row in results if row["path"].endswith(".woff")],
    }))
    return int(any(row["status"] == "BLOCKED" for row in results))


if __name__ == "__main__":
    raise SystemExit(main())
