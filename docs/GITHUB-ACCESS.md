# GitHub updates and releases

The project is [aaraven99/scorebug](https://github.com/aaraven99/scorebug).

## Update the code

Use your existing clone in **GitHub Desktop**, or edit files through the signed-in GitHub website. Pull the latest changes, make your edits, review them, then commit and push. Follow any branch rules shown by GitHub.

The Windows workflow runs for pull requests and relevant updates to `main`. It checks the data code, web build, geometry, and actual Windows widget before it creates the downloads. The connected Vercel project can deploy `main` separately.

A GitHub website login and a connected app have separate permissions. If a connected app returns `403 Resource not accessible by integration`, using the signed-in website or GitHub Desktop is an available way to update this repository. You do not need the connected app to download or run Scorebug.

## Publish a new download

1. Set the same version in the root and desktop `package.json` and lockfiles.
2. Merge the changes and wait for the Windows workflow to pass.
3. Create and push a matching tag, such as `v1.2.0`, at the commit you verified.
4. The tag workflow runs the Windows checks again, packages the app, and publishes the release after its assets are uploaded and checked.

From an authenticated clone, the tag commands are:

```sh
git tag v1.2.0 VERIFIED_COMMIT_SHA
git push origin v1.2.0
```

Use the version and commit you intend to publish. The workflow rejects a tag that does not match the package versions.

Each successful Windows run uploads **Scorebug-Windows-x64** with:

- **Scorebug-Portable-Windows.zip** — the EXE, a short start guide, and checksums.
- **Scorebug-Setup-Windows.exe** — an optional installer.
- **SHA256SUMS.txt** — checksums for the two downloads.
- **release-info.json** — the build’s version, source commit, and asset hashes.

The automated release job has write permission only on a tag push, after the Windows job succeeds. It can resume an existing release for that same version. It reuses matching assets and replaces differing assets only under that tag. Existing release notes and the latest-version selection are preserved when updating an already-published release.

If you publish through GitHub’s website, use the assets from the successful Windows run for the same source version. Attach the ZIP, installer, and checksum file before publishing. This keeps the download usable immediately.

## Permanent download links

The README and website use these links, so users do not need to search Actions or sign in:

- [Latest portable app](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip)
- [Latest installer](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe)
- [Release notes and older versions](https://github.com/aaraven99/scorebug/releases)

The desktop app is unsigned. Publishing a release does not change that.

## References

[GitHub Desktop: commit and push](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop) · [Managing GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
