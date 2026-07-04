import {
  FileBrowserAdapterError,
  type FileBrowserAdapter,
  type FileBrowserListOptions,
  type FileBrowserListResult,
  type FileBrowserUploadOptions,
  type FileNode,
} from "../../core/types";
import {
  getFileBrowserBasename,
  getFileBrowserDirname,
  joinFileBrowserPath,
  normalizeFileBrowserPath,
} from "../../core/path";
import {
  UnsupportedCloudFileBrowserAdapter,
  type CloudFileBrowserAdapterOptions,
} from "../cloud-adapter-base";

export type SupabaseStorageBucket = {
  copy?: (
    fromPath: string,
    toPath: string,
  ) => Promise<SupabaseResult<{ path?: string }>>;
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => Promise<SupabaseResult<{ signedUrl: string }>>;
  list: (
    path: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: { column: string; order: "asc" | "desc" };
    },
  ) => Promise<SupabaseResult<SupabaseListEntry[]>>;
  remove?: (paths: string[]) => Promise<SupabaseResult<unknown>>;
  upload: (
    path: string,
    file: Blob | File | string,
    options?: {
      contentType?: string;
      upsert?: boolean;
    },
  ) => Promise<SupabaseResult<{ path?: string }>>;
};

export type SupabaseClientLike = {
  storage: {
    from(bucket: string): SupabaseStorageBucket;
  };
};

export type SupabaseFileBrowserAdapterOptions =
  CloudFileBrowserAdapterOptions & {
    bucket?: string;
    client?: SupabaseClientLike;
    pageSize?: number;
    prefix?: string;
    signedUrlExpiresIn?: number;
  };

type SupabaseResult<T> = {
  data: T | null;
  error: SupabaseErrorLike | null;
};

type SupabaseErrorLike = {
  message?: string;
  name?: string;
  statusCode?: number | string;
};

type SupabaseListEntry = {
  id?: string | null;
  metadata?: {
    mimetype?: string;
    size?: number;
  } | null;
  name: string;
  updated_at?: string | null;
};

type SupabaseSdkConfig = {
  bucket: SupabaseStorageBucket;
  pageSize: number;
  prefix: string;
  signedUrlExpiresIn: number;
};

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SIGNED_URL_EXPIRES_IN = 60 * 60;
const EMPTY_FOLDER_MARKER = ".emptyFolderPlaceholder";

export class SupabaseStorageFileBrowserAdapter implements FileBrowserAdapter {
  createFolder?: NonNullable<FileBrowserAdapter["createFolder"]>;
  rename?: NonNullable<FileBrowserAdapter["rename"]>;
  move?: NonNullable<FileBrowserAdapter["move"]>;
  copy?: NonNullable<FileBrowserAdapter["copy"]>;
  stat?: NonNullable<FileBrowserAdapter["stat"]>;
  exists?: NonNullable<FileBrowserAdapter["exists"]>;
  createMultipartUpload?: NonNullable<
    FileBrowserAdapter["createMultipartUpload"]
  >;
  uploadPart?: NonNullable<FileBrowserAdapter["uploadPart"]>;
  completeMultipartUpload?: NonNullable<
    FileBrowserAdapter["completeMultipartUpload"]
  >;
  abortMultipartUpload?: NonNullable<
    FileBrowserAdapter["abortMultipartUpload"]
  >;
  bulkDownloadUrl?: NonNullable<FileBrowserAdapter["bulkDownloadUrl"]>;

  private readonly delegate?: UnsupportedCloudFileBrowserAdapter;
  private readonly sdk?: SupabaseSdkConfig;

  constructor(options: SupabaseFileBrowserAdapterOptions = {}) {
    if (!options.client || !options.bucket) {
      this.delegate = new UnsupportedCloudFileBrowserAdapter(
        "Supabase",
        options,
      );
      this.createFolder = this.delegate.createFolder?.bind(this.delegate);
      this.rename = this.delegate.rename?.bind(this.delegate);
      this.move = this.delegate.move?.bind(this.delegate);
      this.copy = this.delegate.copy?.bind(this.delegate);
      this.stat = this.delegate.stat?.bind(this.delegate);
      this.exists = this.delegate.exists?.bind(this.delegate);
      this.createMultipartUpload =
        this.delegate.createMultipartUpload?.bind(this.delegate);
      this.uploadPart = this.delegate.uploadPart?.bind(this.delegate);
      this.completeMultipartUpload =
        this.delegate.completeMultipartUpload?.bind(this.delegate);
      this.abortMultipartUpload =
        this.delegate.abortMultipartUpload?.bind(this.delegate);
      this.bulkDownloadUrl = this.delegate.bulkDownloadUrl?.bind(this.delegate);
      return;
    }

    this.sdk = {
      bucket: options.client.storage.from(options.bucket),
      pageSize: Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE),
      prefix: normalizeObjectPrefix(options.prefix),
      signedUrlExpiresIn:
        options.signedUrlExpiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN,
    };
    this.createFolder = this.createFolderEntry.bind(this);
    this.copy = this.copyEntries.bind(this);
    this.stat = this.statEntry.bind(this);
    this.exists = this.existsEntries.bind(this);
  }

  async list(
    path: string,
    opts: FileBrowserListOptions = {},
  ): Promise<FileBrowserListResult> {
    if (!this.sdk) {
      return this.delegate!.list(path, opts);
    }
    throwIfAborted(opts.signal);
    const offset = parseCursor(opts.cursor);
    const data = await this.unwrap(
      this.sdk.bucket.list(this.pathToKey(path), {
        limit: this.sdk.pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    );

    const items = data
      .filter((entry) => entry.name !== EMPTY_FOLDER_MARKER)
      .map((entry) => this.entryToNode(path, entry))
      .sort(compareNodes);

    return {
      cursor:
        data.length === this.sdk.pageSize
          ? String(offset + data.length)
          : undefined,
      items,
    };
  }

  private async createFolderEntry(path: string): Promise<FileNode> {
    const sdk = this.sdk;
    if (!sdk) {
      throw new FileBrowserAdapterError(
        "not_supported",
        "Supabase adapter method createFolder requires a host-backed implementation.",
      );
    }
    const normalized = normalizeFileBrowserPath(path);
    await this.unwrap(
      sdk.bucket.upload(
        `${this.pathToKey(normalized)}/${EMPTY_FOLDER_MARKER}`,
        "",
        {
          contentType: "application/x-directory",
          upsert: false,
        },
      ),
    );
    return {
      kind: "folder",
      name: getFileBrowserBasename(normalized),
      path: normalized,
    };
  }

  async delete(paths: string[]): Promise<void> {
    if (!this.sdk) {
      return this.delegate!.delete(paths);
    }
    if (!this.sdk.bucket.remove) {
      throw new FileBrowserAdapterError(
        "not_supported",
        "Supabase storage remove is not available on this client.",
      );
    }

    const keys = new Set<string>();
    for (const path of paths) {
      for (const key of await this.resolveKeysForPath(path)) {
        keys.add(key);
      }
    }

    if (keys.size > 0) {
      await this.unwrap(this.sdk.bucket.remove(Array.from(keys)));
    }
  }

  async signedUrl(path: string): Promise<string> {
    if (!this.sdk) {
      return this.delegate!.signedUrl(path);
    }

    const data = await this.unwrap(
      this.sdk.bucket.createSignedUrl(
        this.pathToKey(path),
        this.sdk.signedUrlExpiresIn,
      ),
    );
    return data.signedUrl;
  }

  async upload(
    path: string,
    file: File,
    opts: FileBrowserUploadOptions = {},
  ): Promise<FileNode> {
    if (!this.sdk) {
      return this.delegate!.upload(path, file, opts);
    }
    throwIfAborted(opts.signal);
    const normalized = await this.resolveUploadPath(path, opts.onConflict);
    opts.onProgress?.(0, file.size);
    throwIfAborted(opts.signal);

    await this.unwrap(
      this.sdk.bucket.upload(this.pathToKey(normalized), file, {
        contentType: file.type || undefined,
        upsert: opts.onConflict === "replace",
      }),
    );
    opts.onProgress?.(file.size, file.size);

    return {
      kind: "file",
      mimeType: file.type || undefined,
      name: getFileBrowserBasename(normalized) || file.name,
      path: normalized,
      size: file.size,
    };
  }

  private async statEntry(path: string): Promise<FileNode> {
    const normalized = normalizeFileBrowserPath(path);
    const parentKey = this.pathToKey(getFileBrowserDirname(normalized));
    const basename = getFileBrowserBasename(normalized);
    const entries = await this.unwrap(
      this.sdk!.bucket.list(parentKey, {
        limit: this.sdk!.pageSize,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      }),
    );
    const entry = entries.find((item) => item.name === basename);
    if (!entry) {
      throw new FileBrowserAdapterError(
        "not_found",
        `No Supabase storage entry exists at ${normalized}`,
      );
    }
    return this.entryToNode(getFileBrowserDirname(normalized), entry);
  }

  private async existsEntries(paths: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    await Promise.all(
      paths.map(async (path) => {
        const normalized = normalizeFileBrowserPath(path);
        try {
          await this.statEntry(normalized);
          result[normalized] = true;
        } catch (error) {
          if (!isAdapterNotFound(error)) {
            throw error;
          }
          result[normalized] = false;
        }
      }),
    );
    return result;
  }

  private async copyEntries(from: string[], toDir: string): Promise<void> {
    if (!this.sdk!.bucket.copy) {
      throw new FileBrowserAdapterError(
        "not_supported",
        "Supabase storage copy is not available on this client.",
      );
    }

    for (const sourcePath of from) {
      const normalizedSource = normalizeFileBrowserPath(sourcePath);
      const sourceBase = `${this.pathToKey(normalizedSource)}/`;
      const destinationBase = this.pathToKey(
        joinFileBrowserPath(toDir, getFileBrowserBasename(normalizedSource)),
      );
      const sourceKeys = await this.resolveKeysForPath(normalizedSource);

      for (const sourceKey of sourceKeys) {
        const suffix = sourceKey.startsWith(sourceBase)
          ? sourceKey.slice(sourceBase.length)
          : getFileBrowserBasename(normalizeFileBrowserPath(sourceKey));
        const destinationKey = suffix
          ? `${destinationBase}/${suffix}`
          : destinationBase;
        await this.unwrap(this.sdk!.bucket.copy(sourceKey, destinationKey));
      }
    }
  }

  private async resolveKeysForPath(path: string): Promise<string[]> {
    const normalized = normalizeFileBrowserPath(path);
    const keys = new Set<string>();

    if (await this.keyExists(normalized)) {
      keys.add(this.pathToKey(normalized));
    }

    await this.collectFolderKeys(this.pathToKey(normalized), keys);
    return Array.from(keys);
  }

  private async collectFolderKeys(
    folderKey: string,
    keys: Set<string>,
  ): Promise<void> {
    const entries = await this.unwrap(
      this.sdk!.bucket.list(folderKey, {
        limit: this.sdk!.pageSize,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      }),
    );

    for (const entry of entries) {
      const key = folderKey ? `${folderKey}/${entry.name}` : entry.name;
      if (isSupabaseFolder(entry)) {
        await this.collectFolderKeys(key, keys);
      } else {
        keys.add(key);
      }
    }
  }

  private async keyExists(path: string): Promise<boolean> {
    try {
      await this.statEntry(path);
      return true;
    } catch (error) {
      if (isAdapterNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private async resolveUploadPath(
    path: string,
    onConflict: FileBrowserUploadOptions["onConflict"],
  ): Promise<string> {
    let normalized = normalizeFileBrowserPath(path);
    if (onConflict === "replace") {
      return normalized;
    }
    if (!(await this.keyExists(normalized))) {
      return normalized;
    }
    if (onConflict !== "keep-both") {
      throw new FileBrowserAdapterError(
        "conflict",
        `A file browser entry already exists at ${normalized}`,
      );
    }
    for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
      normalized = addCopySuffix(path, index);
      if (!(await this.keyExists(normalized))) {
        return normalized;
      }
    }
    throw new FileBrowserAdapterError(
      "conflict",
      `Could not allocate a unique file browser path for ${path}`,
    );
  }

  private entryToNode(parentPath: string, entry: SupabaseListEntry): FileNode {
    const path = joinFileBrowserPath(parentPath, entry.name);
    if (isSupabaseFolder(entry)) {
      return {
        kind: "folder",
        modifiedAt: entry.updated_at ?? undefined,
        name: entry.name,
        path,
      };
    }
    return {
      kind: "file",
      mimeType: entry.metadata?.mimetype,
      modifiedAt: entry.updated_at ?? undefined,
      name: entry.name,
      path,
      size: entry.metadata?.size,
    };
  }

  private pathToKey(path: string): string {
    const normalized = normalizeFileBrowserPath(path);
    const relative = normalized === "/" ? "" : normalized.slice(1);
    if (this.sdk!.prefix && relative) {
      return `${this.sdk!.prefix}/${relative}`;
    }
    return this.sdk!.prefix || relative;
  }

  private async unwrap<T>(result: Promise<SupabaseResult<T>>): Promise<T> {
    const { data, error } = await result;
    if (error) {
      throw toSupabaseAdapterError(error);
    }
    if (data === null) {
      throw new FileBrowserAdapterError(
        "not_found",
        "Supabase storage returned no data.",
      );
    }
    return data;
  }
}

function normalizeObjectPrefix(prefix: string | undefined): string {
  return (prefix ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isSupabaseFolder(entry: SupabaseListEntry): boolean {
  return entry.id === null || !entry.metadata;
}

function compareNodes(left: FileNode, right: FileNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function addCopySuffix(path: string, index: number): string {
  const normalized = normalizeFileBrowserPath(path);
  const basename = getFileBrowserBasename(normalized);
  const dotIndex = basename.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const stem = hasExtension ? basename.slice(0, dotIndex) : basename;
  const extension = hasExtension ? basename.slice(dotIndex) : "";
  const dir = normalized.slice(0, Math.max(1, normalized.lastIndexOf("/")));
  return normalizeFileBrowserPath(`${dir}/${stem} (${index})${extension}`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new FileBrowserAdapterError("aborted", "The operation was aborted.");
  }
}

function isAdapterNotFound(error: unknown): boolean {
  return error instanceof FileBrowserAdapterError && error.code === "not_found";
}

function toSupabaseAdapterError(error: SupabaseErrorLike): FileBrowserAdapterError {
  const status =
    typeof error.statusCode === "string"
      ? Number.parseInt(error.statusCode, 10)
      : error.statusCode;
  if (status === 403 || error.name === "AccessDenied") {
    return new FileBrowserAdapterError(
      "access_denied",
      error.message ?? "Access denied by Supabase storage.",
      { cause: error },
    );
  }
  if (status === 404 || error.name === "NotFound") {
    return new FileBrowserAdapterError(
      "not_found",
      error.message ?? "Supabase storage object was not found.",
      { cause: error },
    );
  }
  if (status === 409 || error.name === "Conflict") {
    return new FileBrowserAdapterError(
      "conflict",
      error.message ?? "Supabase storage object already exists.",
      { cause: error },
    );
  }
  return new FileBrowserAdapterError(
    "not_supported",
    error.message ?? "Supabase storage request failed.",
    { cause: error },
  );
}
