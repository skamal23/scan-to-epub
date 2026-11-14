import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { inspectEpub } from './inspectEpub';
import {
  defaultPreferences,
  type LibraryBook,
  type LibraryRepository,
  type ReaderPreferences,
} from './types';

let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  database ??= SQLite.openDatabaseAsync('folio-library.db')
    .then(async (value) => {
      await value.execAsync(
        'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);',
      );
      return value;
    })
    .catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
const directory = () => {
  const folder = new Directory(Paths.document, 'library');
  folder.create({ idempotent: true, intermediates: true });
  return folder;
};
let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}
async function getBook(id: string) {
  const row = await (
    await db()
  ).getFirstAsync<{ data: string }>('SELECT data FROM books WHERE id = ?', id);
  if (!row) return null;
  const book = JSON.parse(row.data) as LibraryBook;
  return { ...book, fileUri: new File(directory(), `${book.id}.epub`).uri };
}
export const libraryRepository: LibraryRepository = {
  async list() {
    await writes;
    const rows = await (await db()).getAllAsync<{ data: string }>('SELECT data FROM books');
    return rows
      .map((row) => {
        const book = JSON.parse(row.data) as LibraryBook;
        return {
          ...book,
          fileUri: new File(directory(), `${book.id}.epub`).uri,
        };
      })
      .sort((a, b) => (b.openedAt ?? b.addedAt).localeCompare(a.openedAt ?? a.addedAt));
  },
  async importFile(uri, details = {}) {
    const input = new File(uri);
    if (input.size > 25_000_000) throw new Error('Choose an EPUB smaller than 25 MB.');
    const bytes = await input.bytes();
    const metadata = await inspectEpub(bytes);
    const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    const id = Array.from(new Uint8Array(hash), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    return serialized(async () => {
      const existing = await getBook(id);
      const file = new File(directory(), `${id}.epub`);
      if (!file.exists) {
        const temporary = new File(directory(), `${id}.partial`);
        try {
          temporary.write(bytes);
          temporary.move(file);
        } finally {
          if (temporary.exists && temporary.uri.endsWith('.partial')) temporary.delete();
        }
      }
      if (existing) return existing;
      const book: LibraryBook = {
        ...metadata,
        ...details,
        id,
        fileUri: file.uri,
        addedAt: new Date().toISOString(),
        openedAt: null,
        location: null,
        progress: 0,
        bookmarks: [],
      };
      await (
        await db()
      ).runAsync('INSERT INTO books (id, data) VALUES (?, ?)', id, JSON.stringify(book));
      return book;
    });
  },
  update(id, patch) {
    return serialized(async () => {
      const current = await getBook(id);
      if (!current) throw new Error('This book is no longer in your library.');
      const book = { ...current, ...patch };
      await (
        await db()
      ).runAsync('UPDATE books SET data = ? WHERE id = ?', JSON.stringify(book), id);
      return book;
    });
  },
  remove(id) {
    return serialized(async () => {
      const book = await getBook(id);
      if (!book) return;
      const file = new File(book.fileUri);
      if (file.exists) file.delete();
      await (await db()).runAsync('DELETE FROM books WHERE id = ?', id);
    });
  },
  async preferences() {
    const row = await (
      await db()
    ).getFirstAsync<{ data: string }>('SELECT data FROM settings WHERE id = ?', 'reader');
    return row
      ? ({
          ...defaultPreferences,
          ...JSON.parse(row.data),
        } as ReaderPreferences)
      : defaultPreferences;
  },
  async setPreferences(value) {
    await (
      await db()
    ).runAsync(
      'INSERT OR REPLACE INTO settings (id, data) VALUES (?, ?)',
      'reader',
      JSON.stringify(value),
    );
  },
};
