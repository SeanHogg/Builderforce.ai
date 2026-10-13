/**
 * Single-page navigation: a `pushState` / `replaceState` / `popstate` that
 * changes the pathname is a new page. The history methods are wrapped, not
 * replaced, and restored on stop if nobody wrapped them after us.
 */

export function watchNavigation(onPath: (path: string) => void): () => void {
  let last = location.pathname;
  const check = () => {
    const path = location.pathname;
    if (path === last) return;
    last = path;
    onPath(path);
  };

  const original = { push: history.pushState, replace: history.replaceState };
  const wrappedPush: History['pushState'] = function (this: History, ...args) {
    const out = original.push.apply(this, args);
    check();
    return out;
  };
  const wrappedReplace: History['replaceState'] = function (this: History, ...args) {
    const out = original.replace.apply(this, args);
    check();
    return out;
  };
  history.pushState = wrappedPush;
  history.replaceState = wrappedReplace;
  window.addEventListener('popstate', check);

  return () => {
    if (history.pushState === wrappedPush) history.pushState = original.push;
    if (history.replaceState === wrappedReplace) history.replaceState = original.replace;
    window.removeEventListener('popstate', check);
  };
}
