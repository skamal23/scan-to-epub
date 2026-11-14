import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: false,
});
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const label = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'object' && value !== null
      ? String((value as Record<string, unknown>)['#text'] ?? '')
      : '';
const safePath = (path: string) =>
  !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..');

export async function inspectEpub(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 25_000_000)
    throw new Error('Choose an EPUB smaller than 25 MB.');
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw new Error('This file is not a readable EPUB. Choose another file.');
  });
  const files = Object.values(zip.files);
  if (files.length > 10_000) throw new Error('This EPUB contains too many files.');
  let expanded = 0;
  for (const file of files) {
    const info = file as typeof file & {
      unsafeOriginalName?: string;
      _data?: { uncompressedSize?: number };
    };
    if (!safePath(info.unsafeOriginalName ?? file.name))
      throw new Error('This EPUB contains an invalid file path.');
    expanded += info._data?.uncompressedSize ?? 0;
    if (expanded > 100_000_000) throw new Error('This EPUB is too large to open safely.');
  }
  async function text(path: string) {
    const file = zip.file(path);
    if (!file) throw new Error('This EPUB is incomplete. Try another edition.');
    const size = (file as typeof file & { _data?: { uncompressedSize: number } })._data
      ?.uncompressedSize;
    if (size && size > 2_000_000) throw new Error('This EPUB contains an unusually large chapter.');
    return file.async('string');
  }
  if ((await text('mimetype')).trim() !== 'application/epub+zip')
    throw new Error('Choose a valid EPUB file.');
  const container = parser.parse(await text('META-INF/container.xml'));
  const packagePath = array<any>(container.container?.rootfiles?.rootfile)[0]?.['@_full-path'];
  if (typeof packagePath !== 'string' || !safePath(packagePath))
    throw new Error('The EPUB has no readable book content.');
  if (zip.file('META-INF/encryption.xml')) {
    const encryption = await text('META-INF/encryption.xml');
    const algorithms = [...encryption.matchAll(/Algorithm\s*=\s*["']([^"']+)/g)];
    if (
      !algorithms.length ||
      algorithms.some((match) => match[1] !== 'http://www.idpf.org/2008/embedding')
    ) {
      throw new Error('This book is protected. Import a DRM-free EPUB.');
    }
  }
  for (const file of files) {
    if (/\.(?:xhtml|html|htm|svg|css)$/i.test(file.name)) {
      const markup = await text(file.name);
      if (/<\s*(?:script|iframe|object|embed)\b|\bon\w+\s*=|javascript\s*:/i.test(markup)) {
        throw new Error(
          'This interactive EPUB is not supported. Choose a standard reading edition.',
        );
      }
      if (
        /(?:src\s*=\s*["']\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import)/i.test(
          markup,
        )
      ) {
        throw new Error('This EPUB needs external content. Choose a complete offline edition.');
      }
    }
  }
  const opf = parser.parse(await text(packagePath)).package;
  if (!opf?.spine?.itemref) throw new Error('This EPUB has no readable chapters.');
  const metadata = opf.metadata ?? {};
  const items = array<any>(opf.manifest?.item);
  const coverId = array<any>(metadata.meta).find((item) => item['@_name'] === 'cover')?.[
    '@_content'
  ];
  const cover = items.find(
    (item) =>
      String(item['@_properties'] ?? '')
        .split(' ')
        .includes('cover-image') || item['@_id'] === coverId,
  );
  let coverUri: string | null = null;
  if (cover && /^image\/(jpeg|png|webp)$/.test(cover['@_media-type'])) {
    const base = packagePath.includes('/')
      ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1)
      : '';
    const path = base + decodeURIComponent(cover['@_href']);
    const file = safePath(path) ? zip.file(path) : null;
    const size = (file as unknown as { _data?: { uncompressedSize: number } } | null)?._data
      ?.uncompressedSize;
    if (file && size && size <= 2_000_000)
      coverUri = `data:${cover['@_media-type']};base64,${await file.async('base64')}`;
  }
  return {
    title: label(array(metadata.title)[0]).trim() || 'Untitled book',
    authors: array(metadata.creator).map(label).filter(Boolean),
    coverUri,
  };
}
