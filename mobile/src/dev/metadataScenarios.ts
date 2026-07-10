import type { MetadataCandidate } from '../api/metadata';

const baseCandidate: MetadataCandidate = {
  candidateId: 'fixture-pride',
  confidence: 'high',
  matchReasons: ['Exact ISBN match'],
  work: {
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    firstPublishedYear: 1813,
    language: 'en',
    sourceIds: { open_library: 'OL66554W' },
  },
  edition: {
    title: 'Pride and Prejudice',
    publisher: 'Penguin Classics',
    publishedDate: '2003',
    isbn10: '0141439513',
    isbn13: '9780141439518',
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg',
    sourceIds: { open_library: 'OL7353617M' },
  },
  sources: [
    { provider: 'open_library', workId: 'OL66554W', editionId: 'OL7353617M' },
  ],
};

const alternateCandidate: MetadataCandidate = {
  candidateId: 'fixture-invisible-wells',
  confidence: 'medium',
  matchReasons: ['Title match'],
  work: {
    title: 'The Invisible Man',
    authors: ['H. G. Wells'],
    firstPublishedYear: 1897,
    language: 'en',
    sourceIds: { open_library: 'OL52267W' },
  },
  edition: {
    title: 'The Invisible Man',
    publisher: 'Penguin Classics',
    publishedDate: '2005',
    isbn10: '014143998X',
    isbn13: '9780141439983',
    coverUrl: null,
    sourceIds: { open_library: 'OL24271826M' },
  },
  sources: [
    { provider: 'open_library', workId: 'OL52267W', editionId: 'OL24271826M' },
  ],
};

const longTitleCandidate: MetadataCandidate = {
  ...baseCandidate,
  candidateId: 'fixture-long-title',
  confidence: 'medium',
  matchReasons: ['Title match', 'Author match'],
  work: {
    ...baseCandidate.work,
    title: 'The Extremely Long and Unexpectedly Detailed Book Title That Must Still Fit on a Small Screen',
    authors: ['Alexandra Example-With-A-Very-Long-Name'],
  },
  edition: {
    ...baseCandidate.edition,
    title: 'The Extremely Long and Unexpectedly Detailed Book Title That Must Still Fit on a Small Screen',
    publisher: null,
    publishedDate: null,
    coverUrl: null,
  },
};

export const metadataScenarios = {
  one: [baseCandidate],
  ambiguous: [
    {
      ...baseCandidate,
      candidateId: 'fixture-invisible-ellison',
      confidence: 'medium' as const,
      matchReasons: ['Title match'],
      work: {
        ...baseCandidate.work,
        title: 'Invisible Man',
        authors: ['Ralph Ellison'],
        firstPublishedYear: 1952,
      },
      edition: {
        ...baseCandidate.edition,
        title: 'Invisible Man',
        publisher: 'Vintage International',
        publishedDate: '1995',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9780679732761-L.jpg',
      },
    },
    alternateCandidate,
  ],
  longTitle: [longTitleCandidate],
};
