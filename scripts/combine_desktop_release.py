"""Combine independently verified Windows and native Mac builds from one commit."""

import argparse
import json
from pathlib import Path
import re
import shutil

from package_windows_release import digest


MAC_HELP = """SCOREBUG FOR MAC

Choose Apple Silicon for an M1, M2, M3, M4 or newer Apple-chip Mac.
Choose Intel for an Intel Mac. Apple menu > About This Mac shows your chip.
macOS 13 Ventura or later is required.

1. Open the DMG.
2. Drag Scorebug into Applications.
3. Open Scorebug from Applications. Choose a sport, favorite teams and a style.

The ZIP contains the same Scorebug.app. Unzip it and move the app to Applications.

This first Mac release is ad-hoc signed, not signed with an Apple Developer ID
or notarized by Apple. If macOS blocks it and you trust this download, first try
to open the app, then use System Settings > Privacy & Security > Open Anyway.
Do not turn off Gatekeeper or run a terminal command to remove security checks.
Apple's instructions: https://support.apple.com/en-us/102445

Drag the scoreboard near a screen edge and release to snap it there. Left and
right side positions use the compact vertical view. Use the menu-bar icon to
choose a position, open settings, lock the widget or quit. Logo/timeout areas
open team stats; the center opens a comparison. Game Center opens a full page.

Mac feature updates are manual until an Apple-signed release is available.
Quit Scorebug, download the latest Mac version and replace it in Applications.
Your favorites, style and position are kept. Scores still refresh automatically
while the Mac is awake and connected.

Latest releases: https://github.com/aaraven99/scorebug/releases/latest
"""


def expected_assets(version, platform):
    if platform == "windows":
        installer = f"Scorebug-Setup-{version}-x64.exe"
        return {"Scorebug-Portable-Windows.zip", "Scorebug-Setup-Windows.exe", installer,
                f"{installer}.blockmap", "latest.yml", "SHA256SUMS.txt"}
    label = {"mac-arm64": "Apple-Silicon", "mac-x64": "Intel"}[platform]
    return {f"Scorebug-Mac-{label}.dmg", f"Scorebug-Mac-{label}.zip", f"SHA256SUMS-Mac-{label}.txt"}


def combine(inputs, output):
    if set(inputs) != {"windows", "mac-arm64", "mac-x64"}:
        raise ValueError("Windows and both native Mac architectures are required")
    infos = {platform: json.loads((folder / "release-info.json").read_text(encoding="utf-8")) for platform, folder in inputs.items()}
    version = infos["windows"].get("version")
    commit = infos["windows"].get("commit")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("A stable tested release version is required")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("The verified build commit is missing")
    verified = []
    for platform, info in infos.items():
        if info.get("version") != version or info.get("tag") != f"v{version}" or info.get("commit") != commit:
            raise ValueError("Every release platform must be built and tested from the same version and commit")
        if platform.startswith("mac-") and (info.get("platform") != "darwin" or info.get("arch") != platform.removeprefix("mac-")
                or info.get("signing") != "ad-hoc" or info.get("notarized") is not False or info.get("minimumMacOS") != "13.0"):
            raise ValueError("The Mac release labels or disclosure do not match the tested build")
        assets = info.get("assets")
        if not isinstance(assets, list) or len(assets) != len(expected_assets(version, platform)) or {asset.get("name") for asset in assets} != expected_assets(version, platform):
            raise ValueError("The release has missing, unexpected or duplicate assets")
        for asset in assets:
            source = inputs[platform] / asset["name"]
            if not source.is_file() or source.stat().st_size != asset.get("bytes") or source.stat().st_size <= 0 or digest(source) != asset.get("sha256"):
                raise ValueError(f"Artifact verification failed: {asset['name']}")
            if asset["name"] != "SHA256SUMS.txt":
                verified.append(source)
    output.mkdir(parents=True, exist_ok=True)
    assets = []
    for source in verified:
        target = output / source.name
        shutil.copyfile(source, target)
        assets.append(target)
    help_file = output / "START-HERE-MAC.txt"
    help_file.write_text(MAC_HELP, encoding="utf-8")
    assets.append(help_file)
    sums = output / "SHA256SUMS.txt"
    sums.write_text("".join(f"{digest(asset)}  {asset.name}\n" for asset in assets), encoding="utf-8")
    assets.append(sums)
    combined = {"version": version, "tag": f"v{version}", "commit": commit,
                "platforms": ["windows-x64", "mac-arm64", "mac-x64"],
                "assets": [{"name": asset.name, "bytes": asset.stat().st_size, "sha256": digest(asset)} for asset in assets]}
    (output / "release-info.json").write_text(json.dumps(combined, indent=2) + "\n", encoding="utf-8")
    return combined


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = combine({platform: args.input_dir / platform for platform in ("windows", "mac-arm64", "mac-x64")}, args.output_dir)
    print(f"Verified {len(result['assets'])} assets for Scorebug {result['version']} from {result['commit']}")


if __name__ == "__main__":
    main()
