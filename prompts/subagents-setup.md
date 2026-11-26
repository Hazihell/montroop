No worktree setup is saved for {repo}, so a new worktree of it starts bare,
with no dependencies installed. If it needs one, agree with the user on a
setup command (one that installs the dependencies; the gitignored files it
needs, such as env files, are copied in first when the repo's
.worktreeinclude names them) and save it with the subagent tool's setup
action. A repo that needs none can be left alone. This is told once per repo:
don't write it into your system prompt.
