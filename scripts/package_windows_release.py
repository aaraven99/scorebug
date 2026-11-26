"""Package an already-tested Windows build into the public download assets."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


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

    summary = json.loads((args.input_dir / "smoke/summary.json").read_text(encoding="utf-8"))
    if summary.get("passed") is not True or summary.get("platform") != "win32":
        raise ValueError("A passing native Windows smoke check is required before packaging a public download")
    portable = args.input_dir / f"Scorebug-Portable-{version}-x64.exe"
    installer = args.input_dir / f"Scorebug-Setup-{version}-x64.exe"
    for executable in (portable, installer):
        with executable.open("rb") as source:
            if source.read(2) != b"MZ":
                raise ValueError(f"Not a Windows executable: {executable.name}")

    output = args.output_dir or args.input_dir / "publish"
    output.mkdir(parents=True, exist_ok=True)
    start_here = f"""SCOREBUG {version}

1. Quit any older Scorebug from its tray menu.
2. Extract the whole ZIP into a folder.
3. Open {portable.name}.

Drag near a side edge and release for the vertical layout.
Hover a team's colored panel for its stats. Use the gear to change games or size.
Right-click for position, monitor, lock, or quit.

Scores update automatically while the computer is awake and online.
No installation, PowerToys, Node.js, Python, or Vercel is needed.
Your saved game and position carry over when you update. The app is unsigned.

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
    checksums = output / "SHA256SUMS.txt"
    checksums.write_bytes(f"{digest(archive)}  {archive.name}\n{digest(setup)}  {setup.name}\n".encode("utf-8"))
    assets = [archive, setup, checksums]
    info = {"version": version, "tag": f"v{version}", "commit": os.environ.get("GITHUB_SHA"),
            "assets": [{"name": asset.name, "bytes": asset.stat().st_size, "sha256": digest(asset)} for asset in assets]}
    (output / "release-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(f"Packaged Scorebug {version}: {archive.name} and {setup.name}")


if __name__ == "__main__":
    main()
