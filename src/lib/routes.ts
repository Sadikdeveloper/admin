import { PAGES } from '../types';
import type { Page } from '../types';

/**
 * Hash routing for the console. The analytics screens keep their original
 * single-segment hashes; the CMS adds nested ones (`#/blog/<id>/edit`).
 */
export type Route =
  | { name: Page }
  | { name: 'blog' }
  | { name: 'blog-editor'; postId: string | null }
  | { name: 'blog-media' }
  | { name: 'blog-comments' };

export type RouteName = Route['name'];

export const CONTENT_ROUTES: RouteName[] = ['blog', 'blog-editor', 'blog-media', 'blog-comments'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A stray "%" in the hash should never take the console down.
    return segment;
  }
}

export function parseRoute(hash: string): Route {
  const raw = (hash ?? '').replace(/^#\/?/, '').trim();
  if (!raw) return { name: 'overview' };

  const path = raw.split('?')[0];
  const segments = path
    .split('/')
    .filter(Boolean)
    .map(safeDecode);

  /* Hand-typed hashes may vary in case; everything else is generated lowercase. */
  if (segments[0].toLowerCase() === 'blog') {
    if (segments.length === 1) return { name: 'blog' };
    const second = segments[1].toLowerCase();
    if (second === 'media') return { name: 'blog-media' };
    if (second === 'comments') return { name: 'blog-comments' };
    if (second === 'new') return { name: 'blog-editor', postId: null };
    if (UUID_PATTERN.test(segments[1]) && (segments.length === 2 || segments[2]?.toLowerCase() === 'edit')) {
      return { name: 'blog-editor', postId: segments[1] };
    }
    return { name: 'blog' };
  }

  const page = segments[0].toLowerCase() as Page;
  return (PAGES as readonly string[]).includes(page) ? { name: page } : { name: 'overview' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'blog':
      return '#/blog';
    case 'blog-editor':
      return route.postId ? `#/blog/${route.postId}/edit` : '#/blog/new';
    case 'blog-media':
      return '#/blog/media';
    case 'blog-comments':
      return '#/blog/comments';
    default:
      return `#/${route.name}`;
  }
}

export function routesEqual(a: Route, b: Route): boolean {
  return routeToHash(a) === routeToHash(b);
}

export function isAnalyticsRoute(route: Route): route is { name: Page } {
  return (PAGES as readonly string[]).includes(route.name);
}
