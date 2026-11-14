export type Bookmark = { cfi: string; label: string; createdAt: string };
export type LibraryBook = {
  id: string;
  title: string;
  authors: string[];
  coverUri: string | null;
  fileUri: string;
  addedAt: string;
  openedAt: string | null;
  location: string | null;
  progress: number;
  bookmarks: Bookmark[];
  source?: {
    name: string;
    url: string;
    license: string;
    attribution?: string | null;
  };
};
export type ReaderPreferences = {
  theme: 'light' | 'sepia' | 'dark';
  fontSize: number;
  font: 'serif' | 'sans-serif';
  lineHeight: number;
};
export const defaultPreferences: ReaderPreferences = {
  theme: 'light',
  fontSize: 19,
  font: 'serif',
  lineHeight: 1.7,
};
export type ImportDetails = Partial<Pick<LibraryBook, 'title' | 'authors' | 'source'>>;
export interface LibraryRepository {
  list(): Promise<LibraryBook[]>;
  importFile(uri: string, details?: ImportDetails): Promise<LibraryBook>;
  update(
    id: string,
    patch: Partial<
      Pick<LibraryBook, 'title' | 'authors' | 'location' | 'progress' | 'openedAt' | 'bookmarks'>
    >,
  ): Promise<LibraryBook>;
  remove(id: string): Promise<void>;
  preferences(): Promise<ReaderPreferences>;
  setPreferences(value: ReaderPreferences): Promise<void>;
}
