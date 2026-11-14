import fs from 'node:fs';
import path from 'node:path';
import { inspectEpub } from '../inspectEpub';
test('imports a full Project Gutenberg EPUB and extracts its own metadata and cover', async () => {
  const bytes = new Uint8Array(
    fs.readFileSync(path.join(__dirname, '../../..', 'public/demo/pride-and-prejudice.epub')),
  );
  const metadata = await inspectEpub(bytes);
  expect(metadata.title).toMatch(/Pride and Prejudice/i);
  expect(metadata.authors.join(' ')).toMatch(/Austen/);
  expect(metadata.coverUri).toMatch(/^data:image\//);
});
test('rejects empty and non-EPUB input', async () => {
  await expect(inspectEpub(new Uint8Array())).rejects.toThrow('Choose an EPUB');
  await expect(inspectEpub(new TextEncoder().encode('Not a book'))).rejects.toThrow();
});
