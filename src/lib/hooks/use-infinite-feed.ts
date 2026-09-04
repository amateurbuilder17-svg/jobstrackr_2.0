"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FetchGuardError } from "@/lib/net/guarded-fetch";

interface SavedFeedCache<T> {
  filterKey: string;
  items: T[];
  nextCursor: string | null;
  scrollY: number;
  timestamp: number;
}

const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface UseInfiniteFeedOptions<T> {
  storagePrefix: string;
  filterKey: string;
  initialItems: T[];
  initialCursor: string | null;
  fetchNextPage: (cursor: string) => Promise<{ items: T[]; nextCursor: string | null }>;
}

function getStoredFeed<T>(storageKey: string, filterKey: string): SavedFeedCache<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "filterKey" in parsed &&
      "items" in parsed &&
      Array.isArray((parsed as SavedFeedCache<T>).items)
    ) {
      const cached = parsed as SavedFeedCache<T>;
      const isFresh = Date.now() - cached.timestamp < CACHE_MAX_AGE_MS;
      if (isFresh && cached.filterKey === filterKey && cached.items.length > 0) {
        return cached;
      }
    }
  } catch {
    // Ignore sessionStorage or JSON parse errors
  }
  return null;
}

export function useInfiniteFeed<T extends { id: string | number }>({
  storagePrefix,
  filterKey,
  initialItems,
  initialCursor,
  fetchNextPage,
}: UseInfiniteFeedOptions<T>) {
  const storageKey = `jt_feed_${storagePrefix}_${filterKey}`;

  // Initial state initialized from sessionStorage if returning to the same filter
  const [items, setItems] = useState<T[]>(() => {
    const cached = getStoredFeed<T>(storageKey, filterKey);
    return cached ? cached.items : initialItems;
  });

  const [nextCursor, setNextCursor] = useState<string | null>(() => {
    const cached = getStoredFeed<T>(storageKey, filterKey);
    return cached ? cached.nextCursor : initialCursor;
  });

  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  /**
   * Seconds until another attempt is worth making, or zero.
   *
   * The observer already stops on `isError`, so the automatic half of the loop
   * was never the problem. The Retry button was: it is offered the instant the
   * failure renders, and on a dead server a frustrated person can press it as
   * fast as they like. `guardedFetch` refuses those presses in memory once the
   * endpoint has failed three times running, and this is that refusal made
   * visible — a disabled button counting down beats one that looks live and
   * silently does nothing.
   */
  const [retryIn, setRetryIn] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When filterKey prop changes, adjust state during render
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    const cached = getStoredFeed<T>(storageKey, filterKey);
    setItems(cached ? cached.items : initialItems);
    setNextCursor(cached ? cached.nextCursor : initialCursor);
    setIsError(false);
    setRetryIn(0);
  }

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFetchingRef = useRef(false);
  const nextCursorRef = useRef(nextCursor);
  const itemsRef = useRef(items);

  // Sync refs in effects
  useEffect(() => {
    nextCursorRef.current = nextCursor;
    itemsRef.current = items;
  }, [nextCursor, items]);

  // Restore scroll position on initial mount if we restored from cache
  useEffect(() => {
    const cached = getStoredFeed<T>(storageKey, filterKey);
    if (cached && cached.scrollY > 0) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: cached.scrollY, behavior: "instant" });
      });
    }
  }, [filterKey, storageKey]);

  // Save current feed state to sessionStorage
  const persistState = useCallback(
    (customScrollY?: number) => {
      if (typeof window === "undefined") return;
      try {
        const payload: SavedFeedCache<T> = {
          filterKey,
          items: itemsRef.current,
          nextCursor: nextCursorRef.current,
          scrollY: customScrollY ?? window.scrollY,
          timestamp: Date.now(),
        };
        sessionStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        // Ignore sessionStorage quota or privacy mode errors
      }
    },
    [filterKey, storageKey],
  );

  // Track scroll position periodically and on page leave
  useEffect(() => {
    if (typeof window === "undefined") return;

    let timeoutId: number | null = null;
    const handleScroll = () => {
      if (timeoutId) return;
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        persistState();
      }, 200);
    };

    const handleBeforeUnload = () => {
      persistState();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, [persistState]);

  /** Counts a cooldown down to zero, so the button can say when. */
  const startCountdown = useCallback((ms: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);

    const seconds = Math.ceil(ms / 1000);
    setRetryIn(seconds);
    if (seconds <= 0) return;

    countdownRef.current = setInterval(() => {
      setRetryIn((remaining) => {
        if (remaining <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Load next page function
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || isFetchingRef.current) return;

    isFetchingRef.current = true;
    setIsLoading(true);
    setIsError(false);

    try {
      const response = await fetchNextPage(cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        const added = response.items.filter((i) => !seen.has(i.id));
        const updated = [...prev, ...added];
        itemsRef.current = updated;
        return updated;
      });
      setNextCursor(response.nextCursor);
      nextCursorRef.current = response.nextCursor;
      persistState();
    } catch (cause) {
      setIsError(true);
      // `guardedFetch` says how long it intends to leave the endpoint alone.
      // Anything else — a malformed body, a 4xx — is not an outage, so the
      // button stays live and a press is worth making.
      if (cause instanceof FetchGuardError && cause.retryInMs > 0) {
        startCountdown(cause.retryInMs);
      }
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [fetchNextPage, persistState, startCountdown]);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || isLoading || isError) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          void loadMore();
        }
      },
      {
        root: null,
        rootMargin: "400px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [nextCursor, isLoading, isError, loadMore]);

  // Capture link clicks on list items to immediately freeze scroll position
  const recordClickPosition = useCallback(() => {
    persistState(window.scrollY);
  }, [persistState]);

  return {
    items,
    nextCursor,
    isLoading,
    isError,
    /** Seconds until Retry is worth offering again. Zero means now. */
    retryIn,
    loadMore,
    sentinelRef,
    recordClickPosition,
  };
}
