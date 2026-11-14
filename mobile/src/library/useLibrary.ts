import { useCallback, useEffect, useState } from 'react';
import { libraryRepository } from './repository';
import {
  defaultPreferences,
  type LibraryBook,
  type LibraryRepository,
  type ReaderPreferences,
} from './types';

export function useLibrary(repository: LibraryRepository = libraryRepository) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [preferences, setPreferencesState] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setBooks(await repository.list());
      setPreferencesState(await repository.preferences());
      setError(null);
    } catch {
      setError('Your library could not be loaded. Your saved files have not been removed.');
    } finally {
      setLoading(false);
    }
  }, [repository]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const upsert = useCallback(
    (book: LibraryBook) =>
      setBooks((items) => [book, ...items.filter((item) => item.id !== book.id)]),
    [],
  );
  const update = useCallback(
    async (id: string, patch: Parameters<LibraryRepository['update']>[1]) => {
      const book = await repository.update(id, patch);
      upsert(book);
      return book;
    },
    [repository, upsert],
  );
  const remove = useCallback(
    async (id: string) => {
      await repository.remove(id);
      setBooks((items) => items.filter((book) => book.id !== id));
    },
    [repository],
  );
  const setPreferences = useCallback(
    async (value: ReaderPreferences) => {
      await repository.setPreferences(value);
      setPreferencesState(value);
    },
    [repository],
  );
  return {
    books,
    loading,
    error,
    reload,
    upsert,
    update,
    remove,
    repository,
    preferences,
    setPreferences,
  };
}
