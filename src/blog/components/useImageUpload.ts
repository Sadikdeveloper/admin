import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlogMediaAsset } from '../../api/blog';
import { describeUploadError, uploadBlogImage } from '../../lib/blog-images';
import type { UploadProblem } from '../../lib/blog-images';

export type UploadItem = {
  id: number;
  name: string;
  size: number;
  status: 'preparing' | 'uploading' | 'done' | 'error';
  problem?: UploadProblem;
  asset?: BlogMediaAsset;
  previewUrl?: string;
};

export type UploadResult = { ok: true; asset: BlogMediaAsset } | { ok: false; problem: UploadProblem };

let nextItemId = 1;

/**
 * Sequential image uploads with per-file state.
 *
 * One file at a time keeps us inside the API's 15-uploads-per-minute limit and
 * makes failures easy to read. A rate-limit or storage-configuration failure
 * stops the rest of the queue instead of hammering the same error.
 */
export function useImageUpload() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [storageProblem, setStorageProblem] = useState<UploadProblem | null>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => {
    const created = previews.current;
    return () => {
      created.forEach(url => URL.revokeObjectURL(url));
      created.length = 0;
    };
  }, []);

  const patchItem = useCallback((id: number, patch: Partial<UploadItem>) => {
    setItems(current => current.map(item => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, options: { track?: boolean } = {}): Promise<UploadResult> => {
      const track = options.track ?? false;
      const id = nextItemId++;
      let previewUrl: string | undefined;

      if (track) {
        try {
          previewUrl = URL.createObjectURL(file);
          previews.current.push(previewUrl);
        } catch {
          // Object URLs are a nicety; a failed preview must not block the upload.
          previewUrl = undefined;
        }
        setItems(current => [
          { id, name: file.name || 'image', size: file.size, status: 'preparing', previewUrl },
          ...current,
        ]);
      }

      if (track) patchItem(id, { status: 'uploading' });

      try {
        const asset = await uploadBlogImage(file);
        if (track) patchItem(id, { status: 'done', asset });
        setStorageProblem(null);
        return { ok: true, asset };
      } catch (error) {
        const problem = describeUploadError(error);
        if (problem.kind === 'storage') setStorageProblem(problem);
        if (track) patchItem(id, { status: 'error', problem });
        return { ok: false, problem };
      }
    },
    [patchItem],
  );

  const uploadFiles = useCallback(
    async (files: File[]): Promise<UploadResult[]> => {
      if (!files.length) return [];
      setBusy(true);
      const results: UploadResult[] = [];

      for (const [index, file] of files.entries()) {
        const result = await uploadOne(file, { track: true });
        results.push(result);

        if (!result.ok && (result.problem.kind === 'rate' || result.problem.kind === 'storage')) {
          // The rest would fail the same way; say so instead of retrying.
          const remaining = files.slice(index + 1);
          if (remaining.length) {
            const placeholders = remaining.map(remainingFile => ({
              id: nextItemId++,
              name: remainingFile.name || 'image',
              size: remainingFile.size,
              status: 'error' as const,
              problem: result.problem,
            }));
            setItems(current => [...placeholders.reverse(), ...current]);
            results.push(...remaining.map(() => result));
          }
          break;
        }
      }

      setBusy(false);
      return results;
    },
    [uploadOne],
  );

  const dismissItem = useCallback((id: number) => {
    setItems(current => {
      const target = current.find(item => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previews.current = previews.current.filter(url => url !== target.previewUrl);
      }
      return current.filter(item => item.id !== id);
    });
  }, []);

  const clearItems = useCallback(() => {
    setItems(current => {
      current.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    previews.current = [];
  }, []);

  return {
    items,
    busy,
    storageProblem,
    setStorageProblem,
    uploadFiles,
    uploadOne,
    dismissItem,
    clearItems,
  };
}
