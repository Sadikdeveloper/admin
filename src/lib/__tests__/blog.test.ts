import { describe, expect, it, vi } from 'vitest';
import {
  canonicalUrlProblem,
  detectImageType,
  formatBytes,
  fromLocalInputValue,
  inspectImageFile,
  mediaUrlProblem,
  normalizeTag,
  postState,
  POST_STATE_META,
  publicPostUrl,
  publicSiteUrl,
  relativeTime,
  revokeLater,
  scheduleProblem,
  slugify,
  toLocalInputValue,
  truncate,
  SLUG_MAX,
  TAG_MAX,
} from '../blog';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const GIF = new Uint8Array([...Array.from('GIF89a').map(c => c.charCodeAt(0)), 1, 2]);
const WEBP = new Uint8Array([...Array.from('RIFF').map(c => c.charCodeAt(0)), 1, 2, 3, 4, ...Array.from('WEBP').map(c => c.charCodeAt(0))]);

const fileOf = (bytes: Uint8Array, name: string, type: string) => {
  /* Copy into a plain ArrayBuffer: a Uint8Array<ArrayBufferLike> is not a BlobPart. */
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type });
};

describe('slugify', () => {
  it('matches the backend slugifier', () => {
    expect(slugify('Rown Pay & Cards!')).toBe('rown-pay-and-cards');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
    expect(slugify('Café Résumé — naïve')).toBe('cafe-resume-naive');
    expect(slugify('Version 2.0 (beta)')).toBe('version-2-0-beta');
  });

  it('produces a slug the API will accept', () => {
    for (const title of ['Rown Pay & Cards!', 'Café Résumé', 'a'.repeat(400), '!!!']) {
      const slug = slugify(title);
      if (slug) expect(slug).toMatch(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);
    }
  });

  it('never exceeds the API limit and collapses symbols to nothing', () => {
    expect(slugify('a'.repeat(400))).toHaveLength(SLUG_MAX);
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('normalizeTag', () => {
  it('lowercases, collapses spaces and clips to the API limit', () => {
    expect(normalizeTag('  Payments   API ')).toBe('payments api');
    expect(normalizeTag('A'.repeat(80))).toHaveLength(TAG_MAX);
    /* Tabs are control characters: the API strips them before collapsing spaces. */
    expect(normalizeTag('tab\there')).toBe('tabhere');
    expect(normalizeTag('multi   space')).toBe('multi space');
  });
});

describe('truncate', () => {
  it('leaves short text alone and ellipsises long text', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello world', 6)).toBe('hello…');
    expect(truncate('anything', 0)).toBe('…');
  });
});

describe('formatBytes', () => {
  it('formats sizes the way an operator reads them', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
  });

  it('shows a dash for unknown sizes', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);

  it('describes the past and the future', () => {
    expect(relativeTime(new Date(now), now)).toBe('just now');
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 minutes ago');
    expect(relativeTime(new Date(now + 3 * 86_400_000).toISOString(), now)).toBe('in 3 days');
  });

  it('never throws on junk dates', () => {
    expect(relativeTime(null, now)).toBe('—');
    expect(relativeTime('not a date', now)).toBe('—');
  });
});

describe('datetime-local helpers', () => {
  it('round-trips a local date and time', () => {
    const date = new Date(2026, 9, 12, 9, 5);
    expect(toLocalInputValue(date)).toBe('2026-10-12T09:05');
    expect(fromLocalInputValue('2026-10-12T09:05')?.getTime()).toBe(date.getTime());
  });

  it('returns empty values for unusable input', () => {
    expect(toLocalInputValue(new Date('nonsense'))).toBe('');
    expect(fromLocalInputValue('')).toBeNull();
    expect(fromLocalInputValue('garbage')).toBeNull();
  });
});

describe('scheduleProblem', () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);

  it('requires a date in the near future, but not a year away', () => {
    expect(scheduleProblem(null, now)).toMatch(/pick the date/i);
    expect(scheduleProblem(new Date(now - 60_000), now)).toMatch(/at least a minute/i);
    expect(scheduleProblem(new Date(now + 400 * 86_400_000), now)).toMatch(/more than a year/i);
    expect(scheduleProblem(new Date(now + 2 * 3_600_000), now)).toBeNull();
    expect(scheduleProblem(new Date('nonsense'), now)).toMatch(/could not be read/i);
  });
});

describe('postState', () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);

  it('derives "scheduled" from a published post with a future date', () => {
    expect(postState({ status: 'DRAFT', publishedAt: null }, now)).toBe('draft');
    expect(postState({ status: 'PUBLISHED', publishedAt: null }, now)).toBe('published');
    expect(postState({ status: 'PUBLISHED', publishedAt: new Date(now - 1000).toISOString() }, now)).toBe('published');
    expect(postState({ status: 'PUBLISHED', publishedAt: new Date(now + 86_400_000).toISOString() }, now)).toBe(
      'scheduled',
    );
    expect(postState({ status: 'PUBLISHED', publishedAt: 'nonsense' }, now)).toBe('published');
  });

  it('has a label and CSS class for every state', () => {
    for (const state of ['draft', 'scheduled', 'published'] as const) {
      expect(POST_STATE_META[state].label).toBeTruthy();
      expect(POST_STATE_META[state].className).toBeTruthy();
    }
  });
});

describe('mediaUrlProblem', () => {
  it('accepts https URLs and root-relative paths', () => {
    expect(mediaUrlProblem('')).toBeNull();
    expect(mediaUrlProblem('https://cdn.rown.xyz/blog/a.png')).toBeNull();
    expect(mediaUrlProblem('/blog-media/a.png')).toBeNull();
  });

  it('rejects everything the API would reject', () => {
    expect(mediaUrlProblem('http://cdn.rown.xyz/a.png')).toMatch(/https/i);
    expect(mediaUrlProblem('//cdn.rown.xyz/a.png')).toMatch(/https/i);
    expect(mediaUrlProblem('javascript:alert(1)')).toBeTruthy();
    expect(mediaUrlProblem('data:image/png;base64,AAAA')).toBeTruthy();
    expect(mediaUrlProblem('not a url at all')).toBeTruthy();
    expect(mediaUrlProblem('https://user:pass@cdn.rown.xyz/a.png')).toBeTruthy();
  });
});

describe('canonicalUrlProblem', () => {
  it('requires an absolute https address', () => {
    expect(canonicalUrlProblem('')).toBeNull();
    expect(canonicalUrlProblem('https://rown.xyz/blog/a')).toBeNull();
    expect(canonicalUrlProblem('/blog/a')).toBeTruthy();
    expect(canonicalUrlProblem('http://rown.xyz/blog/a')).toBeTruthy();
  });
});

describe('publicPostUrl', () => {
  it('is hidden until the deployment configures the public site', () => {
    vi.stubEnv('VITE_PUBLIC_SITE_URL', '');
    expect(publicSiteUrl()).toBeNull();
    expect(publicPostUrl('hello')).toBeNull();

    vi.stubEnv('VITE_PUBLIC_SITE_URL', 'https://rown.xyz/');
    expect(publicSiteUrl()).toBe('https://rown.xyz');
    expect(publicPostUrl('hello-world')).toBe('https://rown.xyz/blog/hello-world');
    expect(publicPostUrl('')).toBeNull();

    vi.stubEnv('VITE_PUBLIC_SITE_URL', 'rown.xyz');
    expect(publicSiteUrl()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('detectImageType', () => {
  it('reads the real type from magic bytes', () => {
    expect(detectImageType(PNG)?.contentType).toBe('image/png');
    expect(detectImageType(JPEG)?.contentType).toBe('image/jpeg');
    expect(detectImageType(GIF)?.contentType).toBe('image/gif');
    expect(detectImageType(WEBP)?.contentType).toBe('image/webp');
  });

  it('rejects non-images, whatever the declared type says', () => {
    expect(detectImageType(new Uint8Array([...Array.from('<svg/>').map(c => c.charCodeAt(0))]))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe('inspectImageFile', () => {
  it('accepts a real image', async () => {
    const result = await inspectImageFile(fileOf(PNG, 'a.png', 'image/png'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind.extension).toBe('png');
  });

  it('rejects empty files, oversized files and non-images', async () => {
    expect((await inspectImageFile(fileOf(new Uint8Array(), 'empty.png', 'image/png'))).ok).toBe(false);

    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const tooBig = await inspectImageFile(big);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toMatch(/5 MB/i);

    const text = await inspectImageFile(new File([new TextEncoder().encode('hello')], 'a.txt', { type: 'text/plain' }));
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error).toMatch(/jpeg, png, gif/i);
  });

  it('catches a file whose declared type contradicts its bytes', async () => {
    const spoofed = await inspectImageFile(fileOf(GIF, 'fake.png', 'image/png'));
    expect(spoofed.ok).toBe(false);
    if (!spoofed.ok) expect(spoofed.error).toMatch(/labelled image\/png/i);
  });
});

describe('revokeLater', () => {
  it('frees object URLs on a timer and ignores null', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;

    revokeLater(null);
    revokeLater('blob:mock/1', 1000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:mock/1');
  });
});
