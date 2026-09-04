/**
 * Handing a half-typed search from one route's field to another's.
 *
 * The home page's search bar does not search the home page: focusing it sends
 * the reader to `/jobs`, where the real, server-backed search lives. The term
 * itself travels in `?q=`, which the URL already carries — what does not
 * survive a navigation is the *caret*. Without it the reader taps a field, the
 * page changes underneath them, and the thing they were about to type into is
 * gone.
 *
 * So the departing field leaves a note in `sessionStorage` saying which route
 * is expecting focus, and the arriving field picks it up once and tears it up.
 * `sessionStorage` rather than a query parameter because `?focus=1` would
 * outlive the handoff: it would sit in the URL, get bookmarked, get shared, and
 * re-fire on every back-button return to the page.
 *
 * Every access is wrapped: Safari's private mode throws on `sessionStorage`
 * rather than returning null, and a search field is not worth an error overlay.
 */
const KEY = "jobstrackr:search-handoff";

/** Ask the search field on `pathname` to take focus when it mounts. */
export function requestSearchFocus(pathname: string): void {
  try {
    sessionStorage.setItem(KEY, pathname);
  } catch {
    // No storage — the field simply will not autofocus.
  }
}

/**
 * Claim a pending focus request for `pathname`, if there is one.
 *
 * Reading consumes it, so a later remount — a back navigation, a Fast Refresh —
 * does not steal focus from whatever the reader is doing by then.
 */
export function consumeSearchFocus(pathname: string): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== pathname) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
