import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { FileBrowserAdapterError, FileBrowserBulkActionError } from './types'
import type { FileBrowserAdapter, FileNode } from './types'
import {
	getFileBrowserDirname,
	isFileBrowserDescendantOrSelf,
	joinFileBrowserPath,
	normalizeFileBrowserPath
} from './path'

export type FileBrowserStatus = 'idle' | 'loading' | 'ready' | 'error'
export type FileBrowserFolderChildren<TMetadata = unknown> = {
	status: 'loading' | 'ready' | 'error'
	items: FileNode<TMetadata>[]
	cursor?: string
	error: Error | null
}
/** A flattened list-view row: an item at some nesting depth, or a status line for an expanded folder. */
export type FileBrowserListRow<TMetadata = unknown> =
	| { type: 'item'; item: FileNode<TMetadata>; depth: number; expanded: boolean }
	| {
			type: 'status'
			parentPath: string
			depth: number
			status: 'loading' | 'empty' | 'error' | 'more'
			error: Error | null
	  }
export type FileBrowserView = 'grid' | 'list'
export type FileBrowserKindFilter = 'all' | 'files' | 'folders'
export type FileBrowserUploadConflictResolution = 'replace' | 'keep-both' | 'skip'
export type FileBrowserUploadFilesOptions = {
	onConflict?: FileBrowserUploadConflictResolution
}
export type FileBrowserClipboard = { type: 'copy'; paths: string[] } | { type: 'cut'; paths: string[] } | null

export type FileBrowserCapabilities = {
	createFolder: boolean
	rename: boolean
	move: boolean
	copy: boolean
	stat: boolean
	exists: boolean
	multipart: boolean
	bulkDownload: boolean
}

export type FileBrowserPathChangeContext<TMetadata = unknown> =
	| {
			source: 'item'
			item: FileNode<TMetadata>
	  }
	| {
			source: 'breadcrumb' | 'programmatic'
			item?: FileNode<TMetadata>
	  }

export type UseFileBrowserOptions<TMetadata = unknown> = {
	adapter: FileBrowserAdapter<TMetadata>
	path?: string
	initialPath?: string
	onPathChange?: (path: string, context: FileBrowserPathChangeContext<TMetadata>) => void
	searchQuery?: string
	initialSearchQuery?: string
	onSearchQueryChange?: (query: string) => void
	/** The view the browser opens in. Defaults to the list. */
	initialView?: FileBrowserView
}

export type UseFileBrowserResult<TMetadata = unknown> = {
	adapter: FileBrowserAdapter<TMetadata>
	capabilities: FileBrowserCapabilities
	currentPath: string
	status: FileBrowserStatus
	items: FileNode<TMetadata>[]
	error: Error | null
	hasMore: boolean
	selectedPaths: string[]
	selectedItems: FileNode<TMetadata>[]
	focusedPath: string | null
	clipboard: FileBrowserClipboard
	view: FileBrowserView
	searchQuery: string
	filterKind: FileBrowserKindFilter
	sortBy: 'name' | 'modifiedAt' | 'size'
	sortDirection: 'asc' | 'desc'
	filteredItems: FileNode<TMetadata>[]
	/** List view rows with expanded folders' children inlined. */
	listRows: FileBrowserListRow<TMetadata>[]
	/** Items in on-screen order: `filteredItems` in grid view, every item row of `listRows` in list view. */
	visibleItems: FileNode<TMetadata>[]
	expandedPaths: string[]
	setView: Dispatch<SetStateAction<FileBrowserView>>
	setSearchQuery: Dispatch<SetStateAction<string>>
	setFilterKind: Dispatch<SetStateAction<FileBrowserKindFilter>>
	setSortBy: Dispatch<SetStateAction<'name' | 'modifiedAt' | 'size'>>
	setSortDirection: Dispatch<SetStateAction<'asc' | 'desc'>>
	refresh: () => Promise<void>
	loadMore: () => Promise<void>
	navigate: (path: string, context?: FileBrowserPathChangeContext<TMetadata>) => Promise<void>
	open: (node: FileNode<TMetadata>) => Promise<void>
	expandFolder: (path: string) => void
	collapseFolder: (path: string) => void
	toggleFolder: (path: string) => void
	loadMoreFolder: (path: string) => void
	selectOnly: (path: string) => void
	toggleSelection: (path: string) => void
	selectRange: (path: string) => void
	setSelection: (paths: string[], options?: { additive?: boolean }) => void
	selectAllLoaded: () => void
	clearSelection: () => void
	createFolder: (name: string) => Promise<FileNode<TMetadata>>
	rename: (path: string, newName: string) => Promise<FileNode<TMetadata>>
	deleteSelected: () => Promise<void>
	deletePaths: (paths: string[]) => Promise<void>
	movePathsTo: (paths: string[], toDir: string) => Promise<void>
	moveSelectedTo: (toDir: string) => Promise<void>
	copySelection: (paths?: string[]) => void
	cutSelection: (paths?: string[]) => void
	pasteInto: (toDir: string) => Promise<void>
	uploadFiles: (files: File[] | FileList, options?: FileBrowserUploadFilesOptions) => Promise<FileNode<TMetadata>[]>
}

export function useFileBrowser<TMetadata = unknown>({
	adapter,
	path,
	initialPath = '/',
	onPathChange,
	searchQuery: controlledSearchQuery,
	initialSearchQuery = '',
	onSearchQueryChange,
	initialView = 'list'
}: UseFileBrowserOptions<TMetadata>): UseFileBrowserResult<TMetadata> {
	const controlledPath = path === undefined ? undefined : normalizeFileBrowserPath(path)
	const [uncontrolledPath, setUncontrolledPath] = useState(() => normalizeFileBrowserPath(initialPath))
	const currentPath = controlledPath ?? uncontrolledPath
	const [status, setStatus] = useState<FileBrowserStatus>('loading')
	const [items, setItems] = useState<FileNode<TMetadata>[]>([])
	const [cursor, setCursor] = useState<string | undefined>()
	const [error, setError] = useState<Error | null>(null)
	const [selected, setSelected] = useState<Set<string>>(() => new Set())
	const [focusedPath, setFocusedPath] = useState<string | null>(null)
	const [rangeAnchor, setRangeAnchor] = useState<string | null>(null)
	const [clipboard, setClipboard] = useState<FileBrowserClipboard>(null)
	const [view, setViewState] = useState<FileBrowserView>(initialView)
	const viewRef = useRef(view)
	viewRef.current = view
	const [uncontrolledSearchQuery, setUncontrolledSearchQuery] = useState(initialSearchQuery)
	const searchQuery = controlledSearchQuery ?? uncontrolledSearchQuery
	const [filterKind, setFilterKind] = useState<FileBrowserKindFilter>('all')
	const [sortBy, setSortBy] = useState<'name' | 'modifiedAt' | 'size'>('name')
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
	const [folderChildren, setFolderChildren] = useState<Map<string, FileBrowserFolderChildren<TMetadata>>>(
		() => new Map()
	)
	const expandedRef = useRef(expanded)
	expandedRef.current = expanded
	const folderChildrenRef = useRef(folderChildren)
	folderChildrenRef.current = folderChildren
	const folderRequestCounterRef = useRef(0)
	const folderRequestIdsRef = useRef(new Map<string, number>())
	const requestIdRef = useRef(0)
	const currentPathRef = useRef(currentPath)
	const cursorRef = useRef<string | undefined>(undefined)
	const searchQueryRef = useRef(searchQuery)
	searchQueryRef.current = searchQuery

	const setSearchQuery = useCallback<Dispatch<SetStateAction<string>>>(
		(nextQuery) => {
			const resolved = typeof nextQuery === 'function' ? nextQuery(searchQueryRef.current) : nextQuery
			searchQueryRef.current = resolved
			if (controlledSearchQuery === undefined) {
				setUncontrolledSearchQuery(resolved)
			}
			onSearchQueryChange?.(resolved)
		},
		[controlledSearchQuery, onSearchQueryChange]
	)

	const setView = useCallback<Dispatch<SetStateAction<FileBrowserView>>>((nextView) => {
		const resolved = typeof nextView === 'function' ? nextView(viewRef.current) : nextView
		viewRef.current = resolved
		setViewState(resolved)
		if (resolved !== 'grid') return
		// Grid shows only the current folder, so selections made inside expanded list-view folders would be hidden.
		const isNested = (path: string | null) => path !== null && getFileBrowserDirname(path) !== currentPathRef.current
		setSelected((current) => {
			const next = new Set(Array.from(current).filter((path) => !isNested(path)))
			return next.size === current.size ? current : next
		})
		setFocusedPath((current) => (isNested(current) ? null : current))
		setRangeAnchor((current) => (isNested(current) ? null : current))
	}, [])

	const capabilities = useMemo<FileBrowserCapabilities>(
		() => ({
			createFolder: typeof adapter.createFolder === 'function',
			rename: typeof adapter.rename === 'function',
			move: typeof adapter.move === 'function',
			copy: typeof adapter.copy === 'function',
			stat: typeof adapter.stat === 'function',
			exists: typeof adapter.exists === 'function',
			multipart:
				typeof adapter.createMultipartUpload === 'function' &&
				typeof adapter.uploadPart === 'function' &&
				typeof adapter.completeMultipartUpload === 'function',
			bulkDownload: typeof adapter.bulkDownloadUrl === 'function'
		}),
		[adapter]
	)

	const selectedPaths = useMemo(() => sortPaths(Array.from(selected)), [selected])
	const selectedItems = useMemo(() => {
		const nodes = new Map(items.map((item) => [item.path, item]))
		for (const entry of folderChildren.values()) {
			for (const item of entry.items) {
				if (!nodes.has(item.path)) nodes.set(item.path, item)
			}
		}
		return Array.from(nodes.values()).filter((item) => selected.has(item.path))
	}, [folderChildren, items, selected])

	const filteredItems = useMemo(
		() => filterAndSortNodes(items, searchQuery, filterKind, sortBy, sortDirection),
		[filterKind, items, searchQuery, sortBy, sortDirection]
	)

	const listRows = useMemo(() => {
		const rows: FileBrowserListRow<TMetadata>[] = []
		const visit = (nodes: FileNode<TMetadata>[], depth: number) => {
			for (const item of nodes) {
				const isExpanded = item.kind === 'folder' && expanded.has(item.path)
				rows.push({ type: 'item', item, depth, expanded: isExpanded })
				if (!isExpanded) continue

				const entry = folderChildren.get(item.path)
				// Search narrows the current folder only; expanded children stay complete, like an OS outline view.
				const children = entry ? filterAndSortNodes(entry.items, '', filterKind, sortBy, sortDirection) : []
				visit(children, depth + 1)
				const status = getFolderRowStatus(entry, children.length)
				if (status) {
					rows.push({ type: 'status', parentPath: item.path, depth: depth + 1, status, error: entry?.error ?? null })
				}
			}
		}
		visit(filteredItems, 0)
		return rows
	}, [expanded, filterKind, filteredItems, folderChildren, sortBy, sortDirection])

	const visibleItems = useMemo(
		() => (view === 'list' ? listRows.flatMap((row) => (row.type === 'item' ? [row.item] : [])) : filteredItems),
		[filteredItems, listRows, view]
	)
	const expandedPaths = useMemo(() => sortPaths(Array.from(expanded)), [expanded])

	const loadFolder = useCallback(
		async (folderPath: string, mode: 'replace' | 'append') => {
			const requestId = ++folderRequestCounterRef.current
			folderRequestIdsRef.current.set(folderPath, requestId)
			const cursor = mode === 'append' ? folderChildrenRef.current.get(folderPath)?.cursor : undefined
			setFolderChildren((current) =>
				withFolderChildren(current, folderPath, {
					items: current.get(folderPath)?.items ?? [],
					cursor: current.get(folderPath)?.cursor,
					status: 'loading',
					error: null
				})
			)

			try {
				const result = await adapter.list(folderPath, { cursor })
				if (folderRequestIdsRef.current.get(folderPath) !== requestId) {
					return
				}
				setFolderChildren((current) =>
					withFolderChildren(current, folderPath, {
						items: mode === 'append' ? mergeItems(current.get(folderPath)?.items ?? [], result.items) : result.items,
						cursor: result.cursor,
						status: 'ready',
						error: null
					})
				)
			} catch (caught) {
				if (folderRequestIdsRef.current.get(folderPath) !== requestId) {
					return
				}
				setFolderChildren((current) =>
					withFolderChildren(current, folderPath, {
						items: current.get(folderPath)?.items ?? [],
						cursor: current.get(folderPath)?.cursor,
						status: 'error',
						error: toError(caught)
					})
				)
			}
		},
		[adapter]
	)

	const reloadExpandedFolders = useCallback(
		async (paths: Iterable<string> = expandedRef.current) => {
			const targets = Array.from(paths).filter((path) => expandedRef.current.has(path))
			await Promise.all(targets.map((path) => loadFolder(path, 'replace')))
		},
		[loadFolder]
	)

	const resetTree = useCallback(() => {
		folderRequestIdsRef.current.clear()
		setExpanded(new Set())
		setFolderChildren(new Map())
	}, [])

	const pruneTree = useCallback((paths: string[]) => {
		for (const folderPath of Array.from(folderRequestIdsRef.current.keys())) {
			if (paths.some((path) => isFileBrowserDescendantOrSelf(path, folderPath))) {
				folderRequestIdsRef.current.delete(folderPath)
			}
		}
		setExpanded((current) => pruneExpandedPaths(current, paths))
		setFolderChildren((current) => pruneFolderChildren(current, paths))
	}, [])

	const expandFolder = useCallback(
		(folderPath: string) => {
			const normalized = normalizeFileBrowserPath(folderPath)
			setExpanded((current) => (current.has(normalized) ? current : new Set(current).add(normalized)))
			void loadFolder(normalized, 'replace')
		},
		[loadFolder]
	)

	const collapseFolder = useCallback((folderPath: string) => {
		const normalized = normalizeFileBrowserPath(folderPath)
		const isHidden = (path: string | null) =>
			path !== null && path !== normalized && isFileBrowserDescendantOrSelf(normalized, path)
		setExpanded((current) => {
			if (!current.has(normalized)) return current
			const next = new Set(current)
			next.delete(normalized)
			return next
		})
		// Hidden rows must not stay selected, or keyboard delete/move would act on items the user cannot see.
		setSelected((current) => {
			const next = new Set(Array.from(current).filter((path) => !isHidden(path)))
			return next.size === current.size ? current : next
		})
		setFocusedPath((current) => (isHidden(current) ? normalized : current))
		setRangeAnchor((current) => (isHidden(current) ? null : current))
	}, [])

	const toggleFolder = useCallback(
		(folderPath: string) => {
			if (expandedRef.current.has(normalizeFileBrowserPath(folderPath))) {
				collapseFolder(folderPath)
			} else {
				expandFolder(folderPath)
			}
		},
		[collapseFolder, expandFolder]
	)

	const loadMoreFolder = useCallback(
		(folderPath: string) => {
			const normalized = normalizeFileBrowserPath(folderPath)
			const entry = folderChildrenRef.current.get(normalized)
			if (!entry?.cursor || entry.status === 'loading') {
				return
			}
			void loadFolder(normalized, 'append')
		},
		[loadFolder]
	)

	const loadPath = useCallback(
		async (path: string, mode: 'replace' | 'append') => {
			const normalized = normalizeFileBrowserPath(path)
			const requestId = ++requestIdRef.current

			setStatus((current) => (mode === 'replace' || current === 'idle' ? 'loading' : current))
			setError(null)

			try {
				const result = await adapter.list(normalized, {
					cursor: mode === 'append' ? cursorRef.current : undefined
				})

				if (requestId !== requestIdRef.current) {
					return
				}

				setItems((current) => (mode === 'append' ? mergeItems(current, result.items) : result.items))
				cursorRef.current = result.cursor
				setCursor(result.cursor)
				setStatus('ready')
			} catch (caught) {
				if (requestId !== requestIdRef.current) {
					return
				}

				setError(toError(caught))
				setStatus('error')
			}
		},
		[adapter]
	)

	const refresh = useCallback(async () => {
		await Promise.all([loadPath(currentPath, 'replace'), reloadExpandedFolders()])
	}, [currentPath, loadPath, reloadExpandedFolders])

	const navigate = useCallback(
		async (nextPath: string, context: FileBrowserPathChangeContext<TMetadata> = { source: 'programmatic' }) => {
			const normalized = normalizeFileBrowserPath(nextPath)
			if (normalized === currentPathRef.current) {
				return
			}

			onPathChange?.(normalized, context)
			if (controlledPath !== undefined) {
				return
			}

			currentPathRef.current = normalized
			setUncontrolledPath(normalized)
			setSelected(new Set())
			setFocusedPath(null)
			setRangeAnchor(null)
			resetTree()
			cursorRef.current = undefined
			setCursor(undefined)
			await loadPath(normalized, 'replace')
		},
		[controlledPath, loadPath, onPathChange, resetTree]
	)

	const loadMore = useCallback(async () => {
		if (!cursor || status === 'loading') {
			return
		}

		await loadPath(currentPath, 'append')
	}, [currentPath, cursor, loadPath, status])

	useEffect(() => {
		const nextPath = currentPath
		if (nextPath !== currentPathRef.current) {
			currentPathRef.current = nextPath
			setSelected(new Set())
			setFocusedPath(null)
			setRangeAnchor(null)
		}
		resetTree()
		cursorRef.current = undefined
		setCursor(undefined)
		void Promise.resolve().then(() => loadPath(nextPath, 'replace'))
		// Uncontrolled navigation loads directly. This effect handles adapter
		// replacement and externally controlled path changes only.
		// oxlint-disable-next-line react/exhaustive-deps
	}, [adapter, controlledPath])

	const selectOnly = useCallback((path: string) => {
		const normalized = normalizeFileBrowserPath(path)
		setSelected(new Set([normalized]))
		setFocusedPath(normalized)
		setRangeAnchor(normalized)
	}, [])

	const toggleSelection = useCallback((path: string) => {
		const normalized = normalizeFileBrowserPath(path)
		setSelected((current) => {
			const next = new Set(current)
			if (next.has(normalized)) {
				next.delete(normalized)
			} else {
				next.add(normalized)
			}
			return next
		})
		setFocusedPath(normalized)
	}, [])

	const selectRange = useCallback(
		(path: string) => {
			const normalized = normalizeFileBrowserPath(path)
			const anchor = rangeAnchor ?? focusedPath ?? normalized
			const visiblePaths = visibleItems.map((item) => item.path)
			const anchorIndex = visiblePaths.indexOf(anchor)
			const targetIndex = visiblePaths.indexOf(normalized)

			if (anchorIndex === -1 || targetIndex === -1) {
				selectOnly(normalized)
				return
			}

			const start = Math.min(anchorIndex, targetIndex)
			const end = Math.max(anchorIndex, targetIndex)
			setSelected(new Set(visiblePaths.slice(start, end + 1)))
			setFocusedPath(normalized)
		},
		[focusedPath, rangeAnchor, selectOnly, visibleItems]
	)

	const setSelection = useCallback((paths: string[], options: { additive?: boolean } = {}) => {
		const normalizedPaths = paths.map(normalizeFileBrowserPath)
		setSelected((current) => {
			const next = options.additive ? new Set(current) : new Set<string>()
			for (const path of normalizedPaths) {
				next.add(path)
			}
			return next
		})
		setFocusedPath(normalizedPaths.at(-1) ?? null)
		setRangeAnchor(normalizedPaths.at(0) ?? null)
	}, [])

	const selectAllLoaded = useCallback(() => {
		const paths = new Set(items.map((item) => item.path))
		if (view === 'list') {
			for (const item of visibleItems) paths.add(item.path)
		}
		setSelected(paths)
		setFocusedPath(items.at(0)?.path ?? null)
		setRangeAnchor(items.at(0)?.path ?? null)
	}, [items, view, visibleItems])

	const clearSelection = useCallback(() => {
		setSelected(new Set())
		setFocusedPath(null)
		setRangeAnchor(null)
	}, [])

	const open = useCallback(
		async (node: FileNode<TMetadata>) => {
			if (node.kind === 'folder') {
				await navigate(node.path, { source: 'item', item: node })
			} else {
				selectOnly(node.path)
			}
		},
		[navigate, selectOnly]
	)

	const createFolder = useCallback(
		async (name: string) => {
			if (!adapter.createFolder) {
				throw new FileBrowserAdapterError('not_supported', 'Folder creation is not supported by this adapter')
			}
			const path = joinFileBrowserPath(currentPath, name.trim())
			const optimistic: FileNode<TMetadata> = {
				path,
				name: name.trim(),
				kind: 'folder',
				modifiedAt: new Date().toISOString()
			}
			setItems((current) => mergeItems(current, [optimistic]))

			try {
				const created = await adapter.createFolder(path)
				setItems((current) => mergeItems(removePaths(current, [path]), [created]))
				return created
			} catch (caught) {
				setItems((current) => removePaths(current, [path]))
				throw caught
			}
		},
		[adapter, currentPath]
	)

	const rename = useCallback(
		async (path: string, newName: string) => {
			if (!adapter.rename) {
				throw new FileBrowserAdapterError('not_supported', 'Rename is not supported by this adapter')
			}

			const normalized = normalizeFileBrowserPath(path)
			const previous = items
			const previousChildren = folderChildrenRef.current
			const replace = (next: (item: FileNode<TMetadata>) => FileNode<TMetadata>) => {
				const update = (nodes: FileNode<TMetadata>[]) =>
					nodes.map((item) => (item.path === normalized ? next(item) : item))
				setItems(update)
				setFolderChildren((current) => mapFolderChildItems(current, update))
			}
			replace((item) => ({ ...item, name: newName.trim() }))

			try {
				const renamed = await adapter.rename(normalized, newName.trim())
				replace(() => renamed)
				return renamed
			} catch (caught) {
				setItems(previous)
				setFolderChildren(previousChildren)
				throw caught
			}
		},
		[adapter, items]
	)

	const deletePaths = useCallback(
		async (paths: string[]) => {
			const normalizedPaths = paths.map(normalizeFileBrowserPath)
			const previousItems = items
			const previousSelected = selected
			const previousExpanded = expandedRef.current
			const previousChildren = folderChildrenRef.current

			setItems((current) => removePaths(current, normalizedPaths))
			pruneTree(normalizedPaths)
			setSelected((current) => {
				const next = new Set(current)
				for (const path of normalizedPaths) {
					next.delete(path)
				}
				return next
			})

			try {
				await adapter.delete(normalizedPaths)
			} catch (caught) {
				if (caught instanceof FileBrowserBulkActionError) {
					const succeededPaths = caught.succeededPaths.map(normalizeFileBrowserPath)
					const failedPaths = caught.failures.map((failure) => normalizeFileBrowserPath(failure.path))
					setItems(removePaths(previousItems, succeededPaths))
					setExpanded(pruneExpandedPaths(previousExpanded, succeededPaths))
					setFolderChildren(pruneFolderChildren(previousChildren, succeededPaths))
					setSelected(new Set(failedPaths))
					setFocusedPath(failedPaths.at(0) ?? null)
					setRangeAnchor(failedPaths.at(0) ?? null)
					throw caught
				}
				setItems(previousItems)
				setExpanded(previousExpanded)
				setFolderChildren(previousChildren)
				setSelected(previousSelected)
				throw caught
			}
		},
		[adapter, items, pruneTree, selected]
	)

	const deleteSelected = useCallback(async () => {
		await deletePaths(selectedPaths)
	}, [deletePaths, selectedPaths])

	const movePathsTo = useCallback(
		async (paths: string[], toDir: string) => {
			if (!adapter.move) {
				throw new FileBrowserAdapterError('not_supported', 'Move is not supported by this adapter')
			}

			const normalizedPaths = paths.map(normalizeFileBrowserPath)
			if (normalizedPaths.length === 0) {
				return
			}

			const destination = normalizeFileBrowserPath(toDir)
			try {
				await adapter.move(normalizedPaths, destination)
			} catch (caught) {
				if (caught instanceof FileBrowserBulkActionError) {
					const succeededPaths = caught.succeededPaths.map(normalizeFileBrowserPath)
					const failedPaths = caught.failures.map((failure) => normalizeFileBrowserPath(failure.path))
					pruneTree(succeededPaths)
					if (destination === currentPath) {
						await refresh()
					} else {
						setItems((current) => removePaths(current, succeededPaths))
						await reloadExpandedFolders([destination])
					}
					setSelected(new Set(failedPaths))
					setFocusedPath(failedPaths.at(0) ?? null)
					setRangeAnchor(failedPaths.at(0) ?? null)
					throw caught
				}
				throw caught
			}
			setSelected((current) => {
				const next = new Set(current)
				for (const path of normalizedPaths) {
					next.delete(path)
				}
				return next
			})
			setFocusedPath(null)
			setRangeAnchor(null)
			pruneTree(normalizedPaths)

			if (destination === currentPath) {
				await refresh()
			} else {
				setItems((current) => removePaths(current, normalizedPaths))
				await reloadExpandedFolders([destination])
			}
		},
		[adapter, currentPath, pruneTree, refresh, reloadExpandedFolders]
	)

	const moveSelectedTo = useCallback(
		async (toDir: string) => {
			await movePathsTo(selectedPaths, toDir)
			setClipboard((current) => (current?.type === 'cut' ? null : current))
		},
		[movePathsTo, selectedPaths]
	)

	const copySelection = useCallback(
		(paths = selectedPaths) => {
			setClipboard({ type: 'copy', paths: paths.map(normalizeFileBrowserPath) })
		},
		[selectedPaths]
	)

	const cutSelection = useCallback(
		(paths = selectedPaths) => {
			setClipboard({ type: 'cut', paths: paths.map(normalizeFileBrowserPath) })
		},
		[selectedPaths]
	)

	const pasteInto = useCallback(
		async (toDir: string) => {
			if (!clipboard || clipboard.paths.length === 0) {
				return
			}

			const destination = normalizeFileBrowserPath(toDir)
			if (clipboard.type === 'copy') {
				if (!adapter.copy) {
					throw new FileBrowserAdapterError('not_supported', 'Copy is not supported by this adapter')
				}
				await adapter.copy(clipboard.paths, destination)
			} else {
				if (!adapter.move) {
					throw new FileBrowserAdapterError('not_supported', 'Move is not supported by this adapter')
				}
				await movePathsTo(clipboard.paths, destination)
				setClipboard(null)
				return
			}

			if (destination === currentPath) {
				await refresh()
			} else {
				await reloadExpandedFolders([destination])
			}
		},
		[adapter, clipboard, currentPath, movePathsTo, refresh, reloadExpandedFolders]
	)

	const uploadFiles = useCallback(
		async (files: File[] | FileList, options: FileBrowserUploadFilesOptions = {}) => {
			if (options.onConflict === 'skip') {
				return []
			}

			const fileArray = Array.from(files)
			const uploaded: FileNode<TMetadata>[] = []

			for (const file of fileArray) {
				const path = joinFileBrowserPath(currentPathRef.current, file.name)
				const result = await adapter.upload(path, file, {
					onConflict: options.onConflict ?? 'keep-both'
				})
				uploaded.push(result)
				setItems((current) => mergeItems(current, [result]))
			}

			return uploaded
		},
		[adapter]
	)

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
		listRows,
		visibleItems,
		expandedPaths,
		setView,
		setSearchQuery,
		setFilterKind,
		setSortBy,
		setSortDirection,
		refresh,
		loadMore,
		navigate,
		open,
		expandFolder,
		collapseFolder,
		toggleFolder,
		loadMoreFolder,
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
		uploadFiles
	}
}

function mergeItems<TMetadata>(current: FileNode<TMetadata>[], incoming: FileNode<TMetadata>[]): FileNode<TMetadata>[] {
	const map = new Map(current.map((item) => [item.path, item]))
	for (const item of incoming) {
		map.set(item.path, item)
	}
	return Array.from(map.values()).sort((left, right) => compareNodes(left, right, 'name', 'asc'))
}

function removePaths<TMetadata>(items: FileNode<TMetadata>[], paths: string[]): FileNode<TMetadata>[] {
	const remove = new Set(paths)
	return items.filter((item) => !remove.has(item.path))
}

function filterAndSortNodes<TMetadata>(
	items: FileNode<TMetadata>[],
	searchQuery: string,
	filterKind: FileBrowserKindFilter,
	sortBy: 'name' | 'modifiedAt' | 'size',
	sortDirection: 'asc' | 'desc'
): FileNode<TMetadata>[] {
	const query = searchQuery.trim().toLowerCase()
	return items
		.filter((item) => (query ? item.name.toLowerCase().includes(query) : true))
		.filter((item) => (filterKind === 'all' ? true : item.kind === (filterKind === 'files' ? 'file' : 'folder')))
		.sort((left, right) => compareNodes(left, right, sortBy, sortDirection))
}

function getFolderRowStatus<TMetadata>(
	entry: FileBrowserFolderChildren<TMetadata> | undefined,
	visibleChildCount: number
): Extract<FileBrowserListRow, { type: 'status' }>['status'] | null {
	if (!entry || (entry.status === 'loading' && (visibleChildCount === 0 || entry.cursor))) return 'loading'
	if (entry.status === 'error') return 'error'
	if (entry.cursor) return 'more'
	return visibleChildCount === 0 ? 'empty' : null
}

function withFolderChildren<TMetadata>(
	current: Map<string, FileBrowserFolderChildren<TMetadata>>,
	folderPath: string,
	entry: FileBrowserFolderChildren<TMetadata>
): Map<string, FileBrowserFolderChildren<TMetadata>> {
	return new Map(current).set(folderPath, entry)
}

function mapFolderChildItems<TMetadata>(
	current: Map<string, FileBrowserFolderChildren<TMetadata>>,
	update: (items: FileNode<TMetadata>[]) => FileNode<TMetadata>[]
): Map<string, FileBrowserFolderChildren<TMetadata>> {
	const next = new Map<string, FileBrowserFolderChildren<TMetadata>>()
	for (const [folderPath, entry] of current) {
		next.set(folderPath, { ...entry, items: update(entry.items) })
	}
	return next
}

function pruneFolderChildren<TMetadata>(
	current: Map<string, FileBrowserFolderChildren<TMetadata>>,
	paths: string[]
): Map<string, FileBrowserFolderChildren<TMetadata>> {
	const next = new Map<string, FileBrowserFolderChildren<TMetadata>>()
	for (const [folderPath, entry] of current) {
		if (paths.some((path) => isFileBrowserDescendantOrSelf(path, folderPath))) continue
		next.set(folderPath, { ...entry, items: removePaths(entry.items, paths) })
	}
	return next
}

function pruneExpandedPaths(current: Set<string>, paths: string[]): Set<string> {
	const next = new Set(
		Array.from(current).filter((folderPath) => !paths.some((path) => isFileBrowserDescendantOrSelf(path, folderPath)))
	)
	return next.size === current.size ? current : next
}

function compareNodes<TMetadata>(
	left: FileNode<TMetadata>,
	right: FileNode<TMetadata>,
	sortBy: 'name' | 'modifiedAt' | 'size',
	direction: 'asc' | 'desc'
): number {
	const multiplier = direction === 'asc' ? 1 : -1

	if (left.kind !== right.kind) {
		return left.kind === 'folder' ? -1 : 1
	}

	if (sortBy === 'size') {
		return ((left.size ?? 0) - (right.size ?? 0)) * multiplier
	}

	if (sortBy === 'modifiedAt') {
		return String(left.modifiedAt ?? '').localeCompare(String(right.modifiedAt ?? '')) * multiplier
	}

	return (
		left.name.localeCompare(right.name, undefined, {
			numeric: true,
			sensitivity: 'base'
		}) * multiplier
	)
}

function sortPaths(paths: string[]): string[] {
	return [...paths].sort((left, right) => left.localeCompare(right))
}

function toError(caught: unknown): Error {
	return caught instanceof Error ? caught : new Error(String(caught))
}
