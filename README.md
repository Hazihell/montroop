<img width="1266" height="663" alt="kunumy-screenshot" src="https://github.com/user-attachments/assets/35b5c75d-cae8-4892-8a49-30f25cf53880" />

Kunumy is an AI agent with one chat that never ends. There is no "new chat" button: you talk to the same agent for days, weeks, years, and it remembers. It started from [Victor Taelin's UniiChat](https://github.com/VictorTaelin/uniichat) by way of [arteeh's Ki](https://github.com/arteeh/ki).

Features
--------

- **One chat, forever.** Forget about sessions or context engineering. Just talk to your agent, from any device.
- **A memory system that keeps everything.** Messages are summarized into a tree that the agent sees every turn: recent messages in detail, older ones more broadly. It can zoom into any line, down to the original message.
- **All your computers.** Run `kny device` on a machine and the agent can run commands and edit files there.
- **Claude and ChatGPT plans** as vendors (`claude-sub`, `openai-sub`) beside API keys; profiles that fall back to the next model when one is out; auto-resume after hitting usage limits.
- **Multiple agents** so each one can have specific knowledge.
- **Subagents** to delegate grunt work while the agent keeps the big picture.
- **Scheduling tools** to give your agent future or repeating tasks.
- **Memory tree viewer** to browse what your agent knows.
- **Web search and page reading** by each vendor's own hosted tools: give the agent a link and it reads the page (on `claude-sub`, search only).
- **Image and video viewing tools** to let the agent see images and video files.
- **Images, video, audio and HTML pages inline** for the agent to show you things, or for you to show the agent.
- **Conversation mode** for when you want a short continuous back-and-forth without the agent forgetting anything you said (shout out to /grill-me!).
- **MCP servers** per device. Ask your agent to set them up on your preferred device.
- **Skills** read from the ~/.agents/skills folder.
- **An installable web app (PWA)** on phones and desktops: icons, an offline shell that opens on your chats as you last saw them, Web Push for replies, a nav bar that shows on Android; the composer stays above a phone's keyboard.
- **Don't start from scratch.** Import past conversations from Claude Code or Codex into an agent's memory tree, from its settings.

Install
-------

Linux, macOS or WSL:

`curl -fsSL https://github.com/Hazihell/kunumy/releases/latest/download/install.sh | sh`

Windows (PowerShell, no admin needed):

`irm https://github.com/Hazihell/kunumy/releases/latest/download/install.ps1 | iex`

Either way you get one `kny` program (in `~/.local/bin`, or `%LOCALAPPDATA%\Programs\kunumy` on Windows). `kny update` checks the Agent SDK for news and where it touches what Kunumy relies on; `kny update apply` bumps it in a worktree of your clone, tests it, installs it and restarts the background services on it; `kny update rollback` puts the previous program back (`kny update help`).

Set up
------

1. **Start the server** on the computer (preferably one that's reachable and on 24/7) that keeps your chat: `kny serve -d`. It runs in the background from then on, at http://127.0.0.1:8788, with its data in `~/.kunumy` (or `$KNY_DIR`). See the Q&A if you want to set up a client on another device right away.
2. **Sign in.** Open the server's address in your browser and type the code that `kny serve login` prints on that computer. Devices sign in with a link and a code you confirm in that browser.
3. **Pick a model.** In the web app, Team, then Settings (the sliders): add API keys. To use your Claude or ChatGPT plan instead, run `kny serve claude login` or `kny serve chatgpt login` on the server's computer, then pick `claude-sub` or `openai-sub`. Another Claude plan signs in with `kny serve claude login --account NAME`, and an agent takes it in its settings.
4. **Add your computers.** On each one Kunumy may work on: `kny device -d https://your-server`. Kunumy works in `~/.kunumy/work` there. Want it working on the server's computer too? Run a device there as well.

**In the background**, `-d` runs the server or a device as a service as your user (systemd on Linux, a Scheduled Task on Windows, a LaunchAgent on macOS): it starts at login and restarts if it crashes. `kny serve stop` / `kny device stop` removes it, `logs -f` follows its output. On Linux, `loginctl enable-linger` keeps it running while you're logged out. On Windows, `sudo kny device -d` offers to run it as administrator, so Kunumy can control apps that run as admin; then `sudo kny device stop` removes it.

Use
---

- **Web UI:** open the server's address. Install it as an app from your browser to get notifications when Kunumy replies.
- **Agents:** **+** in the chat list makes another agent, with its own chat, memory and editable system prompt; its settings keep the prompt's earlier versions, to revert to.
- **Leader:** If you want an agent that automatically knows where the other agents are at, go to the agent's settings and enable Leader Mode. A leader will see the most recent memory of each agent.
- **Conversation mode:** the mode menu left of the model picker. From then on, your and the agent's messages stay word for word in its context, for a real back-and-forth. It costs more per turn and turns itself off when the model's context window fills up.
- `kny help` lists every command.

From source (Bun): `bun install`, `bun run ui`, `bun Cli.ts <command>`, `bun run build` for a single `kny` program.

Uninstall
---------

Back up `~/.kunumy` first if you may want your chat back. Run `kny device stop` and `kny serve stop` where you used `-d`, then:

- **Linux, macOS:** `rm ~/.local/bin/kny` and `rm -rf ~/.kunumy ~/.config/kunumy`.
- **Windows:** `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\kunumy", "$HOME\.kunumy", "$HOME\.config\kunumy"`, and take `%LOCALAPPDATA%\Programs\kunumy` out of your user Path.

Q&A
---

**Can Kunumy use my screen?**

Not by itself: ask Kunumy to add a computer-use MCP server, such as [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver), to the device whose screen it should use.

**I don't trust its unlimited tool calling. Can I sandbox Kunumy?**

Yes, with [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/). Run `kny device` inside the sandbox and on no other computer, pointed at your server outside it (`http://host.docker.internal:8788` if it runs on the same PC), and let the sandbox reach it: `sbx policy allow network localhost:8788`. That device's MCP servers run in the sandbox too.

**I don't trust its unlimited tool calling. Can I make it ask for permission on tool calls?**

For the risky ones, yes: sending messages as you, payments, deletes outside scratch, logins and publishing wait for your Approve or Deny in the web app, with a phone notification. Settings → Ask first lists the rules; add or remove them there.

**How can I reach Kunumy from outside my home network?**

With Tailscale: ask your agent to set up Tailscale Serve on HTTPS port 443, pointing at `http://127.0.0.1:8788`. Only your own Tailscale devices can reach it, not the whole internet.

**How can I give Kunumy administrator rights?**

- Linux: set up passwordless sudo (run `sudo visudo` and then add the line `your_username ALL=(ALL) NOPASSWD: ALL`).
- Windows: run `sudo kny device -d` and be sure to enable the sudo option in settings when it prompts you.

Be aware of the risks. Your agent will have the power to break your computer, and potential vulnerabilities in Kunumy will leave your devices more exposed.

**Can others use my server?**

No: a server has one owner. Anthropic and OpenAI don't allow sharing a subscription.

License
-------

Apache-2.0 (LICENSE).

Copyright 2026 Higher Order Company.

Copyright 2026 Maarten de Jong.
