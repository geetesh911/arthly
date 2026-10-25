// SPDX-License-Identifier: AGPL-3.0-only
// The screens' side of linking a device: the QR code a new device shows, reading one from the
// camera on the device that has the portfolio open, and a name for the device that asks.
import { encode } from 'uqr';

/** A QR code as an SVG path, one unit a module, with a quiet zone of four modules all round. */
export function qrCode(text: string): { path: string; size: number; modules: boolean[][] } {
  const { data } = encode(text, { ecc: 'M', border: 4 });
  let path = '';

  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }),
  );

  return { path, size: data.length, modules: data };
}

/** The text of the QR code in a camera frame's RGBA pixels, if it shows one. */
export async function readQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string | null> {
  // Loaded only when scanning, since most visits never do.
  const { default: jsQR } = await import('jsqr');

  return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** The QR code in the video's current frame, if it shows one. `canvas` is reused between frames. */
export async function readVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  // Smaller frames read faster, and a code held up to the camera fills plenty of them.
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));

  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  if (!canvas.width || !canvas.height) {
    return null;
  }

  const context = canvas.getContext('2d', { willReadFrequently: true })!;

  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return readQr(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width,
    canvas.height,
  );
}

/** Such as "Chrome on macOS", for the other device to show when it asks to confirm. */
export function deviceName(agent: string): string {
  const browser = /Edg(A|iOS)?\//.test(agent)
    ? 'Edge'
    : /Firefox|FxiOS/.test(agent)
      ? 'Firefox'
      : /SamsungBrowser/.test(agent)
        ? 'Samsung Internet'
        : /Chrome|CriOS/.test(agent)
          ? 'Chrome'
          : /Safari/.test(agent)
            ? 'Safari'
            : 'A browser';
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /CrOS/.test(agent)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/.test(agent)
            ? 'macOS'
            : /Windows/.test(agent)
              ? 'Windows'
              : /Linux/.test(agent)
                ? 'Linux'
                : '';

  return system ? `${browser} on ${system}` : browser;
}
