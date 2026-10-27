# Portfolio app: design

- **Status:** approved on 2026-10-22.
- **Scope of this spec:** sub-project 1, the core app (V1). Later sub-projects are listed in §3 and get their own specs.
- **Working name:** `portfolio-app`. A final name gets picked before the public release.

## 1. What it is

A free, open-source portfolio tracker for Indian investors that anyone can use from a website or host themselves.

- **Everything stays on the device.** All parsing, storage and calculation happen in the browser. Data is encrypted on the device. If the user turns on sync, the cloud only stores encrypted files.
- **What it tracks:**
  - Indian stocks, ETFs and mutual funds
  - SGBs and bonds
  - FDs, PPF, EPF and EPS
  - bank cash
  - US stocks, priced manually in V1
- **Who it's for:** a whole family in one vault, with each account belonging to a member.

### Goals
- **One dashboard** for net worth, invested, gain, exact XIRR, allocation, history, income and what's coming up.
- **Minimal upkeep:** download the broker or bank files, drop them in, confirm the preview.
- **Zero cost** for users and for whoever hosts it.
- **No lock-in:** Excel, JSON and encrypted-backup exports, all re-importable.
- **Easy to extend:** importers, asset types, price sources, storage providers and exporters are all plugins.

### Non-goals
- **No broker logins or API connections.** Data comes in through files only.
- **No servers that see user data.** The only server-side piece is a public price feed.
- **No investment or tax advice.** Tax figures are summaries, labelled as such.
- **No plugins downloaded at runtime.** Every plugin ships in the app and is reviewed by pull request.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Audience | Anyone, through a hosted website. Self-hosting is also supported. |
| Records | Every transaction is stored. Holdings files give opening balances where no transactions exist yet, and are used for checks. |
| Sync | Edit on any device and changes merge automatically. When the same item was edited on two devices, the later edit wins, the other version is kept, and the user sees a notice. |
| Tax | V1 shows interest and dividends per financial year. A capital-gains report comes later (sub-project 5), and FIFO lots are kept from day one so it's possible. |
| Family | One vault holds several members. Accounts belong to members. |
| Stack | Svelte 5 + Vite (SvelteKit in static SPA mode) and TypeScript. |
| Unlock | A passphrase, then a fingerprint or Face ID passkey per device, plus a recovery code. The app locks itself when idle. |
| Storage model | An append-only, encrypted log of changes, replayed into in-memory state. No SQLite in V1. |
| Licence | AGPL-3.0 |
| Repo | Its own folder (`~/Documents/geetesh/portfolio-app`), kept apart from personal finance files. |

## 3. Sub-projects

| # | Sub-project | Contents |
|---|---|---|
| 1 | **Core app (this spec)** | The log, encryption, engine, checks, V1 importers, Excel/JSON/backup export, device-only storage, and a minimal price feed (latest prices, plus history from launch onwards) |
| 2 | Cloud sync | Storage plugins: Google Drive, then Dropbox, OneDrive, S3/R2 and WebDAV. The sync engine itself is built in V1. |
| 3 | Price history and US prices | Backfill of past NAVs and closes, and US prices through the user's own API key (Finnhub first) |
| 4 | Wider importers | CAMS/KFintech CAS, NSDL/CDSL CAS, other brokers, US broker files |
| 5 | Capital-gains report | Short and long term, FIFO, the 31 Jan 2018 grandfathering rule, debt-fund rules |

Also out of V1: goals, the SIP planner, push notifications, and any language other than English. The existing Google Sheet keeps covering these meanwhile.

## 4. Architecture

```
portfolio-app/
  packages/core/            plain TypeScript, no DOM; runs in browser workers and Node
    src/model/              entity types and ID helpers
    src/log/                event envelope, clock, replay, upgrading old formats
    src/crypto/             keyring, chunk encryption (WebCrypto + hash-wasm Argon2id)
    src/sync/               sync engine; doesn't know which provider it talks to
    src/engine/             positions, lots, valuation, XIRR, history, income, upcoming, checks
    src/plugins/
      importers/<id>/       code + fixtures/ + tests
      assets/<kind>/
      prices/<id>/
      storage/<id>/
      exporters/<id>/
    src/plugins/index.ts    the registry: arrays of built-in plugins
  apps/web/                 SvelteKit (adapter-static, SPA fallback) + @vite-pwa/sveltekit
    src/worker/             data worker: holds the key, the log, the state and the engine
  apps/price-feed/          Node script + GitHub Actions workflow + GitHub Pages deploy
  docs/
```

**Runtime**
- **UI thread:** Svelte screens and forms only. They call the data worker over typed RPC (Comlink).
- **Data worker:**
  - holds the data key in memory
  - reads and writes IndexedDB
  - replays the log into state and runs the engine
  - parses files
  - talks to storage providers and the price feed

**Libraries**
All of these are lazy-loaded where they're large.
- SheetJS for reading `.xls`, `.xlsx` and `.csv`. Install it from the cdn.sheetjs.com tarball, because the npm package is outdated.
- ExcelJS for writing styled `.xlsx`.
- pdf.js for reading PDFs, including password-protected ones.
- hash-wasm for Argon2id.
- uPlot for time-series charts. Simple SVG for the donut and bar charts.
- Comlink for the worker RPC.

**Tooling**
- pnpm workspaces, Node 22 LTS, TypeScript in strict mode
- Vitest and fast-check for tests, Playwright for end-to-end tests
- ESLint and Prettier

**Numbers and dates**
- **Amounts** are JS numbers, rounded to 2 decimals at import. **Units** are rounded to 6 decimals and **prices** to 4.
- **Comparisons** use tolerances.
- **Dates** are ISO `YYYY-MM-DD` local dates. There are no time zones in the data.
- **Financial year** helpers assume April to March.
- **Display** uses `Intl.NumberFormat('en-IN')`, which gives Indian grouping (₹1,23,456).

## 5. Data model

The entities are the state you get after replaying the log.

```ts
Member      { id, name }
Account     { id, memberId, institution, kind: 'demat'|'mf'|'bank'|'ppf'|'epf'|'other',
              label, ref?: string /* masked */, currency }
Instrument  { id, kind: 'stock'|'etf'|'mf'|'sgb'|'bond'|'fd'|'ppf'|'epf'|'eps'|'cash'|'us-stock'|'other',
              name, currency, assetClass: 'equity'|'debt'|'hybrid'|'gold'|'silver'|'cash'|'other',
              ids: { isin?, amfi?, nse?, bse?, us? },
              terms?: DepositTerms | BondTerms }
DepositTerms{ principal, start, maturity, ratePct,
              compounding: 'none'|'monthly'|'quarterly'|'half-yearly'|'yearly',
              payout: 'cumulative'|'monthly'|'quarterly'|'half-yearly'|'yearly' }
BondTerms   { faceValue, couponPct, couponFreq: 1|2|4|12, issue, maturity }   // SGB: faceValue = issue price, 2.5%, 2/yr
Transaction { id, accountId, instrumentId, date,
              type: 'opening'|'buy'|'sell'|'switch-in'|'switch-out'|'dividend'|'dividend-reinvest'|
                    'interest'|'contribution'|'withdrawal'|'maturity'|'bonus'|'split'|'charge'|'tax',
              units?, price?, amount, currency, fx?, meta?: Record<string,string>,
              source: { kind: 'import', batchId } | { kind: 'manual' } }
Snapshot    { id, accountId, instrumentId, asOf, units, invested?, value?, price?, source }
Group       { id, name, holdings: { accountId?, instrumentId }[] }   // e.g. a smallcase
ManualPrice { id, instrumentId, date, price }
Dismissal   { id, checkKey }                                         // "not a problem" on a check
Setting     { id /* key */, value }
Loan        { id, memberId, direction: 'lent'|'borrowed', party, due?, note? }   // added later
LoanEntry   { id, loanId, date, type: 'advance'|'repayment'|'write-off', amount }
Card        { id, memberId, bank, name, limit?, closed? }                     // added later
CardBill    { id, cardId, statementDate, dueDate, amount, minimumDue }
CardPayment { id, cardId, date, amount }
```

`Loan` and `LoanEntry` came with data format version 2. See [Loans](2026-10-23-loans-design.md). `Card`, `CardBill` and `CardPayment` came with version 3. See [Credit cards](2026-10-23-credit-cards-design.md).

**Instruments**
- **Asset class defaults:**
  - **Mutual funds:** from the AMFI category.
  - **ETFs:** by keyword in the name. GOLD gives gold, SILVER gives silver, LIQUID gives cash.
  - **Fixed income:** by kind.

  The user can override any of these.
- **One instrument per contract:** each FD, PPF or EPF account gets its own instrument.
- **EPF and EPS:** the employee and employer shares are both EPF contributions, told apart by `meta.part`. EPS is a separate instrument that earns no interest.

**IDs are deterministic** so that two devices importing the same file offline produce identical records.

| What | How the ID is made |
|---|---|
| Instrument | `ins_` + hash of the first available key: ISIN, then AMFI code, NSE, BSE, US symbol, or the normalised name |
| Account | `acc_` + hash of (memberId, institution, kind, ref) |
| Imported transaction | `txn_` + hash of (accountId, instrumentId, date, type, units, amount, n), where n is the position among identical rows in the same file |
| Snapshot | `snp_` + hash of (accountId, instrumentId, asOf) |
| Anything entered by hand | a random 128-bit ID |

**Opening balances**
- **When one is created:** if an account and instrument have snapshots but no transaction on or before the earliest snapshot, the engine adds an `opening` position. It uses the snapshot's units and invested amount, dated at the user's "first bought" date, or else the snapshot date.
- **Estimates:** XIRR for that position is marked as an estimate (≈).
- **When transactions arrive:** once a transaction import covers that position, the opening position is dropped.

## 6. The change log

### Entries

```ts
Event { hlc: string, v: number, type: EventType, data: unknown }
```

**The clock (`hlc`)**
- It's a hybrid logical clock, written as `<13-digit ms>.<4-digit counter>.<deviceId>`.
- Sorting it as a string gives a total order across devices, and it doubles as the event ID.
- `deviceId` is 8 random base32 characters per install.

**Event types**

| Type | Data | Meaning |
|---|---|---|
| `entity.put` | `{ entity, id, value, base? }` | Create or replace one entity. `base` is the `hlc` of the version that was edited. |
| `entity.delete` | `{ entity, id, base? }` | Delete one entity. |
| `import.apply` | `{ batchId, importer: {id, version}, file: {name, sha256, size}, asOf?, puts: {entity,id,value}[] }` | One confirmed import. |
| `import.revert` | `{ batchId }` | Undo an import. |

### Replay
- **Order:** events are sorted by `hlc` and applied in turn. State keeps, for each entity, `{ value, hlc, batchId? }`, and tombstones for deletes.
- **Last writer wins:** the later `hlc` always wins.
- **Conflict notices:** if an incoming put or delete has a `base` that isn't the current version's `hlc`, the edit was made without seeing the current version. The engine records a conflict notice (entity, winner, loser) that the UI can show with "restore". Restoring writes a new put with the loser's value.
- **Undoing an import:** `import.revert` removes every entity in that batch whose current version still comes from that batch. Entities edited since the import stay, and the user sees a notice about them.
- **Unchanged files:** an import whose puts would change nothing writes no event at all. The preview says "already up to date".
- **Old formats:** `v` is the version of the data format. Upgraders lift old data to the current shape during replay. Stored events are never rewritten.
- **Newer formats:** if the app finds a `v` newer than it knows, it goes read-only and asks for an update.
- **Speed:** replay is fast enough to run on every unlock, since a few thousand events take milliseconds. Results are kept in memory only.

## 7. Security

### Keys
- **DK, the data key:** a random 256-bit AES-GCM key, created with the vault. It encrypts everything.
- **KEKs, the key-encryption keys:** DK is wrapped with AES-GCM under each of these:
  - **Passphrase:** Argon2id with m = 64 MiB, t = 3, p = 1, a 16-byte salt and a 32-byte output. The parameters are stored so they can be tuned later.
  - **Recovery code:** 20 random bytes, shown once as 8 groups of 4 base32 characters. They go through HKDF-SHA256 (info `pv-recovery`). No stretching is needed, because the code itself is 160 bits.
  - **Passkey, one per device:** a WebAuthn credential using the PRF extension (32-byte `prfSalt`, `userVerification: 'required'`). The PRF output goes through HKDF-SHA256 (info `pv-passkey`).
    - **Where it isn't offered:** browsers without PRF don't show this option.
    - **Domain:** passkeys are tied to the hosting domain, so a self-hosted copy enrols its own.

### The keyring
`keyring.json` is plain JSON. It's not secret, and it's synced.

```json
{ "format": 1, "vaultId": "…", "created": "…",
  "kdf": { "alg": "argon2id", "m": 65536, "t": 3, "p": 1, "salt": "…" },
  "check": "<AES-GCM of a constant under DK>",
  "wraps": [ { "id": "…", "type": "passphrase|recovery|passkey", "iv": "…", "ct": "…",
               "credentialId": "…", "prfSalt": "…", "label": "Pixel 8", "updated": "…" } ],
  "revoked": [ "<wrap id>" ] }
```

- **Merging two keyrings:** combine `wraps` by `id` and `revoked` by value. Revoked wraps are ignored.
- **Changing the passphrase:** add a new passphrase wrap and revoke the old one. No data is re-encrypted.
- **Limit:** the old passphrase still opens copies of the keyring taken before the change. Rotating DK is future work, and the security notes say so.

### Encrypted chunks
Each chunk is laid out as `"PVC1" (4 bytes) | nonce (12 bytes) | AES-256-GCM(gzip(JSON payload)) with tag`. A log chunk's payload is a JSON array of Event. A snap's payload is `{ marks, events }` (§8).

- **AAD:** `<vaultId>:<logical path>`, so a chunk can't be moved to another place or another vault.
- **Compression:** `CompressionStream('gzip')`.
- **Local and remote are the same:** local chunks use the same logical paths as remote ones, so uploading is a straight byte copy.

### At rest on the device
IndexedDB database `pv-<vaultId>`, with these stores:

| Store | Contents |
|---|---|
| `chunks` | Logical path → encrypted bytes |
| `meta` | deviceId, sequence counters, how far each device's files have been read, a copy of the keyring |
| `cache` | Price cache, encrypted with DK |
| `secrets` | Storage-provider tokens, encrypted with DK. These are never synced. |

- **Persistence:** the app calls `navigator.storage.persist()` at setup and shows the result.

### Locking
- **Auto-lock:** after 5 minutes without interaction (configurable from 1 to 60) the worker throws away DK and the decrypted state.
- **Manual lock:** a "Lock" button is always visible.

### The hosted site
- **No outside code:** no analytics, no third-party scripts, no remote fonts.
- **CSP** (set through Cloudflare Pages `_headers`):
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' <feed origin> <known storage-provider origins>; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
- **Custom endpoints:** S3 or WebDAV servers that aren't in the list need a self-hosted build with those origins added to `connect-src`.

### Threats

| Threat | Result |
|---|---|
| Someone with access to the cloud storage | Sees only ciphertext and file sizes. Can delete files, but every device keeps the full log. Can't forge or change entries, because GCM authenticates them. Replaying old files is harmless, because merging is a union. |
| Stolen phone while locked | Data is encrypted, and the passphrase is slow to guess. |
| Stolen phone while unlocked | Exposed until auto-lock. |
| Whoever controls the hosted domain | Could ship a malicious update. Mitigated by open source, tagged releases with build hashes, and self-hosting. |

## 8. Storage and sync

```ts
interface StorageProvider {
  id: string; label: string; origins: string[];          // origins feed the CSP connect-src
  connect(ctx): Promise<Credentials>;                    // OAuth PKCE / keys; stored in `secrets`
  list(prefix: string): Promise<{ path: string; size: number }[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>; // create, or overwrite (only keyring.json is ever overwritten)
  remove(path: string): Promise<void>;
}
```

**Layout at the provider**
- `<root>/<vaultId>/keyring.json`
- `<root>/<vaultId>/log/<deviceId>/<seq, 8 digits>.pvc`, which are sealed chunks
- `<root>/<vaultId>/snap/<hlc>.pvc`, which are compacted chunks holding every event up to that `hlc`

**Local writes**
Each save appends its events to the device's *open chunk*, which is rewritten locally. Sync seals the open chunk and starts the next `seq`.

**One sync pass**
1. Read the remote keyring and merge it with the local one. Write it back if it changed.
2. If no local events exist yet, read the newest `snap/` file.
3. For each device folder under `log/`, read the chunks past that device's read mark. Decrypt them, add the events (deduplicating by `hlc`), then move the read mark forward.
4. Seal the open chunk if it has events, then upload every sealed chunk that isn't remote yet.
5. Replay to bring the state up to date.

**When it runs:** on unlock, 5 seconds after a save, and every 5 minutes while the app is open. Offline passes are skipped quietly and retried later.

**Compaction:** once there are more than 200 chunks in `log/`, a device writes `snap/<hlc>.pvc` with all known events.
- **Snap contents:** a snap is a chunk whose payload is `{ marks: { deviceId: seq }, events }`, where `marks` says how far it covers each device's chunks. A new device that starts from a snap begins reading after those marks.
- **Clean-up:** each device then deletes only its own chunks that are fully covered by a snap, so there are no races between devices.

**Why there's no locking:** every device writes only its own files under `log/`, and merging is a union.

**V1 providers**
- **`device`:** local only, with no remote.
- **`memory`:** used in tests.
- **The backup file (`.pvault`):** a single file holding the keyring, every chunk and a small index. Restoring it on a new device means unlocking with the passphrase or the recovery code.

## 9. Importers

```ts
interface Importer {
  id: string; version: number; label: string; extensions: string[];
  detect(file: InputFile): Promise<number>;                  // 0..1, by heading text, never by cell position
  parse(file: InputFile, ctx: ImportContext): Promise<ImportDraft>;
}
InputFile   { name, bytes, sheets(): Promise<Sheet[]>, pdfText(password?): Promise<PdfPage[]> }
ImportDraft { asOf?, accounts: AccountDraft[], instruments: InstrumentDraft[],
              transactions: TxnDraft[], snapshots: SnapshotDraft[],
              totals?: { invested?, value? }, warnings: string[] }
```

**The import flow**
1. **Add files:** with the file picker, by dropping files or a zip, or through the Android share target (Web Share Target API).
2. **Pick the importer:** every importer runs `detect`, and the highest score of at least 0.6 wins. If none qualifies, see §15.
3. **Parse** the file in the worker. If it's a password-protected PDF, ask for the password and keep it in memory only.
4. **Say whose file it is:** ask which member it belongs to, defaulting to the last one used.
5. **Match instruments:** by ISIN or AMFI code first. Failing that, match by name using token Jaccard of at least 0.6, with a Direct/Growth plan filter (moved over from the sheet). The user confirms each name match.
6. **Plan the import:** `planImport(state, draft)` sorts each record into *new*, *already there* (same ID), *possible duplicate*, *mismatch* or *unmatched instrument*. It also compares the file's own totals with the sum of its lines.
7. **Preview** the plan. Once the user confirms, it's saved as one `import.apply` event. The import can be undone from Settings → History.

**Personal data**
- **Allowed fields:** drafts only have typed fields. Names are the only free text.
- **Masking:** `ref` values go through `mask()`, which keeps the last 4 characters.
- **Original files** are never stored, only their sha256.
- **Test:** a check scans every fixture's parsed output for PANs (`[A-Z]{5}[0-9]{4}[A-Z]`), phone numbers and emails.

**V1 importers**

| ID | Reads | Produces |
|---|---|---|
| `groww-mf-holdings` | Groww mutual-fund holdings `.xlsx` (headings such as "Scheme Name", "Folio No.", "Units", "Invested Value", "Current Value", "XIRR"; the summary block; "HOLDINGS AS ON") | Snapshots, plus the file's own totals |
| `groww-stock-holdings` | Groww stock holdings statement `.xlsx` (headings such as "Stock Name", "ISIN", "Quantity", "Average buy price", "Closing price") | Snapshots, plus the file's own totals |
| `groww-mf-orders` | Groww mutual-fund order history `.xlsx` ("Scheme Name", "Transaction Type", "Units", "NAV", "Amount", "Date"; "TRANSACTIONS FROM … TO …") | Purchases, redemptions and switches. The file names no folio, so its account is `byHolding`: each fund's orders go to the member's folio that already holds it, or to a "Groww mutual funds" account when none does |
| `groww-stock-orders` | Groww stock order history `.xlsx` ("Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Execution date and time", "Order status"; "Order history for stocks from … to …") | Executed buys and sells, in the demat account with the same client code as the holdings statement |
| `epfo-passbook` | EPFO member passbook PDF, one per member ID (the user has two) | Monthly employee, employer and pension contributions, and interest credited each year |
| `bob-ppf-statement` | Bank of Baroda's PPF statement `.xlsx` ("OpTransactionHistory": headings "TRAN DATE", "VALUE DATE", "NARRATION", "WITHDRAWAL(DR)", "DEPOSIT(CR)", "BALANCE(INR)"; "Account No:"; "Statement Period from … to …") | Deposits, interest credits and withdrawals by value date; the closing balance as a snapshot, plus an opening snapshot when the statement starts mid-way |
| `template` | The app's own template or export `.xlsx` or `.csv` (§14) | Any entities |

Manual forms cover transactions, FDs, bonds and SGBs, PPF and EPF entries, cash balances and manual prices.

## 10. Prices

```ts
interface PriceSource {
  id: string; label: string; origins: string[]; needsKey?: boolean;
  covers(i: Instrument): boolean;
  latest(list: Instrument[], ctx): Promise<Price[]>;
  history?(list: Instrument[], from: string, to: string, ctx): Promise<Price[]>;
}
Price { key: string /* 'amfi:122639' | 'nse:NIFTYBEES' | 'isin:…' | 'fx:USDINR' */, date, close, currency, source }
```

**Which price wins:** a manual price, if it's newer than the feed price. Otherwise the feed's latest price. Otherwise the price in the last snapshot. Otherwise cost. US holdings are converted at the USD→INR rate for the same date.

### The public price feed (V1)
It's built by GitHub Actions and served from GitHub Pages, which sends `Access-Control-Allow-Origin: *`. All paths sit under `/v1/`.

| File | Contents |
|---|---|
| `manifest.json` | When it was generated, with the date and sha256 of each file |
| `latest/amfi.json.gz` | `{ date, rows: [amfiCode, isinGrowth, isinReinv, name, category, nav, navDate][] }` for every scheme, taken from AMFI `NAVAll.txt` |
| `latest/nse.json.gz` | `{ date, rows: [symbol, series, isin, close][] }` from the NSE cash-market bhavcopy. This covers stocks, ETFs, SGBs (series GB) and listed bonds. If NSE fails, BSE's bhavcopy is used. |
| `latest/fx.json` | `{ date, USDINR }` (ECB reference rates, through frankfurter.app) |
| `history/<00–ff>.json.gz` | `{ key: [date, close][] }`, in 256 groups by the first byte of sha256(key). Prices are daily for the last 400 days and month-end before that. V1 appends from launch day onwards; sub-project 3 fills in the past. |
| `rates/ppf.json`, `rates/epf.json` | Official PPF rates per quarter and EPF rates per financial year |

- **Privacy:**
  - **Latest prices:** the app always downloads whole `latest/` files.
  - **History:** it downloads a whole group of about 75 instruments, never a single instrument, so the host learns at most "one of these 75".
- **Schedule:** 18:00 UTC (23:30 IST), with a retry at 01:30 UTC.
- **Deploy:** through `actions/deploy-pages`, so nothing is committed to git and the repo doesn't grow. History groups are carried between runs in the Actions cache. If the cache is missing, the job rebuilds from the currently published site.
- **On the device:** the latest prices and the history groups it has fetched are kept in the encrypted `cache` store. The feed is checked on unlock and every 6 hours while the app is open.

## 11. Engine

Everything in the engine is a pure function in `core`.

```ts
build(events): State
positions(state, date): Position[]                 // per account × instrument: units, FIFO lots, cost, realised
summary(state, prices, date, filter?): Summary     // filter: member, account, group, asset class
history(state, prices, from, to): Point[]          // daily
income(state, fy): IncomeRow[]                     // received + accrued, per instrument
upcoming(state, from, days): Upcoming[]            // payouts, coupons, maturities, PPF deadline
checks(state, prices, today, settings): Check[]
xirr(flows: { date: string; amount: number }[]): number | null
```

### Asset types

```ts
interface AssetType {
  kinds: Instrument['kind'][];
  value(p: Position, i: Instrument, ctx): { value: number; priceDate?: string; estimate: boolean };
  projected?(p: Position, i: Instrument, from: string, to: string): CashFlow[];  // payouts, coupons, maturity
  accrued?(p: Position, i: Instrument, from: string, to: string): number;        // interest earned in a period
}
```

| Asset type | Rules |
|---|---|
| `market` (stock, etf, mf, us-stock) | units × price (§10), × FX for USD. |
| `deposit` (fd) | **Cumulative:** full compounding periods compound, and a part period earns simple interest. **Payout:** value = principal + interest accrued since the last payout, and each payout is principal × rate ÷ periods per year. Payouts that have fallen due are assumed to have been paid unless real `interest` transactions exist. **Maturity:** after the maturity date, the FD shows as *matured*, valued at its maturity amount, until the user records a `maturity` transaction, which sets it to 0 and counts as money out, or renews it. `soon.maturity` prompts for this. **Known approximation:** banks discount monthly payouts, so V1 uses rate ÷ 12, and real interest transactions override it. |
| `bond` (bond, sgb) | **Value:** market price if listed, else face value + accrued coupon. **Coupons:** face × units × coupon ÷ frequency, on the schedule from the issue date. **Maturity:** face value. **SGB:** face value = issue price, coupon 2.5% paid twice a year, 8-year term. |
| `ppf` | **Monthly interest:** for each month, take the lowest balance between the 5th and the end of the month, × that quarter's rate ÷ 12. **Crediting:** the year's interest is credited on 31 March. **Value:** balance + interest accrued since 1 April. **Maturity:** 15 years from the end of the financial year the account was opened, then 5-year extensions. |
| `epf` | **Interest:** each month on the running balance, where contributions start earning the following month. It's credited at the end of the financial year at that year's declared rate. **Value:** balance + accrued interest. **Real figures win:** interest credited in the passbook replaces the estimate. |
| `eps` | Value = the sum of contributions. Shown separately as pension money that earns no interest. |
| `cash` | The latest balance snapshot. |

### Positions and lots
- **FIFO:** lots are tracked first-in-first-out for each account and instrument. Sells and switch-outs use up the oldest lots first.
- **Bonus units** are zero-cost lots dated on the allotment date.
- **Splits** change the units and cost per unit, but keep the dates.
- **Dividend reinvestments** count as buys.

### Figures
- **Holding:**
  - **invested:** the cost of the open lots, or for deposits, PPF and EPF: principal + contributions − withdrawals.
  - **gain:** value − invested.
- **Portfolio:** Home, Holdings and Analytics use the same figures.
  - **invested** and **gain:** the sums of the holdings' invested and gain.
  - **realised gain:** sales above cost, plus dividends, interest and coupons paid out. Gain + realised gain = value − net invested, where net invested is money in − money out.
  - **return:** gain ÷ invested.
- **XIRR:**
  - **Cash flows:** money going in is negative; money coming out (sells, withdrawals, payouts, dividends paid) is positive, plus the final value today.
  - **Not cash flows:** reinvested dividends and cumulative interest stay internal.
  - **Method:** Newton's method, falling back to bisection. Returns `null` when there's no sign change.
  - **Display:** if the first flow is less than 365 days ago, the UI shows return instead.
  - **Estimates:** XIRR is marked ≈ when an `opening` position from a snapshot is involved.
- **History:**
  - **Prices:** each day uses the latest known price, carried forward. Before the first known price, cost is used, and that stretch is marked.
  - **Fixed income** is valued through its asset type on each date.
- **Income per financial year:** interest and dividends, with "received" and "accrued" columns. PPF interest is tagged tax-free. The report is labelled as a summary, not tax advice.

## 12. Checks

Each check returns `{ key, severity: 'warn'|'info', message, fix? }`. A check can be dismissed with a `Dismissal`, which syncs. The thresholds are settings.

| Key | Fires when |
|---|---|
| `price.stale` | A held instrument's price, or USD→INR, is more than 4 days old |
| `file.stale` | For a member, the latest import from a holdings importer (such as `groww-mf-holdings`) is more than 35 days old |
| `balance.stale` | A PPF or EPF account has had no transaction or snapshot for 180 days |
| `backup.none` | No sync, and no backup file made, in the last 30 days |
| `recon.units` | Ledger units differ from the latest snapshot by more than 0.001, or the value differs by more than max(₹100, 0.05%) |
| `recon.total` | A file's own totals don't equal the sum of its lines (same tolerance) |
| `recon.missing` | A position with units > 0, first seen through a holdings importer, isn't in that member's latest import from the same importer. The fix offers to record a sell. |
| `recon.unmatched` | A file line was left without an instrument at import |
| `dup.txn` | Two transactions from different sources share account, instrument, date and type, with units within 0.1% and amount within ₹1 |
| `soon.maturity` / `soon.payout` | A maturity or payout falls in the next 30 days |
| `ppf.minimum` | After 1 March, the financial year's PPF deposits are under ₹500 |
| `ppf.limit` | The financial year's PPF deposits are over ₹1,50,000 |
| `sync.conflict` | An unresolved conflict notice exists (§6) |

## 13. Screens

The app is designed for phones first, with a member filter at the top of every screen.

1. **Dashboard:**
   - net worth, invested, gain, realised gain when there is any, and XIRR
   - allocation by asset class, member or group
   - a value chart (1 month, 1 year, all time)
   - warnings from the checks, and what's coming up
2. **Holdings:** grouped by asset class, group or account. Tapping one shows its transactions, lots, XIRR and chart.
3. **Add:** import files, add a transaction, add an FD, bond, PPF or EPF entry, set a cash balance, or download a blank template.
4. **Checks:** the list, with a fix or a dismiss button on each.
5. **Income:** for each financial year, with tabs for interest and dividends.
   - **Loans** (added later): money owed to you and money you owe, counted in net worth. See [Loans](2026-10-23-loans-design.md).
   - **Cards** (added later): credit card bills and payments; what's left to pay comes off net worth. See [Credit cards](2026-10-23-credit-cards-design.md).
6. **Settings:**
   - members, accounts and groups
   - storage and sync, unlock methods, recovery code, auto-lock
   - price sources and feed URL
   - export
   - History of changes (imports and edits, with undo)
   - About (version and build hash)

**First run:** create a vault, then set a passphrase. Show the recovery code, and require it to be re-typed before continuing. Optionally add a passkey, then import the first files. "Try with sample data" opens a separate demo vault instead.

## 14. Export

**Excel** (ExcelJS) holds values only, with no live formulas. These tabs are for reading:

| Tab | Columns |
|---|---|
| Summary | As-of date, the filter used, net worth, invested, gain, realised gain, XIRR, an allocation table |
| Holdings | Member, account, group, instrument, class, units, price, price date, invested, value, gain, gain %, XIRR, weight |
| Transactions | Date, member, account, instrument, type, units, price, amount, currency, source |
| Income | Financial year, member, instrument, type, received, accrued, note |
| Coming up | Date, event, instrument, amount |
| History | Month-end, investments, invested, gain, value per class |

**Data tabs** (`_members`, `_accounts`, `_instruments`, `_transactions`, `_snapshots`, `_groups`) hold every field, including IDs, in the template format.
- **Who reads them:** the `template` importer.
- **Rows with an ID** update that entity.
- **Rows without an ID** create a new one.
- **Rows missing from the file never cause deletes.**

**Other exports**
- **JSON:** `{ format: 'portfolio-export', version: 1, exportedAt, entities }`. It holds state, not the log.
- **Encrypted backup:** the `.pvault` file (§8).

The Excel and JSON exports aren't encrypted, and the app says so before saving them.

## 15. When things go wrong

| Situation | What happens |
|---|---|
| No importer recognises a file | The app offers to copy the file's column headings, with no values, so the user can ask for an importer. |
| An import fails part-way | Nothing is saved. Imports are all or nothing, because the plan is applied as one event. |
| The price feed can't be reached | The cached prices are used and marked out of date, and the `price.stale` check fires. |
| Sync is offline | It's retried later, and the last sync time is shown. |
| A provider's login has expired | A "Reconnect" banner appears. |
| A chunk fails to decrypt or fails its checks | It's skipped and reported in Settings → Sync. The app keeps working. |
| The keyring belongs to a different vault | Sync refuses to run for that vault. |
| The browser refuses to keep data permanently | A banner appears, and `backup.none` turns into a warning. |
| An iPhone user hasn't installed the app | The app asks them to install it to the Home Screen, because iOS may clear data for sites that aren't installed. |
| The app meets a newer data format | It goes read-only and asks for an update (§6). |
| A new app version is out | "New version ready" is shown, and it applies the next time the app opens. |

## 16. Testing

- **Engine:** checked against known answers.
  - An FD of ₹1,00,000 at 7.1% compounded quarterly for one year gives ₹1,07,291.28 at maturity.
  - Monthly-payout FDs give the right payouts and dates.
  - The Groww fixture totals match the file summaries.
  - XIRR matches Excel's `XIRR` on a set of saved cases.
  - PPF and EPF interest is checked against sample passbooks.
- **Log and sync:** fast-check property tests. Delivering any set of events in any order, with duplicates or late, must give the same state. Conflict notices must be deterministic.
- **Crypto:**
  - encrypt and decrypt round trips
  - a wrong key or a tampered nonce, ciphertext or AAD is rejected
  - passphrase change, revocation and keyring merging
- **Importers:** anonymised copies of real files as fixtures, each with a saved snapshot of the parsed draft. Plus the personal-data scan from §9.
- **App:** Playwright at phone (390×844) and desktop sizes:
  - create a vault, import the Groww fixtures, and check the dashboard numbers
  - export to Excel, then re-import it and get the same state
  - lock and unlock
  - restore from a backup file
- **Price feed:** the AMFI, NSE, BSE and FX parsers are tested on saved files, and the history groups are tested for appending and capping.

## 17. Release and hosting

- **Licence:** AGPL-3.0. Every source file starts with an SPDX header.
- **The app:** hosted on Cloudflare Pages, which allows the CSP through `_headers`. Each release is a git tag with a changelog and the sha256 of the build folder, and the About screen shows the build hash.
- **The feed:** a GitHub Pages site on the same repo, published by the workflow.
- **Self-hosting:**
  - `pnpm build` produces a static `apps/web/build`.
  - Fork the repo to run your own feed.
  - Settings → Price sources holds the feed URL.
- **Contributing:** a plugin is one folder containing its code, `fixtures/` and tests, plus one line in the registry. CONTRIBUTING.md explains how to anonymise fixtures.

## 18. Reused from the Google Sheet tracker

- **Groww parsing:** reading by heading text, not cell position, and checking the summary totals.
- **Fund-name matching:** AMFI parsing in the 8-column `NAVAll.txt` format, with token Jaccard of at least 0.6 and the Direct/Growth filter.
- **Masking:** the rules for PAN, mobile number and client code.
- **FD maths and payout dates.**
- **Checks:** the tolerance max(₹100, 0.05%), and the list of check types.

## 19. Open items and risks

1. **EPF passbook format:** the `epfo-passbook` importer is written against the user's real passbooks once they're shared. The PPF statement arrived first; `bob-ppf-statement` reads it. The FD amounts are user data, entered through the forms.
2. **NSE may block GitHub's servers:** the fallback is BSE's bhavcopy, which also has ISINs. If both fail, the feed publishes yesterday's files and marks them out of date.
3. **WebAuthn PRF isn't on every browser:** the passphrase always works.
4. **iOS:** there's no share target and data may be cleared, which §15 handles. File picking still works.
5. **Trust in the hosted copy:** covered in the threats table (§7). A "verify this build" page is future work.
6. **Monthly-payout FD approximation:** see the `deposit` row in §11.
7. **Name:** pick one before the public release, and check for clashes with existing Indian fintech brands.
