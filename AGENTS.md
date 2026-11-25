- **Tests test behaviour, not implementation.** Each rule is tested once, at the lowest layer that owns it, through its module's public interface, with expected values from an independent source (literals, the spec), never recomputed the way the code does. A change to behaviour comes with a test that fails before it and passes after. No tests of trivial wiring, none that a harmless refactor breaks.
- **Test like a user** too. Run your change the way a real user would use it: run troop in an isolated container, with the user's state copied over (NOT mounted) if needed, and use the software there. Test the web UI using [playwright-cli](https://www.npmjs.com/package/@playwright/cli).
- `bun run check` (`bun run lint`: tsc, eslint, knip, `Seams.ts`; then the tests) must finish with 0 errors.
- **No dead code.** What your change leaves unused (code, a setting, a type's case, a text, a CSS rule, a file) goes in the same commit. Dead code or a bug you come across anywhere is fixed in the version you work on, not left for a later one. knip finds unused exports and namespace members, not an option no caller passes or a rule no page uses: look for those yourself.
- **A file is a module, its exports are its interface.** Export only what another file uses. A helper stays unexported, inside the namespace or beside it, called by its bare name. `bun run check` fails on an export no other file uses; `Seams.ts`'s `LEGACY` list of exceptions only shrinks.
- The first commit of every version updates every dependency to its latest version: `package.json` and `bun.lock`, Bun itself (`testing/Containerfile`, the release builds), and the phone's emulator, platform tools, system image and Chrome (`testing/phone/Containerfile`).
- `ui/dist` is generated and not committed: run `bun run ui` after changing `ui/`.
- Don't write docs into the codebase. The readme and code speak for themselves. The README is for users: what Montroop does and how to use it. Don't describe the codebase. Change it only when using the app changes, and keep that to a line or two.
- Be extremely strict on comments. Only add them if the information is essential and can't be inferred from the code.

## How to test

`bun run test` runs the suite (`bun run check` runs it last), in about 20 s; `bun run test testing/lifecycle/crash.test.ts` runs a part. It runs in namespaces of its own: no network, so no real model is ever called, its own processes, ports and home, and no systemd. It needs unprivileged user namespaces (Ubuntu: `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`) and Playwright's browser (`bunx playwright-core install chromium-headless-shell`). Its layers, in `testing/`:

- `rules/`: pure logic, literal inputs and outputs.
- `services/`: modules on a real database and files of the test file's own (`home.ts`, imported first) and real git repos; nothing of ours mocked.
- `lifecycle/`: a real server, holders and Claude Code against the fake models (`rig.ts`): servers, holders and Claude Code killed mid-run, restarts, approvals, messages.
- `journeys/`: the web app in headless Chromium at phone width.

In a test, steer the models with `fake.next(match, order)` (as `fake --match`): each case's messages carry text of its own to match, as cases run at once.

To use a change by hand, the test rig is a container with Montroop on your checkout, a device named `box`, and fake models of all four vendors (claude-api, claude-sub, openai-api, openai-sub) with fake sign-ins: no accounts, no network, no paid calls. From the repository's folder (Podman or Docker):

```sh
podman build -t troop-test -f testing/Containerfile .   # again when bun.lock changes
podman run -d --name rig --network none -v "$PWD:/src:ro,z" troop-test
podman logs -f rig                                          # until "rig up"
```

It copies your checkout in at every start, so after a change, `podman restart rig`; `podman rm -f rig` forgets the chat and sign-ins. Work inside it with `podman exec -it rig bash`: `troop serve login` prints a code to type on the sign-in page (`playwright-cli open http://127.0.0.1:8788`); the logs are in `/rig/logs`.

Steer what the models answer with `fake`, never with test commands in chat messages. Each command applies to the next model call; with nothing queued, a call gets "ok":

```sh
fake reply "text"                        # or --think "t" "text": thinks 5 s first, its text "t" at the end
fake tool NAME 'JSON' [NAME 'JSON' ...]  # tool calls; --pace 2s: each that long after the one before
fake error KIND [--reset 5m]             # prompt-too-long, overloaded, rate-limit, usage-limit, auth-expired
fake stall 60s | fake cut                # the stream hangs, or drops halfway
fake log | fake last [--json] | fake clear
```

`--match TEXT` limits a command to the call whose latest message has TEXT. Use it whenever calls run at once: the chat, the compactor (`--match Compaction:`; `--match "Compaction: TEXT"` for the one whose task has TEXT) and subagents.

The fake claude-sub account has one claude.ai connector, Gmail, which Claude Code runs itself: `fake tool mcp__claude_ai_Gmail__list_messages '{}'` (asks no one) or `mcp__claude_ai_Gmail__send_message '{"to":"a@example.com","body":"hi"}'` (an `ask` rule's card).

Touch is tested on a phone, never in desktop Chromium's phone emulation: its made-up touches skip Chrome's own gestures, flings and snapping. The phone is an Android emulator with a current Chrome, in an image of its own; it shares the rig's network, so it has no internet and opens Montroop at `http://127.0.0.1:8788` (it needs `/dev/kvm`; its screen is drawn in software, so give it 6 cores):

```sh
podman build -t troop-test-phone testing/phone
podman run -d --name phone --device /dev/kvm --network container:rig --memory 4g --cpus 6 troop-test-phone
podman logs -f phone                                        # until "phone up", 2 minutes
```

Sign its Chrome in with `podman exec phone phone eval "fetch('/auth', { method: 'POST', body: new URLSearchParams({ code: 'CODE' }) })"`, CODE from `troop serve login`. Touch it through Android's input with `podman exec phone adb shell input swipe X1 Y1 X2 Y2 MS` (or `tap X Y`; screen pixels of its 1080x2400), or `phone touch` for a finger on any path, timed as given; read the page with `phone eval JS`; log what a touch does to the tree, frame by frame, with `phone trace` before it and `phone trace dump` after; watch it with `adb shell screenrecord`. A change to how the tree scrolls or snaps passes the batteries on its open tree, each to `0 failed`: `podman exec phone battery vertical`, `battery sideways`, `battery guard`. A rig restarted or made anew needs a new phone.

A real provider answer the fake doesn't know goes in `testing/fake/cases.ts`, every secret stripped (keys, tokens, account, org and user ids, emails, cookies), with where and when it was seen.
