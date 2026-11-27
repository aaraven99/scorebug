"""Verify a native-tested Mac app and prepare clear Apple Silicon/Intel downloads."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import zipfile

from package_windows_release import ROOT, digest, release_version


LABELS = {"arm64": "Apple-Silicon", "x64": "Intel"}


def verify_smoke(path, arch, packaged):
    summary = json.loads(path.read_text(encoding="utf-8"))
    if (summary.get("passed") is not True or summary.get("platform") != "darwin"
            or summary.get("arch") != arch or summary.get("packaged") is not packaged):
        raise ValueError("Both source and packaged-app smoke checks must pass on the native Mac architecture")
    return summary


def validate_archives(app, archive, dmg, version, arch):
    """Check the artifacts users download against the exact app smoke-tested."""
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleShortVersionString") != version or info.get("CFBundleIdentifier") != "dev.aarav.scorebug":
        raise ValueError("The built Mac app has the wrong version or bundle identifier")
    if info.get("LSMinimumSystemVersion") != "13.0":
        raise ValueError("The Mac app must declare the runtime's minimum macOS version")
    executable = app / "Contents/MacOS/Scorebug"
    native_arch = "arm64" if arch == "arm64" else "x86_64"
    architectures = subprocess.run(["lipo", "-archs", str(executable)], check=True, capture_output=True, text=True).stdout.split()
    if architectures != [native_arch]:
        raise ValueError("The Mac app architecture does not match its download label")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    signature = subprocess.run(["codesign", "--display", "--verbose=4", str(app)], check=True, capture_output=True, text=True).stderr
    if "Signature=adhoc" not in signature:
        raise ValueError("Unexpected signing mode: update the release disclosure before shipping a differently signed build")
    subprocess.run(["hdiutil", "verify", str(dmg)], check=True)
    with dmg.open("rb") as source:
        source.seek(-512, 2)
        if source.read(4) != b"koly":
            raise ValueError("The download is not a valid UDIF disk image")
    with zipfile.ZipFile(archive) as bundle:
        # All modified app content must be identical to the native-tested app.
        # Framework code is covered by codesign and the archive's CRCs.
        for relative in ("Contents/Info.plist", "Contents/MacOS/Scorebug", "Contents/Resources/app.asar",
                         "Contents/Resources/mac-mouse-release", "Contents/Resources/scorebug/server.mjs"):
            local = app / relative
            expected = digest(local)
            actual = hashlib.sha256()
            with bundle.open(f"Scorebug.app/{relative}") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    actual.update(chunk)
            if actual.hexdigest() != expected:
                raise ValueError(f"The Mac archive differs from the tested app: {relative}")
        if bundle.testzip() is not None:
            raise ValueError("The Mac archive contains a damaged entry")


def package_release(input_dir, output, version, arch):
    if arch not in LABELS:
        raise ValueError("Mac downloads require arm64 or x64")
    for folder, packaged in (("smoke", False), ("smoke-packaged", True)):
        verify_smoke(input_dir / folder / "summary.json", arch, packaged)
    app = input_dir / ("mac-arm64" if arch == "arm64" else "mac") / "Scorebug.app"
    archive = input_dir / f"Scorebug-Mac-{version}-{arch}.zip"
    dmg = input_dir / f"Scorebug-Mac-{version}-{arch}.dmg"
    validate_archives(app, archive, dmg, version, arch)
    output.mkdir(parents=True, exist_ok=True)
    label = LABELS[arch]
    assets = []
    for source in (dmg, archive):
        destination = output / f"Scorebug-Mac-{label}{source.suffix}"
        shutil.copyfile(source, destination)
        assets.append(destination)
    checksums = output / f"SHA256SUMS-Mac-{label}.txt"
    checksums.write_text("".join(f"{digest(asset)}  {asset.name}\n" for asset in assets), encoding="utf-8")
    assets.append(checksums)
    info = {"version": version, "tag": f"v{version}", "commit": os.environ.get("GITHUB_SHA"), "platform": "darwin",
            "arch": arch, "minimumMacOS": "13.0", "signing": "ad-hoc", "notarized": False,
            "assets": [{"name": asset.name, "bytes": asset.stat().st_size, "sha256": digest(asset)} for asset in assets]}
    (output / "release-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(f"Verified Scorebug {version} for Mac {label}: native source + packaged smoke, signature, DMG and ZIP")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arch", choices=LABELS, required=True)
    parser.add_argument("--input-dir", type=Path, default=ROOT / "desktop/release")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    package_release(args.input_dir, args.output_dir or args.input_dir / "publish-mac", release_version(), args.arch)


if __name__ == "__main__":
    main()
