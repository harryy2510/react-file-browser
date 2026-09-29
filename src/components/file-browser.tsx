import {
	CheckSquare,
	ChevronLeft,
	ChevronRight,
	Copy as CopyIcon,
	Download,
	File,
	Folder,
	FolderInput,
	Grid2X2,
	Info,
	List,
	MoreHorizontal,
	Pencil,
	Scissors,
	Search,
	Square,
	Trash2,
	Upload,
	X as XIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import Selecto from 'react-selecto'
import type { OnSelect } from 'react-selecto'
import type { FileBrowserDensity } from '../theme'
import { useFileBrowser } from '../core/use-file-browser'
import type {
	FileBrowserListRow,
	FileBrowserPathChangeContext,
	FileBrowserUploadConflictResolution,
	FileBrowserView,
	UseFileBrowserResult
} from '../core/use-file-browser'
import { getFileBrowserDirname, joinFileBrowserPath, normalizeFileBrowserPath } from '../core/path'
import { FileBrowserAdapterError, FileBrowserBulkActionError } from '../core/types'
import type { FileBrowserAdapter, FileNode } from '../core/types'
import { collectUploadCandidatesFromDataTransfer, getFileBrowserUploadCandidates } from '../core/upload-drop'
import type { FileBrowserUploadCandidate } from '../core/upload-drop'
import { useTransferSnapshot, useTransfers } from '../transfers/file-browser-provider'
import type { UploadTransferGroup } from '../transfers/transfer-manager'
import { ActionSheet, ResponsiveDialog, useBrowserLayout, useLongPress } from './responsive'

export type FileBrowserProps<TMetadata = unknown> = {
	adapter: FileBrowserAdapter<TMetadata>
	className?: string
	emptyState?: {
		title: ReactNode
		description?: ReactNode
	}
	initialPath?: string
	path?: string
	onPathChange?: (path: string, context: FileBrowserPathChangeContext<TMetadata>) => void
	rootLabel?: string
	searchQuery?: string
	initialSearchQuery?: string
	onSearchQueryChange?: (query: string) => void
	density?: FileBrowserDensity
	readOnly?: boolean
	showDetailsPanel?: boolean
	uploadPolicy?: FileBrowserUploadPolicy
	uploadConflictResolutions?: readonly FileBrowserUploadConflictResolution[]
	allowClientZipFallback?: boolean
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
	renderDetailsContent?: (item: FileNode<TMetadata>, defaultContent: ReactNode) => ReactNode
	warnZipSizeBytes?: number
}

export type FileBrowserUploadPolicy = {
	allowedMimeTypes?: string[]
	maxFilesPerBatch?: number
	maxFileSizeBytes?: number
	remainingQuotaBytes?: number
	validate?: (
		candidate: FileBrowserUploadCandidate,
		context: {
			acceptedBytes: number
			currentPath: string
		}
	) => string | string[] | null | undefined
}

export type FileBrowserUploadRejection = {
	fileName: string
	relativePath: string
	reasons: string[]
}

type ContextMenuState<TMetadata = unknown> =
	| {
			target: 'item'
			item: FileNode<TMetadata>
			x: number
			y: number
			mode?: 'context' | 'sheet'
	  }
	| {
			target: 'empty'
			x: number
			y: number
			mode?: 'context' | 'sheet'
	  }

type UploadConflictQueue = {
	candidates: FileBrowserUploadCandidate[]
	conflictPaths: string[]
	group?: UploadTransferGroup
	index: number
}

type MoveDestination = {
	path: string
	name: string
	depth: number
}

type MoveDestinationStatus = 'idle' | 'loading' | 'ready' | 'error'

type PreviewState<TMetadata = unknown> = {
	item: FileNode<TMetadata>
	status: 'loading' | 'ready' | 'error'
	url?: string
	error?: string
}

const FILE_BROWSER_DRAG_MIME = 'application/x.react-file-browser.paths'
const SELECTED_ITEM_DOUBLE_CLICK_WINDOW_MS = 220
const CLIPBOARD_NOTICE_DURATION_MS = 5000
const CONTROL_MOTION =
	'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out motion-reduce:transition-none'
const TOUCH_CONTROL =
	'shrink-0 whitespace-nowrap [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:min-w-[calc(var(--fb-gap)*11)]'
const SURFACE_MOTION =
	'transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none'
const DEFAULT_UPLOAD_CONFLICT_RESOLUTIONS = [
	'skip',
	'replace',
	'keep-both'
] as const satisfies readonly FileBrowserUploadConflictResolution[]

// Density drives layout scale through CSS variables set inline on the root, so the effect works for
// every consumer without shipping global CSS. Classes below reference these vars (e.g. h-[var(--fb-control-h)]).
const DENSITY_STYLES: Record<FileBrowserDensity, CSSProperties> = {
	comfortable: {
		'--fb-font': '13px',
		'--fb-control-h': '32px',
		'--fb-cell-x': '12px',
		'--fb-cell-y': '8px',
		'--fb-pad': '12px',
		'--fb-card-min': '150px',
		'--fb-card-minh': '132px',
		'--fb-card-pad': '8px',
		'--fb-thumb-h': '64px',
		'--fb-grid-gap': '12px',
		'--fb-panel-w': '18rem',
		'--fb-panel-pad': '16px'
	} as CSSProperties,
	compact: {
		'--fb-font': '12px',
		'--fb-control-h': '28px',
		'--fb-cell-x': '10px',
		'--fb-cell-y': '6px',
		'--fb-pad': '8px',
		'--fb-card-min': '124px',
		'--fb-card-minh': '108px',
		'--fb-card-pad': '6px',
		'--fb-thumb-h': '48px',
		'--fb-grid-gap': '8px',
		'--fb-panel-w': '15rem',
		'--fb-panel-pad': '12px'
	} as CSSProperties
}

export function FileBrowser<TMetadata = unknown>({
	adapter,
	className,
	emptyState,
	initialPath = '/',
	path,
	onPathChange,
	rootLabel = 'Files',
	searchQuery,
	initialSearchQuery,
	onSearchQueryChange,
	density = 'comfortable',
	readOnly = false,
	showDetailsPanel = true,
	uploadPolicy,
	uploadConflictResolutions,
	allowClientZipFallback = true,
	renderItemMeta,
	renderDetailsContent,
	warnZipSizeBytes
}: FileBrowserProps<TMetadata>) {
	const browser = useFileBrowser<TMetadata>({
		adapter,
		initialPath,
		path,
		onPathChange,
		searchQuery,
		initialSearchQuery,
		onSearchQueryChange
	})
	const transfers = useTransfers()
	const transferSnapshot = useTransferSnapshot()
	const [newFolderOpen, setNewFolderOpen] = useState(false)
	const [newFolderName, setNewFolderName] = useState('')
	const [newFolderError, setNewFolderError] = useState<string | null>(null)
	const [renameItem, setRenameItem] = useState<FileNode<TMetadata> | null>(null)
	const [renameValue, setRenameValue] = useState('')
	const [renameError, setRenameError] = useState<string | null>(null)
	const [inlineRenameItem, setInlineRenameItem] = useState<FileNode<TMetadata> | null>(null)
	const [inlineRenameValue, setInlineRenameValue] = useState('')
	const [inlineRenameError, setInlineRenameError] = useState<string | null>(null)
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
	const [moveDialogOpen, setMoveDialogOpen] = useState(false)
	const [bulkFailure, setBulkFailure] = useState<FileBrowserBulkActionError | null>(null)
	const [moveDestination, setMoveDestination] = useState(path ?? initialPath)
	const [moveDestinations, setMoveDestinations] = useState<MoveDestination[]>([])
	const [moveDestinationStatus, setMoveDestinationStatus] = useState<MoveDestinationStatus>('idle')
	const [moveDestinationError, setMoveDestinationError] = useState<string | null>(null)
	const [contextMenu, setContextMenu] = useState<ContextMenuState<TMetadata> | null>(null)
	const [uploadConflictQueue, setUploadConflictQueue] = useState<UploadConflictQueue | null>(null)
	const [uploadRejections, setUploadRejections] = useState<FileBrowserUploadRejection[]>([])
	const [applyUploadResolution, setApplyUploadResolution] = useState(false)
	const [clipboardNotice, setClipboardNotice] = useState<string | null>(null)
	const [dropActive, setDropActive] = useState(false)
	const [folderDropTargetPath, setFolderDropTargetPath] = useState<string | null>(null)
	const [preview, setPreview] = useState<PreviewState<TMetadata> | null>(null)
	const rootRef = useRef<HTMLElement | null>(null)
	const { isNarrow, hasSidebar } = useBrowserLayout(rootRef)
	const [mobileSelectionPath, setMobileSelectionPath] = useState<string | null>(null)
	const [toolbarOpen, setToolbarOpen] = useState(false)
	const [detailsOpen, setDetailsOpen] = useState(false)
	const [selectionActionsOpen, setSelectionActionsOpen] = useState(false)
	const mobileSelection = isNarrow && mobileSelectionPath === browser.currentPath
	useEffect(() => {
		setMobileSelectionPath(null)
		setSelectionActionsOpen(false)
		setDetailsOpen(false)
		setToolbarOpen(false)
	}, [browser.currentPath, isNarrow])
	const uploadInputRef = useRef<HTMLInputElement | null>(null)
	const draggedItemPathsRef = useRef<string[]>([])
	const pendingSelectedItemUnselectRef = useRef<{
		path: string
		timeoutId: ReturnType<typeof setTimeout>
	} | null>(null)
	const lastItemClickRef = useRef<{ path: string; timeMs: number } | null>(null)
	const doubleClickOpenPathRef = useRef<string | null>(null)
	const refreshedUploadIdsRef = useRef<Set<string>>(new Set())
	const selected = browser.selectedItems.at(0) ?? null
	const allowedUploadConflictResolutions = useMemo(
		() => normalizeUploadConflictResolutions(uploadConflictResolutions ?? DEFAULT_UPLOAD_CONFLICT_RESOLUTIONS),
		[uploadConflictResolutions]
	)
	const supportsBulkDownload = browser.capabilities.bulkDownload || allowClientZipFallback
	const canDownloadSelection = canDownloadItems(browser.selectedItems, supportsBulkDownload)
	const previewFiles = useMemo(
		() => browser.visibleItems.filter((item) => item.kind === 'file'),
		[browser.visibleItems]
	)
	const openPreview = useCallback(
		async (item: FileNode<TMetadata>) => {
			setPreview({ item, status: 'loading' })
			try {
				const url = await adapter.signedUrl(item.path)
				setPreview((current) => (current?.item.path === item.path ? { item, status: 'ready', url } : current))
			} catch (error) {
				setPreview((current) =>
					current?.item.path === item.path ? { item, status: 'error', error: toErrorMessage(error) } : current
				)
			}
		},
		[adapter]
	)
	const cancelPendingSelectedItemUnselect = useCallback(() => {
		if (!pendingSelectedItemUnselectRef.current) {
			return
		}

		clearTimeout(pendingSelectedItemUnselectRef.current.timeoutId)
		pendingSelectedItemUnselectRef.current = null
	}, [])
	const scheduleSelectedItemUnselect = useCallback(
		(path: string) => {
			cancelPendingSelectedItemUnselect()
			pendingSelectedItemUnselectRef.current = {
				path,
				timeoutId: setTimeout(() => {
					if (pendingSelectedItemUnselectRef.current?.path !== path) {
						return
					}

					pendingSelectedItemUnselectRef.current = null
					browser.clearSelection()
				}, SELECTED_ITEM_DOUBLE_CLICK_WINDOW_MS)
			}
		},
		[browser, cancelPendingSelectedItemUnselect]
	)
	const selectItemWithEvent = useCallback(
		(path: string, event: MouseEvent | KeyboardEvent) => {
			if (isNarrow) {
				if (mobileSelection) {
					browser.toggleSelection(path)
				} else {
					const item = browser.visibleItems.find((candidate) => candidate.path === path)
					if (item?.kind === 'folder') void browser.open(item)
					else if (item) void openPreview(item)
				}
				return
			}
			const clickedAt = Date.now()
			const previousClick = lastItemClickRef.current
			const isFastRepeatClick =
				previousClick?.path === path && clickedAt - previousClick.timeMs <= SELECTED_ITEM_DOUBLE_CLICK_WINDOW_MS

			if ('detail' in event && event.detail > 1) {
				if (isFastRepeatClick) {
					cancelPendingSelectedItemUnselect()
					doubleClickOpenPathRef.current = path
				}
				lastItemClickRef.current = { path, timeMs: clickedAt }
				return
			}

			doubleClickOpenPathRef.current = null
			lastItemClickRef.current = { path, timeMs: clickedAt }
			selectWithEvent(browser, path, event, {
				cancelPendingSelectedItemUnselect,
				scheduleSelectedItemUnselect
			})
		},
		[browser, cancelPendingSelectedItemUnselect, isNarrow, mobileSelection, openPreview, scheduleSelectedItemUnselect]
	)
	const openItemFromDoubleClick = useCallback(
		(item: FileNode<TMetadata>) => {
			if (isNarrow) return
			if (doubleClickOpenPathRef.current !== item.path) {
				return
			}

			doubleClickOpenPathRef.current = null
			cancelPendingSelectedItemUnselect()
			if (item.kind === 'folder') {
				void browser.open(item)
			} else {
				void openPreview(item)
			}
		},
		[browser, cancelPendingSelectedItemUnselect, isNarrow, openPreview]
	)
	useEffect(
		() => () => {
			cancelPendingSelectedItemUnselect()
		},
		[cancelPendingSelectedItemUnselect]
	)
	const totalSelectedBytes = useMemo(
		() => browser.selectedItems.reduce((total, item) => total + (item.size ?? 0), 0),
		[browser.selectedItems]
	)
	const moveKeyboardSelection = useCallback(
		(key: string, extendSelection: boolean) => {
			const visibleItems = browser.visibleItems
			if (visibleItems.length === 0) {
				return
			}

			const currentPath = browser.focusedPath ?? browser.selectedPaths.at(-1)
			const currentIndex = visibleItems.findIndex((item) => item.path === currentPath)
			const currentRow = browser.listRows.find((row) => row.type === 'item' && row.item.path === currentPath)
			// List view follows OS outline conventions: Right expands a folder, Left collapses it or jumps to its parent.
			if (browser.view === 'list' && !extendSelection && currentRow?.type === 'item') {
				if (key === 'ArrowRight' && currentRow.item.kind === 'folder' && !currentRow.expanded) {
					browser.expandFolder(currentRow.item.path)
					return
				}
				if (key === 'ArrowLeft' && currentRow.expanded) {
					browser.collapseFolder(currentRow.item.path)
					return
				}
				if (key === 'ArrowLeft' && currentRow.depth > 0) {
					browser.selectOnly(getFileBrowserDirname(currentRow.item.path))
					return
				}
			}
			const fallbackIndex = key === 'ArrowUp' || key === 'ArrowLeft' || key === 'End' ? visibleItems.length - 1 : 0
			const nextIndex =
				currentIndex === -1 ? fallbackIndex : getNextKeyboardIndex(key, currentIndex, visibleItems.length)
			const next = visibleItems[nextIndex]

			if (extendSelection) {
				browser.selectRange(next.path)
			} else {
				browser.selectOnly(next.path)
			}
		},
		[browser]
	)
	const copySelectedItems = useCallback(
		(paths = browser.selectedPaths) => {
			if (paths.length === 0) {
				return
			}
			browser.copySelection(paths)
			setClipboardNotice(`Copied ${formatItemCount(paths.length)}`)
		},
		[browser]
	)
	const cutSelectedItems = useCallback(
		(paths = browser.selectedPaths) => {
			if (paths.length === 0) {
				return
			}
			browser.cutSelection(paths)
			setClipboardNotice(`Cut ${formatItemCount(paths.length)}`)
		},
		[browser]
	)
	const copyItemPaths = useCallback(async (paths: string[]) => {
		if (paths.length === 0) {
			return
		}
		await navigator.clipboard.writeText(paths.join(', '))
		setClipboardNotice(paths.length === 1 ? 'Copied path' : `Copied ${paths.length} paths`)
	}, [])
	const pasteClipboardInto = useCallback(
		async (toDir: string) => {
			const pastedCount = browser.clipboard?.paths.length ?? 0
			await browser.pasteInto(toDir)
			if (pastedCount > 0) {
				setClipboardNotice(`Pasted ${formatItemCount(pastedCount)}`)
			}
		},
		[browser]
	)

	useEffect(() => {
		const listener = (event: globalThis.KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				(event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))
			)
				return
			if (event.key === 'Escape') {
				browser.clearSelection()
				setMobileSelectionPath(null)
				setToolbarOpen(false)
				setDetailsOpen(false)
				setSelectionActionsOpen(false)
				setInlineRenameItem(null)
				setInlineRenameValue('')
				setInlineRenameError(null)
				setRenameItem(null)
				setRenameError(null)
				setNewFolderError(null)
				setDeleteConfirmOpen(false)
				setMoveDialogOpen(false)
				setBulkFailure(null)
				setContextMenu(null)
				setUploadConflictQueue(null)
				setPreview(null)
			}
			if (
				isEditableEventTarget(event.target) ||
				(event.target instanceof Element &&
					(event.target.closest('[data-fb-touch-control]') ||
						(event.key === 'Enter' && event.target.closest('button, a') && !event.target.closest('[data-fb-path]'))))
			) {
				return
			}
			if (event.key === 'Enter' && isNarrow && mobileSelection) {
				event.preventDefault()
				const path =
					event.target instanceof Element ? event.target.closest('[data-fb-path]')?.getAttribute('data-fb-path') : null
				if (path) browser.toggleSelection(path)
				return
			}
			if (isKeyboardNavigationKey(event.key)) {
				event.preventDefault()
				moveKeyboardSelection(event.key, event.shiftKey)
				return
			}
			if (!readOnly && event.key === 'F2' && browser.capabilities.rename && browser.selectedItems.length === 1) {
				event.preventDefault()
				const item = browser.selectedItems[0]
				setRenameItem(null)
				setRenameError(null)
				setInlineRenameItem(item)
				setInlineRenameValue(item.name)
				setInlineRenameError(null)
				return
			}
			if (!readOnly && (event.key === 'Delete' || event.key === 'Backspace') && browser.selectedPaths.length > 0) {
				event.preventDefault()
				setDeleteConfirmOpen(true)
				return
			}
			if ((event.metaKey || event.ctrlKey) && !readOnly) {
				const key = event.key.toLowerCase()
				if (key === 'c' && browser.capabilities.copy && browser.selectedPaths.length > 0) {
					event.preventDefault()
					copySelectedItems()
					return
				}
				if (key === 'x' && browser.capabilities.move && browser.selectedPaths.length > 0) {
					event.preventDefault()
					cutSelectedItems()
					return
				}
				if (key === 'v' && browser.clipboard) {
					event.preventDefault()
					void pasteClipboardInto(browser.currentPath)
					return
				}
			}
			if (event.key === 'Enter' && browser.selectedItems.length === 1) {
				const item = browser.selectedItems[0]
				if (item.kind === 'folder') {
					void browser.open(item)
				} else {
					void openPreview(item)
				}
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
				event.preventDefault()
				browser.selectAllLoaded()
			}
		}
		document.addEventListener('keydown', listener)
		return () => document.removeEventListener('keydown', listener)
	}, [
		browser,
		copySelectedItems,
		cutSelectedItems,
		isNarrow,
		mobileSelection,
		moveKeyboardSelection,
		openPreview,
		pasteClipboardInto,
		readOnly
	])

	useEffect(() => {
		if (!browser.focusedPath || rootRef.current?.querySelector('[role="dialog"], [role="menu"]')) {
			return
		}

		const item = rootRef.current?.querySelector<HTMLElement>(
			`[data-fb-path="${escapeAttributeSelector(browser.focusedPath)}"]`
		)
		item?.focus()
	}, [browser.focusedPath, browser.visibleItems, browser.view])

	useEffect(() => {
		if (!contextMenu) {
			return
		}
		const close = () => setContextMenu(null)
		document.addEventListener('click', close)
		return () => document.removeEventListener('click', close)
	}, [contextMenu])

	useEffect(() => {
		if (!clipboardNotice) {
			return
		}
		const timer = setTimeout(() => setClipboardNotice(null), CLIPBOARD_NOTICE_DURATION_MS)
		return () => clearTimeout(timer)
	}, [clipboardNotice])

	useEffect(() => {
		for (const upload of transferSnapshot.uploads) {
			if (upload.status !== 'completed' || !upload.result || refreshedUploadIdsRef.current.has(upload.id)) {
				continue
			}

			refreshedUploadIdsRef.current.add(upload.id)
			if (getFileBrowserDirname(upload.result.path) === browser.currentPath) {
				void browser.refresh()
			}
		}
	}, [browser, transferSnapshot.uploads])

	useEffect(() => {
		if (!moveDialogOpen) {
			return
		}

		let cancelled = false

		void Promise.resolve()
			.then(async () => {
				if (cancelled) {
					return []
				}
				setMoveDestinationStatus('loading')
				setMoveDestinationError(null)
				return collectMoveDestinations(adapter, browser.selectedPaths)
			})
			.then((destinations) => {
				if (cancelled || destinations.length === 0) {
					if (!cancelled && destinations.length === 0) {
						setMoveDestinations([])
						setMoveDestinationStatus('ready')
					}
					return
				}
				setMoveDestinations(destinations)
				setMoveDestinationStatus('ready')
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return
				}
				setMoveDestinations([])
				setMoveDestinationStatus('error')
				setMoveDestinationError(toErrorMessage(error))
			})

		return () => {
			cancelled = true
		}
	}, [adapter, browser.selectedPaths, moveDialogOpen])

	async function createFolder() {
		if (!newFolderName.trim()) {
			return
		}
		setNewFolderError(null)
		try {
			await browser.createFolder(newFolderName)
			setNewFolderName('')
			setNewFolderOpen(false)
		} catch (error) {
			setNewFolderError(toErrorMessage(error))
		}
	}

	function openRenameDialog(item = browser.selectedItems.at(0)) {
		if (!item) {
			return
		}
		setInlineRenameItem(null)
		setInlineRenameValue('')
		setInlineRenameError(null)
		setRenameItem(item)
		setRenameValue(item.name)
		setRenameError(null)
	}

	async function renameSelectedItem() {
		const nextName = renameValue.trim()
		if (!renameItem || !nextName) {
			return
		}
		setRenameError(null)
		try {
			await browser.rename(renameItem.path, nextName)
			setRenameItem(null)
			setRenameValue('')
		} catch (error) {
			setRenameError(toErrorMessage(error))
		}
	}

	async function commitInlineRename() {
		const item = inlineRenameItem
		const nextName = inlineRenameValue.trim()
		setInlineRenameError(null)
		if (!item || !nextName || nextName === item.name) {
			setInlineRenameItem(null)
			setInlineRenameValue('')
			return
		}
		try {
			await browser.rename(item.path, nextName)
			setInlineRenameItem(null)
			setInlineRenameValue('')
		} catch (error) {
			setInlineRenameItem(item)
			setInlineRenameValue(nextName)
			setInlineRenameError(toErrorMessage(error))
		}
	}

	function cancelInlineRename() {
		setInlineRenameItem(null)
		setInlineRenameValue('')
		setInlineRenameError(null)
	}

	async function deleteSelectedItems() {
		setDeleteConfirmOpen(false)
		try {
			await browser.deleteSelected()
		} catch (error) {
			if (error instanceof FileBrowserBulkActionError) {
				setBulkFailure(error)
				return
			}
			setDeleteConfirmOpen(true)
			throw error
		}
	}

	function openMoveDialog() {
		if (browser.selectedPaths.length === 0) {
			return
		}
		setMoveDestination(browser.currentPath)
		setMoveDialogOpen(true)
	}

	async function moveSelectedItems() {
		try {
			await browser.moveSelectedTo(moveDestination)
			setMoveDialogOpen(false)
		} catch (error) {
			if (error instanceof FileBrowserBulkActionError) {
				setMoveDialogOpen(false)
				setBulkFailure(error)
				return
			}
			throw error
		}
	}

	function startItemDrag(item: FileNode<TMetadata>, event: DragEvent) {
		if (readOnly || !browser.capabilities.move) {
			return
		}

		const paths = browser.selectedPaths.includes(item.path) ? browser.selectedPaths : [item.path]
		draggedItemPathsRef.current = paths
		setDropActive(false)
		setFolderDropTargetPath(null)
		browser.setSelection(paths)
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData(FILE_BROWSER_DRAG_MIME, JSON.stringify(paths))
	}

	function endItemDrag() {
		draggedItemPathsRef.current = []
		setDropActive(false)
		setFolderDropTargetPath(null)
	}

	function getActiveDraggedPaths(dataTransfer: DataTransfer) {
		const transferredPaths = getDraggedPaths(dataTransfer)
		return transferredPaths.length > 0 ? transferredPaths : draggedItemPathsRef.current
	}

	function allowFolderDrop(item: FileNode<TMetadata>, event: DragEvent) {
		if (readOnly || !browser.capabilities.move || item.kind !== 'folder') {
			return
		}

		const paths = getActiveDraggedPaths(event.dataTransfer)
		if (
			paths.length === 0 ||
			paths.some((path) => item.path === path || item.path.startsWith(`${path}/`)) ||
			paths.every((path) => getFileBrowserDirname(path) === item.path)
		) {
			return
		}

		event.preventDefault()
		event.stopPropagation()
		event.dataTransfer.dropEffect = 'move'
		setDropActive(false)
		setFolderDropTargetPath(item.path)
	}

	async function moveDraggedItemsToFolder(item: FileNode<TMetadata>, event: DragEvent) {
		if (readOnly || !browser.capabilities.move || item.kind !== 'folder') {
			return
		}

		const paths = getActiveDraggedPaths(event.dataTransfer)
		if (paths.every((path) => getFileBrowserDirname(path) === item.path)) {
			return
		}

		event.preventDefault()
		event.stopPropagation()
		endItemDrag()
		try {
			await browser.movePathsTo(paths, item.path)
		} catch (error) {
			if (error instanceof FileBrowserBulkActionError) {
				setBulkFailure(error)
				return
			}
			throw error
		}
	}

	function openItemContextMenu(item: FileNode<TMetadata>, event: MouseEvent) {
		event.preventDefault()
		event.stopPropagation()
		if (!browser.selectedPaths.includes(item.path)) {
			browser.selectOnly(item.path)
		}
		setContextMenu({
			target: 'item',
			item,
			x: event.clientX,
			y: event.clientY,
			mode: isNarrow ? 'sheet' : 'context'
		})
	}

	function openItemTouchMenu(item: FileNode<TMetadata>) {
		if (!browser.selectedPaths.includes(item.path)) {
			browser.selectOnly(item.path)
		}
		if (isNarrow) {
			setMobileSelectionPath(browser.currentPath)
			return
		}
		setContextMenu({
			target: 'item',
			item,
			x: 0,
			y: 0,
			mode: 'sheet'
		})
	}

	function openEmptyContextMenu(event: MouseEvent) {
		event.preventDefault()
		browser.clearSelection()
		setContextMenu({
			target: 'empty',
			x: event.clientX,
			y: event.clientY,
			mode: isNarrow ? 'sheet' : 'context'
		})
	}

	function clearSelectionFromEmptySurface(event: MouseEvent<HTMLElement>) {
		if (mobileSelection) return
		if (event.target !== event.currentTarget || hasSelectionModifier(event)) {
			return
		}
		browser.clearSelection()
	}

	function showAdjacentPreview(direction: -1 | 1) {
		if (!preview || previewFiles.length === 0) {
			return
		}

		const currentIndex = previewFiles.findIndex((item) => item.path === preview.item.path)
		const safeIndex = currentIndex >= 0 ? currentIndex : 0
		const nextIndex = (safeIndex + direction + previewFiles.length) % previewFiles.length
		const next = previewFiles[nextIndex]
		void openPreview(next)
		browser.selectOnly(next.path)
	}

	async function downloadSelection() {
		if (!canDownloadSelection) {
			return
		}

		if (browser.selectedItems.length === 1 && browser.selectedItems[0].kind === 'file') {
			await downloadItem(browser.selectedItems[0])
			return
		}

		const paths = browser.selectedPaths
		await downloadPaths(paths, totalSelectedBytes)
	}

	async function downloadItem(item: FileNode<TMetadata>) {
		if (item.kind === 'file') {
			await transfers.prepareSingleDownload({
				adapter,
				path: item.path,
				selectedBytes: item.size ?? 0
			})
			return
		}

		if (supportsBulkDownload) {
			await downloadPaths([item.path], item.size ?? 0)
		}
	}

	async function downloadPaths(paths: string[], selectedBytes: number) {
		if (paths.length === 0 || !supportsBulkDownload) {
			return
		}

		await transfers.prepareBulkDownload({
			allowClientZipFallback,
			adapter,
			paths,
			selectedBytes,
			warnZipSizeBytes
		})
	}

	async function uploadInputFiles(files: FileList | null) {
		if (!files || files.length === 0) {
			return
		}
		await beginUploadFiles(files)
		if (uploadInputRef.current) {
			uploadInputRef.current.value = ''
		}
	}

	async function beginUploadFiles(files: File[] | FileList) {
		const candidates = getFileBrowserUploadCandidates(files)
		await beginUploadCandidates(candidates)
	}

	async function beginUploadDrop(dataTransfer: DataTransfer) {
		const candidates = await collectUploadCandidatesFromDataTransfer(dataTransfer)
		await beginUploadCandidates(candidates)
	}

	async function beginUploadCandidates(candidates: FileBrowserUploadCandidate[]) {
		if (candidates.length === 0) {
			return
		}
		if (uploadPolicy?.maxFilesPerBatch !== undefined && candidates.length > uploadPolicy.maxFilesPerBatch) {
			setUploadRejections(
				candidates.map((candidate) => ({
					fileName: candidate.file.name,
					relativePath: candidate.relativePath,
					reasons: [`Batch contains ${candidates.length} files; maximum is ${uploadPolicy.maxFilesPerBatch}`]
				}))
			)
			return
		}

		const { acceptedCandidates, rejectedCandidates } = applyUploadPolicy(candidates, uploadPolicy, browser.currentPath)
		if (rejectedCandidates.length > 0) {
			setUploadRejections(rejectedCandidates)
		}
		if (acceptedCandidates.length === 0) {
			return
		}

		const supportedCandidates = rejectUnsupportedFolderUploads(acceptedCandidates)
		if (supportedCandidates.length === 0) {
			return
		}

		const createdFolders = await ensureUploadFolders(supportedCandidates)
		const conflictPaths = await findUploadConflictPaths(supportedCandidates)
		if (conflictPaths.length > 0 && allowedUploadConflictResolutions.length === 0) {
			const conflicts = new Set(conflictPaths)
			const nonConflictingCandidates = supportedCandidates.filter(
				(candidate) => !conflicts.has(joinUploadRelativePath(browser.currentPath, candidate.relativePath))
			)
			const conflictingCandidates = supportedCandidates.filter((candidate) =>
				conflicts.has(joinUploadRelativePath(browser.currentPath, candidate.relativePath))
			)
			setUploadRejections((current) => [
				...current,
				...conflictingCandidates.map((candidate) => ({
					fileName: candidate.file.name,
					relativePath: candidate.relativePath,
					reasons: ['No upload conflict resolutions are enabled']
				}))
			])
			if (nonConflictingCandidates.length > 0) {
				const group = getUploadTransferGroup(browser.currentPath, nonConflictingCandidates, createdFolders)
				processUploadQueue(nonConflictingCandidates, [], 0, undefined, group)
			}
			return
		}
		const group = getUploadTransferGroup(browser.currentPath, supportedCandidates, createdFolders)
		processUploadQueue(supportedCandidates, conflictPaths, 0, undefined, group)
	}

	function rejectUnsupportedFolderUploads(candidates: FileBrowserUploadCandidate[]) {
		if (browser.capabilities.createFolder) {
			return candidates
		}

		const [folderCandidates, flatCandidates] = partitionUploadCandidates(candidates, (candidate) =>
			candidate.relativePath.includes('/')
		)
		if (folderCandidates.length > 0) {
			setUploadRejections((current) => [
				...current,
				...folderCandidates.map((candidate) => ({
					fileName: candidate.file.name,
					relativePath: candidate.relativePath,
					reasons: ['Folder uploads require folder creation support']
				}))
			])
		}
		return flatCandidates
	}

	async function ensureUploadFolders(candidates: FileBrowserUploadCandidate[]) {
		const folders = getUploadFolderPaths(candidates)
		let createdFolders = 0

		if (!adapter.createFolder) {
			if (folders.length > 0) {
				throw new FileBrowserAdapterError('not_supported', 'Folder uploads require folder creation support')
			}
			return 0
		}

		for (const folder of folders) {
			try {
				await adapter.createFolder(joinUploadRelativePath(browser.currentPath, folder))
				createdFolders += 1
			} catch (error) {
				if (error instanceof FileBrowserAdapterError && error.code === 'conflict') {
					continue
				}
				throw error
			}
		}

		if (createdFolders > 0) {
			await browser.refresh()
		}
		return createdFolders
	}

	async function findUploadConflictPaths(candidates: FileBrowserUploadCandidate[]) {
		const paths = candidates.map((candidate) => joinUploadRelativePath(browser.currentPath, candidate.relativePath))

		if (adapter.exists) {
			try {
				const result = await adapter.exists(paths)
				return paths.filter((path) => result[path])
			} catch {
				// Fall back to list lookups below.
			}
		}

		const existingPaths = new Set(browser.items.map((item) => item.path))
		const conflicts: string[] = []
		for (const path of paths) {
			if (existingPaths.has(path) || (await uploadPathExistsByListing(path))) {
				conflicts.push(path)
			}
		}
		return conflicts
	}

	async function uploadPathExistsByListing(path: string): Promise<boolean> {
		const parentPath = getFileBrowserDirname(path)
		let cursor: string | undefined

		do {
			const result = await adapter.list(parentPath, { cursor })
			if (result.items.some((item) => item.path === path)) {
				return true
			}
			cursor = result.cursor
		} while (cursor)

		return false
	}

	function processUploadQueue(
		candidates: FileBrowserUploadCandidate[],
		conflictPaths: string[],
		startIndex: number,
		resolution?: FileBrowserUploadConflictResolution,
		group?: UploadTransferGroup
	) {
		const conflicts = new Set(conflictPaths)

		for (let index = startIndex; index < candidates.length; index += 1) {
			const candidate = candidates[index]
			const path = joinUploadRelativePath(browser.currentPath, candidate.relativePath)

			if (conflicts.has(path)) {
				if (!resolution) {
					setUploadConflictQueue({ candidates, conflictPaths, group, index })
					setApplyUploadResolution(false)
					return
				}

				if (resolution !== 'skip') {
					enqueueUploadTransfer(candidate, resolution, group)
				}
			} else {
				enqueueUploadTransfer(candidate, undefined, group)
			}
		}

		setUploadConflictQueue(null)
		setApplyUploadResolution(false)
	}

	function resolveUploadConflict(resolution: FileBrowserUploadConflictResolution) {
		if (!uploadConflictQueue || !allowedUploadConflictResolutions.includes(resolution)) {
			return
		}

		const { candidates, conflictPaths, group, index } = uploadConflictQueue
		if (applyUploadResolution) {
			processUploadQueue(candidates, conflictPaths, index, resolution, group)
			return
		}

		const candidate = candidates[index]
		if (resolution !== 'skip') {
			enqueueUploadTransfer(candidate, resolution, group)
		}
		processUploadQueue(candidates, conflictPaths, index + 1, undefined, group)
	}

	function enqueueUploadTransfer(
		candidate: FileBrowserUploadCandidate,
		resolution?: FileBrowserUploadConflictResolution,
		group?: UploadTransferGroup
	) {
		transfers.enqueueUpload({
			adapter,
			destinationPath: joinUploadRelativePath(browser.currentPath, candidate.relativePath),
			file: candidate.file,
			group,
			onConflict: resolution === 'skip' ? undefined : resolution
		})
	}

	function exitMobileSelection() {
		browser.clearSelection()
		setMobileSelectionPath(null)
		setSelectionActionsOpen(false)
	}

	const secondaryControls = (
		<div className="flex min-w-0 flex-wrap items-center gap-[calc(var(--fb-gap)*2)]">
			<select
				aria-label="Filter files"
				className={selectInput()}
				onChange={(event) => browser.setFilterKind(event.target.value as 'all' | 'files' | 'folders')}
				value={browser.filterKind}
			>
				<option value="all">All</option>
				<option value="folders">Folders</option>
				<option value="files">Files</option>
			</select>
			<select
				aria-label="Sort files"
				className={selectInput()}
				onChange={(event) => browser.setSortBy(event.target.value as 'name' | 'modifiedAt' | 'size')}
				value={browser.sortBy}
			>
				<option value="name">Name</option>
				<option value="modifiedAt">Modified</option>
				<option value="size">Size</option>
			</select>
			<button
				aria-label="Toggle sort direction"
				className={toolButton(false)}
				onClick={() => browser.setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
				type="button"
			>
				{browser.sortDirection === 'asc' ? 'Asc' : 'Desc'}
			</button>
			<button
				aria-label="Grid view"
				className={toolButton(browser.view === 'grid')}
				onClick={() => browser.setView('grid')}
				type="button"
			>
				<Grid2X2 aria-hidden="true" className="size-4" />
			</button>
			<button
				aria-label="List view"
				className={toolButton(browser.view === 'list')}
				onClick={() => browser.setView('list')}
				type="button"
			>
				<List aria-hidden="true" className="size-4" />
			</button>
			{!readOnly && browser.capabilities.createFolder ? (
				<button
					className={commandButton(false)}
					onClick={() => {
						setToolbarOpen(false)
						setNewFolderError(null)
						setNewFolderOpen(true)
					}}
					type="button"
				>
					<Folder aria-hidden="true" className="size-4" />
					New folder
				</button>
			) : null}
			{isNarrow ? (
				<button
					className={commandButton(false)}
					disabled={browser.filteredItems.length === 0}
					onClick={() => {
						setToolbarOpen(false)
						setMobileSelectionPath(browser.currentPath)
					}}
					type="button"
				>
					Select items
				</button>
			) : null}
			{isNarrow && !readOnly && browser.clipboard ? (
				<button
					className={commandButton(false)}
					onClick={() => {
						setToolbarOpen(false)
						void pasteClipboardInto(browser.currentPath)
					}}
					type="button"
				>
					Paste here
				</button>
			) : null}
		</div>
	)

	const selectionActions = (
		<ActionBar
			canCopy={!readOnly && browser.capabilities.copy}
			canCut={!readOnly && browser.capabilities.move}
			canDelete={!readOnly}
			canMove={!readOnly && browser.capabilities.move}
			canRename={!readOnly && browser.capabilities.rename}
			canDownload={canDownloadSelection}
			itemCount={browser.filteredItems.length}
			onCopy={() => copySelectedItems()}
			onCut={() => cutSelectedItems()}
			onDelete={() => setDeleteConfirmOpen(true)}
			onDownload={() => void downloadSelection()}
			onMove={openMoveDialog}
			onRename={openRenameDialog}
			onSelectAll={browser.selectAllLoaded}
			onSelectNone={browser.clearSelection}
			selectedCount={browser.selectedPaths.length}
		/>
	)

	const detailsContent = (
		<DetailsPanel
			canDownload={canDownloadSelection}
			item={selected}
			onCopyPath={() => void copyItemPaths(browser.selectedPaths)}
			onDownload={() => void downloadSelection()}
			renderDetailsContent={renderDetailsContent}
			selectedCount={browser.selectedItems.length}
			totalBytes={totalSelectedBytes}
			sheet={!hasSidebar}
		/>
	)

	return (
		<section
			className={`@container/fb relative flex min-h-[min(520px,100svh)] w-full min-w-0 max-w-full rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] font-[inherit] text-[length:var(--fb-font)] text-[var(--fb-text)] ${SURFACE_MOTION}${className ? ` ${className}` : ''}`}
			data-fb-density={density}
			data-fb-layout={isNarrow ? 'narrow' : hasSidebar ? 'wide' : 'medium'}
			ref={rootRef}
			style={
				{
					...DENSITY_STYLES[density],
					...(isNarrow ? { '--fb-control-h': 'calc(var(--fb-gap) * 11)' } : {})
				} as CSSProperties
			}
			onDragEnter={(event) => {
				if (getActiveDraggedPaths(event.dataTransfer).length > 0) {
					setDropActive(false)
					return
				}
				event.preventDefault()
				if (!readOnly) {
					setDropActive(true)
				}
			}}
			onDragLeave={(event) => {
				if (event.currentTarget === event.target) {
					setDropActive(false)
					setFolderDropTargetPath(null)
				}
			}}
			onDragOver={(event) => {
				if (getActiveDraggedPaths(event.dataTransfer).length > 0) {
					setDropActive(false)
					setFolderDropTargetPath(null)
					return
				}
				event.preventDefault()
			}}
			onDrop={(event) => {
				event.preventDefault()
				if (getActiveDraggedPaths(event.dataTransfer).length > 0) {
					endItemDrag()
					return
				}
				setDropActive(false)
				if (readOnly) {
					return
				}
				void beginUploadDrop(event.dataTransfer)
			}}
			onPaste={(event) => {
				if (readOnly) {
					return
				}
				const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
				if (files.length > 0) {
					void beginUploadFiles(files)
				}
			}}
		>
			<div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
				{formatScreenReaderStatus({
					currentPath: browser.currentPath,
					itemCount: browser.filteredItems.length,
					rootLabel,
					selectedCount: browser.selectedPaths.length,
					status: browser.status
				})}
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<input
					accept={uploadPolicy?.allowedMimeTypes?.length ? uploadPolicy.allowedMimeTypes.join(',') : undefined}
					aria-label="Upload files"
					multiple
					onChange={(event) => void uploadInputFiles(event.target.files)}
					ref={uploadInputRef}
					type="file"
					className="hidden"
				/>
				<header
					className={`flex min-w-0 flex-wrap items-center gap-[calc(var(--fb-gap)*2)] rounded-t-[var(--fb-radius)] border-b border-[var(--fb-border)] bg-[var(--fb-surface)] px-[var(--fb-pad)] py-[var(--fb-cell-y)] ${SURFACE_MOTION}`}
				>
					{mobileSelection ? (
						<div className="flex w-full min-w-0 items-center gap-[calc(var(--fb-gap)*2)]">
							<button
								aria-label="Exit selection"
								className={toolButton(false)}
								onClick={exitMobileSelection}
								type="button"
							>
								<XIcon aria-hidden="true" className="size-4" />
							</button>
							<span className="mr-auto whitespace-nowrap font-semibold">{browser.selectedPaths.length} selected</span>
							<button className={commandButton(false)} onClick={browser.selectAllLoaded} type="button">
								Select all
							</button>
						</div>
					) : (
						<>
							<div className={isNarrow ? 'min-w-0 flex-1' : 'min-w-0 max-w-full'}>
								<Breadcrumbs
									narrow={isNarrow}
									onNavigate={(nextPath) => browser.navigate(nextPath, { source: 'breadcrumb' })}
									path={browser.currentPath}
									rootLabel={rootLabel}
								/>
							</div>
							{isNarrow ? (
								<button
									aria-label="Browser options"
									aria-expanded={toolbarOpen}
									aria-haspopup="dialog"
									className={toolButton(false)}
									onClick={() => setToolbarOpen(true)}
									type="button"
								>
									<MoreHorizontal aria-hidden="true" className="size-5" />
								</button>
							) : null}
						</>
					)}
					{clipboardNotice ? (
						<span
							aria-label="Clipboard status"
							className={`rounded-[calc(var(--fb-radius)-4px)] bg-[var(--fb-accent-soft)] px-2 py-1 text-[12px] font-medium text-[var(--fb-accent)] ${CONTROL_MOTION}`}
							role="status"
						>
							{clipboardNotice}
						</span>
					) : null}
					{!mobileSelection ? (
						<div
							className={`flex min-w-0 flex-wrap items-center gap-[calc(var(--fb-gap)*2)] ${isNarrow ? 'w-full' : 'ml-auto max-w-full'}`}
						>
							<label className={`relative block min-w-0 ${isNarrow ? 'w-full' : 'w-[calc(var(--fb-gap)*44)] flex-1'}`}>
								<Search
									aria-hidden="true"
									className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--fb-muted)]"
								/>
								<input
									aria-label="Search files"
									className={`h-[var(--fb-control-h)] min-h-[var(--fb-control-h)] w-full min-w-0 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] pl-7 pr-2 text-[16px] text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] @min-[40rem]/fb:text-[12px] [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:text-[16px] ${CONTROL_MOTION}`}
									onChange={(event) => browser.setSearchQuery(event.target.value)}
									placeholder="Search"
									type="search"
									value={browser.searchQuery}
								/>
							</label>
							{!isNarrow ? secondaryControls : null}
							{!isNarrow && !readOnly ? (
								<button className={primaryButton()} onClick={() => uploadInputRef.current?.click()} type="button">
									<Upload aria-hidden="true" className="size-4" />
									Upload
								</button>
							) : null}
						</div>
					) : null}
				</header>

				{!isNarrow ? selectionActions : null}
				{!hasSidebar && !isNarrow && showDetailsPanel ? (
					<div className="flex justify-end border-b border-[var(--fb-border)] px-[var(--fb-pad)] py-[var(--fb-cell-y)]">
						<button className={commandButton(false)} onClick={() => setDetailsOpen(true)} type="button">
							<Info aria-hidden="true" className="size-4" />
							Details
						</button>
					</div>
				) : null}

				{uploadRejections.length > 0 ? (
					<UploadRejectionAlert onDismiss={() => setUploadRejections([])} rejections={uploadRejections} />
				) : null}

				<div
					className={`relative min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--fb-bg)] p-[var(--fb-pad)] ${isNarrow && !readOnly && !mobileSelection ? 'pb-[calc(var(--fb-gap)*20)]' : ''} ${SURFACE_MOTION}`}
					onClick={clearSelectionFromEmptySurface}
					onContextMenu={openEmptyContextMenu}
				>
					{browser.status === 'loading' && browser.items.length === 0 ? (
						<SkeletonGrid rootLabel={rootLabel} />
					) : browser.status === 'error' ? (
						<StateMessage
							title={getErrorState(browser.error).title}
							tone="danger"
							value={getErrorState(browser.error).value}
						/>
					) : browser.filteredItems.length === 0 ? (
						<StateMessage
							title={emptyState ? emptyState.title : 'This folder is empty'}
							value={emptyState ? emptyState.description : 'Create a folder or upload files to start.'}
						/>
					) : browser.view === 'grid' ? (
						<FileGrid
							browser={browser}
							canMove={!readOnly && browser.capabilities.move}
							folderDropTargetPath={folderDropTargetPath}
							inlineRenameError={inlineRenameError}
							inlineRenameLabel={inlineRenameItem?.name ?? ''}
							inlineRenameItem={inlineRenameItem}
							inlineRenameValue={inlineRenameValue}
							onDragStart={startItemDrag}
							onDragEnd={endItemDrag}
							onFolderDragOver={allowFolderDrop}
							onFolderDrop={(item, event) => void moveDraggedItemsToFolder(item, event)}
							onEmptyClick={() => browser.clearSelection()}
							onInlineRenameCancel={cancelInlineRename}
							onInlineRenameChange={(value) => {
								setInlineRenameValue(value)
								setInlineRenameError(null)
							}}
							onInlineRenameCommit={() => void commitInlineRename()}
							onContextMenu={openItemContextMenu}
							onOpenItem={openItemFromDoubleClick}
							onSelectItem={selectItemWithEvent}
							onTouchMenu={openItemTouchMenu}
							narrow={isNarrow}
							selectionMode={mobileSelection}
							onToggleItem={browser.toggleSelection}
							renderItemMeta={renderItemMeta}
							rootLabel={rootLabel}
							selectedPaths={browser.selectedPaths}
						/>
					) : (
						<FileTable
							browser={browser}
							canMove={!readOnly && browser.capabilities.move}
							folderDropTargetPath={folderDropTargetPath}
							inlineRenameError={inlineRenameError}
							inlineRenameLabel={inlineRenameItem?.name ?? ''}
							inlineRenameItem={inlineRenameItem}
							inlineRenameValue={inlineRenameValue}
							onDragStart={startItemDrag}
							onDragEnd={endItemDrag}
							onFolderDragOver={allowFolderDrop}
							onFolderDrop={(item, event) => void moveDraggedItemsToFolder(item, event)}
							onInlineRenameCancel={cancelInlineRename}
							onInlineRenameChange={(value) => {
								setInlineRenameValue(value)
								setInlineRenameError(null)
							}}
							onInlineRenameCommit={() => void commitInlineRename()}
							onContextMenu={openItemContextMenu}
							onOpenItem={openItemFromDoubleClick}
							onSelectItem={selectItemWithEvent}
							onTouchMenu={openItemTouchMenu}
							narrow={isNarrow}
							selectionMode={mobileSelection}
							onToggleItem={browser.toggleSelection}
							renderItemMeta={renderItemMeta}
							rootLabel={rootLabel}
							selectedPaths={browser.selectedPaths}
						/>
					)}
					{dropActive ? (
						<div
							className={`pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-[var(--fb-radius)] border-2 border-dashed border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] text-[13px] font-semibold text-[var(--fb-accent)] ${SURFACE_MOTION}`}
						>
							Drop files to upload
						</div>
					) : null}
				</div>

				<footer
					className={`sticky bottom-0 flex min-h-[calc(var(--fb-gap)*11)] min-w-0 flex-wrap items-center justify-between gap-[var(--fb-gap)] rounded-b-[var(--fb-radius)] border-t border-[var(--fb-border)] bg-[var(--fb-surface)] px-[var(--fb-pad)] py-[var(--fb-gap)] text-[11px] text-[var(--fb-muted)] ${SURFACE_MOTION}`}
				>
					{mobileSelection ? (
						<div
							aria-label="Selection actions"
							className="flex w-full flex-wrap items-center gap-[calc(var(--fb-gap)*2)]"
							role="toolbar"
						>
							<button
								className={commandButton(false)}
								disabled={!selected}
								onClick={() => setSelectionActionsOpen(true)}
								type="button"
							>
								<MoreHorizontal aria-hidden="true" className="size-4" />
								Actions
							</button>
							{showDetailsPanel ? (
								<button
									className={commandButton(false)}
									disabled={!selected}
									onClick={() => setDetailsOpen(true)}
									type="button"
								>
									<Info aria-hidden="true" className="size-4" />
									Details
								</button>
							) : null}
						</div>
					) : null}
					<span>
						{browser.filteredItems.length} items
						{browser.selectedPaths.length ? ` · ${browser.selectedPaths.length} selected` : ''}
					</span>
					{isNarrow && !readOnly && !mobileSelection ? (
						<button
							aria-label="Upload"
							className={`${primaryButton()} absolute bottom-[calc(var(--fb-gap)*14)] right-[var(--fb-pad)] shadow-lg`}
							onClick={() => uploadInputRef.current?.click()}
							type="button"
						>
							<Upload aria-hidden="true" className="size-5" />
							Upload
						</button>
					) : null}
					{browser.hasMore ? (
						<button
							className={`min-h-[var(--fb-control-h)] rounded-[calc(var(--fb-radius)-4px)] px-2 py-1 font-medium text-[var(--fb-accent)] hover:bg-[var(--fb-accent-soft)] ${TOUCH_CONTROL} ${CONTROL_MOTION}`}
							onClick={() => void browser.loadMore()}
							type="button"
						>
							Load more
						</button>
					) : (
						<span />
					)}
				</footer>
			</div>

			{showDetailsPanel && hasSidebar ? detailsContent : null}
			{showDetailsPanel && !hasSidebar && detailsOpen ? (
				<ActionSheet label="Details" onClose={() => setDetailsOpen(false)}>
					{detailsContent}
				</ActionSheet>
			) : null}
			{isNarrow && toolbarOpen ? (
				<ActionSheet label="Browser options" onClose={() => setToolbarOpen(false)}>
					{secondaryControls}
				</ActionSheet>
			) : null}
			{mobileSelection && selectionActionsOpen ? (
				<ActionSheet label="Selected item actions" onClose={() => setSelectionActionsOpen(false)}>
					<div
						onClick={(event) => {
							if ((event.target as Element).closest('button:not(:disabled)')) setSelectionActionsOpen(false)
						}}
					>
						{selectionActions}
					</div>
				</ActionSheet>
			) : null}

			{contextMenu ? (
				<ContextMenu
					browser={browser}
					canDownload={canDownloadSelection}
					menu={contextMenu}
					onClose={() => setContextMenu(null)}
					onDelete={() => setDeleteConfirmOpen(true)}
					onDownload={() => void downloadSelection()}
					onMove={openMoveDialog}
					onNewFolder={() => {
						setNewFolderError(null)
						setNewFolderOpen(true)
					}}
					onCopy={() => copySelectedItems()}
					onCopyPath={(item) =>
						void copyItemPaths(browser.selectedPaths.includes(item.path) ? browser.selectedPaths : [item.path])
					}
					onCut={() => cutSelectedItems()}
					onPaste={() => void pasteClipboardInto(browser.currentPath)}
					onRename={openRenameDialog}
					onUpload={() => uploadInputRef.current?.click()}
					readOnly={readOnly}
				/>
			) : null}

			{newFolderOpen ? (
				<ResponsiveDialog label="New folder" narrow={isNarrow} onClose={() => setNewFolderOpen(false)}>
					<form
						className={`w-[min(360px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)] ${SURFACE_MOTION}`}
						onSubmit={(event) => {
							event.preventDefault()
							void createFolder()
						}}
					>
						<h2 className="m-0 text-[14px] font-semibold">New folder</h2>
						<label className="mt-3 block text-[12px] font-medium text-[var(--fb-muted)]">
							Folder name
							<input
								aria-label="Folder name"
								className={`mt-1 h-[max(var(--fb-control-h),calc(var(--fb-gap)*9))] w-full min-w-0 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-2 text-[16px] text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${CONTROL_MOTION}`}
								onChange={(event) => {
									setNewFolderName(event.target.value)
									setNewFolderError(null)
								}}
								value={newFolderName}
							/>
						</label>
						{newFolderError ? (
							<div
								className={`mt-3 rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-danger)] bg-[var(--fb-danger-soft)] px-2 py-1.5 text-[12px] text-[var(--fb-danger)] ${SURFACE_MOTION}`}
								role="alert"
							>
								{newFolderError}
							</div>
						) : null}
						<div className="mt-4 flex flex-wrap justify-end gap-2">
							<button
								className={commandButton(false)}
								onClick={() => {
									setNewFolderError(null)
									setNewFolderOpen(false)
								}}
								type="button"
							>
								Cancel
							</button>
							<button className={primaryButton()} type="submit">
								Create folder
							</button>
						</div>
					</form>
				</ResponsiveDialog>
			) : null}

			{renameItem ? (
				<ResponsiveDialog label="Rename item" narrow={isNarrow} onClose={() => setRenameItem(null)}>
					<form
						className={`w-[min(360px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)] ${SURFACE_MOTION}`}
						onSubmit={(event) => {
							event.preventDefault()
							void renameSelectedItem()
						}}
					>
						<h2 className="m-0 text-[14px] font-semibold">Rename</h2>
						<label className="mt-3 block text-[12px] font-medium text-[var(--fb-muted)]">
							New name
							<input
								aria-label="New name"
								className={`mt-1 h-[max(var(--fb-control-h),calc(var(--fb-gap)*9))] w-full min-w-0 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-2 text-[16px] text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${CONTROL_MOTION}`}
								onChange={(event) => {
									setRenameValue(event.target.value)
									setRenameError(null)
								}}
								value={renameValue}
							/>
						</label>
						{renameError ? (
							<div
								className={`mt-3 rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-danger)] bg-[var(--fb-danger-soft)] px-2 py-1.5 text-[12px] text-[var(--fb-danger)] ${SURFACE_MOTION}`}
								role="alert"
							>
								{renameError}
							</div>
						) : null}
						<div className="mt-4 flex flex-wrap justify-end gap-2">
							<button
								className={commandButton(false)}
								onClick={() => {
									setRenameItem(null)
									setRenameValue('')
									setRenameError(null)
								}}
								type="button"
							>
								Cancel
							</button>
							<button className={primaryButton()} type="submit">
								Rename item
							</button>
						</div>
					</form>
				</ResponsiveDialog>
			) : null}

			{deleteConfirmOpen ? (
				<ResponsiveDialog label="Delete selected items" narrow={isNarrow} onClose={() => setDeleteConfirmOpen(false)}>
					<form
						className={`w-[min(400px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)] ${SURFACE_MOTION}`}
						onSubmit={(event) => {
							event.preventDefault()
							void deleteSelectedItems()
						}}
					>
						<h2 className="m-0 text-[14px] font-semibold">Delete selected items</h2>
						<p className="mt-2 text-[12px] text-[var(--fb-muted)]">This removes the selected entries from storage.</p>
						<ul
							className={`mt-3 max-h-32 overflow-auto rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] p-2 text-[12px] ${SURFACE_MOTION}`}
						>
							{browser.selectedItems.map((item) => (
								<li className="truncate py-1" key={item.path}>
									{item.name}
								</li>
							))}
						</ul>
						<div className="mt-4 flex flex-wrap justify-end gap-2">
							<button className={commandButton(false)} onClick={() => setDeleteConfirmOpen(false)} type="button">
								Cancel
							</button>
							<button className={dangerButton()} type="submit">
								Delete selected
							</button>
						</div>
					</form>
				</ResponsiveDialog>
			) : null}

			{moveDialogOpen ? (
				<ResponsiveDialog label="Move selected items" narrow={isNarrow} onClose={() => setMoveDialogOpen(false)}>
					<form
						className={`w-[min(420px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)] ${SURFACE_MOTION}`}
						onSubmit={(event) => {
							event.preventDefault()
							void moveSelectedItems()
						}}
					>
						<h2 className="m-0 text-[14px] font-semibold">Move selected items</h2>
						<p className="mt-2 text-[12px] text-[var(--fb-muted)]">Choose a destination folder from the folder tree.</p>
						<MoveDestinationPicker
							currentPath={browser.currentPath}
							destinations={moveDestinations}
							error={moveDestinationError}
							onSelect={setMoveDestination}
							rootLabel={rootLabel}
							selectedPath={moveDestination}
							status={moveDestinationStatus}
						/>
						<div className="mt-3 truncate text-[11px] text-[var(--fb-muted)]">Destination: {moveDestination}</div>
						<div className="mt-4 flex flex-wrap justify-end gap-2">
							<button className={commandButton(false)} onClick={() => setMoveDialogOpen(false)} type="button">
								Cancel
							</button>
							<button className={primaryButton()} type="submit">
								Move here
							</button>
						</div>
					</form>
				</ResponsiveDialog>
			) : null}

			{bulkFailure ? (
				<BulkFailureDialog error={bulkFailure} narrow={isNarrow} onClose={() => setBulkFailure(null)} />
			) : null}

			{uploadConflictQueue ? (
				<UploadConflictDialog
					applyToAll={applyUploadResolution}
					narrow={isNarrow}
					currentPath={browser.currentPath}
					onApplyToAllChange={setApplyUploadResolution}
					onCancel={() => {
						setUploadConflictQueue(null)
						setApplyUploadResolution(false)
					}}
					onResolve={(resolution) => resolveUploadConflict(resolution)}
					queue={uploadConflictQueue}
					resolutions={allowedUploadConflictResolutions}
				/>
			) : null}

			{preview ? (
				<ResponsiveDialog label={`Preview ${preview.item.name}`} narrow={isNarrow} onClose={() => setPreview(null)}>
					<div
						className={`w-[min(720px,100%)] overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] shadow-[0_22px_70px_color-mix(in_oklch,var(--fb-text)_24%,transparent)] ${SURFACE_MOTION}`}
					>
						<div
							className={`flex min-h-[calc(var(--fb-gap)*12)] min-w-0 flex-wrap items-center justify-between gap-[calc(var(--fb-gap)*2)] border-b border-[var(--fb-border)] p-[calc(var(--fb-gap)*3)] ${SURFACE_MOTION}`}
						>
							<div className="min-w-0 max-w-full flex-1 basis-[calc(var(--fb-gap)*40)] truncate font-semibold">
								Preview {preview.item.name}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<button
									aria-label="Previous file"
									className={toolButton(false)}
									disabled={previewFiles.length <= 1}
									onClick={() => showAdjacentPreview(-1)}
									type="button"
								>
									<ChevronLeft aria-hidden="true" className="size-4" />
								</button>
								<button
									aria-label="Next file"
									className={toolButton(false)}
									disabled={previewFiles.length <= 1}
									onClick={() => showAdjacentPreview(1)}
									type="button"
								>
									<ChevronRight aria-hidden="true" className="size-4" />
								</button>
								<button className={toolButton(false)} onClick={() => setPreview(null)} type="button">
									Close
								</button>
							</div>
						</div>
						<div
							className={`grid min-h-[min(260px,40dvh)] min-w-0 place-items-center bg-[var(--fb-bg)] p-[var(--fb-pad)] ${SURFACE_MOTION}`}
						>
							{(preview.item.mimeType?.startsWith('image/') && preview.url) || preview.item.thumbnailUrl ? (
								<div className="min-w-0 max-w-full text-center">
									<img
										alt={preview.item.name}
										className={`max-h-[min(420px,55dvh)] max-w-full rounded-[calc(var(--fb-radius)-2px)] object-contain ${SURFACE_MOTION}`}
										src={preview.url ?? preview.item.thumbnailUrl}
									/>
									<PreviewOriginalLink preview={preview} />
								</div>
							) : (
								<div className="min-w-0 max-w-full text-center">
									<File className="mx-auto size-12 text-[var(--fb-muted)]" />
									<div className="mt-3 font-semibold">{preview.item.name}</div>
									<div className="mt-1 text-[12px] text-[var(--fb-muted)]">{preview.item.mimeType ?? 'File'}</div>
									{preview.status === 'loading' ? (
										<div className="mt-3 text-[12px] text-[var(--fb-muted)]">Loading preview</div>
									) : null}
									{preview.status === 'error' ? (
										<div className="mt-3 text-[12px] text-[var(--fb-danger)]">
											{preview.error ?? 'Could not load preview'}
										</div>
									) : null}
									<PreviewOriginalLink preview={preview} />
								</div>
							)}
						</div>
					</div>
				</ResponsiveDialog>
			) : null}
		</section>
	)
}

type BrowserLike<TMetadata = unknown> = UseFileBrowserResult<TMetadata>

function joinUploadRelativePath(currentPath: string, relativePath: string) {
	return relativePath
		.split('/')
		.filter(Boolean)
		.reduce((path, part) => joinFileBrowserPath(path, part), currentPath)
}

function getUploadFolderPaths(candidates: FileBrowserUploadCandidate[]) {
	const folders = new Set<string>()

	for (const { relativePath } of candidates) {
		const parts = relativePath.split('/').filter(Boolean)
		for (let index = 1; index < parts.length; index += 1) {
			folders.add(parts.slice(0, index).join('/'))
		}
	}

	return Array.from(folders).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

function partitionUploadCandidates(
	candidates: FileBrowserUploadCandidate[],
	predicate: (candidate: FileBrowserUploadCandidate) => boolean
): [FileBrowserUploadCandidate[], FileBrowserUploadCandidate[]] {
	const matched: FileBrowserUploadCandidate[] = []
	const unmatched: FileBrowserUploadCandidate[] = []

	for (const candidate of candidates) {
		if (predicate(candidate)) {
			matched.push(candidate)
		} else {
			unmatched.push(candidate)
		}
	}

	return [matched, unmatched]
}

function getUploadTransferGroup(
	currentPath: string,
	candidates: FileBrowserUploadCandidate[],
	createdFolders = 0
): UploadTransferGroup | undefined {
	if (getUploadFolderPaths(candidates).length === 0) {
		return undefined
	}

	const topLevelFolders = candidates
		.map((candidate) => candidate.relativePath.split('/').filter(Boolean)[0])
		.filter((folder): folder is string => Boolean(folder))
	const uniqueTopLevelFolders = Array.from(new Set(topLevelFolders))
	const name = uniqueTopLevelFolders.length === 1 ? uniqueTopLevelFolders[0] : 'Folder upload'
	const id =
		uniqueTopLevelFolders.length === 1
			? joinUploadRelativePath(currentPath, name)
			: `${normalizeFileBrowserPath(currentPath)}#folder-upload`

	return {
		id,
		name,
		totalFiles: candidates.length,
		createdFolders
	}
}

async function collectMoveDestinations<TMetadata>(
	adapter: FileBrowserAdapter<TMetadata>,
	excludedPaths: string[]
): Promise<MoveDestination[]> {
	const destinations: MoveDestination[] = []
	const excluded = excludedPaths.map(normalizeFileBrowserPath)

	async function collect(path: string, depth: number): Promise<void> {
		let cursor: string | undefined
		do {
			const result = await adapter.list(path, { cursor })
			const folders = result.items
				.filter((item) => item.kind === 'folder')
				.sort((left, right) =>
					left.name.localeCompare(right.name, undefined, {
						numeric: true,
						sensitivity: 'base'
					})
				)

			for (const folder of folders) {
				if (isExcludedDestination(folder.path, excluded)) {
					continue
				}
				destinations.push({
					path: folder.path,
					name: folder.name,
					depth
				})
				await collect(folder.path, depth + 1)
			}

			cursor = result.cursor
		} while (cursor)
	}

	await collect('/', 0)
	return destinations
}

function isExcludedDestination(path: string, excludedPaths: string[]) {
	const normalized = normalizeFileBrowserPath(path)
	return excludedPaths.some((excluded) => normalized === excluded || normalized.startsWith(`${excluded}/`))
}

function applyUploadPolicy(
	candidates: FileBrowserUploadCandidate[],
	policy: FileBrowserUploadPolicy | undefined,
	currentPath: string
) {
	if (!policy) {
		return { acceptedCandidates: candidates, rejectedCandidates: [] }
	}

	const acceptedCandidates: FileBrowserUploadCandidate[] = []
	const rejectedCandidates: FileBrowserUploadRejection[] = []
	let acceptedBytes = 0

	for (const candidate of candidates) {
		const reasons: string[] = []

		if (policy.maxFileSizeBytes !== undefined && candidate.file.size > policy.maxFileSizeBytes) {
			reasons.push(`File is larger than ${formatBytes(policy.maxFileSizeBytes)}`)
		}

		if (policy.allowedMimeTypes?.length && !isAllowedUploadType(candidate.file, policy.allowedMimeTypes)) {
			reasons.push(`File type ${candidate.file.type || 'unknown'} is not allowed`)
		}

		if (policy.remainingQuotaBytes !== undefined && acceptedBytes + candidate.file.size > policy.remainingQuotaBytes) {
			reasons.push(`Upload exceeds remaining quota of ${formatBytes(policy.remainingQuotaBytes)}`)
		}

		const customReason = policy.validate?.(candidate, {
			acceptedBytes,
			currentPath
		})
		if (Array.isArray(customReason)) {
			reasons.push(...customReason.filter(Boolean))
		} else if (customReason) {
			reasons.push(customReason)
		}

		if (reasons.length > 0) {
			rejectedCandidates.push({
				fileName: candidate.file.name,
				relativePath: candidate.relativePath,
				reasons
			})
			continue
		}

		acceptedBytes += candidate.file.size
		acceptedCandidates.push(candidate)
	}

	return { acceptedCandidates, rejectedCandidates }
}

function isAllowedUploadType(file: File, allowedMimeTypes: string[]) {
	return allowedMimeTypes.some((allowed) => {
		if (allowed.endsWith('/*')) {
			return file.type.startsWith(allowed.slice(0, -1))
		}
		if (allowed.startsWith('.')) {
			return file.name.toLowerCase().endsWith(allowed.toLowerCase())
		}
		return file.type === allowed
	})
}

function FileGrid<TMetadata>({
	browser,
	canMove,
	folderDropTargetPath,
	inlineRenameError,
	inlineRenameLabel,
	inlineRenameItem,
	inlineRenameValue,
	selectedPaths,
	onContextMenu,
	onDragEnd,
	onDragStart,
	onEmptyClick,
	onFolderDragOver,
	onFolderDrop,
	onInlineRenameCancel,
	onInlineRenameChange,
	onInlineRenameCommit,
	onOpenItem,
	onSelectItem,
	onTouchMenu,
	narrow,
	selectionMode,
	onToggleItem,
	renderItemMeta,
	rootLabel
}: {
	browser: BrowserLike<TMetadata>
	canMove: boolean
	folderDropTargetPath: string | null
	inlineRenameError: string | null
	inlineRenameLabel: string
	inlineRenameItem: FileNode<TMetadata> | null
	inlineRenameValue: string
	selectedPaths: string[]
	onContextMenu: (item: FileNode<TMetadata>, event: MouseEvent) => void
	onDragEnd: () => void
	onDragStart: (item: FileNode<TMetadata>, event: DragEvent) => void
	onEmptyClick: () => void
	onFolderDragOver: (item: FileNode<TMetadata>, event: DragEvent) => void
	onFolderDrop: (item: FileNode<TMetadata>, event: DragEvent) => void
	onInlineRenameCancel: () => void
	onInlineRenameChange: (value: string) => void
	onInlineRenameCommit: () => void
	onOpenItem: (item: FileNode<TMetadata>) => void
	onSelectItem: (path: string, event: MouseEvent) => void
	onTouchMenu: (item: FileNode<TMetadata>) => void
	narrow: boolean
	selectionMode: boolean
	onToggleItem: (path: string) => void
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
	rootLabel: string
}) {
	const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)

	function handleMarqueeSelect(event: OnSelect) {
		const inputEvent = event.inputEvent as MouseEvent | KeyboardEvent | undefined
		const paths = event.selected
			.map((element) => element.getAttribute('data-fb-path'))
			.filter((path): path is string => Boolean(path))

		browser.setSelection(paths, {
			additive: Boolean(inputEvent?.shiftKey || inputEvent?.metaKey || inputEvent?.ctrlKey)
		})
	}

	return (
		<>
			{gridElement && !narrow ? (
				<Selecto
					className="[background:var(--fb-accent-soft)!important] [border-color:var(--fb-accent)!important]"
					container={gridElement}
					dragContainer={gridElement}
					hitRate={10}
					onSelect={handleMarqueeSelect}
					onDragStart={(event) => {
						if (event.inputEvent?.type?.startsWith('touch')) event.stop()
					}}
					preventClickEventOnDrag
					selectByClick={false}
					selectableTargets={[
						() => Array.from(gridElement.querySelectorAll<HTMLElement | SVGElement>("[data-fb-selectable='true']"))
					]}
					selectFromInside={false}
				/>
			) : null}
			<div
				aria-label={rootLabel}
				className="relative grid min-h-full min-w-0 touch-pan-y content-start grid-cols-[repeat(2,minmax(0,1fr))] gap-[var(--fb-grid-gap)] @min-[40rem]/fb:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--fb-card-min)),1fr))]"
				onClick={(event) => {
					if (!selectionMode && event.target === event.currentTarget && !hasSelectionModifier(event)) {
						onEmptyClick()
					}
				}}
				ref={setGridElement}
				role="grid"
			>
				{browser.filteredItems.map((item) => (
					<FileCard
						canMove={canMove}
						dropTarget={folderDropTargetPath === item.path}
						item={item}
						key={item.path}
						onOpen={() => onOpenItem(item)}
						onContextMenu={(event) => onContextMenu(item, event)}
						onDragEnd={onDragEnd}
						onDragStart={(event) => onDragStart(item, event)}
						onFolderDragOver={(event) => onFolderDragOver(item, event)}
						onFolderDrop={(event) => onFolderDrop(item, event)}
						inlineRenameError={inlineRenameError}
						inlineRenameLabel={inlineRenameLabel}
						inlineRenameValue={inlineRenameValue}
						isRenaming={inlineRenameItem?.path === item.path}
						onInlineRenameCancel={onInlineRenameCancel}
						onInlineRenameChange={onInlineRenameChange}
						onInlineRenameCommit={onInlineRenameCommit}
						onSelect={(event) => onSelectItem(item.path, event)}
						onTouchMenu={() => onTouchMenu(item)}
						narrow={narrow}
						selectionMode={selectionMode}
						onToggle={() => onToggleItem(item.path)}
						renderItemMeta={renderItemMeta}
						selected={selectedPaths.includes(item.path)}
					/>
				))}
			</div>
		</>
	)
}

function FileCard<TMetadata>({
	canMove,
	dropTarget,
	inlineRenameError,
	inlineRenameLabel,
	inlineRenameValue,
	isRenaming,
	item,
	selected,
	onSelect,
	onOpen,
	onContextMenu,
	onDragEnd,
	onDragStart,
	onFolderDragOver,
	onFolderDrop,
	onInlineRenameCancel,
	onInlineRenameChange,
	onInlineRenameCommit,
	onTouchMenu,
	narrow,
	selectionMode,
	onToggle,
	renderItemMeta
}: {
	canMove: boolean
	dropTarget: boolean
	inlineRenameError: string | null
	inlineRenameLabel: string
	inlineRenameValue: string
	isRenaming: boolean
	item: FileNode<TMetadata>
	selected: boolean
	onSelect: (event: MouseEvent) => void
	onOpen: () => void
	onContextMenu: (event: MouseEvent) => void
	onDragEnd: () => void
	onDragStart: (event: DragEvent) => void
	onFolderDragOver: (event: DragEvent) => void
	onFolderDrop: (event: DragEvent) => void
	onInlineRenameCancel: () => void
	onInlineRenameChange: (value: string) => void
	onInlineRenameCommit: () => void
	onTouchMenu: () => void
	narrow: boolean
	selectionMode: boolean
	onToggle: () => void
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
}) {
	const longPress = useLongPress(onTouchMenu)

	return (
		<article
			aria-selected={selected}
			data-fb-drop-target={dropTarget ? 'true' : undefined}
			data-fb-path={item.path}
			data-fb-selectable="true"
			draggable={canMove && !narrow}
			className={`group relative flex min-h-[var(--fb-card-minh)] min-w-0 cursor-default flex-col rounded-[calc(var(--fb-radius)-1px)] border p-[var(--fb-card-pad)] outline-none hover:shadow-[0_8px_22px_color-mix(in_oklch,var(--fb-text)_8%,transparent)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${SURFACE_MOTION} ${
				dropTarget
					? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] ring-2 ring-[var(--fb-accent)] ring-offset-2 ring-offset-[var(--fb-surface)]'
					: selected
						? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)]'
						: 'border-[var(--fb-border)] bg-[var(--fb-surface)] hover:border-[var(--fb-border-strong)]'
			}`}
			onClick={onSelect}
			onContextMenu={onContextMenu}
			onDoubleClick={onOpen}
			onDragEnd={canMove ? onDragEnd : undefined}
			onDragOver={item.kind === 'folder' ? onFolderDragOver : undefined}
			onDragStart={canMove ? onDragStart : undefined}
			onDrop={item.kind === 'folder' ? onFolderDrop : undefined}
			{...longPress}
			role="gridcell"
			tabIndex={0}
		>
			{selectionMode ? (
				<button
					aria-label={`Select ${item.name}`}
					aria-pressed={selected}
					className="absolute right-0 top-0 z-10 grid size-[calc(var(--fb-gap)*11)] place-items-center text-[var(--fb-accent)]"
					data-fb-touch-control
					onClick={(event) => {
						event.stopPropagation()
						onToggle()
					}}
					type="button"
				>
					{selected ? (
						<CheckSquare aria-hidden="true" className="size-5" />
					) : (
						<Square aria-hidden="true" className="size-5" />
					)}
				</button>
			) : (
				<span
					aria-hidden="true"
					className={`absolute right-2 top-2 grid size-4 place-items-center rounded border text-[10px] ${CONTROL_MOTION} ${
						selected
							? 'border-[var(--fb-accent)] bg-[var(--fb-accent)] text-[var(--fb-surface)]'
							: 'border-[var(--fb-border)] bg-[var(--fb-surface)] opacity-0 group-hover:opacity-100'
					}`}
				>
					{selected ? '✓' : ''}
				</span>
			)}
			<div
				className={`grid h-[var(--fb-thumb-h)] place-items-center rounded-[calc(var(--fb-radius)-3px)] bg-[var(--fb-surface-2)] group-hover:bg-[var(--fb-bg)] ${CONTROL_MOTION}`}
			>
				{item.kind === 'folder' ? (
					<Folder aria-hidden="true" className="size-9 text-[var(--fb-folder)]" />
				) : (
					<File aria-hidden="true" className="size-9 text-[var(--fb-muted)]" />
				)}
			</div>
			{isRenaming ? (
				<InlineRenameInput
					item={item}
					error={inlineRenameError}
					label={inlineRenameLabel}
					onCancel={onInlineRenameCancel}
					onChange={onInlineRenameChange}
					onCommit={onInlineRenameCommit}
					value={inlineRenameValue}
				/>
			) : (
				<button
					className={`mt-2 min-w-0 truncate text-left text-[12.5px] font-semibold text-[var(--fb-text)] outline-none [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${narrow ? 'min-h-[calc(var(--fb-gap)*11)]' : ''} ${CONTROL_MOTION}`}
					onClick={(event) => {
						event.stopPropagation()
						onSelect(event)
					}}
					type="button"
				>
					{item.name}
				</button>
			)}
			<div className="mt-1 text-[11px] text-[var(--fb-muted)]">
				{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}
			</div>
			<ItemMeta item={item} renderItemMeta={renderItemMeta} view="grid" />
		</article>
	)
}

function ItemMeta<TMetadata>({
	item,
	renderItemMeta,
	view
}: {
	item: FileNode<TMetadata>
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
	view: FileBrowserView
}) {
	if (!renderItemMeta) {
		return null
	}

	const content = renderItemMeta(item, { view })
	return content === null || content === undefined || content === false ? null : (
		<div
			className="mt-1 min-w-0 max-w-full text-[11px] [overflow-wrap:anywhere] [&_*]:max-w-full"
			data-fb-item-meta={view}
		>
			{content}
		</div>
	)
}

function InlineRenameInput<TMetadata>({
	error,
	item,
	label,
	onCancel,
	onChange,
	onCommit,
	value
}: {
	error: string | null
	item: FileNode<TMetadata>
	label: string
	onCancel: () => void
	onChange: (value: string) => void
	onCommit: () => void
	value: string
}) {
	return (
		<div className="min-w-0">
			<input
				aria-label={`Rename ${label || item.name}`}
				autoFocus
				className={`mt-2 w-full min-w-0 rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-accent)] bg-[var(--fb-surface)] px-1.5 py-1 text-[12.5px] font-semibold text-[var(--fb-text)] outline-none ring-2 ring-[var(--fb-accent-soft)] [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:text-[16px] ${CONTROL_MOTION}`}
				onBlur={onCommit}
				onChange={(event) => onChange(event.target.value)}
				onClick={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault()
						onCommit()
					}
					if (event.key === 'Escape') {
						event.preventDefault()
						onCancel()
					}
				}}
				value={value}
			/>
			{error ? (
				<div
					className={`mt-1 rounded-[calc(var(--fb-radius)-5px)] border border-[var(--fb-danger)] bg-[var(--fb-danger-soft)] px-1.5 py-1 text-[11px] text-[var(--fb-danger)] ${SURFACE_MOTION}`}
					role="alert"
				>
					{error}
				</div>
			) : null}
		</div>
	)
}

function FileTable<TMetadata>({
	browser,
	canMove,
	folderDropTargetPath,
	inlineRenameError,
	inlineRenameLabel,
	inlineRenameItem,
	inlineRenameValue,
	selectedPaths,
	onContextMenu,
	onDragEnd,
	onDragStart,
	onFolderDragOver,
	onFolderDrop,
	onInlineRenameCancel,
	onInlineRenameChange,
	onInlineRenameCommit,
	onOpenItem,
	onSelectItem,
	onTouchMenu,
	narrow,
	selectionMode,
	onToggleItem,
	renderItemMeta,
	rootLabel
}: {
	browser: BrowserLike<TMetadata>
	canMove: boolean
	folderDropTargetPath: string | null
	inlineRenameError: string | null
	inlineRenameLabel: string
	inlineRenameItem: FileNode<TMetadata> | null
	inlineRenameValue: string
	selectedPaths: string[]
	onContextMenu: (item: FileNode<TMetadata>, event: MouseEvent) => void
	onDragEnd: () => void
	onDragStart: (item: FileNode<TMetadata>, event: DragEvent) => void
	onFolderDragOver: (item: FileNode<TMetadata>, event: DragEvent) => void
	onFolderDrop: (item: FileNode<TMetadata>, event: DragEvent) => void
	onInlineRenameCancel: () => void
	onInlineRenameChange: (value: string) => void
	onInlineRenameCommit: () => void
	onOpenItem: (item: FileNode<TMetadata>) => void
	onSelectItem: (path: string, event: MouseEvent) => void
	onTouchMenu: (item: FileNode<TMetadata>) => void
	narrow: boolean
	selectionMode: boolean
	onToggleItem: (path: string) => void
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
	rootLabel: string
}) {
	const disclosureSize = getDisclosureSize(narrow)
	return (
		<table
			aria-label={rootLabel}
			className={`w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-left ${SURFACE_MOTION}`}
		>
			<thead className="text-[11px] text-[var(--fb-muted)]">
				<tr>
					<th className="border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)] font-medium">
						Name
					</th>
					{!narrow ? (
						<th className="w-[22%] border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)] font-medium">
							Size
						</th>
					) : null}
					{!narrow ? (
						<th className="w-[26%] border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)] font-medium">
							Modified
						</th>
					) : null}
				</tr>
			</thead>
			<tbody>
				{browser.listRows.map((row) => {
					if (row.type === 'status') {
						return <FolderStatusRow browser={browser} key={`${row.parentPath}::status`} narrow={narrow} row={row} />
					}
					const { item, depth, expanded } = row
					return (
						<TouchRow
							aria-selected={selectedPaths.includes(item.path)}
							data-fb-drop-target={folderDropTargetPath === item.path ? 'true' : undefined}
							data-fb-path={item.path}
							className={
								folderDropTargetPath === item.path
									? `bg-[var(--fb-accent-soft)] ring-2 ring-inset ring-[var(--fb-accent)] ${CONTROL_MOTION}`
									: selectedPaths.includes(item.path)
										? `bg-[var(--fb-accent-soft)] outline-none focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${CONTROL_MOTION}`
										: `outline-none hover:bg-[var(--fb-bg)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${CONTROL_MOTION}`
							}
							draggable={canMove && !narrow}
							onLongPress={() => onTouchMenu(item)}
							key={item.path}
							onClick={(event) => onSelectItem(item.path, event)}
							onContextMenu={(event) => onContextMenu(item, event)}
							onDragEnd={onDragEnd}
							onDragOver={(event) => onFolderDragOver(item, event)}
							onDragStart={(event) => onDragStart(item, event)}
							onDrop={(event) => onFolderDrop(item, event)}
							onDoubleClick={() => onOpenItem(item)}
							tabIndex={0}
						>
							<td
								className="border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)]"
								style={depth > 0 ? { paddingInlineStart: treeIndent(depth) } : undefined}
							>
								<div className="flex min-w-0 items-start gap-2">
									{selectionMode ? (
										<button
											aria-label={`Select ${item.name}`}
											aria-pressed={selectedPaths.includes(item.path)}
											className="grid size-[calc(var(--fb-gap)*11)] shrink-0 place-items-center text-[var(--fb-accent)]"
											data-fb-touch-control
											onClick={(event) => {
												event.stopPropagation()
												onToggleItem(item.path)
											}}
											type="button"
										>
											{selectedPaths.includes(item.path) ? (
												<CheckSquare aria-hidden="true" className="size-5" />
											) : (
												<Square aria-hidden="true" className="size-5" />
											)}
										</button>
									) : null}
									{item.kind === 'folder' ? (
										<button
											aria-expanded={expanded}
											aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}
											className={`grid shrink-0 place-items-center rounded-[var(--fb-radius)] text-[var(--fb-muted)] hover:bg-[var(--fb-border)] hover:text-[var(--fb-text)] ${disclosureSize} ${CONTROL_MOTION}`}
											data-fb-touch-control
											onClick={(event) => {
												event.stopPropagation()
												browser.toggleFolder(item.path)
											}}
											onDoubleClick={(event) => event.stopPropagation()}
											type="button"
										>
											<ChevronRight
												aria-hidden="true"
												className={`size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
											/>
										</button>
									) : (
										<span aria-hidden="true" className={`shrink-0 ${disclosureSize}`} />
									)}
									{item.kind === 'folder' ? (
										<Folder className="mt-0.5 size-4 shrink-0 text-[var(--fb-folder)]" />
									) : (
										<File className="mt-0.5 size-4 shrink-0 text-[var(--fb-muted)]" />
									)}
									<div className="min-w-0 flex-1">
										{inlineRenameItem?.path === item.path ? (
											<InlineRenameInput
												item={item}
												error={inlineRenameError}
												label={inlineRenameLabel}
												onCancel={onInlineRenameCancel}
												onChange={onInlineRenameChange}
												onCommit={onInlineRenameCommit}
												value={inlineRenameValue}
											/>
										) : (
											<button
												className={`block max-w-full truncate text-left font-medium [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${narrow ? 'min-h-[calc(var(--fb-gap)*11)]' : ''} ${CONTROL_MOTION}`}
												onClick={(event) => {
													event.stopPropagation()
													onSelectItem(item.path, event)
												}}
												type="button"
											>
												{item.name}
											</button>
										)}
										<ItemMeta item={item} renderItemMeta={renderItemMeta} view="list" />
										{narrow ? (
											<div className="mt-[var(--fb-gap)] flex flex-wrap gap-x-[calc(var(--fb-gap)*3)] text-[11px] text-[var(--fb-muted)]">
												<span>{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}</span>
												{item.modifiedAt ? <span>{new Date(item.modifiedAt).toLocaleDateString()}</span> : null}
											</div>
										) : null}
									</div>
								</div>
							</td>
							{!narrow ? (
								<td className="border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)] text-[12px] text-[var(--fb-muted)]">
									{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}
								</td>
							) : null}
							{!narrow ? (
								<td className="border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)] text-[12px] text-[var(--fb-muted)]">
									{item.modifiedAt ? new Date(item.modifiedAt).toLocaleDateString() : '—'}
								</td>
							) : null}
						</TouchRow>
					)
				})}
			</tbody>
		</table>
	)
}

function treeIndent(depth: number) {
	return `calc(var(--fb-cell-x) + var(--fb-gap) * ${depth * 5})`
}

function getDisclosureSize(narrow: boolean) {
	return `size-5 [@media(pointer:coarse)]:size-[calc(var(--fb-gap)*11)] ${narrow ? 'size-[calc(var(--fb-gap)*11)]' : ''}`
}

function FolderStatusRow<TMetadata>({
	browser,
	narrow,
	row
}: {
	browser: BrowserLike<TMetadata>
	narrow: boolean
	row: Extract<FileBrowserListRow<TMetadata>, { type: 'status' }>
}) {
	const linkButton = `rounded-[var(--fb-radius)] font-medium text-[var(--fb-accent)] hover:underline ${CONTROL_MOTION}`
	return (
		<tr data-fb-status-for={row.parentPath}>
			<td
				className="border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[var(--fb-cell-y)] text-[12px] text-[var(--fb-muted)]"
				colSpan={narrow ? 1 : 3}
				style={{ paddingInlineStart: treeIndent(row.depth) }}
			>
				<div className="flex min-w-0 items-center gap-2">
					{/* Same width as the item-row chevron so the status lines up with the child icons. */}
					<span aria-hidden="true" className={`shrink-0 ${getDisclosureSize(narrow)}`} />
					{row.status === 'loading' ? (
						<span role="status">Loading…</span>
					) : row.status === 'empty' ? (
						<span>Empty folder</span>
					) : row.status === 'more' ? (
						<button className={linkButton} onClick={() => browser.loadMoreFolder(row.parentPath)} type="button">
							Load more
						</button>
					) : (
						<span className="text-[var(--fb-danger)]">
							{row.error?.message ?? 'Could not load folder'}{' '}
							<button className={linkButton} onClick={() => browser.expandFolder(row.parentPath)} type="button">
								Retry
							</button>
						</span>
					)}
				</div>
			</td>
		</tr>
	)
}

function TouchRow({ onLongPress, ...props }: React.ComponentProps<'tr'> & { onLongPress: () => void }) {
	const longPress = useLongPress(onLongPress)
	return <tr {...props} {...longPress} />
}

function ContextMenu<TMetadata>({
	browser,
	canDownload,
	menu,
	onClose,
	onDelete,
	onDownload,
	onCopy,
	onCopyPath,
	onCut,
	onMove,
	onNewFolder,
	onPaste,
	onRename,
	onUpload,
	readOnly
}: {
	browser: BrowserLike<TMetadata>
	canDownload: boolean
	menu: ContextMenuState<TMetadata>
	onClose: () => void
	onDelete: () => void
	onDownload: () => void
	onCopy: () => void
	onCopyPath: (item: FileNode<TMetadata>) => void
	onCut: () => void
	onMove: () => void
	onNewFolder: () => void
	onPaste: () => void
	onRename: (item?: FileNode<TMetadata>) => void
	onUpload: () => void
	readOnly: boolean
}) {
	const isItemMenu = menu.target === 'item'
	const isSheet = menu.mode === 'sheet'
	const menuRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState({ left: menu.x, top: menu.y })

	useEffect(() => {
		if (isSheet) return
		const element = menuRef.current
		const previousFocus = document.activeElement
		const reposition = () => {
			const gap = element ? (Number.parseFloat(getComputedStyle(element).paddingLeft) || 0) * 2 : 0
			const rect = element?.getBoundingClientRect()
			setPosition({
				left: Math.max(gap, Math.min(menu.x, document.documentElement.clientWidth - (rect?.width ?? 0) - gap)),
				top: Math.max(gap, Math.min(menu.y, window.innerHeight - (rect?.height ?? 0) - gap))
			})
		}
		reposition()
		element?.querySelector<HTMLElement>('button')?.focus()
		window.addEventListener('resize', reposition)
		return () => {
			window.removeEventListener('resize', reposition)
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
				previousFocus.focus({ preventScroll: true })
		}
	}, [menu.x, menu.y, isSheet])

	function run(action: () => void) {
		action()
		onClose()
	}

	const content = (
		<div
			aria-label={isItemMenu ? 'Item actions' : 'Folder actions'}
			className={`rounded-[calc(var(--fb-radius)-2px)] bg-[var(--fb-surface)] p-1 text-[12px] text-[var(--fb-text)] ${SURFACE_MOTION} ${
				isSheet
					? 'w-full'
					: 'fixed z-[60] max-h-[calc(100dvh-var(--fb-gap)*4)] min-w-40 max-w-[calc(100%-var(--fb-gap)*4)] overflow-y-auto border border-[var(--fb-border)] shadow-[0_16px_44px_color-mix(in_oklch,var(--fb-text)_16%,transparent)]'
			}`}
			data-fb-menu={isSheet ? 'sheet' : 'context'}
			role="menu"
			ref={menuRef}
			style={isSheet ? undefined : position}
			onKeyDown={(event) => {
				if (event.key === 'Escape' || (event.key === 'Tab' && !isSheet)) {
					event.stopPropagation()
					onClose()
					return
				}
				if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
				event.preventDefault()
				event.stopPropagation()
				const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
				const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
				const next =
					event.key === 'Home'
						? 0
						: event.key === 'End'
							? buttons.length - 1
							: (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
				buttons[next]?.focus()
			}}
		>
			{isItemMenu && !readOnly && browser.capabilities.rename ? (
				<ContextMenuButton onClick={() => run(() => onRename(menu.item))}>Rename</ContextMenuButton>
			) : null}
			{isItemMenu && !readOnly && browser.capabilities.move ? (
				<ContextMenuButton onClick={() => run(onMove)}>Move</ContextMenuButton>
			) : null}
			{isItemMenu && !readOnly && browser.capabilities.copy ? (
				<ContextMenuButton onClick={() => run(onCopy)}>Copy</ContextMenuButton>
			) : null}
			{isItemMenu && !readOnly && browser.capabilities.move ? (
				<ContextMenuButton onClick={() => run(onCut)}>Cut</ContextMenuButton>
			) : null}
			{isItemMenu ? (
				<>
					<ContextMenuButton onClick={() => run(() => onCopyPath(menu.item))}>
						{browser.selectedPaths.includes(menu.item.path) && browser.selectedPaths.length > 1
							? 'Copy paths'
							: 'Copy path'}
					</ContextMenuButton>
					{canDownload ? <ContextMenuButton onClick={() => run(onDownload)}>Download</ContextMenuButton> : null}
					{!readOnly ? (
						<ContextMenuButton
							danger
							onClick={() => {
								onDelete()
								onClose()
							}}
						>
							Delete
						</ContextMenuButton>
					) : null}
				</>
			) : (
				<>
					{!readOnly ? (
						<>
							{browser.capabilities.createFolder ? (
								<ContextMenuButton onClick={() => run(onNewFolder)}>New folder</ContextMenuButton>
							) : null}
							<ContextMenuButton onClick={() => run(onUpload)}>Upload</ContextMenuButton>
						</>
					) : null}
					{!readOnly && browser.clipboard ? (
						<ContextMenuButton onClick={() => run(onPaste)}>Paste here</ContextMenuButton>
					) : null}
				</>
			)}
		</div>
	)
	return isSheet ? (
		<ActionSheet label={isItemMenu ? 'Item actions' : 'Folder actions'} onClose={onClose}>
			{content}
		</ActionSheet>
	) : (
		content
	)
}

function ContextMenuButton({ children, danger, onClick }: { children: string; danger?: boolean; onClick: () => void }) {
	return (
		<button
			className={`flex min-h-[var(--fb-control-h)] w-full items-center rounded-[calc(var(--fb-radius)-4px)] px-2 text-left font-medium outline-none hover:bg-[var(--fb-bg)] focus:bg-[var(--fb-bg)] ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
				danger ? 'text-[var(--fb-danger)]' : ''
			}`}
			onClick={onClick}
			role="menuitem"
			type="button"
		>
			{children}
		</button>
	)
}

function UploadConflictDialog({
	applyToAll,
	narrow,
	currentPath,
	onApplyToAllChange,
	onCancel,
	onResolve,
	queue,
	resolutions
}: {
	applyToAll: boolean
	narrow: boolean
	currentPath: string
	onApplyToAllChange: (value: boolean) => void
	onCancel: () => void
	onResolve: (resolution: FileBrowserUploadConflictResolution) => void
	queue: UploadConflictQueue
	resolutions: readonly FileBrowserUploadConflictResolution[]
}) {
	const candidate = queue.candidates[queue.index]
	const path = joinUploadRelativePath(currentPath, candidate.relativePath)
	const conflictIndex = queue.conflictPaths.indexOf(path) + 1

	return (
		<ResponsiveDialog label="File conflict" narrow={narrow} onClose={onCancel}>
			<div
				className={`w-[min(420px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)] ${SURFACE_MOTION}`}
			>
				<h2 className="m-0 text-[14px] font-semibold">File conflict</h2>
				<p className="mt-2 text-[12px] text-[var(--fb-muted)]">
					{candidate.relativePath} already exists in this folder.
				</p>
				<div
					className={`mt-3 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] p-2 text-[12px] ${SURFACE_MOTION}`}
				>
					Conflict {conflictIndex} of {queue.conflictPaths.length}
				</div>
				<label className="mt-3 flex min-h-[calc(var(--fb-gap)*11)] items-center gap-2 text-[12px] font-medium text-[var(--fb-muted)]">
					<input checked={applyToAll} onChange={(event) => onApplyToAllChange(event.target.checked)} type="checkbox" />
					Apply to all conflicts
				</label>
				<div
					className={`mt-4 flex flex-wrap justify-end gap-2 ${narrow ? 'flex-col [&>button]:w-full [&>button]:justify-center' : ''}`}
				>
					<button className={commandButton(false)} onClick={onCancel} type="button">
						Cancel
					</button>
					{resolutions.map((resolution) => (
						<button
							className={resolution === 'keep-both' ? primaryButton() : commandButton(false)}
							key={resolution}
							onClick={() => onResolve(resolution)}
							type="button"
						>
							{formatUploadConflictResolution(resolution)}
						</button>
					))}
				</div>
			</div>
		</ResponsiveDialog>
	)
}

function BulkFailureDialog({
	error,
	narrow,
	onClose
}: {
	error: FileBrowserBulkActionError
	narrow: boolean
	onClose: () => void
}) {
	const completedCount = error.succeededPaths.length

	return (
		<ResponsiveDialog label="Partial bulk failure" narrow={narrow} onClose={onClose}>
			<div
				className={`w-[min(440px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)] ${SURFACE_MOTION}`}
			>
				<h2 className="m-0 text-[14px] font-semibold">Partial bulk failure</h2>
				<p className="mt-2 text-[12px] text-[var(--fb-muted)]">
					{completedCount} of {error.totalCount} completed
				</p>
				<ul
					className={`mt-3 max-h-40 overflow-auto rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] p-2 text-[12px] ${SURFACE_MOTION}`}
				>
					{error.failures.map((failure) => (
						<li className="py-1" key={failure.path}>
							<div className="truncate font-medium">
								{failure.path.split('/').filter(Boolean).at(-1) ?? failure.path}
							</div>
							<div className="text-[var(--fb-danger)]">{failure.message}</div>
						</li>
					))}
				</ul>
				<div className="mt-4 flex justify-end">
					<button className={primaryButton()} onClick={onClose} type="button">
						OK
					</button>
				</div>
			</div>
		</ResponsiveDialog>
	)
}

function MoveDestinationPicker({
	currentPath,
	destinations,
	error,
	onSelect,
	rootLabel,
	selectedPath,
	status
}: {
	currentPath: string
	destinations: MoveDestination[]
	error: string | null
	onSelect: (path: string) => void
	rootLabel: string
	selectedPath: string
	status: MoveDestinationStatus
}) {
	return (
		<div
			className={`mt-3 max-h-64 overflow-auto rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] p-2 ${SURFACE_MOTION}`}
		>
			<MoveDestinationButton
				active={selectedPath === currentPath}
				label="Current folder"
				onClick={() => onSelect(currentPath)}
				path={currentPath}
			/>
			<MoveDestinationButton active={selectedPath === '/'} label={rootLabel} onClick={() => onSelect('/')} path="/" />
			{status === 'loading' ? (
				<div className="px-2 py-3 text-[12px] text-[var(--fb-muted)]">Loading folders</div>
			) : null}
			{status === 'error' ? (
				<div className="px-2 py-3 text-[12px] text-[var(--fb-danger)]">{error ?? 'Could not load folders'}</div>
			) : null}
			{status === 'ready' && destinations.length === 0 ? (
				<div className="px-2 py-3 text-[12px] text-[var(--fb-muted)]">No folders available.</div>
			) : null}
			{destinations.map((destination) => (
				<MoveDestinationButton
					active={selectedPath === destination.path}
					depth={destination.depth}
					key={destination.path}
					label={destination.name}
					onClick={() => onSelect(destination.path)}
					path={destination.path}
				/>
			))}
		</div>
	)
}

function MoveDestinationButton({
	active,
	depth = 0,
	label,
	onClick,
	path
}: {
	active: boolean
	depth?: number
	label: string
	onClick: () => void
	path: string
}) {
	return (
		<button
			aria-label={`Move destination ${path}`}
			className={`mt-1 flex min-h-[var(--fb-control-h)] w-full min-w-0 items-center gap-2 rounded-[calc(var(--fb-radius)-4px)] px-2 text-left text-[12px] font-medium ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
				active ? 'bg-[var(--fb-accent-soft)] text-[var(--fb-accent)]' : 'hover:bg-[var(--fb-surface)]'
			}`}
			onClick={onClick}
			style={{ paddingLeft: `min(40%, calc((${depth} * 6 + 2) * var(--fb-gap)))` }}
			type="button"
		>
			<Folder aria-hidden="true" className="size-4 shrink-0" />
			<span className="truncate">{label}</span>
		</button>
	)
}

function ActionBar({
	selectedCount,
	itemCount,
	canRename,
	canMove,
	canCopy,
	canCut,
	canDelete,
	canDownload,
	onRename,
	onMove,
	onCopy,
	onCut,
	onDelete,
	onDownload,
	onSelectAll,
	onSelectNone
}: {
	selectedCount: number
	itemCount: number
	canRename: boolean
	canMove: boolean
	canCopy: boolean
	canCut: boolean
	canDelete: boolean
	canDownload: boolean
	onRename: () => void
	onMove: () => void
	onCopy: () => void
	onCut: () => void
	onDelete: () => void
	onDownload: () => void
	onSelectAll: () => void
	onSelectNone: () => void
}) {
	const hasSelection = selectedCount > 0

	return (
		<div
			aria-label="Selection actions"
			className={`flex min-h-11 flex-wrap items-center gap-2 border-b border-[var(--fb-border)] px-[var(--fb-pad)] py-1.5 ${SURFACE_MOTION} ${
				hasSelection ? 'bg-[var(--fb-accent-soft)]' : 'bg-[var(--fb-surface)]'
			}`}
			role="toolbar"
		>
			<span className="mr-auto text-[12px] font-semibold">{selectedCount} selected</span>
			<button className={commandButton(false)} disabled={itemCount === 0} onClick={onSelectAll} type="button">
				<CheckSquare className="size-4" />
				Select all
			</button>
			<button className={commandButton(false)} disabled={!hasSelection} onClick={onSelectNone} type="button">
				<XIcon className="size-4" />
				Select none
			</button>
			{hasSelection && canRename && selectedCount === 1 ? (
				<button className={commandButton(false)} onClick={() => onRename()} type="button">
					<Pencil className="size-4" />
					Rename
				</button>
			) : null}
			{hasSelection && canMove ? (
				<button className={commandButton(false)} onClick={onMove} type="button">
					<FolderInput className="size-4" />
					Move
				</button>
			) : null}
			{hasSelection && canCopy ? (
				<button className={commandButton(false)} onClick={onCopy} type="button">
					<CopyIcon className="size-4" />
					Copy
				</button>
			) : null}
			{hasSelection && canCut ? (
				<button className={commandButton(false)} onClick={onCut} type="button">
					<Scissors className="size-4" />
					Cut
				</button>
			) : null}
			{hasSelection && canDownload ? (
				<button className={commandButton(false)} onClick={onDownload} type="button">
					<Download className="size-4" />
					Download
				</button>
			) : null}
			{hasSelection && canDelete ? (
				<button className={dangerButton()} onClick={onDelete} type="button">
					<Trash2 className="size-4" />
					Delete
				</button>
			) : null}
		</div>
	)
}

function Breadcrumbs({
	path,
	onNavigate,
	rootLabel,
	narrow
}: {
	path: string
	onNavigate: (path: string) => Promise<void>
	rootLabel: string
	narrow: boolean
}) {
	const [ancestorsOpen, setAncestorsOpen] = useState(false)
	const parts = path.split('/').filter(Boolean)
	const crumbs = [{ label: rootLabel, path: '/' }].concat(
		parts.map((part, index) => ({
			label: part,
			path: `/${parts.slice(0, index + 1).join('/')}`
		}))
	)
	const visibleCrumbs: VisibleBreadcrumbCrumb[] =
		narrow && crumbs.length > 1
			? [
					{ kind: 'collapsed', key: 'collapsed' },
					{ ...crumbs[crumbs.length - 1], kind: 'crumb', key: path }
				]
			: getVisibleBreadcrumbs(crumbs)

	return (
		<nav aria-label="Breadcrumb" className="flex min-w-0 max-w-full items-center gap-1">
			{narrow && parts.length > 0 ? (
				<button
					aria-label="Parent folder"
					className={toolButton(false)}
					onClick={() => void onNavigate(getFileBrowserDirname(path))}
					type="button"
				>
					<ChevronLeft aria-hidden="true" className="size-4" />
				</button>
			) : null}
			{visibleCrumbs.map((crumb, index) => (
				<span className="flex min-w-0 items-center gap-1 last:flex-1" key={crumb.key}>
					{index > 0 ? (
						<span className="text-[var(--fb-muted)]" aria-hidden="true">
							/
						</span>
					) : null}
					{crumb.kind === 'collapsed' ? (
						<button
							aria-label="Collapsed breadcrumb"
							aria-haspopup="dialog"
							className={`${toolButton(false)} border-0`}
							onClick={() => setAncestorsOpen(true)}
							type="button"
						>
							...
						</button>
					) : (
						<button
							className={`min-h-[var(--fb-control-h)] min-w-[var(--fb-control-h)] max-w-[160px] truncate rounded-[calc(var(--fb-radius)-4px)] px-1.5 py-1 text-[12px] font-semibold hover:bg-[var(--fb-bg)] [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:min-w-[calc(var(--fb-gap)*11)] ${CONTROL_MOTION}`}
							onClick={() => void onNavigate(crumb.path)}
							type="button"
						>
							{crumb.label}
						</button>
					)}
				</span>
			))}
			{ancestorsOpen ? (
				<ActionSheet label="Folder path" onClose={() => setAncestorsOpen(false)}>
					<div className="flex min-w-0 flex-col">
						{crumbs.map((crumb) => (
							<button
								key={crumb.path}
								className={`${commandButton(false)} my-[var(--fb-gap)] block w-full truncate text-left`}
								onClick={() => {
									setAncestorsOpen(false)
									void onNavigate(crumb.path)
								}}
								type="button"
							>
								{crumb.label}
							</button>
						))}
					</div>
				</ActionSheet>
			) : null}
		</nav>
	)
}

type BreadcrumbCrumb = {
	label: string
	path: string
}

type VisibleBreadcrumbCrumb =
	| (BreadcrumbCrumb & {
			kind: 'crumb'
			key: string
	  })
	| {
			kind: 'collapsed'
			key: string
	  }

function getVisibleBreadcrumbs(crumbs: BreadcrumbCrumb[]): VisibleBreadcrumbCrumb[] {
	if (crumbs.length <= 4) {
		return crumbs.map((crumb) => ({ ...crumb, kind: 'crumb', key: crumb.path }))
	}

	return [
		{ ...crumbs[0], kind: 'crumb', key: crumbs[0].path },
		{ ...crumbs[1], kind: 'crumb', key: crumbs[1].path },
		{ kind: 'collapsed', key: 'collapsed' },
		...crumbs.slice(-2).map((crumb) => ({
			...crumb,
			kind: 'crumb' as const,
			key: crumb.path
		}))
	]
}

function DetailsPanel<TMetadata>({
	canDownload,
	item,
	onCopyPath,
	onDownload,
	renderDetailsContent,
	selectedCount,
	totalBytes,
	sheet
}: {
	canDownload: boolean
	item: FileNode<TMetadata> | null
	onCopyPath: () => void
	onDownload: () => void
	renderDetailsContent?: (item: FileNode<TMetadata>, defaultContent: ReactNode) => ReactNode
	selectedCount: number
	totalBytes: number
	sheet: boolean
}) {
	const panelClass = `min-w-0 max-w-full shrink-0 bg-[var(--fb-surface)] [overflow-wrap:anywhere] [&_*]:max-w-full ${SURFACE_MOTION} ${
		sheet
			? 'w-full'
			: 'w-[var(--fb-panel-w)] rounded-r-[var(--fb-radius)] border-l border-[var(--fb-border)] p-[var(--fb-panel-pad)]'
	}`
	if (!item) {
		return (
			<aside aria-label="Details" className={`${panelClass} flex`}>
				<div className="flex min-h-full flex-1 flex-col items-center justify-center text-center">
					<div
						className={`grid h-28 w-full place-items-center rounded-[var(--fb-radius)] bg-[var(--fb-bg)] ${SURFACE_MOTION}`}
					>
						<Square className="size-12 text-[var(--fb-muted)]" />
					</div>
					<h2 className="mt-4 text-[14px] font-semibold">No item selected</h2>
				</div>
			</aside>
		)
	}

	if (selectedCount > 1) {
		return (
			<aside aria-label="Details" className={panelClass}>
				<div className={`grid h-28 place-items-center rounded-[var(--fb-radius)] bg-[var(--fb-bg)] ${SURFACE_MOTION}`}>
					<CopyIcon className="size-12 text-[var(--fb-muted)]" />
				</div>
				<h2 className="mt-4 text-[14px] font-semibold">{formatItemCount(selectedCount)} selected</h2>
				<dl className="mt-3 space-y-2 text-[12px]">
					<div>
						<dt className="text-[var(--fb-muted)]">Total size</dt>
						<dd className="font-medium">{formatBytes(totalBytes)}</dd>
					</div>
				</dl>
				{canDownload ? (
					<button
						aria-label={`Download ${formatItemCount(selectedCount)}`}
						className={`${commandButton(false)} mt-4 w-full justify-center`}
						onClick={onDownload}
						type="button"
					>
						<Download className="size-4" />
						Download
					</button>
				) : null}
				<button
					aria-label={`Copy ${formatItemCount(selectedCount)} paths`}
					className={`${commandButton(false)} mt-2 w-full justify-center`}
					onClick={onCopyPath}
					type="button"
				>
					<CopyIcon className="size-4" />
					Copy paths
				</button>
			</aside>
		)
	}

	const defaultContent = (
		<>
			<div className={`grid h-28 place-items-center rounded-[var(--fb-radius)] bg-[var(--fb-bg)] ${SURFACE_MOTION}`}>
				{item.kind === 'folder' ? (
					<Folder className="size-12 text-[var(--fb-folder)]" />
				) : (
					<File className="size-12 text-[var(--fb-muted)]" />
				)}
			</div>
			<h2 className="mt-4 truncate text-[14px] font-semibold">{item.name}</h2>
			<dl className="mt-3 space-y-2 text-[12px]">
				<div>
					<dt className="text-[var(--fb-muted)]">Path</dt>
					<dd className="truncate font-medium">{item.path}</dd>
				</div>
				<div>
					<dt className="text-[var(--fb-muted)]">Type</dt>
					<dd className="font-medium">{item.kind}</dd>
				</div>
				{item.kind === 'file' ? (
					<div>
						<dt className="text-[var(--fb-muted)]">Size</dt>
						<dd className="font-medium">{formatBytes(item.size ?? 0)}</dd>
					</div>
				) : null}
			</dl>
			{canDownload ? (
				<button
					aria-label={`Download ${item.name}`}
					className={`${commandButton(false)} mt-4 w-full justify-center`}
					onClick={onDownload}
					type="button"
				>
					<Download className="size-4" />
					Download
				</button>
			) : null}
			<button
				aria-label={`Copy path of ${item.name}`}
				className={`${commandButton(false)} mt-2 w-full justify-center`}
				onClick={onCopyPath}
				type="button"
			>
				<CopyIcon className="size-4" />
				Copy path
			</button>
		</>
	)

	return (
		<aside aria-label="Details" className={panelClass}>
			{renderDetailsContent ? renderDetailsContent(item, defaultContent) : defaultContent}
		</aside>
	)
}

function PreviewOriginalLink<TMetadata>({ preview }: { preview: PreviewState<TMetadata> }) {
	if (!preview.url) {
		return null
	}

	return (
		<a
			aria-label={`Open original ${preview.item.name}`}
			className={`mt-4 inline-flex min-h-[var(--fb-control-h)] items-center rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-2.5 text-[12px] font-medium text-[var(--fb-accent)] outline-none hover:bg-[var(--fb-bg)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${TOUCH_CONTROL} ${CONTROL_MOTION}`}
			href={preview.url}
			rel="noreferrer"
			target="_blank"
		>
			Open original
		</a>
	)
}

function SkeletonGrid({ rootLabel }: { rootLabel: string }) {
	return (
		<div
			aria-label={rootLabel}
			className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-[var(--fb-grid-gap)] @min-[40rem]/fb:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--fb-card-min)),1fr))]"
			role="grid"
		>
			{Array.from({ length: 8 }, (_, index) => (
				<div
					className={`min-h-[var(--fb-card-minh)] animate-pulse rounded-[calc(var(--fb-radius)-1px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-[var(--fb-card-pad)] ${SURFACE_MOTION}`}
					key={index}
				>
					<div className="h-[var(--fb-thumb-h)] rounded-[calc(var(--fb-radius)-3px)] bg-[var(--fb-surface-2)]" />
					<div className="mt-3 h-3 w-3/4 rounded bg-[var(--fb-surface-2)]" />
					<div className="mt-2 h-3 w-1/2 rounded bg-[var(--fb-surface-2)]" />
				</div>
			))}
		</div>
	)
}

function StateMessage({ title, value, tone }: { title: ReactNode; value?: ReactNode; tone?: 'danger' }) {
	return (
		<div
			className={`grid min-h-[min(280px,50svh)] min-w-0 place-items-center rounded-[var(--fb-radius)] border border-dashed border-[var(--fb-border)] bg-[var(--fb-surface)] p-[var(--fb-pad)] text-center [overflow-wrap:anywhere] [&_*]:max-w-full ${SURFACE_MOTION}`}
		>
			<div>
				<div className={`font-semibold ${tone === 'danger' ? 'text-[var(--fb-danger)]' : ''}`}>{title}</div>
				{value === undefined ? null : <div className="mt-1 text-[12px] text-[var(--fb-muted)]">{value}</div>}
			</div>
		</div>
	)
}

function UploadRejectionAlert({
	onDismiss,
	rejections
}: {
	onDismiss: () => void
	rejections: FileBrowserUploadRejection[]
}) {
	return (
		<div
			aria-label="Upload rejected"
			className="min-w-0 border-b border-[var(--fb-border)] bg-[var(--fb-danger-soft)] px-3 py-2 text-[12px] text-[var(--fb-text)] [overflow-wrap:anywhere]"
			role="alert"
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="font-semibold text-[var(--fb-danger)]">Upload rejected</div>
					<ul className="mt-1 space-y-1">
						{rejections.map((rejection) => (
							<li className="min-w-0" key={rejection.relativePath}>
								<span className="font-medium">{rejection.relativePath}</span>
								<span className="text-[var(--fb-muted)]"> {rejection.reasons.join('; ')}</span>
							</li>
						))}
					</ul>
				</div>
				<button
					aria-label="Dismiss upload rejection"
					className={commandButton(false)}
					onClick={onDismiss}
					type="button"
				>
					Dismiss
				</button>
			</div>
		</div>
	)
}

function selectWithEvent<TMetadata>(
	browser: BrowserLike<TMetadata>,
	path: string,
	event: MouseEvent | KeyboardEvent,
	options: {
		cancelPendingSelectedItemUnselect: () => void
		scheduleSelectedItemUnselect: (path: string) => void
	}
) {
	if ('shiftKey' in event && event.shiftKey) {
		options.cancelPendingSelectedItemUnselect()
		browser.selectRange(path)
	} else if ('metaKey' in event && (event.metaKey || event.ctrlKey)) {
		options.cancelPendingSelectedItemUnselect()
		browser.toggleSelection(path)
	} else if (browser.selectedPaths.length === 1 && browser.selectedPaths[0] === path) {
		options.scheduleSelectedItemUnselect(path)
	} else {
		options.cancelPendingSelectedItemUnselect()
		browser.selectOnly(path)
	}
}

function hasSelectionModifier(event: MouseEvent | KeyboardEvent): boolean {
	return Boolean('shiftKey' in event && (event.shiftKey || event.metaKey || event.ctrlKey))
}

function isKeyboardNavigationKey(key: string) {
	return ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'].includes(key)
}

function getNextKeyboardIndex(key: string, currentIndex: number, length: number) {
	if (key === 'Home') {
		return 0
	}
	if (key === 'End') {
		return length - 1
	}
	if (key === 'ArrowUp' || key === 'ArrowLeft') {
		return Math.max(0, currentIndex - 1)
	}
	return Math.min(length - 1, currentIndex + 1)
}

function escapeAttributeSelector(value: string) {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
		return CSS.escape(value)
	}

	return value.replace(/["\\]/g, '\\$&')
}

function getDraggedPaths(dataTransfer: DataTransfer) {
	if (typeof dataTransfer.getData !== 'function') {
		return []
	}

	const raw = dataTransfer.getData(FILE_BROWSER_DRAG_MIME)
	if (!raw) {
		return []
	}

	try {
		const parsed = JSON.parse(raw) as unknown
		if (!Array.isArray(parsed)) {
			return []
		}
		return parsed.filter((path): path is string => typeof path === 'string').map(normalizeFileBrowserPath)
	} catch {
		return []
	}
}

function getErrorState(error: Error | null) {
	if (isAccessDeniedError(error)) {
		return {
			title: 'Access denied',
			value: error?.message ?? 'You do not have access to this folder.'
		}
	}

	return {
		title: 'Could not load this folder',
		value: error?.message ?? 'Unknown error'
	}
}

function isAccessDeniedError(error: Error | null) {
	if (!error) {
		return false
	}

	const metadata = error as Error & {
		code?: unknown
		status?: unknown
		statusCode?: unknown
	}
	return (
		metadata.status === 403 ||
		metadata.statusCode === 403 ||
		metadata.code === 'access_denied' ||
		metadata.code === 'forbidden' ||
		metadata.code === 'permission_denied'
	)
}

function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function isEditableEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false
	}

	return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

function formatBytes(bytes: number) {
	if (bytes < 1024) {
		return `${bytes} B`
	}
	const kib = bytes / 1024
	if (kib < 1024) {
		return `${kib.toFixed(1)} KB`
	}
	return `${(kib / 1024).toFixed(1)} MB`
}

function formatItemCount(count: number) {
	return `${count} ${count === 1 ? 'item' : 'items'}`
}

function normalizeUploadConflictResolutions(resolutions: readonly FileBrowserUploadConflictResolution[]) {
	return Array.from(
		new Set(
			resolutions.filter((resolution) =>
				DEFAULT_UPLOAD_CONFLICT_RESOLUTIONS.includes(resolution as (typeof DEFAULT_UPLOAD_CONFLICT_RESOLUTIONS)[number])
			)
		)
	)
}

function formatUploadConflictResolution(resolution: FileBrowserUploadConflictResolution) {
	if (resolution === 'keep-both') {
		return 'Keep both'
	}
	return resolution === 'replace' ? 'Replace' : 'Skip'
}

function canDownloadItems<TMetadata>(items: FileNode<TMetadata>[], supportsBulkDownload: boolean) {
	return items.length === 1 && items[0].kind === 'file' ? true : items.length > 0 && supportsBulkDownload
}

function formatScreenReaderStatus({
	currentPath,
	itemCount,
	rootLabel,
	selectedCount,
	status
}: {
	currentPath: string
	itemCount: number
	rootLabel: string
	selectedCount: number
	status: string
}) {
	const folderName = currentPath === '/' ? rootLabel : (currentPath.split('/').filter(Boolean).at(-1) ?? rootLabel)
	return `${folderName} ${status}. ${itemCount} ${itemCount === 1 ? 'item' : 'items'}. ${selectedCount} selected.`
}

function toolButton(active: boolean) {
	return `inline-flex h-[var(--fb-control-h)] min-w-[var(--fb-control-h)] items-center justify-center gap-1 rounded-[calc(var(--fb-radius)-3px)] border px-2 text-[12px] font-medium outline-none disabled:opacity-45 focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
		active
			? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] text-[var(--fb-accent)]'
			: 'border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-muted)] hover:bg-[var(--fb-bg)]'
	}`
}

function commandButton(active: boolean) {
	return `inline-flex h-[var(--fb-control-h)] items-center gap-1.5 rounded-[calc(var(--fb-radius)-3px)] border px-2.5 text-[12px] font-medium outline-none disabled:cursor-not-allowed disabled:opacity-45 focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
		active
			? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] text-[var(--fb-accent)]'
			: 'border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-bg)]'
	}`
}

function primaryButton() {
	return `inline-flex h-[var(--fb-control-h)] items-center gap-1.5 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-accent)] bg-[var(--fb-accent)] px-2.5 text-[12px] font-semibold text-[var(--fb-surface)] outline-none hover:opacity-90 focus:ring-2 focus:ring-[var(--fb-accent-soft)] ${TOUCH_CONTROL} ${CONTROL_MOTION}`
}

function dangerButton() {
	return `inline-flex h-[var(--fb-control-h)] items-center gap-1.5 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-danger)] bg-[var(--fb-danger-soft)] px-2.5 text-[12px] font-medium text-[var(--fb-danger)] outline-none hover:bg-[var(--fb-danger-soft)] focus:ring-2 focus:ring-[var(--fb-danger-soft)] ${TOUCH_CONTROL} ${CONTROL_MOTION}`
}

function selectInput() {
	return `h-[var(--fb-control-h)] min-w-0 max-w-full rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-2 text-[12px] font-medium text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] focus:ring-2 focus:ring-[var(--fb-accent-soft)] [@media(pointer:coarse)]:text-[16px] ${TOUCH_CONTROL} ${CONTROL_MOTION}`
}
