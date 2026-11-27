"""Exercise release assembly without downloading or executing built applications."""

import json
from pathlib import Path
import tempfile
import unittest

from combine_desktop_release import combine, expected_assets
from package_windows_release import digest


class DesktopReleaseTests(unittest.TestCase):
    def fixture(self, directory):
        inputs = {}
        for platform in ('windows', 'mac-arm64', 'mac-x64'):
            folder = Path(directory) / platform
            folder.mkdir()
            assets = []
            for name in expected_assets('2.0.0', platform):
                path = folder / name
                path.write_bytes(f'tested-{platform}-{name}'.encode())
                assets.append({'name':name,'bytes':path.stat().st_size,'sha256':digest(path)})
            info = {'version':'2.0.0','tag':'v2.0.0','commit':'a'*40,'assets':assets}
            if platform.startswith('mac-'):
                info.update(platform='darwin',arch=platform.removeprefix('mac-'),signing='ad-hoc',notarized=False,minimumMacOS='13.0')
            (folder / 'release-info.json').write_text(json.dumps(info))
            inputs[platform] = folder
        return inputs

    def test_all_platforms_same_commit_with_global_checksums(self):
        with tempfile.TemporaryDirectory() as directory:
            inputs = self.fixture(directory)
            output = Path(directory) / 'combined'
            result = combine(inputs,output)
            self.assertEqual(len(result['assets']),13)
            self.assertEqual(result['platforms'],['windows-x64','mac-arm64','mac-x64'])
            self.assertIn('ad-hoc signed',(output/'START-HERE-MAC.txt').read_text())
            sums = (output/'SHA256SUMS.txt').read_text().splitlines()
            self.assertEqual(len(sums),12)
            for line in sums:
                sha,name=line.split('  ')
                self.assertEqual(digest(output/name),sha)
            self.assertEqual((output/'latest.yml').read_bytes(),(inputs['windows']/'latest.yml').read_bytes())

    def test_different_commits_cannot_be_published_together(self):
        with tempfile.TemporaryDirectory() as directory:
            inputs = self.fixture(directory)
            info_path = inputs['mac-arm64']/'release-info.json'
            info = json.loads(info_path.read_text());info['commit']='b'*40;info_path.write_text(json.dumps(info))
            with self.assertRaisesRegex(ValueError,'same version and commit'):
                combine(inputs,Path(directory)/'combined')

    def test_changed_artifact_rejected_before_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            inputs = self.fixture(directory)
            (inputs['mac-x64']/'Scorebug-Mac-Intel.zip').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'Artifact verification failed'):
                combine(inputs,Path(directory)/'combined')
            self.assertFalse((Path(directory)/'combined').exists())

    def test_missing_architecture_and_unexpected_assets_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            inputs = self.fixture(directory)
            with self.assertRaisesRegex(ValueError,'both native Mac'):
                combine({'windows':inputs['windows']},Path(directory)/'combined')
            info_path = inputs['mac-arm64']/'release-info.json'
            info = json.loads(info_path.read_text());info['assets'].append({'name':'../outside','bytes':1,'sha256':'a'*64});info_path.write_text(json.dumps(info))
            with self.assertRaisesRegex(ValueError,'unexpected'):
                combine(inputs,Path(directory)/'combined')

    def test_wrong_mac_label_or_signing_disclosure_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            inputs = self.fixture(directory)
            info_path = inputs['mac-arm64']/'release-info.json'
            info = json.loads(info_path.read_text());info['arch']='x64';info_path.write_text(json.dumps(info))
            with self.assertRaisesRegex(ValueError,'disclosure'):
                combine(inputs,Path(directory)/'combined')


if __name__=='__main__':
    unittest.main()
