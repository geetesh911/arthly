// SPDX-License-Identifier: AGPL-3.0-only
// Google Drive as a storage provider (§8). With the drive.file permission the app sees only what it
// made: an `Arthly` folder in My Drive holding one folder per vault, named by the vault's ID. A
// vault's files sit flat in its folder, each named by its logical path, so one list reads them all.
import { OfflineError, type StorageProvider } from '../../../sync/stores.ts';
import { concatBytes, randomBytes, toHex, utf8 } from '../../../util/bytes.ts';

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** For the CSP's connect-src. */
export const DRIVE_ORIGINS = ['https://www.googleapis.com'];
export const ROOT_FOLDER = 'Arthly';
const FOLDER = 'application/vnd.google-apps.folder';
const VAULT_FOLDER = /^vault_[a-z2-7]+$/;

/** Google refused in a way trying again won't fix, such as a full Drive. */
export class DriveError extends Error {
  override name = 'DriveError';
}

/** The sign-in no longer works: the user has to connect again. */
export class ReconnectError extends Error {
  override name = 'ReconnectError';
}

/** Where access tokens come from; `fresh` asks for a new one after Drive refused the last. */
export interface DriveAuth {
  token(fresh?: boolean): Promise<string>;
}

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  parents: string[];
  created: string;
  modified: string;
}

interface ApiFile {
  id: string;
  name: string;
  size?: string;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
}

/** Quotes a value for a Drive search. */
const quote = (text: string) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const oldestFirst = (a: DriveFile, b: DriveFile) => a.created.localeCompare(b.created);

/** Google's reason for an error, such as 'storageQuotaExceeded'. */
async function reason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { status?: string; errors?: { reason?: string }[] };
    };

    return body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  } catch {
    return '';
  }
}

export class GoogleDrive {
  constructor(
    private fetcher: typeof fetch,
    private auth: DriveAuth,
  ) {}

  /** One Drive call, signed in. A 401 gets a fresh token once; a 404 is answered if `missing`. */
  async request(url: string, init: RequestInit = {}, missing = false): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.token(attempt > 0);
      let res: Response;

      try {
        res = await this.fetcher(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            authorization: `Bearer ${token}`,
          },
        });
      } catch {
        throw new OfflineError('Google Drive could not be reached');
      }

      if (res.ok || (missing && res.status === 404)) {
        return res;
      }

      const why = await reason(res);

      if (res.status === 401) {
        if (attempt === 0) {
          continue;
        }

        throw new ReconnectError('Google Drive needs you to sign in again');
      }

      if (res.status === 429 || res.status >= 500 || /rateLimitExceeded/i.test(why)) {
        throw new OfflineError('Google Drive is busy');
      }

      if (why === 'storageQuotaExceeded') {
        throw new DriveError('Your Google Drive is full');
      }

      throw new DriveError(
        `Google Drive refused a request (${res.status}${why ? `, ${why}` : ''})`,
      );
    }
  }

  /** Every file a search finds, page by page. */
  async search(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page: string | undefined;

    do {
      const params = new URLSearchParams({
        q,
        spaces: 'drive',
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,size,parents,createdTime,modifiedTime)',
        ...(page ? { pageToken: page } : {}),
      });
      const body = (await (await this.request(`${DRIVE_API}/files?${params}`)).json()) as {
        nextPageToken?: string;
        files?: ApiFile[];
      };

      for (const f of body.files ?? []) {
        out.push({
          id: f.id,
          name: f.name,
          size: Number(f.size ?? 0),
          parents: f.parents ?? [],
          created: f.createdTime ?? '',
          modified: f.modifiedTime ?? '',
        });
      }

      page = body.nextPageToken;
    } while (page);

    return out;
  }

  private async createFolder(name: string, parent: string): Promise<string> {
    const res = await this.request(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    });

    return ((await res.json()) as { id: string }).id;
  }

  /** The Arthly folders, and the vault folders in them, oldest first. */
  private async folders(): Promise<{ roots: DriveFile[]; vaults: DriveFile[] }> {
    const all = (await this.search(`mimeType = '${FOLDER}' and trashed = false`)).sort(oldestFirst);
    const roots = all.filter((f) => f.name === ROOT_FOLDER);
    const ids = new Set(roots.map((f) => f.id));
    const vaults = all.filter(
      (f) => VAULT_FOLDER.test(f.name) && f.parents.some((p) => ids.has(p)),
    );

    return { roots, vaults };
  }

  /** Every vault with a folder here, each once: two devices connecting at once can make two. */
  async vaults(): Promise<{ vaultId: string; folderId: string }[]> {
    const seen = new Map<string, string>();

    for (const f of (await this.folders()).vaults) {
      if (!seen.has(f.name)) {
        seen.set(f.name, f.id);
      }
    }

    return [...seen].map(([vaultId, folderId]) => ({ vaultId, folderId }));
  }

  /** The vault's folder, made with the Arthly folder if needed when `create`. */
  async vaultFolder(vaultId: string, create: boolean): Promise<string | undefined> {
    const { roots, vaults } = await this.folders();
    const found = vaults.find((f) => f.name === vaultId);

    if (found || !create) {
      return found?.id;
    }

    return this.createFolder(
      vaultId,
      roots[0]?.id ?? (await this.createFolder(ROOT_FOLDER, 'root')),
    );
  }

  folder(folderId: string): GoogleDriveFolder {
    return new GoogleDriveFolder(this, folderId);
  }

  /** The account's email address, to show which Drive is connected. */
  async account(): Promise<string | undefined> {
    try {
      const res = await this.request(`${DRIVE_API}/about?fields=user(emailAddress)`);

      return ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress;
    } catch {
      return undefined;
    }
  }
}

/** One vault's folder, as the sync engine's storage. */
export class GoogleDriveFolder implements StorageProvider {
  readonly id = 'google-drive';
  readonly label = 'Google Drive';
  readonly origins = DRIVE_ORIGINS;
  /** File IDs by name, newest first, from the last listing. */
  private ids = new Map<string, string[]>();

  constructor(
    private drive: GoogleDrive,
    readonly folderId: string,
  ) {}

  private async files(name?: string): Promise<DriveFile[]> {
    const files = await this.drive.search(
      `${quote(this.folderId)} in parents and trashed = false${name === undefined ? '' : ` and name = ${quote(name)}`}`,
    );

    files.sort((a, b) => b.modified.localeCompare(a.modified));

    if (name === undefined) {
      this.ids.clear();
    } else {
      this.ids.delete(name);
    }

    for (const f of files) {
      this.ids.set(f.name, [...(this.ids.get(f.name) ?? []), f.id]);
    }

    return files;
  }

  private async idsOf(path: string): Promise<string[]> {
    if (!this.ids.has(path)) {
      await this.files(path);
    }

    return this.ids.get(path) ?? [];
  }

  async list(prefix: string) {
    const out = new Map<string, number>();

    for (const f of await this.files()) {
      if (f.name.startsWith(prefix) && !out.has(f.name)) {
        out.set(f.name, f.size);
      }
    }

    return [...out].map(([path, size]) => ({ path, size }));
  }

  async read(path: string): Promise<Uint8Array> {
    const [id] = await this.idsOf(path);

    if (!id) {
      throw new DriveError(`${path} isn't in Google Drive`);
    }

    const res = await this.drive.request(`${DRIVE_API}/files/${id}?alt=media`, {}, true);

    // Another device can tidy up a file between the listing and the read.
    if (res.status === 404) {
      throw new OfflineError(`${path} left Google Drive during the sync`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const type = path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    // The sync pass lists the folder first, so a name not seen there is new.
    const [id] = this.ids.get(path) ?? [];

    if (id) {
      await this.drive.request(`${DRIVE_UPLOAD}/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'content-type': type },
        body: new Uint8Array(bytes),
      });

      return;
    }

    const boundary = `arthly${toHex(randomBytes(12))}`;
    const meta = JSON.stringify({ name: path, parents: [this.folderId] });
    const res = await this.drive.request(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: concatBytes(
        utf8.encode(
          `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
            `--${boundary}\r\ncontent-type: ${type}\r\n\r\n`,
        ),
        bytes,
        utf8.encode(`\r\n--${boundary}--`),
      ),
    });

    this.ids.set(path, [((await res.json()) as { id: string }).id]);
  }

  async remove(path: string): Promise<void> {
    for (const id of await this.idsOf(path)) {
      await this.drive.request(`${DRIVE_API}/files/${id}`, { method: 'DELETE' }, true);
    }

    this.ids.delete(path);
  }
}
