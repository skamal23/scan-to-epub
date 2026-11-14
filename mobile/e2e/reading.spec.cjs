const { test, expect } = require('@playwright/test');
async function scan(page, scenario = 'ready') {
  await page.goto(`/?demo=${scenario}`);
  await page.getByRole('button', { name: 'Scan your first book' }).click();
  await page.getByRole('button', { name: 'Capture cover or detected ISBN' }).click();
}
async function acquire(page) {
  await scan(page);
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByRole('button', { name: 'Table of contents' })).toBeVisible();
  await expect(page.getByText('OPENING YOUR BOOK', { exact: true })).not.toBeVisible();
}
test('scan → confirm → offline library → real EPUB, bookmarks, appearance, search, resume and removal', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await acquire(page);
  await page.getByRole('button', { name: 'Table of contents' }).click();
  await page.getByRole('button', { name: 'Chapter I.', exact: true }).click();
  const chapter = page.frameLocator('iframe[title="Pride and Prejudice"]').frameLocator('iframe');
  await expect(chapter.locator('body')).toContainText('universally acknowledged');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Bookmark this page' }).click();
  await expect(page.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reading appearance' }).click();
  await page.getByRole('button', { name: 'sepia', exact: true }).click();
  await page.getByRole('button', { name: 'Increase text size' }).click();
  await page.screenshot({ path: testInfo.outputPath('appearance.png') });
  await page.getByRole('button', { name: 'Close Reading settings' }).click();
  await page.getByRole('button', { name: 'Search this book' }).click();
  await page.getByLabel('Search text in this book').fill('universally');
  await page.getByRole('button', { name: 'Search book', exact: true }).click();
  await expect(page.getByText(/is a truth universally acknowledged/).first()).toBeVisible();
  await page
    .getByText(/is a truth universally acknowledged/)
    .first()
    .click();
  await expect(page.getByText('Find a passage', { exact: true })).not.toBeVisible();
  await expect(
    chapter.locator('p').filter({ hasText: 'is a truth universally acknowledged' }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('reader.png') });
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Continue reading Pride and Prejudice' }).click();
  await expect(chapter.locator('body')).toContainText('universally acknowledged');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('Let’s try that again')).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('library.png') });
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByText('Nothing on this shelf yet')).toBeVisible();
  await page.getByRole('tab', { name: 'All books', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Discovery & privacy')).toBeVisible();
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Details for Pride and Prejudice' }).click();
  await page.getByRole('button', { name: 'Remove book', exact: true }).click();
  await page.getByRole('button', { name: 'Keep book', exact: true }).click();
  await page.getByRole('button', { name: 'Remove book', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from library', exact: true }).click();
  await expect(page.getByText('Your next read.', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
test('ambiguous scans require choosing a book and can be rejected', async ({ page }) => {
  await scan(page, 'ambiguous');
  await page.getByRole('button', { name: 'Choose The Invisible Man', exact: true }).click();
  await expect(page.getByText('H. G. Wells', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Not this book' }).click();
  await expect(
    page.getByRole('button', { name: 'Choose Invisible Man', exact: true }),
  ).toBeVisible();
});
test('unavailable edition and download failure both recover', async ({ page }) => {
  await scan(page, 'unavailable');
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByRole('button', { name: 'Import my EPUB' })).toBeVisible();
  await page.getByRole('button', { name: 'Try another book' }).click();
  await expect(page.getByLabel('Book title or ISBN')).toBeVisible();
  await scan(page, 'download-error');
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByText('The download was interrupted.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
});
test('permission denial offers manual search; barcode scan reaches confirmation', async ({
  page,
}) => {
  await page.goto('/?demo=permission');
  await page.getByRole('button', { name: 'Scan your first book' }).click();
  await page.getByRole('button', { name: 'Search manually' }).click();
  await expect(page.getByLabel('Book title or ISBN')).toBeVisible();
  await page.goto('/?demo=barcode');
  await page.getByRole('button', { name: 'Scan your first book' }).click();
  await expect(page.getByText('Is this your book?')).toBeVisible();
});
test('imports a real EPUB and deduplicates repeat imports', async ({ page }) => {
  await page.goto('/?demo=ready');
  for (let i = 0; i < 2; i++) {
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import EPUB', exact: true }).click();
    await (await picker).setFiles('public/demo/pride-and-prejudice.epub');
    await page.getByRole('button', { name: 'Close On your shelf' }).click();
  }
  await expect(page.getByText('1 book', { exact: true })).toBeVisible();
});
test('unreadable cover, cancelled recognition, and offline search keep a working way back', async ({
  page,
}) => {
  await scan(page, 'no-match');
  await page.getByRole('button', { name: 'Enter title manually' }).click();
  await expect(page.getByLabel('Book title or ISBN')).toBeVisible();
  await page.goto('/?demo=ready');
  await page.getByRole('button', { name: 'Scan your first book' }).click();
  await page.getByRole('button', { name: 'Capture cover or detected ISBN' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture cover or detected ISBN' })).toBeVisible();
  await page.goto('/?demo=offline');
  await page.getByRole('button', { name: 'Scan your first book' }).click();
  await page.getByRole('button', { name: 'Search manually' }).click();
  await page.getByLabel('Book title or ISBN').fill('A book');
  await page.getByRole('button', { name: 'Find book', exact: true }).click();
  await expect(page.getByText('You’re offline.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Your library', { exact: true })).toBeVisible();
});
test('live catalog → validated download → browser library', async ({ page }) => {
  test.skip(process.env.E2E_LIVE !== '1', 'Requires the live backend and internet');
  await page.goto('/');
  await page.getByRole('button', { name: 'Find a book online' }).click();
  await page.getByLabel('Book title or ISBN').fill('9780141439518');
  await page.getByRole('button', { name: 'Find book', exact: true }).click();
  if (
    await page.getByRole('button', { name: 'Choose Pride and Prejudice', exact: true }).isVisible()
  )
    await page.getByRole('button', { name: 'Choose Pride and Prejudice', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByRole('button', { name: 'Table of contents' })).toBeVisible({
    timeout: 110000,
  });
});
test('small screens keep scan controls visible and long book details reachable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?demo=long-title');
  await page.getByRole('tab', { name: 'Scan a book', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Capture cover or detected ISBN' }),
  ).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Search manually' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('small-scanner.png') });
  await page.getByRole('button', { name: 'Capture cover or detected ISBN' }).click();
  await page.getByRole('button', { name: /Choose The Extremely Long/ }).click();
  await page.getByRole('button', { name: 'Yes, this is my book' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('long-title.png') });
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByRole('button', { name: 'Import my EPUB' })).toBeVisible();
});

test('cached scan lifts the cover continuously into confirmation', async ({ page }, testInfo) => {
  await page.goto('/?demo=ready');
  await page.getByRole('button', { name: 'Scan your first book' }).click();
  await page.screenshot({ path: testInfo.outputPath('camera.png') });
  await page.evaluate(() => {
    window.bookFrames = [];
    const sample = () => {
      const book = document.querySelector('[data-testid="scan-book"]');
      if (book) {
        const { x, y, width, height } = book.getBoundingClientRect();
        window.bookFrames.push({ x, y, width, height });
      }
      if (!document.querySelector('[data-testid="confirmed-book"]')) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Capture cover or detected ISBN' }).click();
  await expect(page.getByTestId('scan-reveal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, this is my book' })).toBeVisible();
  const frames = await page.evaluate(() => window.bookFrames);
  expect(frames.length).toBeGreaterThan(3);
  const confirmed = await page.getByTestId('confirmed-book').boundingBox();
  for (const field of ['x', 'y', 'width', 'height'])
    expect(Math.abs(frames.at(-1)[field] - confirmed[field])).toBeLessThan(3);
  expect(Math.abs(frames[0].width - confirmed.width)).toBeGreaterThan(20);
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('confirmation.png') });
});
test('Reduce Motion and bundled demo work without external catalog requests', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const external = [];
  await page.route('**/*', (route) => {
    if (!new URL(route.request().url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await scan(page);
  await expect(page.getByRole('button', { name: 'Yes, this is my book' })).toBeVisible();
  await expect(page.getByTestId('scan-reveal')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reduced-motion.png') });
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByRole('button', { name: 'Table of contents' })).toBeVisible();
  await expect(page.getByTestId('reader-transition')).not.toBeVisible();
  expect(external).toEqual([]);
});

test('confirmation crossfades only after the first EPUB page is rendered', async ({
  page,
}, testInfo) => {
  await scan(page);
  await page.getByRole('button', { name: 'Yes, this is my book' }).waitFor();
  await page.evaluate(() => {
    window.readerFadeFrames = [];
    let started = false;
    const sample = () => {
      const overlay = document.querySelector('[data-testid="reader-transition"]');
      if (overlay) {
        started = true;
        const publication = document
          .querySelector('iframe')
          ?.contentDocument?.querySelector('iframe')?.contentDocument;
        window.readerFadeFrames.push({
          opacity: Number(getComputedStyle(overlay).opacity),
          pageOpacity: Number(
            getComputedStyle(document.querySelector('[data-testid="reader-page"]')).opacity,
          ),
          pageReady: !!publication?.body?.children.length,
        });
      }
      if (overlay || !started) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Yes, this is my book' }).click();
  await expect(page.getByRole('button', { name: 'Table of contents' })).toBeVisible();
  const frames = await page.evaluate(() => window.readerFadeFrames);
  const fading = frames.filter((frame) => frame.opacity > 0 && frame.opacity < 1);
  expect(fading.length).toBeGreaterThan(3);
  expect(fading.every((frame) => frame.pageReady)).toBe(true);
  expect(fading.some((frame) => frame.opacity > 0.05 && frame.pageOpacity > 0.05)).toBe(false);
  await expect(page.getByTestId('reader-transition')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('first-page.png') });
});
