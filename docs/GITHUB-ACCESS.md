# GitHub updates and releases

The project is [aaraven99/scorebug](https://github.com/aaraven99/scorebug).

## Update the code

Use your existing clone in **GitHub Desktop**, or edit files through the signed-in GitHub website. Pull the latest changes, make your edits, review them, then commit and push. Follow any branch rules shown by GitHub.

The Windows workflow runs for pull requests and relevant updates to `main`. It checks the data code, web build, geometry, and actual Windows widget before it creates the downloads. The connected Vercel project can deploy `main` separately.

A GitHub website login and a connected app have separate permissions. If a connected app returns `403 Resource not accessible by integration`, using the signed-in website or GitHub Desktop is an available way to update this repository. You do not need the connected app to download or run Scorebug.

## Publish a new download

You can publish entirely through GitHub's website:

1. Set a new, matching version in the root and desktop `package.json` and lockfiles, then merge those changes into `main`.
2. Open **Actions → Build Windows desktop app → Run workflow**.
3. Select the **main** branch and check **Publish the tested main commit as the latest Windows release**.
4. Click **Run workflow**. The workflow tests and builds that exact commit, uploads the verified files to a draft, and then publishes it as the latest release.

The publish checkbox defaults to off. Leaving it unchecked builds downloadable Actions artifacts without publishing a release. Publication from this manual action is allowed only on `main`; no separate tag or empty release needs to be created in the browser.

### Publish with a tag instead

Pushing a matching version tag also runs the full Windows checks and release process. From an authenticated clone:


```sh
git tag v1.2.0 VERIFIED_COMMIT_SHA
git push origin v1.2.0
```

Use the version and commit you intend to publish. The workflow rejects a tag that does not match the package versions or points to a different commit from the tested artifact.

Each successful Windows run uploads **Scorebug-Windows-x64** with:

- **Scorebug-Portable-Windows.zip** — the EXE, a short start guide, and checksums.
- **Scorebug-Setup-Windows.exe** — an optional installer.
- **SHA256SUMS.txt** — checksums for the two downloads.
- **release-info.json** — the build’s version, source commit, and asset hashes.

Only the release job receives repository write permission, after all Windows checks, the native smoke test, and packaging succeed. It uses this same run's artifact, verifies its source commit, checks every file's size and SHA-256 hash, and publishes only after the uploaded files match. Drafts are located by authenticated release listing and retained numeric IDs, so an unfinished draft can be resumed.

If an upload or publication request fails, use **Re-run failed jobs** on that workflow run. The release job reuses the same verified build and replaces incomplete or mismatched uploads only while the release remains a draft. A published release with matching files is left unchanged. Different files in an already-published release, including an immutable release, cause a clear failure: bump the version for a new release. Do not move an existing version tag or expect a fresh rebuild to have identical ZIP hashes.

## Permanent download links

The README and website use these links, so users do not need to search Actions or sign in:

- [Latest portable app](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip)
- [Latest installer](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe)
- [Release notes and older versions](https://github.com/aaraven99/scorebug/releases)

The desktop app is unsigned. Publishing a release does not change that.

## References

[GitHub Desktop: commit and push](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop) · [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) · [GitHub release API](https://docs.github.com/en/rest/releases/releases) · [Release asset API](https://docs.github.com/en/rest/releases/assets)
