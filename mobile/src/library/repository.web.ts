import { get, set, del, entries } from 'idb-keyval';
import { inspectEpub } from './inspectEpub';
import { defaultPreferences, type LibraryBook, type LibraryRepository } from './types';

let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>) {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}
export const libraryRepository: LibraryRepository = {
  async list() {
    await writes;
    return (await entries())
      .filter(([key]) => String(key).startsWith('book:'))
      .map(([, value]) => value as LibraryBook)
      .sort((a, b) => (b.openedAt ?? b.addedAt).localeCompare(a.openedAt ?? a.addedAt));
  },
  async importFile(uri, details = {}) {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('This EPUB could not be loaded. Try again.');
    const blob = await response.blob();
    if (blob.size > 25_000_000) throw new Error('Choose an EPUB smaller than 25 MB.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const metadata = await inspectEpub(bytes);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const id = Array.from(new Uint8Array(hash), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    return serialized(async () => {
      const existing = await get<LibraryBook>(`book:${id}`);
      if (existing) {
        await set(`file:${id}`, bytes);
        return existing;
      }
      const book: LibraryBook = {
        ...metadata,
        ...details,
        id,
        fileUri: `indexeddb:${id}`,
        addedAt: new Date().toISOString(),
        openedAt: null,
        location: null,
        progress: 0,
        bookmarks: [],
      };
      await set(`file:${id}`, bytes);
      await set(`book:${id}`, book);
      return book;
    });
  },
  update(id, patch) {
    return serialized(async () => {
      const book = await get<LibraryBook>(`book:${id}`);
      if (!book) throw new Error('This book is no longer in your library.');
      const updated = { ...book, ...patch };
      await set(`book:${id}`, updated);
      return updated;
    });
  },
  remove(id) {
    return serialized(async () => {
      await del(`book:${id}`);
      await del(`file:${id}`);
    });
  },
  async preferences() {
    return { ...defaultPreferences, ...(await get('preferences')) };
  },
  async setPreferences(value) {
    await set('preferences', value);
  },
};
