// SPDX-License-Identifier: AGPL-3.0-only
import { linkQrText } from '@pv/core';
import { describe, expect, it } from 'vitest';

import { deviceName, qrCode, readQr } from './link.ts';

/** The QR code as camera pixels: `scale` pixels a module, black on white. */
function pixels(text: string, scale: number) {
  const { modules } = qrCode(text);
  const width = modules.length * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);

  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) {
        return;
      }

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * width + x * scale + dx) * 4;

          data.fill(0, i, i + 3);
        }
      }
    }),
  );

  return { data, width };
}

describe('QR codes', () => {
  it('draw a link code that a camera frame reads back', async () => {
    const text = linkQrText('ABCDEFGHIJKLMNOP');
    const { path, size, modules } = qrCode(text);

    expect(size).toBe(modules.length);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    // A quiet zone of four modules all round.
    expect(modules.slice(0, 4).flat().some(Boolean)).toBe(false);
    const { data, width } = pixels(text, 4);

    expect(await readQr(data, width, width)).toBe(text);
    expect(await readQr(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toBeNull();
  });
});

describe('device names', () => {
  it('name the browser and system', () => {
    const agents: [string, string][] = [
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        'Safari on iPhone',
      ],
      [
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
        'Chrome on Android',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'Chrome on macOS',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
        'Edge on Windows',
      ],
      [
        'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
        'Firefox on Linux',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
        'Chrome on iPhone',
      ],
      ['Something else', 'A browser'],
    ];

    for (const [agent, name] of agents) {
      expect(deviceName(agent)).toBe(name);
    }
  });
});
