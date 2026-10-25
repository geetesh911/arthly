# Cloud sync: Google Drive

- **Status:** approved on 2026-10-24. Builds phase 2 of the portfolio app design (§8), starting with Google Drive. The open questions use the defaults in **Decisions**; change any of them before building on it.
- **Scope:** run the existing sync engine (`VaultLog.sync`) from the app, add a Google Drive storage provider, and add a small token function next to the price relay.

## What it is

1. **Sync in the app.** A connected portfolio syncs on unlock, 5 seconds after a change, every 5 minutes, when the device comes back online and when the app comes back into view. Changes pulled from other devices show up straight away.
2. **Google Drive.** Settings → **Cloud sync** connects this portfolio to the user's Google Drive. Only encrypted files go there.
3. **Open on another device.** The unlock screen gets **Open from Google Drive**: sign in, pick the portfolio, and unlock it with the passphrase or recovery code.
4. **One tab at a time.** A portfolio can be open in only one tab per browser, because two tabs would write the same device files.

Out of scope for now: Dropbox, OneDrive, WebDAV and S3; choosing a different folder; deleting the files in Drive from the app; syncing fund reports added by hand; and encrypting file names.

## Decisions

| Topic | Default |
|---|---|
| Google permission | `drive.file` only: Arthly sees just the files it created. Google lists it as non-sensitive, so the consent screen needs no security review. |
| Where in Drive | A visible `Arthly` folder in My Drive, with one folder per portfolio named by its vault ID. Visible, so people can see what's stored and remove it. |
| Files | Flat inside the portfolio's folder, each named by its logical path (`keyring.json`, `log/<device>/<seq>.pvc`, `snap/<hlc>.pvc`). One list call reads the whole folder. |
| Sign-in | Google's authorization code flow with PKCE. The token function holds the client secret, swaps the code for a refresh token, and turns the refresh token into one-hour access tokens. It sees tokens, never data. |
| Refresh token | Sealed with the data key in the device's `meta` store (`cloud:secret`). Never synced and never in a backup file. |
| Each device | Connects on its own. Disconnecting forgets this device's token and leaves the files in Drive. It doesn't revoke Google access, because that would disconnect every device. |
| Sign-in window | A popup that reports back through a `BroadcastChannel`. An app installed to the home screen uses a full-page redirect instead, because its storage can be separate from the browser's; that means unlocking again on return. |
| Revoked or expired access | Sync stops and Settings asks to reconnect. Nothing is lost: changes wait on the device. |
| Offline or Drive busy | The pass is skipped quietly and tried again on the next trigger. Settings shows the last sync time. |
| Two tabs | A Web Lock per portfolio. A second tab is told the portfolio is open elsewhere and can take it over; the first tab then locks. |
| Fund reports added by hand | Stay on the device that added them. They can be tens of megabytes, and the next refresh or a fresh download brings them back. |
| Sample data | Never syncs. |
| Portfolio name | Chosen on each device, as when restoring a backup. The name isn't stored in Drive. |
| Checks | `backup.none` counts the last sync as well as the last backup, as the checks already allow. |
| Hosting | The function needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Cloudflare Pages. Without them, Settings says Google Drive isn't set up for this copy. |

## Sign-in

```text
Screen                         Token function                    Google
  │ GET /api/google/config ─────▶ { clientId }
  │ open popup ───────────────────────────────────────────────────▶ accounts.google.com
  │                                                                 (consent: drive.file)
  │ ◀── /oauth.html?code&state (BroadcastChannel back to the app)
  │ worker: POST /api/google/token
  │        { grant_type: authorization_code, code, code_verifier, redirect_uri }
  │                              ─────▶ oauth2.googleapis.com/token (+ client secret)
  │ ◀── { access_token, expires_in, refresh_token, scope }
  │ worker: Drive API with the access token; later
  │        POST /api/google/token { grant_type: refresh_token, refresh_token }
```

- The redirect address is `<origin>/oauth.html`, which must be listed in the Google client.
- The function only answers same-origin POSTs, only accepts a redirect address on its own origin, and never logs or stores tokens.
- If the user leaves the Drive box unticked on Google's consent screen, the app says so and doesn't connect.
- A Google app in **Testing** status issues refresh tokens that last 7 days, so the README says to publish it.

## Drive provider

`GoogleDriveFolder` implements `StorageProvider` for one portfolio folder:

| Call | Drive API |
|---|---|
| `list(prefix)` | `files.list` with `'<folder>' in parents and trashed = false`, paged, then filtered by prefix |
| `read(path)` | `files.get?alt=media`, by the ID from the last list (or a lookup by name) |
| `write(path)` | A multipart `files.create`, or a media `files.update` when the name exists (only `keyring.json`) |
| `remove(path)` | `files.delete` for every file with that name |

- **Duplicates:** if a retried upload leaves two files with one name, reads use the newest and removes delete both.
- **Errors:** 401 refreshes the token once. 429, 5xx and network failures count as offline. A full Drive or a refused request is shown in Settings.
- **CSP:** `https://www.googleapis.com` joins `connect-src`.

## Sync in the app

- **When:** after unlocking (or connecting), 5 seconds after the last change, every 5 minutes while unlocked, on `online`, and when the app becomes visible. Passes never overlap.
- **After a pass:** if events or a keyring arrived, the state is rebuilt and the screens reload. The last sync time and any skipped chunks are kept for Settings.
- **Locking:** timers stop. A pass already running finishes on its own copy of the log.

## Testing

- **Core:** the Drive provider against an in-memory fake of the Drive API (paging, multipart create, update, duplicates, delete, 401 retry, offline); two devices syncing through it; the token function (config, code and refresh grants, origin and redirect checks, Google errors).
- **Worker:** connecting, syncing between two devices and opening a portfolio from the cloud on a second device; disconnecting; the sample vault refusing.
- **End to end:** Google's sign-in, the token function and the Drive API are faked with Playwright routes, shared between two browser contexts: connect on one, open from Google Drive on the other, change something and see it arrive.
- **Not covered:** the real Google sign-in and Drive, which need a Google Cloud client.
