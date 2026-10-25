// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64, utf8 } from '../util/bytes.ts';

import {
  answerLink,
  formatLinkCode,
  LINK_TTL_MS,
  linkCode,
  LinkError,
  linkQrText,
  newLink,
  openLinkReply,
  readLinkCode,
} from './link.ts';

const NOW = new Date('2026-10-25T10:00:00Z');

async function dataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function portfolio() {
  return { vaultId: 'vault_abcd', dk: await dataKey(), folderId: 'folder-1', name: 'Family' };
}

describe('link codes', () => {
  it('come from the public key: 16 base32 characters, shown in groups of four', async () => {
    const { code, request } = await newLink('Chrome on macOS', NOW);

    expect(code).toMatch(/^[A-Z2-7]{16}$/);
    expect(linkCode(fromBase64(request.publicKey))).toBe(code);
    expect(formatLinkCode(code)).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);
    expect(request).toEqual({
      format: 1,
      publicKey: expect.any(String),
      device: 'Chrome on macOS',
      created: NOW.toISOString(),
    });
    expect((await newLink('x', NOW)).code).not.toBe(code);
  });

  it('read from a QR code or typed by hand', () => {
    const code = 'ABCDEFGHIJKLMNOP';

    expect(readLinkCode(linkQrText(code))).toBe(code);
    expect(readLinkCode('abcd-efgh ijkl-mnop')).toBe(code);
    expect(readLinkCode(' ABCD EFGH IJKL MNOP ')).toBe(code);
    // Codes have no 0, 1 or 8, so those were meant as O, I and B.
    expect(readLinkCode('ABCD-EFGH-1JKL-MN0P')).toBe(code);
    expect(readLinkCode('8BCD-EFGH-IJKL-MNOP')).toBe('BBCDEFGHIJKLMNOP');
    expect(readLinkCode('ABCD-EFGH-IJKL-MNO')).toBeNull();
    expect(readLinkCode('ABCD-EFGH-IJKL-MNO9')).toBeNull();
    expect(readLinkCode('https://example.com/ABCDEFGHIJKLMNOP')).toBeNull();
  });
});

describe('linking', () => {
  it('sends the data key to the device that made the code, and only to it', async () => {
    const { code, request, privateKey } = await newLink('Safari on iPhone', NOW);
    const sent = await portfolio();
    const reply = await answerLink(code, request, sent, new Date(NOW.getTime() + 60_000));

    expect(JSON.stringify(reply)).not.toContain('Family');
    const got = await openLinkReply(code, privateKey, reply);

    expect(got).toMatchObject({ vaultId: 'vault_abcd', folderId: 'folder-1', name: 'Family' });
    // The same key: what one seals, the other opens.
    const iv = new Uint8Array(12);
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sent.dk,
      utf8.encode('check'),
    );

    expect(
      utf8.decode(
        new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, got.dk, sealed)),
      ),
    ).toBe('check');

    const other = await newLink('Someone else', NOW);

    await expect(openLinkReply(code, other.privateKey, reply)).rejects.toThrow(LinkError);
    await expect(openLinkReply(other.code, other.privateKey, reply)).rejects.toThrow(LinkError);
  });

  it('refuses a request whose key does not match the code', async () => {
    const real = await newLink('Chrome on Windows', NOW);
    const swapped = await newLink('Chrome on Linux', NOW);

    await expect(answerLink(real.code, swapped.request, await portfolio(), NOW)).rejects.toThrow(
      /doesn’t match/,
    );
    await expect(
      answerLink(real.code, { ...real.request, publicKey: 'not a key' }, await portfolio(), NOW),
    ).rejects.toThrow(LinkError);
  });

  it('refuses a request over 10 minutes old', async () => {
    const { code, request } = await newLink('Chrome on Android', NOW);
    const late = new Date(NOW.getTime() + LINK_TTL_MS + 1000);

    await expect(answerLink(code, request, await portfolio(), late)).rejects.toThrow(/expired/);
  });

  it('refuses a reply that was changed', async () => {
    const { code, request, privateKey } = await newLink('Firefox on Linux', NOW);
    const reply = await answerLink(code, request, await portfolio(), NOW);
    const ct = fromBase64(reply.ct);

    ct[3]! ^= 1;
    await expect(openLinkReply(code, privateKey, { ...reply, ct: toBase64(ct) })).rejects.toThrow(
      LinkError,
    );
    const another = await answerLink(code, request, await portfolio(), NOW);

    await expect(
      openLinkReply(code, privateKey, { ...reply, publicKey: another.publicKey }),
    ).rejects.toThrow(LinkError);
    await expect(openLinkReply(code, privateKey, { ...reply, format: 2 as 1 })).rejects.toThrow(
      LinkError,
    );
  });
});
