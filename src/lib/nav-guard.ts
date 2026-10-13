import type { Route } from './routes';

/**
 * A screen can veto navigation while it holds unsaved work. The editor
 * registers a guard that returns a warning message; the shell turns that into
 * a "leave anyway?" dialog instead of silently discarding an article.
 */
export type NavGuard = (target: Route) => string | null;

let guard: NavGuard | null = null;
let allowNextChange = false;

export const navGuard = {
  register(next: NavGuard): () => void {
    guard = next;
    return () => {
      if (guard === next) guard = null;
    };
  },

  clear(next?: NavGuard): void {
    if (!next || guard === next) guard = null;
  },

  /**
   * Lets exactly one hash change through without prompting. Used when a newly
   * created draft swaps `#/blog/new` for its real `#/blog/<id>/edit` address.
   */
  allowNextChange(): void {
    allowNextChange = true;
  },

  check(target: Route): string | null {
    if (allowNextChange) {
      allowNextChange = false;
      return null;
    }
    return guard ? guard(target) : null;
  },
};
