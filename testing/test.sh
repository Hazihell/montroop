#!/bin/bash
# The test suite (`bun run test [path ...]`), in namespaces of its own: no
# network, so no real model is ever called (the fake models answer as the
# vendors' hosts), its own processes, ports, /etc/hosts and home, on a
# tmpfs gone with it, and no systemd, so work sessions' holders run
# detached.
set -eu
cd "$(dirname "$0")/.."
NS=(unshare --user --map-root-user --mount --net --pid --fork --mount-proc)
if [ "${KNY_TEST_DIR:-}" = "" ] || [ $$ != 1 ]; then
  "${NS[@]}" true 2> /dev/null || {
    echo "The suite runs in a user namespace of its own: this system refuses them to unprivileged users (on Ubuntu: sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0)." >&2
    exit 1
  }
  KNY_TEST_DIR=$(mktemp -d -t kny-test.XXXXXX)
  trap 'rmdir "$KNY_TEST_DIR"' EXIT
  export KNY_TEST_DIR KNY_TEST_BUN="${KNY_TEST_BUN:-$(bun -e "console.log(process.execPath)")}"
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  "${NS[@]}" "$0" "$@"
  exit
fi

T=$KNY_TEST_DIR
mount -t tmpfs -o mode=700 tmpfs "$T"
ip link set lo up
HOSTS="api.anthropic.com claude.com platform.claude.com console.anthropic.com mcp-proxy.anthropic.com claude.ai api.openai.com auth.openai.com chatgpt.com"
echo "127.0.0.1 localhost $HOSTS" > "$T/hosts"
mount --bind "$T/hosts" /etc/hosts

mkdir -p "$T/certs" "$T/bin" "$T/home" "$T/run" "$T/tmp"
(
  cd "$T/certs"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -subj "/CN=Kunumy tests" 2> /dev/null
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=fake" 2> /dev/null
  echo "subjectAltName=DNS:${HOSTS// /,DNS:}" > san.ext
  openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -extfile san.ext -out server.pem 2> /dev/null
)
ln -s "$KNY_TEST_BUN" "$T/bin/bun"
unset DBUS_SESSION_BUS_ADDRESS
export PATH="$T/bin:$PATH" HOME="$T/home" XDG_RUNTIME_DIR="$T/run" XDG_CONFIG_HOME="$T/home/.config" XDG_DATA_HOME="$T/home/.local/share" XDG_CACHE_HOME="$T/home/.cache" NODE_EXTRA_CA_CERTS="$T/certs/ca.pem" TMPDIR="$T/tmp"

if [ ! -f ui/dist/files.ts ] || [ -n "$(find ui/src ui/index.html vite.config.ts -newer ui/dist/files.ts -print -quit)" ]; then
  bun run ui > "$T/ui.log" 2>&1 || { cat "$T/ui.log"; exit 1; }
fi

bun testing/fake/server.ts "$T/certs" > "$T/fake.log" 2>&1 &
for _ in $(seq 100); do grep -q "fake up" "$T/fake.log" && break; sleep 0.05; done
grep -q "fake up" "$T/fake.log" || { cat "$T/fake.log"; exit 1; }

bun test --parallel --timeout 30000 "${@:-testing/}"
