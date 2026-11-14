import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { get } from 'idb-keyval';
import { readerDocument, parseReaderEvent, type ReaderEvent, type ReaderHandle } from './document';
import type { LibraryBook, ReaderPreferences } from '../library/types';
export const ReaderSurface = forwardRef<
  ReaderHandle,
  {
    book: LibraryBook;
    preferences: ReaderPreferences;
    onEvent(event: ReaderEvent): void;
  }
>(function ReaderSurface({ book, preferences, onEvent }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef({ book, preferences });
  const callback = useRef(onEvent);
  callback.current = onEvent;
  const [html, setHtml] = useState('');
  useEffect(() => {
    let active = true;
    get<Uint8Array>(`file:${initial.current.book.id}`)
      .then((bytes) => {
        if (!bytes) throw new Error('Missing file');
        const chunks: string[] = [];
        for (let offset = 0; offset < bytes.length; offset += 8192)
          chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
        if (active)
          setHtml(
            readerDocument(
              btoa(chunks.join('')),
              initial.current.book.location,
              initial.current.preferences,
              initial.current.book.progress,
            ),
          );
      })
      .catch(() =>
        callback.current({
          type: 'error',
          message: 'This saved file could not be loaded. Import the EPUB again.',
        }),
      );
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data?.bookReader) return;
      const message = parseReaderEvent(event.data);
      if (message) callback.current(message);
    };
    window.addEventListener('message', receive);
    return () => {
      active = false;
      window.removeEventListener('message', receive);
    };
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      command(value) {
        frame.current?.contentWindow?.postMessage({ bookReaderCommand: true, command: value }, '*');
      },
    }),
    [],
  );
  return (
    <iframe
      ref={frame}
      title={book.title}
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        border: 0,
        background: 'transparent',
      }}
    />
  );
});
