import { describe, expect, test, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { InMemoryFileBrowserAdapter } from "@/adapters/in-memory";
import type {
  FileBrowserAdapter,
  FileBrowserUploadOptions,
  FileNode,
} from "@/index";
import { TransferManager } from "@/transfers/transfer-manager";

type UploadPartArgs = Parameters<
  NonNullable<FileBrowserAdapter["uploadPart"]>
>[0];

const fileOfSize = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { type: "application/octet-stream" });

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

describe("TransferManager", () => {
  test("runs simple uploads, reports progress, and arms beforeunload while active", async () => {
    const upload = vi.fn(
      (
        _path: string,
        file: File,
        opts?: FileBrowserUploadOptions,
      ): Promise<FileNode> => {
        opts?.onProgress?.(0, file.size);
        opts?.onProgress?.(file.size, file.size);
        return Promise.resolve({
          path: "/demo.bin",
          name: "demo.bin",
          kind: "file",
          size: file.size,
        });
      },
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      upload,
    };
    const manager = new TransferManager();

    const id = manager.enqueueUpload({
      adapter,
      destinationPath: "/demo.bin",
      file: fileOfSize("demo.bin", 10),
    });

    expect(manager.hasActiveTransfers()).toBe(true);
    await manager.waitForIdle();

    const job = manager.getSnapshot().uploads.find((upload) => upload.id === id);
    expect(job).toMatchObject({
      status: "completed",
      loadedBytes: 10,
      totalBytes: 10,
    });
    expect(manager.hasActiveTransfers()).toBe(false);
  });

  test("passes conflict resolution to simple uploads", async () => {
    const upload = vi.fn(
      (
        path: string,
        file: File,
        opts?: FileBrowserUploadOptions,
      ): Promise<FileNode> =>
        Promise.resolve({
          path:
            opts?.onConflict === "keep-both"
              ? path.replace(".bin", " (1).bin")
              : path,
          name: file.name,
          kind: "file",
          size: file.size,
        }),
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      upload,
    };
    const manager = new TransferManager({ idFactory: () => "upload-1" });

    manager.enqueueUpload({
      adapter,
      destinationPath: "/demo.bin",
      file: fileOfSize("demo.bin", 10),
      onConflict: "keep-both",
    });
    await manager.waitForIdle();

    expect(upload).toHaveBeenCalledWith(
      "/demo.bin",
      expect.any(File),
      expect.objectContaining({ onConflict: "keep-both" }),
    );
    expect(manager.getUpload("upload-1")?.result?.path).toBe(
      "/demo (1).bin",
    );
  });

  test("records upload speed samples from progress events", async () => {
    const times = [
      new Date("2026-07-04T00:00:00.000Z"),
      new Date("2026-07-04T00:00:01.000Z"),
      new Date("2026-07-04T00:00:02.000Z"),
      new Date("2026-07-04T00:00:03.000Z"),
      new Date("2026-07-04T00:00:04.000Z"),
    ];
    const upload = vi.fn(
      (
        _path: string,
        file: File,
        opts?: FileBrowserUploadOptions,
      ): Promise<FileNode> => {
        opts?.onProgress?.(0, file.size);
        opts?.onProgress?.(5, file.size);
        opts?.onProgress?.(10, file.size);
        return Promise.resolve({
          path: "/demo.bin",
          name: "demo.bin",
          kind: "file",
          size: file.size,
        });
      },
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      upload,
    };
    const manager = new TransferManager({
      idFactory: () => "upload-1",
      now: () => times.shift() ?? new Date("2026-07-04T00:00:04.000Z"),
    });

    manager.enqueueUpload({
      adapter,
      destinationPath: "/demo.bin",
      file: fileOfSize("demo.bin", 10),
    });
    await manager.waitForIdle();

    expect(manager.getUpload("upload-1")).toMatchObject({
      status: "completed",
      bytesPerSecond: 5,
    });
  });

  test("uses multipart capabilities and resumes from completed parts", async () => {
    const uploadedParts: number[] = [];
    let failPartThree = true;
    const completeMultipartUpload = vi.fn(
      (): Promise<FileNode> =>
        Promise.resolve({
          path: "/big.bin",
          name: "big.bin",
          kind: "file",
          size: 10,
        }),
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      upload: vi.fn(),
      createMultipartUpload: vi.fn(() =>
        Promise.resolve({
          uploadId: "upload-1",
          partSize: 4,
        }),
      ),
      uploadPart: vi.fn(({ partNumber, chunk, onProgress }: UploadPartArgs) => {
        if (partNumber === 3 && failPartThree) {
          failPartThree = false;
          return Promise.reject(new Error("network"));
        }
        uploadedParts.push(partNumber);
        onProgress?.(chunk.size);
        return Promise.resolve({ etag: `etag-${partNumber}` });
      }),
      completeMultipartUpload,
      abortMultipartUpload: vi.fn(),
    };
    const manager = new TransferManager({
      storage: window.localStorage,
      storageKey: "rfb-transfer-test",
    });

    const id = manager.enqueueUpload({
      adapter,
      destinationPath: "/big.bin",
      file: fileOfSize("big.bin", 10),
    });
    await manager.waitForIdle();

    expect(manager.getUpload(id)?.status).toBe("failed");
    expect(manager.getUpload(id)?.completedParts.map((part) => part.partNumber)).toEqual([
      1,
      2,
    ]);

    await manager.resumeUpload(id);
    await manager.waitForIdle();

    expect(uploadedParts).toEqual([1, 2, 3]);
    expect(manager.getUpload(id)?.status).toBe("completed");
    expect(completeMultipartUpload).toHaveBeenCalledWith({
      uploadId: "upload-1",
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
        { partNumber: 3, etag: "etag-3" },
      ],
    });
    expect(window.localStorage.getItem("rfb-transfer-test")).toContain(
      "\"status\":\"completed\"",
    );
  });

  test("reattaches persisted uploads after refresh and resumes from completed parts", async () => {
    const storageKey = "rfb-restored-resume";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        uploads: [
          {
            id: "upload-1",
            kind: "upload",
            status: "failed",
            path: "/big.bin",
            name: "big.bin",
            loadedBytes: 4,
            totalBytes: 10,
            completedParts: [{ partNumber: 1, etag: "etag-1" }],
            uploadId: "multipart-1",
            partSize: 4,
            createdAt: "2026-07-04T00:00:00.000Z",
            updatedAt: "2026-07-04T00:00:01.000Z",
          },
        ],
        downloads: [],
      }),
    );
    const uploadedParts: number[] = [];
    const createMultipartUpload = vi.fn();
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      upload: vi.fn(),
      createMultipartUpload,
      uploadPart: vi.fn(({ partNumber, chunk, onProgress }: UploadPartArgs) => {
        uploadedParts.push(partNumber);
        onProgress?.(chunk.size);
        return Promise.resolve({ etag: `etag-${partNumber}` });
      }),
      completeMultipartUpload: vi.fn(
        (): Promise<FileNode> =>
          Promise.resolve({
          path: "/big.bin",
          name: "big.bin",
          kind: "file",
          size: 10,
          }),
      ),
    };
    const manager = new TransferManager({
      storage: window.localStorage,
      storageKey,
    });

    await manager.resumeRestoredUpload({
      adapter,
      file: fileOfSize("big.bin", 10),
      id: "upload-1",
    });
    await manager.waitForIdle();

    expect(createMultipartUpload).not.toHaveBeenCalled();
    expect(uploadedParts).toEqual([2, 3]);
    expect(manager.getUpload("upload-1")).toMatchObject({
      status: "completed",
      loadedBytes: 10,
    });
  });

  test("allocates a keep-both path before starting multipart uploads", async () => {
    const adapter = new InMemoryFileBrowserAdapter({
      capabilities: { multipart: true },
      multipartPartSize: 4,
    });
    await adapter.upload("/big.bin", fileOfSize("big.bin", 10));
    const manager = new TransferManager({ idFactory: () => "upload-1" });

    manager.enqueueUpload({
      adapter,
      destinationPath: "/big.bin",
      file: fileOfSize("big.bin", 10),
      onConflict: "keep-both",
    });
    await manager.waitForIdle();

    expect(manager.getUpload("upload-1")).toMatchObject({
      status: "completed",
      path: "/big (1).bin",
    });
    expect((await adapter.list("/")).items.map((item) => item.path).sort()).toEqual(
      ["/big (1).bin", "/big.bin"],
    );
  });

  test("replaces an existing path through multipart uploads", async () => {
    const adapter = new InMemoryFileBrowserAdapter({
      capabilities: { multipart: true },
      multipartPartSize: 4,
    });
    await adapter.upload("/big.bin", fileOfSize("big.bin", 4));
    const manager = new TransferManager({ idFactory: () => "upload-1" });

    manager.enqueueUpload({
      adapter,
      destinationPath: "/big.bin",
      file: fileOfSize("big.bin", 10),
      onConflict: "replace",
    });
    await manager.waitForIdle();

    expect(manager.getUpload("upload-1")).toMatchObject({
      status: "completed",
      path: "/big.bin",
    });
    expect(await adapter.stat?.("/big.bin")).toMatchObject({
      path: "/big.bin",
      size: 10,
    });
    expect((await adapter.list("/")).items.map((item) => item.path)).toEqual([
      "/big.bin",
    ]);
  });

  test("prefers server zip and falls back to client zip with size warning", async () => {
    const serverAdapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      signedUrl: vi.fn(),
      upload: vi.fn(),
      bulkDownloadUrl: vi.fn(() =>
        Promise.resolve({
        url: "https://files.example/archive.zip",
        expiresAt: "2026-07-04T04:00:00.000Z",
        }),
      ),
    };
    const manager = new TransferManager();

    const serverJob = await manager.prepareBulkDownload({
      adapter: serverAdapter,
      paths: ["/a.txt", "/b.txt"],
      selectedBytes: 100,
    });

    expect(serverJob).toMatchObject({
      status: "ready",
      strategy: "server",
      url: "https://files.example/archive.zip",
    });

    const clientAdapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
      signedUrl: vi.fn((path: string) => Promise.resolve(`blob:client-${path}`)),
    };

    const clientJob = await manager.prepareBulkDownload({
      adapter: clientAdapter,
      paths: ["/a.txt"],
      selectedBytes: 500,
      warnZipSizeBytes: 100,
    });

    expect(clientJob).toMatchObject({
      status: "warning",
      strategy: "client",
      warning: "client_zip_size",
    });
  });

  test("does not restore expired or stale completed downloads", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "transfers",
      JSON.stringify({
        uploads: [],
        downloads: [
          {
            id: "expired",
            kind: "bulk-download",
            status: "ready",
            strategy: "server",
            paths: ["/expired.zip"],
            selectedBytes: 1,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            url: "https://example.test/expired.zip",
            expiresAt: "2026-07-02T00:00:00.000Z",
          },
          {
            id: "stale",
            kind: "bulk-download",
            status: "ready",
            strategy: "single",
            paths: ["/stale.txt"],
            selectedBytes: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            updatedAt: "2026-07-02T00:00:00.000Z",
            url: "https://example.test/stale.txt",
          },
          {
            id: "current",
            kind: "bulk-download",
            status: "ready",
            strategy: "server",
            paths: ["/current.zip"],
            selectedBytes: 1,
            createdAt: "2026-07-04T00:00:00.000Z",
            updatedAt: "2026-07-04T00:00:00.000Z",
            url: "https://example.test/current.zip",
            expiresAt: "2026-07-04T02:00:00.000Z",
          },
        ],
      }),
    );

    const manager = new TransferManager({
      now: () => new Date("2026-07-04T00:00:00.000Z"),
      storage,
      storageKey: "transfers",
    });

    expect(manager.getSnapshot().downloads.map((download) => download.id)).toEqual([
      "current",
    ]);
    expect(storage.getItem("transfers")).toContain("current");
    expect(storage.getItem("transfers")).not.toContain("expired");
    expect(storage.getItem("transfers")).not.toContain("stale");
  });

  test("uses signed URLs for single-file downloads", async () => {
    const signedUrl = vi.fn(() =>
      Promise.resolve("https://files.example/report.pdf"),
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
      signedUrl,
    };
    const manager = new TransferManager({ idFactory: () => "download-1" });

    const job = await manager.prepareSingleDownload({
      adapter,
      path: "/report.pdf",
      selectedBytes: 20,
    });

    expect(job).toMatchObject({
      id: "download-1",
      status: "ready",
      strategy: "single",
      paths: ["/report.pdf"],
      selectedBytes: 20,
      url: "https://files.example/report.pdf",
    });
    expect(signedUrl).toHaveBeenCalledWith("/report.pdf");
  });

  test("creates a real client zip from signed URLs", async () => {
    let zipBlob: Blob | undefined;
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob: Blob | MediaSource) => {
        zipBlob = blob as Blob;
        return "blob:zip";
      });
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        new Response(url.endsWith("a.txt") ? "alpha" : "beta", {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const signedUrl = vi.fn((path: string) =>
      Promise.resolve(`https://files${path}`),
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
      signedUrl,
    };
    const manager = new TransferManager();

    const job = await manager.prepareBulkDownload({
      adapter,
      paths: ["/docs/a.txt", "/b.txt"],
      selectedBytes: 10,
    });

    expect(job).toMatchObject({
      status: "ready",
      strategy: "client",
      url: "blob:zip",
    });
    expect(signedUrl).toHaveBeenCalledWith("/docs/a.txt");
    expect(signedUrl).toHaveBeenCalledWith("/b.txt");
    expect(fetch).toHaveBeenCalledWith("https://files/docs/a.txt");
    expect(fetch).toHaveBeenCalledWith("https://files/b.txt");
    expect(zipBlob?.type).toBe("application/zip");

    const entries = unzipSync(new Uint8Array(await zipBlob!.arrayBuffer()));
    expect(strFromU8(entries["docs/a.txt"])).toBe("alpha");
    expect(strFromU8(entries["b.txt"])).toBe("beta");

    createObjectUrl.mockRestore();
    vi.unstubAllGlobals();
  });

  test("continues a warned client zip after user confirmation", async () => {
    let zipBlob: Blob | undefined;
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob: Blob | MediaSource) => {
        zipBlob = blob as Blob;
        return "blob:confirmed-zip";
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("confirmed", { status: 200 }))),
    );
    const adapter: FileBrowserAdapter = {
      list: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
      signedUrl: vi.fn((path: string) => Promise.resolve(`https://files${path}`)),
    };
    const manager = new TransferManager();

    const warning = await manager.prepareBulkDownload({
      adapter,
      paths: ["/large.txt"],
      selectedBytes: 500,
      warnZipSizeBytes: 100,
    });

    expect(warning.status).toBe("warning");
    expect(manager.hasActiveTransfers()).toBe(false);

    const confirmed = await manager.confirmBulkDownload(warning.id);

    expect(confirmed).toMatchObject({
      status: "ready",
      url: "blob:confirmed-zip",
    });
    expect(zipBlob?.type).toBe("application/zip");

    createObjectUrl.mockRestore();
    vi.unstubAllGlobals();
  });
});
