// @ts-expect-error
import Jimp from 'jimp-compact';

export async function cropImageAsync({
  imagePath,
  outputPath,
  x,
  y,
  width,
  height,
}: {
  imagePath: string;
  outputPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  const image = await Jimp.read(imagePath);
  const croppedImage = image.crop(x, y, width, height);
  await croppedImage.write(outputPath);
}

/**
 * Resize the image to a maximum size and return the resized image in buffer
 * Since tunnel allow only 1MB of payload, we need to resize the image to a maximum size
 */
export async function resizeImageToMaxSizeAsync(
  imagePath: string,
  {
    maxBytes = 700000, // 700KB (consider base64 and JSON overhead)
    maxWidth = 960, // initial resize cap
    minWidth = 320, // stop shrinking past this
    startQuality = 85, // initial JPEG quality
    minQuality = 40, // don’t go below this
    qualityStep = 5, // lower quality by this amount
    downscaleStep = 0.9, // shrink width by 10% if quality floor is reached
    maxRuns = 10, // max number of runs
  } = {}
): Promise<{ bytes: number; quality: number; width: number; buffer: Buffer }> {
  const image = await Jimp.read(imagePath);

  // resize if image is very large
  if (image.getWidth() > maxWidth) {
    image.resize(maxWidth, Jimp.AUTO);
  }

  let quality = startQuality;
  let width = image.getWidth();
  let buffer = await image.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
  let runs = 0;

  // loop until size is acceptable
  while (buffer.length > maxBytes) {
    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - qualityStep);
    } else {
      // quality floor reached, start resizing smaller
      const nextWidth = Math.floor(width * downscaleStep);
      if (nextWidth < minWidth) break;
      width = nextWidth;
    }

    buffer = await image
      .clone()
      .resize(width, Jimp.AUTO)
      .quality(quality)
      .getBufferAsync(Jimp.MIME_JPEG);

    runs += 1;
    if (runs > maxRuns) {
      break;
    }
  }

  return {
    bytes: buffer.length,
    quality,
    width,
    buffer,
  };
}
