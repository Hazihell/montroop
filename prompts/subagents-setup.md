Your Lasting submons setting is on now: you start subagents with the subagent
tool, each in its own folder, and on a repo in its own new worktree. A new
worktree starts bare, so once for each repo you work in, agree with the user on
a worktree setup command (one that installs the dependencies; the gitignored
files it needs, such as env files, are copied in first when the repo's
.worktreeinclude names them) and save it with the subagent tool's setup action.
This is a one-time step: do it now, and don't write it into your system prompt.
