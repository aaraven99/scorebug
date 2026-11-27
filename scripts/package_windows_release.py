"""Package an already-tested Windows build into the public download assets."""

import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def validate_update_files(input_dir, installer, version):
    """Keep electron-builder's manifest intact and verify every referenced byte."""
    manifest = input_dir / "latest.yml"
    blockmap = input_dir / f"{installer.name}.blockmap"
    if not 0 < manifest.stat().st_size <= 64 * 1024:
        raise ValueError("The Windows update manifest is empty or too large")
    # js-yaml is already installed by electron-builder/electron-updater. Use its
    # JSON schema rather than a handwritten YAML parser or custom YAML types.
    parsed = subprocess.run(
        ["node", "-e", """
const fs = require('node:fs');
const yaml = require(require.resolve('js-yaml', { paths: [process.argv[2]] }));
process.stdout.write(JSON.stringify(yaml.load(fs.readFileSync(process.argv[1], 'utf8'), { schema: yaml.JSON_SCHEMA })));
""", str(manifest.resolve()), str(ROOT / "desktop")],
        check=True, capture_output=True, text=True, timeout=15,
    )
    data = json.loads(parsed.stdout)
    if not isinstance(data, dict) or data.get("version") != version:
        raise ValueError("The update manifest version does not match the tested build")
    files = data.get("files")
    if not isinstance(files, list) or len(files) != 1 or not isinstance(files[0], dict):
        raise ValueError("Expected exactly one Windows x64 installer in latest.yml")
    entry = files[0]
    # Exact basenames exclude external hosts, path traversal, other releases,
    # and a stable-name alias that differs from the builder's original file.
    if entry.get("url") != installer.name or data.get("path") != installer.name or data.get("packages"):
        raise ValueError("The update manifest must reference this version's local NSIS installer")
    actual_size = installer.stat().st_size
    if type(entry.get("size")) is not int or entry["size"] != actual_size:
        raise ValueError("The update manifest installer size does not match")
    sha512 = hashlib.sha512()
    with installer.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha512.update(chunk)
    expected = base64.b64encode(sha512.digest()).decode("ascii")
    if entry.get("sha512") != expected or data.get("sha512") != expected:
        raise ValueError("The update manifest SHA-512 does not match the tested installer")

    if not 0 < blockmap.stat().st_size <= 16 * 1024 * 1024:
        raise ValueError("The installer blockmap is empty or too large")
    with gzip.open(blockmap, "rb") as source:
        payload = source.read(64 * 1024 * 1024 + 1)
    if len(payload) > 64 * 1024 * 1024:
        raise ValueError("The installer blockmap expands beyond its limit")
    blocks = json.loads(payload)
    block_files = blocks.get("files") if isinstance(blocks, dict) else None
    if not isinstance(blocks, dict) or blocks.get("version") != "2" or not isinstance(block_files, list) or len(block_files) != 1:
        raise ValueError("Expected electron-builder's Windows v2 installer blockmap")
    block_file = block_files[0]
    if not isinstance(block_file, dict) or block_file.get("offset") != 0:
        raise ValueError("The installer blockmap must start at the beginning of the EXE")
    sizes, hashes = block_file.get("sizes"), block_file.get("checksums")
    if (not isinstance(sizes, list) or not sizes or not isinstance(hashes, list)
            or len(sizes) != len(hashes) or any(type(size) is not int or size <= 0 for size in sizes)
            or sum(sizes) != actual_size):
        raise ValueError("The installer blockmap does not cover the tested installer")
    with installer.open("rb") as source:
        for size, expected_hash in zip(sizes, hashes):
            # electron-builder v26 uses a base64-encoded 18-byte BLAKE2b hash.
            checksum = hashlib.blake2b(digest_size=18)
            remaining = size
            while remaining:
                chunk = source.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError("The installer ended before its blockmap")
                checksum.update(chunk)
                remaining -= len(chunk)
            if base64.b64encode(checksum.digest()).decode("ascii") != expected_hash:
                raise ValueError("The blockmap checksum does not match the tested installer")
    return manifest, blockmap


def release_version():
    versions = []
    for relative in ("package.json", "package-lock.json", "desktop/package.json", "desktop/package-lock.json"):
        data = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        versions.append(data["version"])
        if "packages" in data:
            versions.append(data["packages"][""]["version"])
    if len(set(versions)) != 1 or not re.fullmatch(r"\d+\.\d+\.\d+", versions[0]):
        raise ValueError("Root and desktop package/lock versions must match a stable release version")
    version = versions[0]
    if os.environ.get("GITHUB_REF_TYPE") == "tag" and os.environ.get("GITHUB_REF_NAME") != f"v{version}":
        raise ValueError(f"Release tag must be v{version}")
    return version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-tag", action="store_true")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "desktop/release")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    version = release_version()
    if args.check_tag:
        print(f"Release versions match: {version}")
        return

    package_release(args.input_dir, args.output_dir or args.input_dir / "publish", version)


def package_release(input_dir, output, version):
    summary = json.loads((input_dir / "smoke/summary.json").read_text(encoding="utf-8"))
    if summary.get("passed") is not True or summary.get("platform") != "win32":
        raise ValueError("A passing native Windows smoke check is required before packaging a public download")
    portable = input_dir / f"Scorebug-Portable-{version}-x64.exe"
    installer = input_dir / f"Scorebug-Setup-{version}-x64.exe"
    for executable in (portable, installer):
        with executable.open("rb") as source:
            if source.read(2) != b"MZ":
                raise ValueError(f"Not a Windows executable: {executable.name}")

    manifest, blockmap = validate_update_files(input_dir, installer, version)
    output.mkdir(parents=True, exist_ok=True)
    start_here = f"""SCOREBUG {version}

1. Quit any older Scorebug from its tray menu.
2. Extract the whole ZIP into a folder.
3. Open {portable.name}.

Drag near a side edge and release for the vertical layout.
Hover a logo or timeout area for team stats, or the center for a comparison.
Use the gear to choose sports, favorites, a scorebug style or size.
Right-click for position, monitor, lock, or quit.

Scores update automatically while the computer is awake and online.
This portable copy needs a new download for feature updates.
For automatic feature updates, quit this copy and install the Windows app once:
https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe

Your saved teams, style and position carry over. No PowerToys, Node.js, Python,
or Vercel setup is needed. The app is unsigned.

Latest download: https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip
Help: https://github.com/aaraven99/scorebug#readme
"""
    readme_bytes = start_here.encode("utf-8")
    inner_checksums = (
        f"{digest(portable)}  {portable.name}\n"
        f"{hashlib.sha256(readme_bytes).hexdigest()}  START-HERE.txt\n"
    )
    archive = output / "Scorebug-Portable-Windows.zip"
    # The portable EXE is already compressed. Storing it keeps packaging fast.
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.write(portable, portable.name)
        bundle.writestr("START-HERE.txt", readme_bytes)
        bundle.writestr("SHA256SUMS.txt", inner_checksums)

    setup = output / "Scorebug-Setup-Windows.exe"
    shutil.copyfile(installer, setup)
    # The direct-download alias stays convenient for people. The updater uses
    # the versioned original named by the unmodified electron-builder manifest.
    update_assets = [output / item.name for item in (installer, blockmap, manifest)]
    for source, target in zip((installer, blockmap, manifest), update_assets):
        shutil.copyfile(source, target)
    downloads = [archive, setup, *update_assets]
    checksums = output / "SHA256SUMS.txt"
    checksums.write_bytes("".join(f"{digest(asset)}  {asset.name}\n" for asset in downloads).encode("utf-8"))
    assets = [*downloads, checksums]
    info = {"version": version, "tag": f"v{version}", "commit": os.environ.get("GITHUB_SHA"),
            "assets": [{"name": asset.name, "bytes": asset.stat().st_size, "sha256": digest(asset)} for asset in assets]}
    (output / "release-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(f"Packaged Scorebug {version}: Windows downloads and verified automatic-update files")


if __name__ == "__main__":
    main()
