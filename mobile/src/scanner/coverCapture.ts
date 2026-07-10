export type CapturedPhoto = {
  uri: string;
  width: number;
  height: number;
};

type Manipulate = (
  uri: string,
  actions: Array<
    | { crop: { originX: number; originY: number; width: number; height: number } }
    | { resize: { width: number } }
  >,
  options: { compress: number; format: 'jpeg' },
) => Promise<CapturedPhoto>;

type Remove = (uri: string, options: { idempotent: true }) => Promise<void>;

export function centerCoverCrop(width: number, height: number, ratio: number) {
  const currentRatio = width / height;
  if (currentRatio > ratio) {
    const cropWidth = Math.round(height * ratio);
    return {
      originX: Math.round((width - cropWidth) / 2),
      originY: 0,
      width: cropWidth,
      height,
    };
  }
  const cropHeight = Math.round(width / ratio);
  return {
    originX: 0,
    originY: Math.round((height - cropHeight) / 2),
    width,
    height: cropHeight,
  };
}

export async function prepareCoverPhoto(
  photo: CapturedPhoto,
  manipulate: Manipulate,
): Promise<CapturedPhoto> {
  const crop = centerCoverCrop(photo.width, photo.height, 2 / 3);
  return manipulate(
    photo.uri,
    [
      { crop },
      { resize: { width: 1200 } },
    ],
    { compress: 0.72, format: 'jpeg' },
  );
}

export async function cleanupCoverFiles(uris: Array<string | null | undefined>, remove: Remove) {
  const unique = [...new Set(uris.filter((uri): uri is string => Boolean(uri)))];
  await Promise.allSettled(unique.map((uri) => remove(uri, { idempotent: true })));
}
