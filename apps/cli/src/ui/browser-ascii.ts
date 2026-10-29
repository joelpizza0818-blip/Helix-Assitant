import jpeg from 'jpeg-js';

const ASCII_RAMP = ' .:-=+*#%@';
const MAX_FRAME_WIDTH = 76;
const MAX_FRAME_HEIGHT = 34;
const MAX_JPEG_BYTES = 560_000;

export function grayscaleToAscii(
  pixels: number[][],
  width = MAX_FRAME_WIDTH,
): string {
  if (!pixels.length || !pixels[0]?.length) {
    throw new Error('Browser frame has no pixels to render.');
  }
  const boundedWidth = Math.max(1, Math.min(MAX_FRAME_WIDTH, Math.floor(width)));
  const sourceHeight = pixels.length;
  const sourceWidth = pixels[0].length;
  const outputHeight = Math.max(
    1,
    Math.min(MAX_FRAME_HEIGHT, Math.round((sourceHeight / sourceWidth) * boundedWidth * 0.5)),
  );
  const lines: string[] = [];

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / outputHeight) * sourceHeight));
    let line = '';
    for (let x = 0; x < boundedWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / boundedWidth) * sourceWidth));
      const value = Math.max(0, Math.min(255, pixels[sourceY][sourceX]));
      const index = Math.round(((255 - value) / 255) * (ASCII_RAMP.length - 1));
      line += ASCII_RAMP[index];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function renderJpegAsAscii(base64: string, width = MAX_FRAME_WIDTH): string {
  if (
    typeof base64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    || base64.length > Math.ceil(MAX_JPEG_BYTES * 4 / 3)
  ) {
    throw new Error('Browser frame is not a valid, bounded Base64 JPEG.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_JPEG_BYTES) {
    throw new Error('Browser frame exceeds the supported JPEG size.');
  }
  const image = jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 4,
    maxMemoryUsageInMB: 128,
  });
  const pixels: number[][] = [];
  const outputWidth = Math.min(MAX_FRAME_WIDTH, image.width);
  const outputHeight = Math.max(
    1,
    Math.min(
      MAX_FRAME_HEIGHT,
      Math.round((image.height / image.width) * outputWidth * 0.5),
    ),
  );

  for (let y = 0; y < outputHeight; y += 1) {
    const row: number[] = [];
    const sourceY = Math.min(image.height - 1, Math.floor((y / outputHeight) * image.height));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x / outputWidth) * image.width));
      const offset = (sourceY * image.width + sourceX) * 4;
      row.push(
        image.data[offset] * 0.299
        + image.data[offset + 1] * 0.587
        + image.data[offset + 2] * 0.114,
      );
    }
    pixels.push(row);
  }

  return grayscaleToAscii(pixels, Math.min(width, outputWidth));
}
