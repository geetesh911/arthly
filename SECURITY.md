# Security

## How your data is protected

- **One data key encrypts everything:** a random 256-bit AES-GCM key made when you create the portfolio.
- **That key is stored only in wrapped form.** It is wrapped under:
  - your passphrase, through Argon2id (64 MiB, 3 passes)
  - a 160-bit recovery code
  - optionally, a passkey on each device, using the WebAuthn PRF extension
- **The keyring is signed with the data key,** so a copy that was changed outside the app is ignored.
- **Data is stored as an append-only log of encrypted chunks.** Each chunk is bound to its vault and its path, so chunks can't be swapped or moved.
- **The key lives only in the data worker's memory while unlocked.** It is dropped when you lock the app, when it locks itself after the idle time (5 minutes by default), or when you close the tab.
- **The hosted site loads no outside code.** A Content-Security-Policy lets the app talk only to its own site (including the price relay and the Google token function), Frankfurter for the USD rate, the Google Drive API for cloud sync, and a price feed if you set one.
- **Cloud sync stores only what's already encrypted:** the chunks and the signed keyring, in files only Arthly can see (Google's `drive.file` permission). Each device's Google sign-in is sealed with the data key on that device. It's never synced and never in a backup file.
- **The Google token function** on the app's site swaps Google's sign-in codes and refresh tokens for access tokens, adding the client secret. It sees those tokens as they pass, never your data, and keeps nothing.
- **Linking a device with a QR code** sends the data key through your own Drive folder, sealed with ECDH (P-256) for a one-time key that never leaves the new device. The code is a hash of that key, and the device sending the data key checks it, so a request put into your Drive in its place is refused. Scanning someone else's QR code gives them nothing: the answer lands in your Drive, which they can't read. Both files are deleted once the device is linked, and a code expires after 10 minutes.
- **One tab at a time:** a portfolio is open in only one tab of a browser, so two tabs never write over each other's changes.

## Limits

- **Someone with your unlocked phone** can see your data until the app locks, and can link their own device to it if it syncs. Linking asks you to confirm, and names the device asking.
- **Old keyring copies:** changing the passphrase doesn't re-encrypt anything. A copy of the keyring taken before the change, such as an old backup file, still opens with the old passphrase. Rotating the data key is future work.
- **Excel and JSON exports aren't encrypted.** The app warns before saving one.
- **What Google Drive shows:** whoever can read your Drive (Google, or someone in your account) sees encrypted files, their sizes, when they change, and file names that show each device's ID and how many changes it has saved. They can't read or change your data, but they could delete files: each device keeps its own full copy, while a device that opens the portfolio from Drive afterwards would miss what was deleted. A backup file covers this.
- **A lost device stays signed in to Google Drive** until you remove Arthly's access in your Google account. That stops sync on every device, which each then connects again.
- **The hosted site:** whoever controls it could ship a malicious update. Each release lists the SHA-256 of its build (`pnpm hash`), and you can host your own copy.
- **No recovery without your secrets.** Without your passphrase, your recovery code or a passkey, nobody can recover your data, us included.

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** button on this repository, not in a public issue. We aim to reply within a week.
