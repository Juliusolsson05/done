"""Collect successful iPad test attachments without resampling their PNGs."""

import json
import shutil
import struct
import sys
from pathlib import Path


def verify_png(path):
    with path.open("rb") as image:
        header = image.read(24)
    if len(header) != 24 or header[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
        raise SystemExit(f"{path}: invalid PNG header")
    width, height = struct.unpack(">II", header[16:24])
    if (width, height) != (2064, 2752):
        raise SystemExit(f"{path}: expected 2064 × 2752, found {width} × {height}")


def main(output):
    attachments = output / "screens"
    manifest = json.loads((attachments / "manifest.json").read_text())
    sources = {"Today": output / "Today.png"}
    for view in ("Board", "Focus", "Notes", "Upcoming"):
        matches = [
            item["exportedFileName"]
            for test in manifest
            if test["testIdentifier"] == f"Capture/test{view}()"
            for item in test["attachments"]
            if not item["isAssociatedWithFailure"]
            and item["exportedFileName"].endswith(".png")
            and item["suggestedHumanReadableName"].startswith(f"{view}_")
        ]
        if len(matches) != 1:
            raise SystemExit(f"{view}: expected one verified PNG, found {len(matches)}")
        sources[view] = attachments / matches[0]

    for source in sources.values():
        verify_png(source)

    native = output / "native"
    native.mkdir(exist_ok=True)
    for view, source in sources.items():
        shutil.copyfile(source, native / f"{view}.png")
        print(f"{view}.png: 2064 × 2752")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
