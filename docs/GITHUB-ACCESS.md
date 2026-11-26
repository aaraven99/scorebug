# Put the update in your existing GitHub repository

## What the connection error means

The attempted write returned GitHub's `403 Resource not accessible by integration`. Owning `aaraven99/scorebug` gives your account rights; the connected app still needs its own authorization. The earlier wording, “give the GitHub connection write access,” was imprecise.

[OpenAI's GitHub connection guide](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt) describes the standard ChatGPT GitHub app as read-only and directs editing/pushing workflows to Codex. Reconnecting or selecting a repository does not turn that read-only app into a write-enabled app. The error alone does not identify which integration permission is missing.

The signed-in GitHub website has its own authenticated session. It can provide a writable path without changing the connected app's permissions. The GitHub Desktop steps below are an alternative for uploading future changes from your computer.

## GitHub Desktop: update `aaraven99/scorebug`

1. Open [GitHub Desktop](https://desktop.github.com/) and sign in to the GitHub account that owns the repository.
2. Choose **File → Clone repository → URL**. Enter `https://github.com/aaraven99/scorebug`, choose a folder, then click **Clone**. If you already have this repository in Desktop, select it instead, then **Fetch origin** and **Pull origin** if available.
3. Select the repository's default branch in **Current Branch**. Open the cloned folder in File Explorer.
4. Extract the supplied source ZIP elsewhere. Copy the project contents—the folder containing `package.json`, `public`, `api`, and `desktop`—into the cloned repository folder, replacing the matching project files. The project files should sit directly in the clone, not inside an extra nested `scorebug` folder. Keep the clone's Git metadata; do not copy dependencies such as `node_modules` or build output.
5. Return to Desktop. Review the **Changes** list. Enter a summary such as `Refine scorebug transparency, hover details, and typography`, then click **Commit to [branch]**.
6. Click **Push origin**. Open the repository on GitHub and verify the new commit and changed files.

If branch rules require a pull request, use Desktop's new-branch flow, publish that branch, and create the pull request rather than bypassing the rules. If you prefer Codex, open the existing repository in an authenticated Codex workspace that can push and apply the prepared source files there.

Official instructions: [clone an existing repository](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-and-forking-repositories-from-github-desktop), [review and commit changes](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop), and [sync your branch](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop).

## Check which repositories the connection can read

Open [GitHub's installed-app settings](https://github.com/settings/installations). Beside the relevant ChatGPT/Codex app, choose **Configure**. Under **Repository access**, ensure `scorebug` is selected, then **Save**. Review **Permissions** to see the app's existing grants. This controls repository selection; it does not add permission types that the app does not request. See [GitHub's official installed-app guide](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps).
