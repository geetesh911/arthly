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
- **The hosted site loads no outside code.** A Content-Security-Policy lets the app talk only to its own site (including the price relay), Frankfurter for the USD rate, and a price feed if you set one.

## Limits

- **Someone with your unlocked phone** can see your data until the app locks.
- **Old keyring copies:** changing the passphrase doesn't re-encrypt anything. A copy of the keyring taken before the change, such as an old backup file, still opens with the old passphrase. Rotating the data key is future work.
- **Excel and JSON exports aren't encrypted.** The app warns before saving one.
- **The hosted site:** whoever controls it could ship a malicious update. Each release lists the SHA-256 of its build (`pnpm hash`), and you can host your own copy.
- **No recovery without your secrets.** Without your passphrase, your recovery code or a passkey, nobody can recover your data, us included.

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** button on this repository, not in a public issue. We aim to reply within a week.
