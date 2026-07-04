import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  FileBrowserAdapterError,
  FileBrowserBulkActionError,
  type FileBrowserAdapter,
  type FileNode,
} from "./types";
import { joinFileBrowserPath, normalizeFileBrowserPath } from "./path";

export type FileBrowserStatus = "idle" | "loading" | "ready" | "error";
export type FileBrowserView = "grid" | "list";
export type FileBrowserKindFilter = "all" | "files" | "folders";
export type FileBrowserUploadConflictResolution =
  | "replace"
  | "keep-both"
  | "skip";
export type FileBrowserUploadFilesOptions = {
  onConflict?: FileBrowserUploadConflictResolution;
};
export type FileBrowserClipboard =
  | { type: "copy"; paths: string[] }
  | { type: "cut"; paths: string[] }
  | null;

export type FileBrowserCapabilities = {
  createFolder: boolean;
  rename: boolean;
  move: boolean;
  copy: boolean;
  stat: boolean;
  exists: boolean;
  multipart: boolean;
  bulkDownload: boolean;
};

export type UseFileBrowserOptions = {
  adapter: FileBrowserAdapter;
  initialPath?: string;
};

export type UseFileBrowserResult = {
  adapter: FileBrowserAdapter;
  capabilities: FileBrowserCapabilities;
  currentPath: string;
  status: FileBrowserStatus;
  items: FileNode[];
  error: Error | null;
  hasMore: boolean;
  selectedPaths: string[];
  selectedItems: FileNode[];
  focusedPath: string | null;
  clipboard: FileBrowserClipboard;
  view: FileBrowserView;
  searchQuery: string;
  filterKind: FileBrowserKindFilter;
  sortBy: "name" | "modifiedAt" | "size";
  sortDirection: "asc" | "desc";
  filteredItems: FileNode[];
  setView: Dispatch<SetStateAction<FileBrowserView>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setFilterKind: Dispatch<SetStateAction<FileBrowserKindFilter>>;
  setSortBy: Dispatch<SetStateAction<"name" | "modifiedAt" | "size">>;
  setSortDirection: Dispatch<SetStateAction<"asc" | "desc">>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  navigate: (path: string) => Promise<void>;
  open: (node: FileNode) => Promise<void>;
  selectOnly: (path: string) => void;
  toggleSelection: (path: string) => void;
  selectRange: (path: string) => void;
  setSelection: (paths: string[], options?: { additive?: boolean }) => void;
  selectAllLoaded: () => void;
  clearSelection: () => void;
  createFolder: (name: string) => Promise<FileNode>;
  rename: (path: string, newName: string) => Promise<FileNode>;
  deleteSelected: () => Promise<void>;
  deletePaths: (paths: string[]) => Promise<void>;
  movePathsTo: (paths: string[], toDir: string) => Promise<void>;
  moveSelectedTo: (toDir: string) => Promise<void>;
  copySelection: (paths?: string[]) => void;
  cutSelection: (paths?: string[]) => void;
  pasteInto: (toDir: string) => Promise<void>;
  uploadFiles: (
    files: File[] | FileList,
    options?: FileBrowserUploadFilesOptions,
  ) => Promise<FileNode[]>;
};

export function useFileBrowser({
  adapter,
  initialPath = "/",
}: UseFileBrowserOptions): UseFileBrowserResult {
  const [currentPath, setCurrentPath] = useState(() =>
    normalizeFileBrowserPath(initialPath),
  );
  const [status, setStatus] = useState<FileBrowserStatus>("loading");
  const [items, setItems] = useState<FileNode[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<FileBrowserClipboard>(null);
  const [view, setView] = useState<FileBrowserView>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterKind, setFilterKind] = useState<FileBrowserKindFilter>("all");
  const [sortBy, setSortBy] = useState<"name" | "modifiedAt" | "size">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const requestIdRef = useRef(0);
  const currentPathRef = useRef(currentPath);

  const capabilities = useMemo<FileBrowserCapabilities>(
    () => ({
      createFolder: typeof adapter.createFolder === "function",
      rename: typeof adapter.rename === "function",
      move: typeof adapter.move === "function",
      copy: typeof adapter.copy === "function",
      stat: typeof adapter.stat === "function",
      exists: typeof adapter.exists === "function",
      multipart:
        typeof adapter.createMultipartUpload === "function" &&
        typeof adapter.uploadPart === "function" &&
        typeof adapter.completeMultipartUpload === "function",
      bulkDownload: typeof adapter.bulkDownloadUrl === "function",
    }),
    [adapter],
  );

  const selectedPaths = useMemo(() => sortPaths(Array.from(selected)), [selected]);
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.path)),
    [items, selected],
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...items]
      .filter((item) => (query ? item.name.toLowerCase().includes(query) : true))
      .filter((item) =>
        filterKind === "all"
          ? true
          : item.kind === (filterKind === "files" ? "file" : "folder"),
      )
      .sort((left, right) => compareNodes(left, right, sortBy, sortDirection));
  }, [filterKind, items, searchQuery, sortBy, sortDirection]);

  const loadPath = useCallback(
    async (path: string, mode: "replace" | "append") => {
      const normalized = normalizeFileBrowserPath(path);
      const requestId = ++requestIdRef.current;

      setStatus((current) =>
        mode === "replace" || current === "idle" ? "loading" : current,
      );
      setError(null);

      try {
        const result = await adapter.list(normalized, {
          cursor: mode === "append" ? cursor : undefined,
        });

        if (requestId !== requestIdRef.current) {
          return;
        }

        setItems((current) =>
          mode === "append" ? mergeItems(current, result.items) : result.items,
        );
        setCursor(result.cursor);
        setStatus("ready");
      } catch (caught) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(toError(caught));
        setStatus("error");
      }
    },
    [adapter, cursor],
  );

  const refresh = useCallback(async () => {
    await loadPath(currentPath, "replace");
  }, [currentPath, loadPath]);

  const navigate = useCallback(
    async (path: string) => {
      const normalized = normalizeFileBrowserPath(path);
      currentPathRef.current = normalized;
      setCurrentPath(normalized);
      setSelected(new Set());
      setFocusedPath(null);
      setRangeAnchor(null);
      setCursor(undefined);
      await loadPath(normalized, "replace");
    },
    [loadPath],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || status === "loading") {
      return;
    }

    await loadPath(currentPath, "append");
  }, [currentPath, cursor, loadPath, status]);

  useEffect(() => {
    void Promise.resolve().then(() => loadPath(currentPath, "replace"));
    // The initial adapter load is intentionally scoped to adapter replacement.
    // Navigation calls loadPath directly after updating currentPath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  const selectOnly = useCallback((path: string) => {
    const normalized = normalizeFileBrowserPath(path);
    setSelected(new Set([normalized]));
    setFocusedPath(normalized);
    setRangeAnchor(normalized);
  }, []);

  const toggleSelection = useCallback((path: string) => {
    const normalized = normalizeFileBrowserPath(path);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
    setFocusedPath(normalized);
  }, []);

  const selectRange = useCallback(
    (path: string) => {
      const normalized = normalizeFileBrowserPath(path);
      const anchor = rangeAnchor ?? focusedPath ?? normalized;
      const visiblePaths = filteredItems.map((item) => item.path);
      const anchorIndex = visiblePaths.indexOf(anchor);
      const targetIndex = visiblePaths.indexOf(normalized);

      if (anchorIndex === -1 || targetIndex === -1) {
        selectOnly(normalized);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      setSelected(new Set(visiblePaths.slice(start, end + 1)));
      setFocusedPath(normalized);
    },
    [filteredItems, focusedPath, rangeAnchor, selectOnly],
  );

  const setSelection = useCallback(
    (paths: string[], options: { additive?: boolean } = {}) => {
      const normalizedPaths = paths.map(normalizeFileBrowserPath);
      setSelected((current) => {
        const next = options.additive ? new Set(current) : new Set<string>();
        for (const path of normalizedPaths) {
          next.add(path);
        }
        return next;
      });
      setFocusedPath(normalizedPaths.at(-1) ?? null);
      setRangeAnchor(normalizedPaths.at(0) ?? null);
    },
    [],
  );

  const selectAllLoaded = useCallback(() => {
    setSelected(new Set(items.map((item) => item.path)));
    setFocusedPath(items.at(0)?.path ?? null);
    setRangeAnchor(items.at(0)?.path ?? null);
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setFocusedPath(null);
    setRangeAnchor(null);
  }, []);

  const open = useCallback(
    async (node: FileNode) => {
      if (node.kind === "folder") {
        await navigate(node.path);
      } else {
        selectOnly(node.path);
      }
    },
    [navigate, selectOnly],
  );

  const createFolder = useCallback(
    async (name: string) => {
      if (!adapter.createFolder) {
        throw new FileBrowserAdapterError(
          "not_supported",
          "Folder creation is not supported by this adapter",
        );
      }
      const path = joinFileBrowserPath(currentPath, name.trim());
      const optimistic: FileNode = {
        path,
        name: name.trim(),
        kind: "folder",
        modifiedAt: new Date().toISOString(),
      };
      setItems((current) => mergeItems(current, [optimistic]));

      try {
        const created = await adapter.createFolder(path);
        setItems((current) => mergeItems(removePaths(current, [path]), [created]));
        return created;
      } catch (caught) {
        setItems((current) => removePaths(current, [path]));
        throw caught;
      }
    },
    [adapter, currentPath],
  );

  const rename = useCallback(
    async (path: string, newName: string) => {
      if (!adapter.rename) {
        throw new FileBrowserAdapterError(
          "not_supported",
          "Rename is not supported by this adapter",
        );
      }

      const normalized = normalizeFileBrowserPath(path);
      const previous = items;
      setItems((current) =>
        current.map((item) =>
          item.path === normalized ? { ...item, name: newName.trim() } : item,
        ),
      );

      try {
        const renamed = await adapter.rename(normalized, newName.trim());
        setItems((current) =>
          current.map((item) => (item.path === normalized ? renamed : item)),
        );
        return renamed;
      } catch (caught) {
        setItems(previous);
        throw caught;
      }
    },
    [adapter, items],
  );

  const deletePaths = useCallback(
    async (paths: string[]) => {
      const normalizedPaths = paths.map(normalizeFileBrowserPath);
      const previousItems = items;
      const previousSelected = selected;

      setItems((current) => removePaths(current, normalizedPaths));
      setSelected((current) => {
        const next = new Set(current);
        for (const path of normalizedPaths) {
          next.delete(path);
        }
        return next;
      });

      try {
        await adapter.delete(normalizedPaths);
      } catch (caught) {
        if (caught instanceof FileBrowserBulkActionError) {
          const succeededPaths = caught.succeededPaths.map(
            normalizeFileBrowserPath,
          );
          const failedPaths = caught.failures.map((failure) =>
            normalizeFileBrowserPath(failure.path),
          );
          setItems(removePaths(previousItems, succeededPaths));
          setSelected(new Set(failedPaths));
          setFocusedPath(failedPaths.at(0) ?? null);
          setRangeAnchor(failedPaths.at(0) ?? null);
          throw caught;
        }
        setItems(previousItems);
        setSelected(previousSelected);
        throw caught;
      }
    },
    [adapter, items, selected],
  );

  const deleteSelected = useCallback(async () => {
    await deletePaths(selectedPaths);
  }, [deletePaths, selectedPaths]);

  const movePathsTo = useCallback(
    async (paths: string[], toDir: string) => {
      if (!adapter.move) {
        throw new FileBrowserAdapterError(
          "not_supported",
          "Move is not supported by this adapter",
        );
      }

      const normalizedPaths = paths.map(normalizeFileBrowserPath);
      if (normalizedPaths.length === 0) {
        return;
      }

      const destination = normalizeFileBrowserPath(toDir);
      try {
        await adapter.move(normalizedPaths, destination);
      } catch (caught) {
        if (caught instanceof FileBrowserBulkActionError) {
          const succeededPaths = caught.succeededPaths.map(
            normalizeFileBrowserPath,
          );
          const failedPaths = caught.failures.map((failure) =>
            normalizeFileBrowserPath(failure.path),
          );
          if (destination === currentPath) {
            await refresh();
          } else {
            setItems((current) => removePaths(current, succeededPaths));
          }
          setSelected(new Set(failedPaths));
          setFocusedPath(failedPaths.at(0) ?? null);
          setRangeAnchor(failedPaths.at(0) ?? null);
          throw caught;
        }
        throw caught;
      }
      setSelected((current) => {
        const next = new Set(current);
        for (const path of normalizedPaths) {
          next.delete(path);
        }
        return next;
      });
      setFocusedPath(null);
      setRangeAnchor(null);

      if (destination === currentPath) {
        await refresh();
      } else {
        setItems((current) => removePaths(current, normalizedPaths));
      }
    },
    [adapter, currentPath, refresh],
  );

  const moveSelectedTo = useCallback(
    async (toDir: string) => {
      await movePathsTo(selectedPaths, toDir);
      setClipboard((current) => (current?.type === "cut" ? null : current));
    },
    [movePathsTo, selectedPaths],
  );

  const copySelection = useCallback(
    (paths = selectedPaths) => {
      setClipboard({ type: "copy", paths: paths.map(normalizeFileBrowserPath) });
    },
    [selectedPaths],
  );

  const cutSelection = useCallback(
    (paths = selectedPaths) => {
      setClipboard({ type: "cut", paths: paths.map(normalizeFileBrowserPath) });
    },
    [selectedPaths],
  );

  const pasteInto = useCallback(
    async (toDir: string) => {
      if (!clipboard || clipboard.paths.length === 0) {
        return;
      }

      const destination = normalizeFileBrowserPath(toDir);
      if (clipboard.type === "copy") {
        if (!adapter.copy) {
          throw new FileBrowserAdapterError(
            "not_supported",
            "Copy is not supported by this adapter",
          );
        }
        await adapter.copy(clipboard.paths, destination);
      } else {
        if (!adapter.move) {
          throw new FileBrowserAdapterError(
            "not_supported",
            "Move is not supported by this adapter",
          );
        }
        await movePathsTo(clipboard.paths, destination);
        setClipboard(null);
        return;
      }

      if (destination === currentPath) {
        await refresh();
      }
    },
    [adapter, clipboard, currentPath, movePathsTo, refresh],
  );

  const uploadFiles = useCallback(
    async (
      files: File[] | FileList,
      options: FileBrowserUploadFilesOptions = {},
    ) => {
      if (options.onConflict === "skip") {
        return [];
      }

      const fileArray = Array.from(files);
      const uploaded: FileNode[] = [];

      for (const file of fileArray) {
        const path = joinFileBrowserPath(currentPathRef.current, file.name);
        const result = await adapter.upload(path, file, {
          onConflict: options.onConflict ?? "keep-both",
        });
        uploaded.push(result);
        setItems((current) => mergeItems(current, [result]));
      }

      return uploaded;
    },
    [adapter],
  );

  return {
    adapter,
    capabilities,
    currentPath,
    status,
    items,
    error,
    hasMore: Boolean(cursor),
    selectedPaths,
    selectedItems,
    focusedPath,
    clipboard,
    view,
    searchQuery,
    filterKind,
    sortBy,
    sortDirection,
    filteredItems,
    setView,
    setSearchQuery,
    setFilterKind,
    setSortBy,
    setSortDirection,
    refresh,
    loadMore,
    navigate,
    open,
    selectOnly,
    toggleSelection,
    selectRange,
    setSelection,
    selectAllLoaded,
    clearSelection,
    createFolder,
    rename,
    deleteSelected,
    deletePaths,
    movePathsTo,
    moveSelectedTo,
    copySelection,
    cutSelection,
    pasteInto,
    uploadFiles,
  };
}

function mergeItems(current: FileNode[], incoming: FileNode[]): FileNode[] {
  const map = new Map(current.map((item) => [item.path, item]));
  for (const item of incoming) {
    map.set(item.path, item);
  }
  return Array.from(map.values()).sort((left, right) =>
    compareNodes(left, right, "name", "asc"),
  );
}

function removePaths(items: FileNode[], paths: string[]): FileNode[] {
  const remove = new Set(paths);
  return items.filter((item) => !remove.has(item.path));
}

function compareNodes(
  left: FileNode,
  right: FileNode,
  sortBy: "name" | "modifiedAt" | "size",
  direction: "asc" | "desc",
): number {
  const multiplier = direction === "asc" ? 1 : -1;

  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1;
  }

  if (sortBy === "size") {
    return ((left.size ?? 0) - (right.size ?? 0)) * multiplier;
  }

  if (sortBy === "modifiedAt") {
    return (
      String(left.modifiedAt ?? "").localeCompare(String(right.modifiedAt ?? "")) *
      multiplier
    );
  }

  return (
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) * multiplier
  );
}

function sortPaths(paths: string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}
