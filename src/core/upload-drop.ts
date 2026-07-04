export type FileBrowserUploadCandidate = {
  file: File;
  relativePath: string;
};

type FileSystemEntryLike =
  | FileSystemFileEntryLike
  | FileSystemDirectoryEntryLike;

type FileSystemFileEntryLike = {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (
    success: (file: File) => void,
    error?: (error: DOMException) => void,
  ) => void;
};

type FileSystemDirectoryEntryLike = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      error?: (error: DOMException) => void,
    ) => void;
  };
};

type DataTransferItemWithEntry = {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

export async function collectUploadCandidatesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<FileBrowserUploadCandidate[]> {
  const entries = Array.from(dataTransfer.items)
    .map(
      (item) =>
        (item as unknown as DataTransferItemWithEntry).webkitGetAsEntry?.(),
    )
    .filter((entry): entry is FileSystemEntryLike => Boolean(entry));

  if (entries.length === 0) {
    return getFileBrowserUploadCandidates(dataTransfer.files);
  }

  const candidates: FileBrowserUploadCandidate[] = [];
  for (const entry of entries) {
    candidates.push(...(await collectEntryCandidates(entry)));
  }
  return candidates;
}

export function getFileBrowserUploadCandidates(
  files: File[] | FileList,
): FileBrowserUploadCandidate[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: sanitizeRelativePath(getFileRelativePath(file)),
  }));
}

async function collectEntryCandidates(
  entry: FileSystemEntryLike,
  prefix = "",
): Promise<FileBrowserUploadCandidate[]> {
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    return [
      {
        file,
        relativePath: sanitizeRelativePath(joinRelativePath(prefix, file.name)),
      },
    ];
  }

  const nextPrefix = joinRelativePath(prefix, entry.name);
  const entries = await readAllDirectoryEntries(entry);
  const candidates: FileBrowserUploadCandidate[] = [];

  for (const child of entries) {
    candidates.push(...(await collectEntryCandidates(child, nextPrefix)));
  }

  return candidates;
}

function readEntryFile(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllDirectoryEntries(
  entry: FileSystemDirectoryEntryLike,
): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      break;
    }
    entries.push(...batch);
  }

  return entries;
}

function getFileRelativePath(file: File): string {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return withRelativePath.webkitRelativePath || file.name;
}

function joinRelativePath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function sanitizeRelativePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}
