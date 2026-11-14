import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { readerDocument, parseReaderEvent, type ReaderEvent, type ReaderHandle } from './document';
import type { LibraryBook, ReaderPreferences } from '../library/types';
export type SurfaceProps = {
  book: LibraryBook;
  preferences: ReaderPreferences;
  onEvent(event: ReaderEvent): void;
};
export const ReaderSurface = forwardRef<ReaderHandle, SurfaceProps>(function ReaderSurface(
  { book, preferences, onEvent },
  ref,
) {
  const webview = useRef<WebView<{}>>(null);
  const initial = useRef({ book, preferences });
  initial.current = { book, preferences };
  const [generation, setGeneration] = useState(0);
  const callback = useRef(onEvent);
  callback.current = onEvent;
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    new File(initial.current.book.fileUri)
      .base64()
      .then((data) => {
        if (mounted)
          setHtml(
            readerDocument(
              data,
              initial.current.book.location,
              initial.current.preferences,
              initial.current.book.progress,
            ),
          );
      })
      .catch(() =>
        callback.current({
          type: 'error',
          message: 'The saved EPUB is missing or unavailable. Import the book again to restore it.',
        }),
      );
    return () => {
      mounted = false;
    };
  }, [generation]);
  useImperativeHandle(
    ref,
    () => ({
      command(value) {
        webview.current?.injectJavaScript(
          `window.readerCommand(${JSON.stringify(value).replace(/</g, '\\u003c')});true;`,
        );
      },
    }),
    [],
  );
  return html ? (
    <WebView<{}>
      ref={webview}
      source={{ html, baseUrl: 'about:blank' }}
      originWhitelist={['about:*', 'blob:*']}
      onShouldStartLoadWithRequest={(request) =>
        request.url === 'about:blank' ||
        request.url.startsWith('blob:') ||
        request.url.startsWith('about:srcdoc')
      }
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      scrollEnabled={false}
      onMessage={(event) => {
        try {
          const message = parseReaderEvent(JSON.parse(event.nativeEvent.data));
          if (message) callback.current(message);
        } catch {}
      }}
      onError={() =>
        callback.current({
          type: 'error',
          message: 'The reader could not start. Close and reopen this book.',
        })
      }
      onContentProcessDidTerminate={() => {
        setHtml(null);
        setGeneration((value) => value + 1);
      }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    />
  ) : null;
});
