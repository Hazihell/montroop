// runs before the router reads the history, so it comes first among
// the client's imports

// the home screen, the agent list; every other one sits on top of it
export const TOP = /^\/(team)?$/;

// opened straight on a chat (a notification's tap, a link), the list sits
// under it, so back lands there instead of leaving the app; once per tab
function based(): void {
  const KEY = "ki.based";
  if (sessionStorage.getItem(KEY) !== null) {
    return;
  }
  sessionStorage.setItem(KEY, "1");
  if (TOP.test(location.pathname)) {
    return;
  }
  const here = location.pathname + location.search + location.hash;
  const key = () => Math.random().toString(36).slice(2, 10);
  const [first, second] = [key(), key()];
  history.replaceState({ __TSR_index: 0, key: first, __TSR_key: first }, "", "/");
  history.pushState({ __TSR_index: 1, key: second, __TSR_key: second }, "", here);
}

based();
