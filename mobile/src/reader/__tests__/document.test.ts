import { readerDocument, parseReaderEvent } from '../document';
import { defaultPreferences } from '../../library/types';
test('reader scripts compile for a new book and a saved reading position', () => {
  for (const location of [null, 'epubcfi(/6/2!/4/2:1)']) {
    const html = readerDocument('UEs=', location, defaultPreferences);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(() => new Function(script[1])).not.toThrow();
  }
});
test('accepts a location while bounding progress and ignores malformed messages', () => {
  expect(parseReaderEvent({ type: 'location', cfi: 'here', progress: 2 })).toEqual({ type: 'location', cfi: 'here', progress: 1, chapter: '' });
  expect(parseReaderEvent({ type: 'location', progress: NaN })).toBeNull();
});
