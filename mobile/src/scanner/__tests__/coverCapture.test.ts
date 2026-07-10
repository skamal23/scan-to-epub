import {
  centerCoverCrop,
  cleanupCoverFiles,
  prepareCoverPhoto,
} from '../coverCapture';


test('center crop follows the portrait guide without stretching the photo', () => {
  expect(centerCoverCrop(4032, 3024, 2 / 3)).toEqual({
    originX: 1008,
    originY: 0,
    width: 2016,
    height: 3024,
  });
  expect(centerCoverCrop(1200, 2400, 2 / 3)).toEqual({
    originX: 0,
    originY: 300,
    width: 1200,
    height: 1800,
  });
});


test('prepares a bounded JPEG with one deterministic manipulation', async () => {
  const manipulate = jest.fn().mockResolvedValue({
    uri: 'file:///cache/prepared.jpg',
    width: 1200,
    height: 1800,
  });

  const result = await prepareCoverPhoto(
    { uri: 'file:///cache/original.jpg', width: 4032, height: 3024 },
    manipulate,
  );

  expect(result.uri).toBe('file:///cache/prepared.jpg');
  expect(manipulate).toHaveBeenCalledWith(
    'file:///cache/original.jpg',
    [
      { crop: { originX: 1008, originY: 0, width: 2016, height: 3024 } },
      { resize: { width: 1200 } },
    ],
    { compress: 0.72, format: 'jpeg' },
  );
});


test('cleanup attempts every unique local file even when one deletion fails', async () => {
  const remove = jest
    .fn()
    .mockRejectedValueOnce(new Error('already removed'))
    .mockResolvedValue(undefined);

  await cleanupCoverFiles(
    ['file:///original.jpg', 'file:///prepared.jpg', 'file:///original.jpg'],
    remove,
  );

  expect(remove).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenNthCalledWith(1, 'file:///original.jpg', { idempotent: true });
  expect(remove).toHaveBeenNthCalledWith(2, 'file:///prepared.jpg', { idempotent: true });
});
