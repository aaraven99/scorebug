# Scorebug working instructions

## Preserve the product

Keep the UI simple and readable. Keep league-scoped game and team identities,
saved team and style favorites, explicit cross-sport style selections, independent
Standby cards, and native window positioning intact. Never turn missing provider
data into made-up scores, clocks, possessions, flags, or player statistics.

## Required verification for every change

Aarav requires deep regression testing on every edit, including small visual
changes. This is a continuing project requirement, not an optional release task.

1. Run the unit/data tests, desktop tests, production build, and complete browser
   QA suite. Run the WebKit phone workflow suite too. See `docs/QA.md` for commands.
2. Exercise every supported league with every selectable scorebug design in both
   orientations, at least three times. With 30 leagues and 83 designs that is at
   least 14,940 actual browser render cases. Derive the matrix from the catalogs
   so new sports and styles are automatically included. Report cases separately
   from assertion counts.
3. Repeat real user workflows: every selection control, team and style favorites,
   global search, demos and animation exit, hover statistics, normal/side pop-outs,
   Game Center, Standby with one to four games, portrait/landscape changes,
   persisted preferences, interrupted feeds, retries, and hide/resume lifecycle.
   Test every team in the recorded directory corpus. Use deterministic source
   fixtures for large repeated runs and bounded first-party probes for live data.
4. Inspect representative screenshots across styles, sports and screen sizes.
   Include long names, high scores, long racing lists, and empty/delayed states.
   A DOM check is not a claim that every screenshot has been manually reviewed.
5. Fix failures at their cause, add a regression check, and rerun the full required
   gates after the final changes. Do not remove checks, reduce the matrix, hide
   console errors, increase tolerances indiscriminately, or silently skip browser
   engines to make a failing run pass.
6. Windows, Apple Silicon and Intel Mac native smoke checks remain required before
   a desktop release. Browser emulation cannot prove OS window behavior or real
   iPhone hardware behavior. Preserve packaged Mac checks and update verification.
7. Save machine-readable results and screenshots as CI artifacts. In the handoff,
   state what passed, what was visually inspected, the tested commit/deployment,
   and any provider or platform limitation. Never claim every live source works
   when it is unavailable, stale, out of season, or needs credentials.

The release workflow must depend on browser QA and native checks. If the local
environment cannot run a required gate, run it in CI and wait for its result.
Do not label the release verified while any required gate is pending or failing.

## Collaboration and releases

Work on an isolated branch, preserve unrelated user edits, and coordinate shared
file ownership. Keep package versions and lockfiles consistent. Publish only the
commit whose checks passed. Never move an existing release tag or relabel an old
binary as a new build. Use plain language in the README and release notes.
