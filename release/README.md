# Release scripts

The owner's release tooling, run on the build computer from the checkout they build (`$REL/release`). Work dirs, locks and release notes stay in `~/Projects/kunumy-dev`.

- `cut.sh [--publish]`: cuts the version in `Update.ts` from the checkout it is in: `N` is a release (from `origin/main`, in `~/Projects/kunumy-wt/release`, published as Latest), `N.rcM` a release candidate (from `origin/rc`, in `~/Projects/kunumy-wt/rc`, a pre-release, never Latest).
- `install.sh.in`, `install.ps1.in`: the installers; cut.sh fills in the version, sums, prompts and `upgrade.js`, which brings older data to this version's layout. Every migration step lives in the installers, none in the app.
- `sign.sh sign|verify DIR PUB`: signs or checks `SHA256SUMS`, `install.sh`, `install.ps1` in DIR with `ssh-keygen -Y sign`, one namespace per file. PUB is `release/kunumy.pub`.
- `migrate-kunumy.sh [--dry-run] [--rollback]`: moves an install from its earlier name (`ki`, data in `~/.ki`) to Kunumy, and back.

cut.sh refuses to build unless `kunumy.pub` holds a real `ssh-ed25519 AAAA…` key; it signs after writing the installers, and `--publish` checks every signature before it tags anything.

## Release key

Made once: `ssh-keygen -t ed25519 -N '' -C kunumy-release -f ~/.config/kunumy-release/kunumy.key`, with a backup kept off the build computer. Its public half goes into `release/kunumy.pub`, committed.

Lost on the build computer: restore it from the backup. Lost for good or leaked: make a new one, commit it, and say so in the release notes.
