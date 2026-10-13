import { describe, expect, it } from 'vitest';
import { navGuard } from '../nav-guard';
import type { NavGuard } from '../nav-guard';
import { isAnalyticsRoute, parseRoute, routeToHash, routesEqual } from '../routes';
import type { Route } from '../routes';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseRoute', () => {
  it('keeps the analytics hashes working exactly as before', () => {
    expect(parseRoute('')).toEqual({ name: 'overview' });
    expect(parseRoute('#')).toEqual({ name: 'overview' });
    expect(parseRoute('#/')).toEqual({ name: 'overview' });
    expect(parseRoute('overview')).toEqual({ name: 'overview' });
    expect(parseRoute('#/transactions')).toEqual({ name: 'transactions' });
    expect(parseRoute('#/deposits')).toEqual({ name: 'deposits' });
    expect(parseRoute('#/topups')).toEqual({ name: 'topups' });
    expect(parseRoute('#/providers')).toEqual({ name: 'providers' });
    expect(parseRoute('#/users')).toEqual({ name: 'users' });
  });

  it('parses every CMS address', () => {
    expect(parseRoute('#/blog')).toEqual({ name: 'blog' });
    expect(parseRoute('#/blog/new')).toEqual({ name: 'blog-editor', postId: null });
    expect(parseRoute(`#/blog/${UUID}`)).toEqual({ name: 'blog-editor', postId: UUID });
    expect(parseRoute(`#/blog/${UUID}/edit`)).toEqual({ name: 'blog-editor', postId: UUID });
    expect(parseRoute('#/blog/media')).toEqual({ name: 'blog-media' });
    expect(parseRoute('#/blog/comments')).toEqual({ name: 'blog-comments' });
  });

  it('falls back to the post list for anything it does not recognise', () => {
    expect(parseRoute('#/blog/not-a-uuid')).toEqual({ name: 'blog' });
    expect(parseRoute('#/blog/media/extra/deep')).toEqual({ name: 'blog-media' });
    expect(parseRoute('#/nonsense')).toEqual({ name: 'overview' });
    expect(parseRoute('#/BLOG/Comments')).toEqual({ name: 'blog-comments' });
  });

  it('never throws on malformed hashes', () => {
    expect(() => parseRoute('#/%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/%E0%A4%A')).toEqual({ name: 'overview' });
    expect(parseRoute('#/blog?status=DRAFT')).toEqual({ name: 'blog' });
  });
});

describe('routeToHash', () => {
  it('writes the address each route lives at', () => {
    expect(routeToHash({ name: 'overview' })).toBe('#/overview');
    expect(routeToHash({ name: 'blog' })).toBe('#/blog');
    expect(routeToHash({ name: 'blog-editor', postId: null })).toBe('#/blog/new');
    expect(routeToHash({ name: 'blog-editor', postId: UUID })).toBe(`#/blog/${UUID}/edit`);
    expect(routeToHash({ name: 'blog-media' })).toBe('#/blog/media');
    expect(routeToHash({ name: 'blog-comments' })).toBe('#/blog/comments');
  });

  it('round-trips through parseRoute', () => {
    const routes: Route[] = [
      { name: 'overview' },
      { name: 'users' },
      { name: 'blog' },
      { name: 'blog-editor', postId: null },
      { name: 'blog-editor', postId: UUID },
      { name: 'blog-media' },
      { name: 'blog-comments' },
    ];
    for (const route of routes) {
      expect(parseRoute(routeToHash(route))).toEqual(route);
      expect(routesEqual(route, parseRoute(routeToHash(route)))).toBe(true);
    }
  });
});

describe('isAnalyticsRoute', () => {
  it('separates the analytics screens from the CMS', () => {
    expect(isAnalyticsRoute({ name: 'overview' })).toBe(true);
    expect(isAnalyticsRoute({ name: 'users' })).toBe(true);
    expect(isAnalyticsRoute({ name: 'blog' })).toBe(false);
    expect(isAnalyticsRoute({ name: 'blog-editor', postId: null })).toBe(false);
    expect(isAnalyticsRoute({ name: 'blog-media' })).toBe(false);
    expect(isAnalyticsRoute({ name: 'blog-comments' })).toBe(false);
  });
});

describe('navGuard', () => {
  it('lets navigation through when nobody registered a guard', () => {
    expect(navGuard.check({ name: 'blog' })).toBeNull();
  });

  it('vetoing guard blocks navigation with a message', () => {
    const unregister = navGuard.register(() => 'You have unsaved changes.');
    expect(navGuard.check({ name: 'blog' })).toBe('You have unsaved changes.');
    unregister();
    expect(navGuard.check({ name: 'blog' })).toBeNull();
  });

  it('allowNextChange lets exactly one change through', () => {
    const unregister = navGuard.register(() => 'Unsaved work');
    navGuard.allowNextChange();
    expect(navGuard.check({ name: 'blog-editor', postId: UUID })).toBeNull();
    expect(navGuard.check({ name: 'blog' })).toBe('Unsaved work');
    unregister();
  });

  it('clear() only clears the guard that owns it', () => {
    const first: NavGuard = () => 'first';
    const second: NavGuard = () => 'second';
    navGuard.register(first);
    navGuard.register(second); // the newest screen wins

    navGuard.clear(first); // a stale screen must not clear the current guard
    expect(navGuard.check({ name: 'blog' })).toBe('second');

    navGuard.clear(second);
    expect(navGuard.check({ name: 'blog' })).toBeNull();
  });
});
