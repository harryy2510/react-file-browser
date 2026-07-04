import type { FileBrowserAdapter, FileNode } from "@/index";

export type AdapterContractFactory = {
  name: string;
  createAdapter: () => FileBrowserAdapter;
};

const textFile = (name: string, contents: string, type = "text/plain") =>
  new File([contents], name, { type });

const paths = (items: FileNode[]) => items.map((item) => item.path).sort();

function requireCreateFolder(adapter: FileBrowserAdapter) {
  if (!adapter.createFolder) {
    throw new Error("adapter under test must include createFolder");
  }
  return adapter.createFolder.bind(adapter);
}

export function defineFileBrowserAdapterContract({
  name,
  createAdapter,
}: AdapterContractFactory) {
  describe(`${name} adapter contract`, () => {
    test("creates folders, uploads files, and lists immediate children", async () => {
      const adapter = createAdapter();
      const createFolder = requireCreateFolder(adapter);

      await createFolder("/docs");
      await adapter.upload("/docs/readme.txt", textFile("readme.txt", "hello"));
      await adapter.upload("/hero.png", textFile("hero.png", "image", "image/png"));

      await expect(adapter.list("/")).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            path: "/docs",
            name: "docs",
            kind: "folder",
          }),
          expect.objectContaining({
            path: "/hero.png",
            name: "hero.png",
            kind: "file",
            mimeType: "image/png",
            size: 5,
          }),
        ]),
      });

      const docs = await adapter.list("/docs");
      expect(paths(docs.items)).toEqual(["/docs/readme.txt"]);
    });

    test("reports upload progress from zero to total bytes", async () => {
      const adapter = createAdapter();
      const progress: Array<[number, number]> = [];

      await adapter.upload("/notes.txt", textFile("notes.txt", "hello world"), {
        onProgress: (loaded, total) => progress.push([loaded, total]),
      });

      expect(progress.at(0)).toEqual([0, 11]);
      expect(progress.at(-1)).toEqual([11, 11]);
    });

    test("deletes folders recursively", async () => {
      const adapter = createAdapter();
      const createFolder = requireCreateFolder(adapter);

      await createFolder("/docs");
      await createFolder("/docs/drafts");
      await adapter.upload("/docs/drafts/a.txt", textFile("a.txt", "a"));
      await adapter.delete(["/docs"]);

      await expect(adapter.list("/")).resolves.toMatchObject({ items: [] });
    });

    test("returns signed object URLs for uploaded files", async () => {
      const adapter = createAdapter();

      await adapter.upload("/notes.txt", textFile("notes.txt", "hello"));

      await expect(adapter.signedUrl("/notes.txt")).resolves.toMatch(
        /^blob:nodedata:/,
      );
    });

    test("renames display metadata without changing immutable paths", async () => {
      const adapter = createAdapter();

      if (!adapter.rename) {
        throw new Error("adapter under test must include rename");
      }

      await adapter.upload(
        "/quarterly-report.pdf",
        textFile("quarterly-report.pdf", "pdf", "application/pdf"),
      );

      const renamed = await adapter.rename("/quarterly-report.pdf", "Q4 board.pdf");

      expect(renamed).toMatchObject({
        path: "/quarterly-report.pdf",
        name: "Q4 board.pdf",
        kind: "file",
      });
      await expect(adapter.list("/")).resolves.toMatchObject({
        items: [
          expect.objectContaining({
            path: "/quarterly-report.pdf",
            name: "Q4 board.pdf",
          }),
        ],
      });
    });

    test("copies files to a destination folder with new storage keys", async () => {
      const adapter = createAdapter();
      const createFolder = requireCreateFolder(adapter);

      if (!adapter.copy) {
        throw new Error("adapter under test must include copy");
      }

      await createFolder("/archive");
      await adapter.upload("/notes.txt", textFile("notes.txt", "hello"));
      await adapter.copy(["/notes.txt"], "/archive");

      expect(paths((await adapter.list("/archive")).items)).toEqual([
        "/archive/notes.txt",
      ]);
      expect(paths((await adapter.list("/")).items)).toEqual([
        "/archive",
        "/notes.txt",
      ]);
    });

    test("moves files and folders recursively when the capability is present", async () => {
      const adapter = createAdapter();
      const createFolder = requireCreateFolder(adapter);

      if (!adapter.move) {
        throw new Error("adapter under test must include move");
      }

      await createFolder("/archive");
      await createFolder("/docs");
      await adapter.upload("/docs/readme.txt", textFile("readme.txt", "hello"));
      await adapter.move(["/docs"], "/archive");

      expect(paths((await adapter.list("/")).items)).toEqual(["/archive"]);
      expect(paths((await adapter.list("/archive/docs")).items)).toEqual([
        "/archive/docs/readme.txt",
      ]);
    });
  });
}
