"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * URL-backed filter state, for whichever route the component is rendered on.
 *
 * The destination used to be the string `"/jobs"`, written into three separate
 * components. `FilterChips` had exactly one caller — `/updates` — so choosing a
 * category there navigated to the jobs list carrying a `category` parameter
 * that `/jobs` ignores. The filter had never worked, and nothing about the code
 * looked wrong: the bug was a literal that was correct for a caller that did
 * not exist.
 *
 * `usePathname()` removes the class of bug rather than the instance. A filter
 * component now cannot navigate anywhere except the page it is on.
 */
export interface FilterParams {
  params: URLSearchParams;
  /** Replace the whole query string, dropping any pagination cursor. */
  push: (next: URLSearchParams) => void;
  /** Set or clear one parameter. */
  set: (param: string, value: string | null) => void;
}

export function useFilterParams(): FilterParams {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const push = useCallback(
    (next: URLSearchParams) => {
      // A changed filter invalidates the current cursor: keeping it would page
      // through the previous result set, which reads as results going missing.
      next.delete("after");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const set = useCallback(
    (param: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(param, value);
      else next.delete(param);
      push(next);
    },
    [params, push],
  );

  return { params, push, set };
}
