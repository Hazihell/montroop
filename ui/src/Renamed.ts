// what this browser kept under the app's earlier name ("ki.…"), moved
// once to its keys now, before any module reads them
for (const store of [localStorage, sessionStorage]) {
  for (const key of Object.keys(store).filter((k) => k.startsWith("ki."))) {
    const now = "kunumy." + key.slice(3);
    if (store.getItem(now) === null) {
      store.setItem(now, store.getItem(key) ?? "");
    }
    store.removeItem(key);
  }
}
