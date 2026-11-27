"""Exercise the public download/update package using small generated binaries."""

import base64
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from package_windows_release import package_release


class WindowsReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "build"
        self.source.mkdir()
        self.output = self.root / "publish"
        self.version = "1.2.3"
        self.installer = self.source / "Scorebug-Setup-1.2.3-x64.exe"
        self.portable = self.source / "Scorebug-Portable-1.2.3-x64.exe"
        self.installer.write_bytes(b"MZ" + b"installer fixture" * 100)
        self.portable.write_bytes(b"MZ" + b"portable fixture" * 100)
        (self.source / "smoke").mkdir()
        (self.source / "smoke/summary.json").write_text(json.dumps({"passed": True, "platform": "win32"}))
        self.manifest = {
            "version": self.version,
            "files": [{"url": self.installer.name, "sha512": self.sha512(), "size": self.installer.stat().st_size}],
            "path": self.installer.name,
            "sha512": self.sha512(),
            "releaseDate": "2026-11-27T00:00:00.000Z",
        }
        self.write_manifest()
        self.blockmap = {"version": "2", "files": [{
            "name": "file", "offset": 0, "sizes": [self.installer.stat().st_size],
            "checksums": [base64.b64encode(hashlib.blake2b(self.installer.read_bytes(), digest_size=18).digest()).decode("ascii")],
        }]}
        self.write_blockmap()

    def sha512(self):
        return base64.b64encode(hashlib.sha512(self.installer.read_bytes()).digest()).decode("ascii")

    def write_manifest(self):
        # JSON is valid YAML; the happy-path test below also exercises builder-style YAML.
        (self.source / "latest.yml").write_text(json.dumps(self.manifest))

    def write_blockmap(self):
        (self.source / f"{self.installer.name}.blockmap").write_bytes(gzip.compress(json.dumps(self.blockmap).encode("utf-8")))

    def package(self):
        package_release(self.source, self.output, self.version)

    def test_manifest_is_unchanged_and_all_update_files_are_published(self):
        entry = self.manifest["files"][0]
        yaml = (f"version: {self.version}\nfiles:\n  - url: {entry['url']}\n"
                f"    sha512: {entry['sha512']}\n    size: {entry['size']}\n"
                f"path: {self.installer.name}\nsha512: {self.sha512()}\n"
                "releaseDate: '2026-11-27T00:00:00.000Z'\n")
        (self.source / "latest.yml").write_text(yaml)
        self.package()
        expected = {"Scorebug-Portable-Windows.zip", "Scorebug-Setup-Windows.exe", self.installer.name,
                    f"{self.installer.name}.blockmap", "latest.yml", "SHA256SUMS.txt"}
        info = json.loads((self.output / "release-info.json").read_text())
        self.assertEqual({item["name"] for item in info["assets"]}, expected)
        self.assertEqual((self.output / "latest.yml").read_bytes(), (self.source / "latest.yml").read_bytes())
        self.assertEqual((self.output / "Scorebug-Setup-Windows.exe").read_bytes(), self.installer.read_bytes())
        self.assertEqual((self.output / self.installer.name).read_bytes(), self.installer.read_bytes())
        checksum_lines = (self.output / "SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual({line.split("  ", 1)[1] for line in checksum_lines}, expected - {"SHA256SUMS.txt"})
        for item in info["assets"]:
            contents = (self.output / item["name"]).read_bytes()
            self.assertEqual(item["bytes"], len(contents))
            self.assertEqual(item["sha256"], hashlib.sha256(contents).hexdigest())
        with zipfile.ZipFile(self.output / "Scorebug-Portable-Windows.zip") as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read(self.portable.name), self.portable.read_bytes())
            guide = archive.read("START-HERE.txt").decode("utf-8")
            self.assertIn("portable copy needs a new download for feature updates", guide)
            self.assertIn("Scorebug-Setup-Windows.exe", guide)

    def test_rejects_other_versions_before_creating_downloads(self):
        self.manifest["version"] = "9.9.9"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "version"):
            self.package()
        self.assertFalse(self.output.exists())

    def test_rejects_external_or_traversing_installer_references(self):
        for name in ("https://example.com/update.exe", "../update.exe", "Scorebug-Setup-Windows.exe"):
            with self.subTest(name=name):
                self.manifest["files"][0]["url"] = name
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, "local NSIS installer"):
                    self.package()

    def test_rejects_wrong_manifest_size_and_both_hash_fields(self):
        for field in ("size", "file_hash", "top_hash"):
            with self.subTest(field=field):
                self.manifest["files"][0]["size"] = self.installer.stat().st_size
                self.manifest["files"][0]["sha512"] = self.sha512()
                self.manifest["sha512"] = self.sha512()
                if field == "size":
                    self.manifest["files"][0]["size"] += 1
                elif field == "file_hash":
                    self.manifest["files"][0]["sha512"] = "wrong"
                else:
                    self.manifest["sha512"] = "wrong"
                self.write_manifest()
                with self.assertRaises(ValueError):
                    self.package()

    def test_rejects_wrong_blockmap_bytes_and_coverage(self):
        original = json.dumps(self.blockmap)
        for field in ("checksum", "size"):
            with self.subTest(field=field):
                self.blockmap = json.loads(original)
                if field == "checksum":
                    self.blockmap["files"][0]["checksums"][0] = "wrong"
                else:
                    self.blockmap["files"][0]["sizes"][0] -= 1
                self.write_blockmap()
                with self.assertRaisesRegex(ValueError, "blockmap"):
                    self.package()

    def test_requires_a_passing_real_windows_smoke_result(self):
        (self.source / "smoke/summary.json").write_text(json.dumps({"passed": True, "platform": "linux"}))
        with self.assertRaisesRegex(ValueError, "Windows smoke"):
            self.package()


if __name__ == "__main__":
    unittest.main()
