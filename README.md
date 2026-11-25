<img width="1266" height="663" alt="montroop-screenshot" src="https://github.com/user-attachments/assets/35b5c75d-cae8-4892-8a49-30f25cf53880" />

Montroop is an AI agent with one chat that never ends. There is no "new chat" button: you talk to the same agent for days, weeks, years, and it remembers. It started from [Victor Taelin's UniiChat](https://github.com/VictorTaelin/uniichat) by way of [arteeh's Ki](https://github.com/arteeh/ki).

Features
--------

- **One chat, forever.** Forget about sessions or context engineering. Just talk to your agent, from any device.
- **A memory system that keeps everything.** Messages are summarized into a tree that the agent sees every turn: recent messages in detail, older ones more broadly. It can zoom into any line, down to the original message.
- **All your computers.** Run `troop device` on a machine and the agent can run commands and edit files there.
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

`curl -fsSL https://github.com/Hazihell/montroop/releases/latest/download/install.sh | sh`

Windows (PowerShell, no admin needed):

`irm https://github.com/Hazihell/montroop/releases/latest/download/install.ps1 | iex`

Either way you get one `troop` program (in `~/.local/bin`, or `%LOCALAPPDATA%\Programs\montroop` on Windows). `troop update` checks the Agent SDK for news and where it touches what Montroop relies on; `troop update apply` bumps it in a worktree of your clone, tests it, installs it and restarts the background services on it; `troop update rollback` puts the previous program back (`troop update help`).

Set up
------

1. **Start the server** on the computer (preferably one that's reachable and on 24/7) that keeps your chat: `troop serve -d`. It runs in the background from then on, at http://127.0.0.1:8788, with its data in `~/.montroop` (or `$TROOP_DIR`). See the Q&A if you want to set up a client on another device right away.
2. **Sign in.** Open the server's address in your browser and type the code that `troop serve login` prints on that computer. Devices sign in with a link and a code you confirm in that browser.
3. **Pick a model.** In the web app, Team, then Settings (the sliders): add API keys. To use your Claude or ChatGPT plan instead, run `troop serve claude login` or `troop serve chatgpt login` on the server's computer, then pick `claude-sub` or `openai-sub`. Another Claude plan signs in with `troop serve claude login --account NAME`, and an agent takes it in its settings.
4. **Add your computers.** On each one Montroop may work on: `troop device -d https://your-server`. Montroop works in `~/.montroop/work` there. Want it working on the server's computer too? Run a device there as well.

**In the background**, `-d` runs the server or a device as a service as your user (systemd on Linux, a Scheduled Task on Windows, a LaunchAgent on macOS): it starts at login and restarts if it crashes. `troop serve stop` / `troop device stop` removes it, `logs -f` follows its output. On Linux, `loginctl enable-linger` keeps it running while you're logged out. On Windows, `sudo troop device -d` offers to run it as administrator, so Montroop can control apps that run as admin; then `sudo troop device stop` removes it.

Use
---

- **Web UI:** open the server's address. Install it as an app from your browser to get notifications when Montroop replies.
- **Agents:** **+** in the chat list makes another agent, with its own chat, memory and editable system prompt; its settings keep the prompt's earlier versions, to revert to.
- **Leader:** If you want an agent that automatically knows where the other agents are at, go to the agent's settings and enable Leader Mode. A leader will see the most recent memory of each agent.
- **Lasting subagents:** turn it on in an agent's settings and its subagents run on their own through restarts and updates, each in a folder of its own or a worktree of a repo, on any model you offer; their pages show what they do and let you approve their risky calls.
- **Conversation mode:** the mode menu left of the model picker. From then on, your and the agent's messages stay word for word in its context, for a real back-and-forth. It costs more per turn and turns itself off when the model's context window fills up.
- `troop help` lists every command.

From source (Bun): `bun install`, `bun run ui`, `bun Cli.ts <command>`, `bun run build` for a single `troop` program.

Uninstall
---------

Back up `~/.montroop` first if you may want your chat back. Run `troop device stop` and `troop serve stop` where you used `-d`, then:

- **Linux, macOS:** `rm ~/.local/bin/troop` and `rm -rf ~/.montroop ~/.config/montroop`.
- **Windows:** `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\montroop", "$HOME\.montroop", "$HOME\.config\montroop"`, and take `%LOCALAPPDATA%\Programs\montroop` out of your user Path.

Q&A
---

**Can Montroop use my screen?**

Not by itself: ask Montroop to add a computer-use MCP server, such as [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver), to the device whose screen it should use.

**I don't trust its unlimited tool calling. Can I sandbox Montroop?**

Yes, with [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/). Run `troop device` inside the sandbox and on no other computer, pointed at your server outside it (`http://host.docker.internal:8788` if it runs on the same PC), and let the sandbox reach it: `sbx policy allow network localhost:8788`. That device's MCP servers run in the sandbox too.

**I don't trust its unlimited tool calling. Can I make it ask for permission on tool calls?**

For the risky ones, yes: sending messages as you, payments, deletes outside scratch, logins and publishing wait for your Approve or Deny in the web app, with a phone notification. Settings → Ask first lists the rules; add or remove them there.

**How can I reach Montroop from outside my home network?**

With Tailscale: ask your agent to set up Tailscale Serve on HTTPS port 443, pointing at `http://127.0.0.1:8788`. Only your own Tailscale devices can reach it, not the whole internet.

**How can I give Montroop administrator rights?**

- Linux: set up passwordless sudo (run `sudo visudo` and then add the line `your_username ALL=(ALL) NOPASSWD: ALL`).
- Windows: run `sudo troop device -d` and be sure to enable the sudo option in settings when it prompts you.

Be aware of the risks. Your agent will have the power to break your computer, and potential vulnerabilities in Montroop will leave your devices more exposed.

**Can others use my server?**

No: a server has one owner. Anthropic and OpenAI don't allow sharing a subscription.

License
-------

Apache-2.0 (LICENSE).

Copyright 2026 Higher Order Company.

Copyright 2026 Maarten de Jong.
