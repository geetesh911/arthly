# Linking a device with a QR code

- **Status:** approved on 2026-10-25. Builds on cloud sync (2026-10-24-cloud-sync-design.md). The new device signs in to Google itself, so the Google sign-in still never leaves its device.
- **Scope:** open a portfolio on a new device by scanning a QR code from a device where it's already open, instead of typing the passphrase or recovery code.

## What it is

1. **On the new device:** the unlock screen gets **Link with another device**. It signs in to Google (the account the portfolio syncs to), then shows a QR code with the same code written underneath.
2. **On a device where the portfolio is open:** Settings → Cloud sync gets **Link a device**. Scan the QR code, or type the code. It names the device that asked and asks to confirm.
3. **The new device** opens the portfolio, connected to Google Drive, and syncs. Later it unlocks like any other device: passphrase, recovery code, or a fingerprint added on it.

Out of scope for now: linking without Google Drive, sending the Google sign-in to the new device, and a live view that keeps the data only on the main device.

## Decisions

| Topic | Default |
|---|---|
| Where the handoff goes | Two small files in the user's own `Arthly` folder in Google Drive. No new server. |
| Google sign-in | Each device signs in itself. The refresh token never leaves its device, as before. |
| Keys | The new device makes a one-time P-256 key pair in the data worker. The private key can't be exported and is forgotten once the link ends. |
| The code | The first 80 bits of the SHA-256 of the new device's public key, as 16 base32 characters in groups of 4 (`ABCD-EFGH-JKLM-NOPQ`). The QR code holds `arthly-link:` and the code. |
| What's sent | The portfolio's ID, data key, Drive folder ID and name, sealed with AES-256-GCM under a key from ECDH (P-256) and HKDF-SHA-256, with the code as context. |
| Checks on the sending device | The request's public key must hash to the code, so a request put in its place is refused. The request must be under 10 minutes old, and the user confirms. |
| Checks on the new device | The data key must open the keyring in that folder (`verifyKey`), and the keyring must be signed with it (`verifyKeyring`). A portfolio already on the device is refused. |
| Expiry | 10 minutes. The new device looks for the answer every 2 seconds and offers a new code after that. |
| Clean-up | The new device deletes its two files once it opens the portfolio, gives up or is cancelled. Starting a link also deletes `link-` files over an hour old. |
| Camera | `Permissions-Policy` allows the camera for the app's own origin. The scanner uses the back camera and reads frames with jsQR, bundled with the app. Typing the code works without a camera. |
| QR code | Drawn as an SVG path from `uqr`'s module grid, bundled with the app. |
| When it shows | **Link a device** shows only while this device syncs with Google Drive. |
| Wrong Google account | The sending device finds no request with that code and says to sign in on the new device with its own account. |
| Device name | Browser and system from the user agent, such as "Chrome on macOS". Only a label for the confirm step. |

## Flow

```text
New device (worker)                     Arthly folder in Drive           Open device (worker)
  sign in to Google
  key pair; code = SHA-256(publicKey)
  write link-<code>.json ──────────────▶ { publicKey, device, created }
  show QR code ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  camera or typing  ·  ·  ·  ·  ▶ code
                                         ◀────── read link-<code>.json
                                                 check the key and age; user confirms
                                         ◀────── write link-<code>-reply.json
                                                 { publicKey, iv, ct }
  every 2 s: read the reply
  ECDH → open { vaultId, key, folderId, name }
  check against keyring.json; open; connect; sync
  delete both files ───────────────────▶
```

## Security

- Google, and anyone else who can read the Drive folder, sees two public keys and a sealed reply. Only the new device's private key opens the reply.
- Scanning a QR code someone else shows you gets them nothing. The reply goes into your own Drive, which they can't read.
- Someone who could write to your Drive while you link could put a different request in place of the real one. Its key can't match the code you scanned or typed, so it's refused.
- The new device keeps the data key in the data worker only, as an unlock does.
- What linking can't protect: someone holding your unlocked phone can link their own device, just as they could read the screen or save a backup. The confirm step names the device asking.

## Testing

- **Core:** the code from a key; reading typed and scanned codes; a full round trip; a request whose key doesn't match the code; the wrong private key; a tampered reply.
- **Worker:** linking a second device through the fake Google; a code from another Google account; an expired request; a portfolio already on the device; cancelling, and clearing old files.
- **Web:** a QR code drawn by `uqr` reads back through jsQR; device names from user agents.
- **End to end:** two browser contexts sharing the fake Google. The new device signs in and shows a code, the open device types it in Settings and confirms, and the new device opens the portfolio.
- **Not covered:** the camera itself, which Playwright can't point at a screen.
