# GitHub updates and releases

The project is [aaraven99/scorebug](https://github.com/aaraven99/scorebug). For local commands, see [Development](DEVELOPMENT.md).

## Update the code

Pull the latest changes, make and review your edits, then commit and push using GitHub Desktop, an authenticated terminal, or the GitHub website. Follow the repository's branch rules. A pull request lets you review a change and its checks before merging it into `main`.

The workflow is **Actions → Build Windows and Mac desktop apps**. Pull requests build and test without publishing. Relevant changes to `main` run the checks and can publish a new version. Vercel deploys the website separately; a successful website deployment does not mean desktop downloads are ready.

A GitHub website login and a connected app have separate permissions. If an integration reports `403 Resource not accessible by integration`, use a connection with repository write access, GitHub Desktop, or the signed-in website. Users do not need GitHub access to download Scorebug.

## Publish a new download

1. Set a new matching version in both `package.json` files and both lockfiles.
2. Merge the reviewed change into `main`.
3. Open **Actions → Build Windows and Mac desktop apps** and wait for Windows, both Mac builds, and the release job to finish.

The workflow publishes one release containing all three platforms. It does not publish a Windows-only update while a Mac build is failing. Each release needs a new version; published downloads are never replaced with different files.

For a manual run, choose **Run workflow**. The publish checkbox defaults to off. Enable it only to publish an unpublished version from `main`. You do not need to create an empty release first.

A matching tag can also start the full process. For example, from an authenticated clone:

```sh
git tag v2.0.0 VERIFIED_COMMIT_SHA
git push origin v2.0.0
```

Replace the version and commit with the ones you intend to publish. Never move an existing release tag.

## What must pass

| Build | Required checks |
| --- | --- |
| Windows x64 | Matching versions, release-script tests, web/data tests, static web build, desktop tests, native window smoke test, installer and portable packaging, update-manifest verification |
| Apple Silicon Mac | Native arm64 runner, matching versions, desktop tests, compiled drag helper, source and packaged-app smoke tests, DMG/ZIP verification |
| Intel Mac | The same Mac checks on a native x64 runner |
| Publication | All builds passed; versions and source commits match; expected files, sizes and hashes match before and after upload |

Mac checks currently use macOS 15 runners. They verify actual native executables, rather than running an Intel app through translation. Mac downloads require macOS 13 or newer.

Only the final publication job gets repository write permission. It uploads into a draft, checks every uploaded file, then makes the release public. If an upload fails, choose **Re-run failed jobs** on that same run. This reuses the tested files and can resume an unfinished draft. If a published version has different files, bump the version instead of rebuilding over it.

## Downloads and build evidence

Successful runs save three download artifacts for 30 days: `Scorebug-Windows-x64`, `Scorebug-Mac-arm64`, and `Scorebug-Mac-x64`.

The evidence artifacts are `Scorebug-Windows-smoke`, `Scorebug-Mac-arm64-smoke`, and `Scorebug-Mac-x64-smoke`. They contain test results and screenshots and last 14 days. Mac evidence includes both source and packaged-app runs.

The public release uploads **13 files**:

- Windows portable ZIP and the stable Windows installer.
- The versioned Windows installer, its `.blockmap`, and `latest.yml` for automatic updates.
- Apple Silicon and Intel Mac DMGs and ZIPs.
- Two Mac checksum files, one combined `SHA256SUMS.txt`, and `START-HERE-MAC.txt`.

Each build also carries `release-info.json` with its source commit and file hashes. That is internal verification metadata, not an extra public download. Keep the versioned Windows installer alongside the stable alias: `latest.yml` refers to the versioned filename.

### Permanent links

| Download | Link |
| --- | --- |
| Windows installer | [Scorebug-Setup-Windows.exe](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe) |
| Windows portable | [Scorebug-Portable-Windows.zip](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip) |
| Mac with an Apple chip | [DMG](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-Apple-Silicon.dmg) · [ZIP](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-Apple-Silicon.zip) |
| Intel Mac | [DMG](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-Intel.dmg) · [ZIP](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-Intel.zip) |

These links use the latest published release. A platform's link becomes available when a release containing that file is published. [Release notes and older downloads](https://github.com/aaraven99/scorebug/releases) remain available.

## Updates and signing

The installed Windows app checks for stable releases and downloads updates in the background. A ready update installs when the app quits, or when the user chooses **Restart to update**. Closing Settings does not quit the app. Portable copies need a fresh download.

Windows builds are unsigned. Update downloads use GitHub HTTPS and verified manifest hashes; there is no Authenticode publisher certificate.

Mac builds are ad-hoc signed, without Apple Developer ID signing or notarization. If macOS blocks the app and the user trusts the download, they can try opening it, then choose **System Settings → Privacy & Security → Open Anyway**. [Apple's instructions](https://support.apple.com/en-us/102445) explain this without disabling Gatekeeper.

Mac feature updates are manual for now: quit Scorebug, download the latest Mac version, and replace the app in Applications. Favorites, style and position stay saved. Scores continue to refresh automatically while the app is running and the computer is awake and online.
