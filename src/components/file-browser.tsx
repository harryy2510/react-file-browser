import {
	Check,
	CheckSquare,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Copy as CopyIcon,
	Download,
	Folder,
	FolderInput,
	LayoutGrid,
	FolderPlus,
	ArrowDown,
	ArrowUp,
	Lock,
	CircleAlert,
	Info,
	List,
	MoreHorizontal,
	Pencil,
	Scissors,
	Search,
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
// Accent-tinted text that stays legible on accent-soft fills in light and dark themes.
const ACCENT_INK = 'text-[color-mix(in_oklch,var(--fb-accent)_80%,var(--fb-text))]'
const DEFAULT_UPLOAD_CONFLICT_RESOLUTIONS = [
	'skip',
	'replace',
	'keep-both'
] as const satisfies readonly FileBrowserUploadConflictResolution[]

// Density drives layout scale through CSS variables set inline on the root, so the effect works for
// every consumer without shipping global CSS. Classes below reference these vars (e.g. h-[var(--fb-control-h)]).
const DENSITY_STYLES: Record<FileBrowserDensity, CSSProperties> = {
	comfortable: {
		'--fb-font': '14px',
		'--fb-font-sm': '12px',
		'--fb-control-h': '40px',
		'--fb-bar-control-h': '30px',
		'--fb-header-h': '64px',
		'--fb-bar-h': '48px',
		'--fb-row-h': '52px',
		'--fb-cell-x': '16px',
		'--fb-cell-y': '10px',
		'--fb-pad': '24px',
		'--fb-card-min': '140px',
		'--fb-card-minh': '150px',
		'--fb-card-pad': '10px',
		'--fb-thumb-h': '92px',
		'--fb-grid-gap': '14px',
		'--fb-panel-w': '280px',
		'--fb-panel-pad': '20px'
	} as CSSProperties,
	compact: {
		'--fb-font': '13px',
		'--fb-font-sm': '11px',
		'--fb-control-h': '32px',
		'--fb-bar-control-h': '26px',
		'--fb-header-h': '52px',
		'--fb-bar-h': '40px',
		'--fb-row-h': '40px',
		'--fb-cell-x': '12px',
		'--fb-cell-y': '6px',
		'--fb-pad': '16px',
		'--fb-card-min': '120px',
		'--fb-card-minh': '120px',
		'--fb-card-pad': '8px',
		'--fb-thumb-h': '64px',
		'--fb-grid-gap': '10px',
		'--fb-panel-w': '240px',
		'--fb-panel-pad': '16px'
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

	const previewPosition = preview ? previewFiles.findIndex((item) => item.path === preview.item.path) + 1 : 0
	const previewNavButton = `grid size-12 shrink-0 place-items-center rounded-full border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-surface-2)] disabled:opacity-40 ${FOCUS_RING} ${CONTROL_MOTION}`

	const secondaryControls = (
		<div className="flex min-w-0 flex-wrap items-center gap-3">
			<SelectField
				aria-label="Filter files"
				onChange={(event) => browser.setFilterKind(event.target.value as 'all' | 'files' | 'folders')}
				value={browser.filterKind}
			>
				<option value="all">All</option>
				<option value="folders">Folders</option>
				<option value="files">Files</option>
			</SelectField>
			<SelectField
				aria-label="Sort files"
				onChange={(event) => browser.setSortBy(event.target.value as 'name' | 'modifiedAt' | 'size')}
				value={browser.sortBy}
			>
				<option value="name">Name</option>
				<option value="modifiedAt">Modified</option>
				<option value="size">Size</option>
			</SelectField>
			<button
				aria-label="Toggle sort direction"
				className={toolButton(false)}
				onClick={() => browser.setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
				type="button"
			>
				{browser.sortDirection === 'asc' ? (
					<ArrowUp aria-hidden="true" className="size-4" />
				) : (
					<ArrowDown aria-hidden="true" className="size-4" />
				)}
			</button>
			<div className="flex shrink-0 overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)]">
				<button
					aria-label="Grid view"
					aria-pressed={browser.view === 'grid'}
					className={segmentButton(browser.view === 'grid')}
					onClick={() => browser.setView('grid')}
					type="button"
				>
					<LayoutGrid aria-hidden="true" className="size-4" strokeWidth={2} />
				</button>
				<button
					aria-label="List view"
					aria-pressed={browser.view === 'list'}
					className={segmentButton(browser.view === 'list')}
					onClick={() => browser.setView('list')}
					type="button"
				>
					<List aria-hidden="true" className="size-4" strokeWidth={2} />
				</button>
			</div>
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
					<FolderPlus aria-hidden="true" className="size-4" />
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
			className={`@container/fb relative flex min-h-[min(520px,100svh)] w-full min-w-0 max-w-full overflow-hidden rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] font-[inherit] text-[length:var(--fb-font)] text-[var(--fb-text)] ${SURFACE_MOTION}${className ? ` ${className}` : ''}`}
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
			<div className="@container/fb-main flex min-w-0 flex-1 flex-col">
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
					className={`flex min-h-[var(--fb-header-h)] min-w-0 flex-wrap items-center gap-3 border-b @min-[72rem]/fb-main:flex-nowrap border-[var(--fb-border)] px-[var(--fb-pad)] py-3 ${isNarrow ? 'px-4' : ''} ${SURFACE_MOTION}`}
				>
					{mobileSelection ? (
						<div className="flex w-full min-w-0 items-center gap-[calc(var(--fb-gap)*2)]">
							<button
								aria-label="Exit selection"
								className={`${toolButton(false)} border-transparent bg-transparent`}
								onClick={exitMobileSelection}
								type="button"
							>
								<XIcon aria-hidden="true" className="size-4" />
							</button>
							<span className="mr-auto whitespace-nowrap text-[17px] font-bold">
								{browser.selectedPaths.length} selected
							</span>
							<button
								className={`${barButton('ghost')} font-semibold ${ACCENT_INK}`}
								onClick={browser.selectAllLoaded}
								type="button"
							>
								Select all
							</button>
						</div>
					) : (
						<>
							<div
								className={
									isNarrow
										? 'min-w-0 flex-1'
										: 'w-full min-w-0 overflow-hidden @min-[72rem]/fb-main:w-auto @min-[72rem]/fb-main:flex-1'
								}
							>
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
							className={`rounded-full bg-[var(--fb-accent-soft)] px-3 py-1 text-[var(--fb-font-sm)] font-semibold ${ACCENT_INK} ${CONTROL_MOTION}`}
							role="status"
						>
							{clipboardNotice}
						</span>
					) : null}
					{!mobileSelection ? (
						<div
							className={`flex min-w-0 flex-wrap items-center gap-3 ${isNarrow ? 'w-full' : 'w-full @min-[72rem]/fb-main:w-auto @min-[72rem]/fb-main:shrink-0 @min-[72rem]/fb-main:flex-nowrap'}`}
						>
							<label
								className={`relative block min-w-0 ${isNarrow ? 'w-full' : 'min-w-[180px] flex-1 @min-[72rem]/fb-main:w-[240px] @min-[72rem]/fb-main:flex-none'}`}
							>
								<Search
									aria-hidden="true"
									className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fb-muted)]"
									strokeWidth={2}
								/>
								<input
									aria-label="Search files"
									className={`h-[var(--fb-control-h)] min-h-[var(--fb-control-h)] w-full min-w-0 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] pl-9 pr-3 text-[16px] text-[var(--fb-text)] outline-none placeholder:text-[var(--fb-muted)] focus:border-[var(--fb-accent)] focus:ring-[3px] focus:ring-[color-mix(in_oklch,var(--fb-accent)_15%,transparent)] @min-[40rem]/fb:text-[var(--fb-font)] [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:text-[16px] ${CONTROL_MOTION}`}
									onChange={(event) => browser.setSearchQuery(event.target.value)}
									placeholder="Search this folder"
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
					<div className="flex justify-end px-[var(--fb-pad)] pt-3">
						<button className={barButton()} onClick={() => setDetailsOpen(true)} type="button">
							<Info aria-hidden="true" className="size-4" />
							Details
						</button>
					</div>
				) : null}

				{uploadRejections.length > 0 ? (
					<UploadRejectionAlert onDismiss={() => setUploadRejections([])} rejections={uploadRejections} />
				) : null}

				<div
					className={`relative min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--fb-bg)] px-[var(--fb-pad)] pb-[var(--fb-pad)] pt-1 ${isNarrow ? 'px-3 pt-3' : ''} ${isNarrow && !readOnly && !mobileSelection ? 'pb-[calc(var(--fb-gap)*20)]' : ''} ${SURFACE_MOTION}`}
					onClick={clearSelectionFromEmptySurface}
					onContextMenu={openEmptyContextMenu}
				>
					{browser.status === 'loading' && browser.items.length === 0 ? (
						<SkeletonGrid rootLabel={rootLabel} />
					) : browser.status === 'error' ? (
						<StateMessage
							icon={isAccessDeniedError(browser.error) ? 'lock' : 'error'}
							title={getErrorState(browser.error).title}
							value={getErrorState(browser.error).value}
						/>
					) : browser.filteredItems.length === 0 ? (
						<StateMessage
							icon="folder"
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
							className={`pointer-events-none absolute inset-4 z-10 flex flex-col items-center justify-center gap-3.5 rounded-[calc(var(--fb-radius)+6px)] border-2 border-dashed border-[var(--fb-accent)] bg-[color-mix(in_oklch,var(--fb-accent-soft)_92%,var(--fb-surface))] text-center backdrop-blur-[1px] ${SURFACE_MOTION}`}
						>
							<span className="grid size-[72px] place-items-center rounded-full bg-[var(--fb-accent)] text-[var(--fb-surface)]">
								<Upload aria-hidden="true" className="size-8" strokeWidth={2} />
							</span>
							<span className={`text-[20px] font-bold ${ACCENT_INK}`}>Drop files to upload</span>
							<span className="text-[var(--fb-font)] text-[var(--fb-muted)]">Folders keep their structure</span>
						</div>
					) : null}
				</div>

				<footer
					className={`sticky bottom-0 flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-[var(--fb-gap)] border-t border-[var(--fb-border)] bg-[var(--fb-bg)] px-[var(--fb-pad)] py-1 text-[var(--fb-font-sm)] text-[var(--fb-muted)] ${isNarrow ? 'bg-[var(--fb-surface)] px-3' : ''} ${SURFACE_MOTION}`}
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
							className={`${primaryButton()} absolute bottom-[calc(var(--fb-gap)*14)] right-4 rounded-full px-5 shadow-[0_10px_24px_color-mix(in_oklch,var(--fb-accent)_35%,transparent)]`}
							onClick={() => uploadInputRef.current?.click()}
							type="button"
						>
							<Upload aria-hidden="true" className="size-5" />
							Upload
						</button>
					) : null}
					{browser.hasMore ? (
						<button
							className={`inline-flex min-h-[var(--fb-bar-control-h)] items-center rounded-[calc(var(--fb-radius)-2px)] px-3 font-semibold ${ACCENT_INK} hover:bg-[var(--fb-accent-soft)] ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION}`}
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
						className={`${DIALOG_SURFACE} max-w-[420px]`}
						onSubmit={(event) => {
							event.preventDefault()
							void createFolder()
						}}
					>
						<h2 className={DIALOG_TITLE}>New folder</h2>
						<label className="mt-4 flex flex-col gap-1.5 text-[calc(var(--fb-font)-1px)] font-semibold">
							Folder name
							<input
								aria-invalid={newFolderError ? true : undefined}
								aria-label="Folder name"
								className={textInput(Boolean(newFolderError))}
								onChange={(event) => {
									setNewFolderName(event.target.value)
									setNewFolderError(null)
								}}
								value={newFolderName}
							/>
						</label>
						{newFolderError ? (
							<div className="mt-2 text-[calc(var(--fb-font)-1px)] text-[var(--fb-danger)]" role="alert">
								{newFolderError}
							</div>
						) : null}
						<div className={DIALOG_ACTIONS}>
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
						className={`${DIALOG_SURFACE} max-w-[420px]`}
						onSubmit={(event) => {
							event.preventDefault()
							void renameSelectedItem()
						}}
					>
						<h2 className={DIALOG_TITLE}>Rename</h2>
						<label className="mt-4 flex flex-col gap-1.5 text-[calc(var(--fb-font)-1px)] font-semibold">
							New name
							<input
								aria-invalid={renameError ? true : undefined}
								aria-label="New name"
								className={textInput(Boolean(renameError))}
								onChange={(event) => {
									setRenameValue(event.target.value)
									setRenameError(null)
								}}
								value={renameValue}
							/>
						</label>
						{renameError ? (
							<div className="mt-2 text-[calc(var(--fb-font)-1px)] text-[var(--fb-danger)]" role="alert">
								{renameError}
							</div>
						) : null}
						<div className={DIALOG_ACTIONS}>
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
						className={`${DIALOG_SURFACE} max-w-[420px]`}
						onSubmit={(event) => {
							event.preventDefault()
							void deleteSelectedItems()
						}}
					>
						<span className="grid size-11 place-items-center rounded-full bg-[var(--fb-danger-soft)] text-[var(--fb-danger)]">
							<Trash2 aria-hidden="true" className="size-5" />
						</span>
						<h2 className={`${DIALOG_TITLE} mt-3.5`}>Delete selected items</h2>
						<p className={DIALOG_BODY}>This removes the selected entries from storage.</p>
						<ul
							className={`m-0 mt-3 max-h-32 list-none overflow-auto rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-bg)] px-3 py-1.5 text-[calc(var(--fb-font)-1px)] ${SURFACE_MOTION}`}
						>
							{browser.selectedItems.map((item) => (
								<li className="flex min-w-0 items-center gap-2 py-1" key={item.path}>
									<FileTypeTile item={item} size="sm" />
									<span className="truncate">{item.name}</span>
								</li>
							))}
						</ul>
						<div className={DIALOG_ACTIONS}>
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
						className={`${DIALOG_SURFACE} max-w-[480px]`}
						onSubmit={(event) => {
							event.preventDefault()
							void moveSelectedItems()
						}}
					>
						<h2 className={DIALOG_TITLE}>Move selected items</h2>
						<p className={`${DIALOG_BODY} mt-1`}>Choose a destination folder from the folder tree.</p>
						<MoveDestinationPicker
							currentPath={browser.currentPath}
							destinations={moveDestinations}
							error={moveDestinationError}
							onSelect={setMoveDestination}
							rootLabel={rootLabel}
							selectedPath={moveDestination}
							status={moveDestinationStatus}
						/>
						<div className="mt-3 truncate text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
							Destination: {moveDestination}
						</div>
						<div className={DIALOG_ACTIONS}>
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
						className={`flex w-[min(1120px,100%)] min-w-0 flex-col overflow-hidden rounded-[calc(var(--fb-radius)+6px)] bg-[var(--fb-surface)] shadow-[0_24px_60px_color-mix(in_oklch,var(--fb-text)_30%,transparent)] ${SURFACE_MOTION}`}
					>
						<div
							className={`flex min-h-[60px] min-w-0 items-center gap-3 border-b border-[var(--fb-border)] py-2.5 pl-6 pr-4 ${isNarrow ? 'pl-4' : ''} ${SURFACE_MOTION}`}
						>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-[15px] font-bold">{preview.item.name}</span>
								<span className="truncate text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
									{previewPosition > 0 ? `${previewPosition} of ${previewFiles.length} · ` : ''}
									{formatBytes(preview.item.size ?? 0)}
									{preview.item.mimeType ? ` · ${preview.item.mimeType}` : ''}
								</span>
							</div>
							<PreviewOriginalLink preview={preview} />
							<button
								aria-label="Close"
								className={`${toolButton(false)} border-transparent bg-transparent text-[var(--fb-text)]`}
								onClick={() => setPreview(null)}
								type="button"
							>
								<XIcon aria-hidden="true" className="size-[18px]" />
							</button>
						</div>
						<div
							className={`flex min-h-[min(420px,55dvh)] min-w-0 items-center justify-center gap-6 bg-[var(--fb-bg)] p-6 ${isNarrow ? 'gap-2 p-3' : ''} ${SURFACE_MOTION}`}
						>
							<button
								aria-label="Previous file"
								className={`${previewNavButton} ${isNarrow ? 'size-10' : ''}`}
								disabled={previewFiles.length <= 1}
								onClick={() => showAdjacentPreview(-1)}
								type="button"
							>
								<ChevronLeft aria-hidden="true" className="size-5" />
							</button>
							<div className="flex min-w-0 flex-1 justify-center">
								{(preview.item.mimeType?.startsWith('image/') && preview.url) || preview.item.thumbnailUrl ? (
									<img
										alt={preview.item.name}
										className={`max-h-[min(560px,60dvh)] max-w-full rounded-[var(--fb-radius)] object-contain ${SURFACE_MOTION}`}
										src={preview.url ?? preview.item.thumbnailUrl}
									/>
								) : (
									<div className="flex min-w-0 max-w-full flex-col items-center gap-3 text-center">
										<span className="block w-[72px]">
											<FileTypeTile item={preview.item} size="md" />
										</span>
										<div className="text-[15px] font-bold">{preview.item.name}</div>
										<div className="text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]">
											{preview.item.mimeType ?? 'File'}
										</div>
										{preview.status === 'loading' ? (
											<div className="text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]">Loading preview</div>
										) : null}
										{preview.status === 'error' ? (
											<div className="text-[calc(var(--fb-font)-1px)] text-[var(--fb-danger)]">
												{preview.error ?? 'Could not load preview'}
											</div>
										) : null}
									</div>
								)}
							</div>
							<button
								aria-label="Next file"
								className={`${previewNavButton} ${isNarrow ? 'size-10' : ''}`}
								disabled={previewFiles.length <= 1}
								onClick={() => showAdjacentPreview(1)}
								type="button"
							>
								<ChevronRight aria-hidden="true" className="size-5" />
							</button>
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
					className="rounded-[4px] [background:color-mix(in_oklch,var(--fb-accent)_10%,transparent)!important] [border:1.5px_solid_var(--fb-accent)!important]"
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
				className="relative grid min-h-full min-w-0 touch-pan-y content-start grid-cols-[repeat(2,minmax(0,1fr))] gap-[calc(var(--fb-grid-gap)-4px)] @min-[40rem]/fb:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--fb-card-min)),1fr))] @min-[40rem]/fb:gap-[var(--fb-grid-gap)]"
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
			className={`group relative flex min-h-[var(--fb-card-minh)] min-w-0 cursor-default flex-col gap-1.5 rounded-[calc(var(--fb-radius)+2px)] border-[1.5px] p-[var(--fb-card-pad)] outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fb-bg)] ${SURFACE_MOTION} ${
				dropTarget
					? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] ring-2 ring-[var(--fb-accent)] ring-offset-2 ring-offset-[var(--fb-bg)]'
					: selected
						? 'border-[var(--fb-accent)] bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))]'
						: 'border-[var(--fb-border)] bg-[var(--fb-surface)] hover:border-[var(--fb-border-strong)] hover:shadow-[0_6px_18px_color-mix(in_oklch,var(--fb-text)_7%,transparent)]'
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
					className="absolute left-0 top-0 z-10 grid size-[calc(var(--fb-gap)*11)] place-items-center"
					data-fb-touch-control
					onClick={(event) => {
						event.stopPropagation()
						onToggle()
					}}
					type="button"
				>
					<SelectionMark selected={selected} visibleOnHover={false} />
				</button>
			) : (
				<span className="absolute left-[calc(var(--fb-card-pad)+8px)] top-[calc(var(--fb-card-pad)+8px)] z-[1]">
					<SelectionMark selected={selected} />
				</span>
			)}
			<FileTypeTile item={item} size="md" />
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
					className={`mt-0.5 min-w-0 truncate rounded-[4px] text-left text-[var(--fb-font)] font-semibold text-[var(--fb-text)] outline-none [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${narrow ? 'min-h-[calc(var(--fb-gap)*11)]' : ''} ${CONTROL_MOTION}`}
					onClick={(event) => {
						event.stopPropagation()
						onSelect(event)
					}}
					type="button"
				>
					{item.name}
				</button>
			)}
			<div className="flex min-w-0 gap-1 truncate text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
				<span>{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}</span>
				{formatShortDate(item.modifiedAt) ? <span>· {formatShortDate(item.modifiedAt)}</span> : null}
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
			className="min-w-0 max-w-full text-[var(--fb-font-sm)] [overflow-wrap:anywhere] [&_*]:max-w-full"
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
				className={`h-8 w-full min-w-0 rounded-[calc(var(--fb-radius)-4px)] border-[1.5px] border-[var(--fb-accent)] bg-[var(--fb-surface)] px-2 text-[calc(var(--fb-font)-1px)] text-[var(--fb-text)] outline-none ring-[3px] ring-[color-mix(in_oklch,var(--fb-accent)_15%,transparent)] [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:text-[16px] ${CONTROL_MOTION}`}
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
				<div className={`mt-1 text-[var(--fb-font-sm)] text-[var(--fb-danger)] ${SURFACE_MOTION}`} role="alert">
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
	const headCell = `h-10 border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] text-[var(--fb-font-sm)] font-semibold text-[var(--fb-muted)]`
	const bodyCell =
		'h-[var(--fb-row-h)] border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[calc(var(--fb-cell-y)/2)]'
	return (
		<table
			aria-label={rootLabel}
			className={`w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-left ${SURFACE_MOTION}`}
		>
			<thead>
				<tr>
					<th className={headCell}>Name</th>
					{!narrow ? <th className={`${headCell} w-[140px] text-right`}>Size</th> : null}
					{!narrow ? <th className={`${headCell} w-[160px] text-right`}>Modified</th> : null}
				</tr>
			</thead>
			<tbody>
				{browser.listRows.map((row) => {
					if (row.type === 'status') {
						return <FolderStatusRow browser={browser} key={`${row.parentPath}::status`} narrow={narrow} row={row} />
					}
					const { item, depth, expanded } = row
					const isSelected = selectedPaths.includes(item.path)
					const isDropTarget = folderDropTargetPath === item.path
					return (
						<TouchRow
							aria-selected={isSelected}
							data-fb-drop-target={isDropTarget ? 'true' : undefined}
							data-fb-path={item.path}
							className={`group outline-none focus-visible:bg-[var(--fb-surface-2)] ${CONTROL_MOTION} ${
								isDropTarget
									? 'bg-[var(--fb-accent-soft)] ring-2 ring-inset ring-[var(--fb-accent)]'
									: isSelected
										? 'bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))] shadow-[inset_3px_0_0_var(--fb-accent)]'
										: 'hover:bg-[color-mix(in_oklch,var(--fb-surface-2)_60%,var(--fb-surface))]'
							}`}
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
							<td className={bodyCell} style={depth > 0 ? { paddingInlineStart: treeIndent(depth) } : undefined}>
								<div className="flex min-w-0 items-center gap-2.5">
									{selectionMode ? (
										<button
											aria-label={`Select ${item.name}`}
											aria-pressed={isSelected}
											className="-ml-3 grid size-[calc(var(--fb-gap)*11)] shrink-0 place-items-center"
											data-fb-touch-control
											onClick={(event) => {
												event.stopPropagation()
												onToggleItem(item.path)
											}}
											type="button"
										>
											<SelectionMark selected={isSelected} visibleOnHover={false} />
										</button>
									) : !narrow ? (
										<SelectionMark selected={isSelected} />
									) : null}
									{item.kind === 'folder' ? (
										<button
											aria-expanded={expanded}
											aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}
											className={`grid shrink-0 place-items-center rounded-[calc(var(--fb-radius)-4px)] text-[var(--fb-muted)] hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)] ${FOCUS_RING} ${disclosureSize} ${CONTROL_MOTION}`}
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
												strokeWidth={2.5}
											/>
										</button>
									) : (
										<span aria-hidden="true" className={`shrink-0 ${disclosureSize}`} />
									)}
									<FileTypeTile item={item} size="sm" />
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
												className={`block max-w-full truncate rounded-[4px] text-left text-[var(--fb-font)] font-medium outline-none [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${narrow ? 'min-h-[calc(var(--fb-gap)*6)]' : ''} ${CONTROL_MOTION}`}
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
											<div className="flex flex-wrap gap-x-3 text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
												<span>{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}</span>
												{item.modifiedAt ? <span>{new Date(item.modifiedAt).toLocaleDateString()}</span> : null}
											</div>
										) : null}
									</div>
								</div>
							</td>
							{!narrow ? (
								<td className={`${bodyCell} text-right text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]`}>
									{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}
								</td>
							) : null}
							{!narrow ? (
								<td className={`${bodyCell} text-right text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]`}>
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
	return `calc(var(--fb-cell-x) + 18px * ${depth})`
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
	const linkButton = `rounded-[4px] font-semibold ${ACCENT_INK} hover:underline ${FOCUS_RING} ${CONTROL_MOTION}`
	return (
		<tr data-fb-status-for={row.parentPath}>
			<td
				className="h-11 border-b border-[var(--fb-border)] bg-[color-mix(in_oklch,var(--fb-surface-2)_40%,var(--fb-surface))] px-[var(--fb-cell-x)] text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]"
				colSpan={narrow ? 1 : 3}
				style={{ paddingInlineStart: treeIndent(row.depth) }}
			>
				<div className="flex min-w-0 items-center gap-2">
					{/* Same width as the item-row chevron so the status lines up with the child icons. */}
					<span aria-hidden="true" className={`shrink-0 ${getDisclosureSize(narrow)}`} />
					{row.status === 'loading' ? (
						<span className="inline-flex items-center gap-2" role="status">
							<span
								aria-hidden="true"
								className="size-3.5 animate-spin rounded-full border-2 border-[var(--fb-accent-soft)] border-t-[var(--fb-accent)] motion-reduce:animate-none"
							/>
							Loading…
						</span>
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
			className={`flex flex-col bg-[var(--fb-surface)] text-[var(--fb-font)] text-[var(--fb-text)] ${SURFACE_MOTION} ${
				isSheet
					? 'w-full'
					: 'fixed z-[60] max-h-[calc(100dvh-var(--fb-gap)*4)] min-w-[200px] max-w-[calc(100%-var(--fb-gap)*4)] overflow-y-auto rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] p-1.5 shadow-[0_12px_32px_color-mix(in_oklch,var(--fb-text)_12%,transparent)]'
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
					{!readOnly ? <div aria-hidden="true" className="mx-1.5 my-1 h-px bg-[var(--fb-border)]" /> : null}
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
			className={`flex min-h-9 w-full items-center rounded-[calc(var(--fb-radius)-2px)] px-2.5 text-left outline-none ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
				danger
					? 'text-[var(--fb-danger)] hover:bg-[var(--fb-danger-soft)] focus:bg-[var(--fb-danger-soft)]'
					: 'hover:bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))] focus:bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))]'
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
			<div className={`${DIALOG_SURFACE} max-w-[480px]`}>
				<div className="flex items-baseline justify-between gap-3">
					<h2 className={DIALOG_TITLE}>File conflict</h2>
					<span className="shrink-0 text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]">
						Conflict {conflictIndex} of {queue.conflictPaths.length}
					</span>
				</div>
				<p className={DIALOG_BODY}>{candidate.relativePath} already exists in this folder.</p>
				<div className="mt-4 flex min-w-0 flex-col gap-1 rounded-[var(--fb-radius)] border-[1.5px] border-[var(--fb-accent)] bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))] p-3">
					<span className={`text-[var(--fb-font-sm)] ${ACCENT_INK}`}>Uploading</span>
					<span className="truncate text-[var(--fb-font)] font-semibold">{candidate.file.name}</span>
					<span className="text-[var(--fb-font-sm)] text-[var(--fb-muted)]">{formatBytes(candidate.file.size)}</span>
				</div>
				<label className="mt-4 flex min-h-[calc(var(--fb-gap)*11)] items-center gap-2.5 text-[var(--fb-font)] @min-[40rem]/fb:min-h-0">
					<input
						checked={applyToAll}
						className="size-[18px] accent-[var(--fb-accent)]"
						onChange={(event) => onApplyToAllChange(event.target.checked)}
						type="checkbox"
					/>
					Apply to all conflicts
				</label>
				<div
					className={`mt-6 flex flex-wrap justify-end gap-2 ${narrow ? 'flex-col [&>button]:w-full [&>button]:justify-center' : ''}`}
				>
					<button
						className={`${commandButton(false)} border-transparent bg-transparent text-[var(--fb-muted)]`}
						onClick={onCancel}
						type="button"
					>
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
			<div className={`${DIALOG_SURFACE} max-w-[440px]`}>
				<div className="flex items-center gap-2.5">
					<span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-[var(--fb-warn)]" />
					<h2 className={DIALOG_TITLE}>Partial bulk failure</h2>
				</div>
				<p className={DIALOG_BODY}>
					{completedCount} of {error.totalCount} completed
				</p>
				<ul
					className={`m-0 mt-3 max-h-40 list-none overflow-auto rounded-[var(--fb-radius)] bg-[var(--fb-warn-soft)] px-3 py-2 text-[calc(var(--fb-font)-1px)] ${SURFACE_MOTION}`}
				>
					{error.failures.map((failure) => (
						<li className="flex min-w-0 flex-wrap justify-between gap-x-3 py-1" key={failure.path}>
							<span className="min-w-0 truncate font-semibold">
								{failure.path.split('/').filter(Boolean).at(-1) ?? failure.path}
							</span>
							<span className="text-[color-mix(in_oklch,var(--fb-warn)_75%,var(--fb-text))]">{failure.message}</span>
						</li>
					))}
				</ul>
				<div className="mt-6 flex justify-end">
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
			className={`mt-4 flex max-h-72 flex-col gap-px overflow-auto rounded-[var(--fb-radius)] border border-[var(--fb-border)] p-1.5 ${SURFACE_MOTION}`}
		>
			<MoveDestinationButton
				active={selectedPath === currentPath}
				label="Current folder"
				onClick={() => onSelect(currentPath)}
				path={currentPath}
			/>
			<MoveDestinationButton active={selectedPath === '/'} label={rootLabel} onClick={() => onSelect('/')} path="/" />
			{status === 'loading' ? (
				<div className="px-2.5 py-3 text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]">Loading folders</div>
			) : null}
			{status === 'error' ? (
				<div className="px-2.5 py-3 text-[calc(var(--fb-font)-1px)] text-[var(--fb-danger)]">
					{error ?? 'Could not load folders'}
				</div>
			) : null}
			{status === 'ready' && destinations.length === 0 ? (
				<div className="px-2.5 py-3 text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)]">No folders available.</div>
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
			className={`flex min-h-[34px] w-full min-w-0 items-center gap-2 rounded-[calc(var(--fb-radius)-2px)] pr-2 text-left text-[var(--fb-font)] ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
				active ? `bg-[var(--fb-accent-soft)] font-semibold ${ACCENT_INK}` : 'hover:bg-[var(--fb-surface-2)]'
			}`}
			onClick={onClick}
			style={{ paddingLeft: `min(40%, calc(8px + 18px * ${depth}))` }}
			type="button"
		>
			<Folder
				aria-hidden="true"
				className={`size-4 shrink-0 fill-current ${active ? 'text-[var(--fb-accent)]' : 'text-[var(--fb-folder)]'}`}
				strokeWidth={0}
			/>
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
			className={`flex min-h-[var(--fb-bar-h)] min-w-0 flex-wrap items-center gap-2 px-[var(--fb-pad)] py-2 text-[calc(var(--fb-font)-1px)] ${SURFACE_MOTION}`}
			role="toolbar"
		>
			<span className={`mr-1 whitespace-nowrap font-semibold ${hasSelection ? ACCENT_INK : 'text-[var(--fb-muted)]'}`}>
				{selectedCount} selected
			</span>
			{hasSelection && canDownload ? (
				<button className={barButton()} onClick={onDownload} type="button">
					<Download aria-hidden="true" className="size-3.5" />
					Download
				</button>
			) : null}
			{hasSelection && canRename && selectedCount === 1 ? (
				<button className={barButton()} onClick={() => onRename()} type="button">
					<Pencil aria-hidden="true" className="size-3.5" />
					Rename
				</button>
			) : null}
			{hasSelection && canMove ? (
				<button className={barButton()} onClick={onMove} type="button">
					<FolderInput aria-hidden="true" className="size-3.5" />
					Move
				</button>
			) : null}
			{hasSelection && canCopy ? (
				<button className={barButton()} onClick={onCopy} type="button">
					<CopyIcon aria-hidden="true" className="size-3.5" />
					Copy
				</button>
			) : null}
			{hasSelection && canCut ? (
				<button className={barButton()} onClick={onCut} type="button">
					<Scissors aria-hidden="true" className="size-3.5" />
					Cut
				</button>
			) : null}
			{hasSelection && canDelete ? (
				<button className={barButton('danger')} onClick={onDelete} type="button">
					<Trash2 aria-hidden="true" className="size-3.5" />
					Delete
				</button>
			) : null}
			<span className="ml-auto flex items-center gap-1">
				<button className={barButton('ghost')} disabled={itemCount === 0} onClick={onSelectAll} type="button">
					<CheckSquare aria-hidden="true" className="size-3.5" />
					Select all
				</button>
				<button className={barButton('ghost')} disabled={!hasSelection} onClick={onSelectNone} type="button">
					<XIcon aria-hidden="true" className="size-3.5" />
					Select none
				</button>
			</span>
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
		<nav aria-label="Breadcrumb" className="flex min-w-0 max-w-full items-center gap-1.5 text-[var(--fb-font)]">
			{narrow && parts.length > 0 ? (
				<button
					aria-label="Parent folder"
					className={`${toolButton(false)} border-transparent bg-transparent text-[var(--fb-text)]`}
					onClick={() => void onNavigate(getFileBrowserDirname(path))}
					type="button"
				>
					<ChevronLeft aria-hidden="true" className="size-4" />
				</button>
			) : null}
			{visibleCrumbs.map((crumb, index) => (
				<span className="flex min-w-0 items-center gap-1.5 last:flex-1" key={crumb.key}>
					{index > 0 ? (
						<ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[var(--fb-muted)]" strokeWidth={2} />
					) : null}
					{crumb.kind === 'collapsed' ? (
						<button
							aria-label="Collapsed breadcrumb"
							aria-haspopup="dialog"
							className={`inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[calc(var(--fb-radius)-4px)] bg-[var(--fb-surface-2)] px-1.5 text-[calc(var(--fb-font)-1px)] text-[var(--fb-muted)] hover:text-[var(--fb-text)] ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION}`}
							onClick={() => setAncestorsOpen(true)}
							type="button"
						>
							…
						</button>
					) : (
						<button
							aria-current={index === visibleCrumbs.length - 1 ? 'page' : undefined}
							className={`min-w-0 max-w-[180px] truncate rounded-[calc(var(--fb-radius)-4px)] px-0.5 py-1 hover:text-[var(--fb-text)] [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${FOCUS_RING} ${CONTROL_MOTION} ${
								index === visibleCrumbs.length - 1 ? 'font-semibold text-[var(--fb-text)]' : 'text-[var(--fb-muted)]'
							}`}
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
	const panelClass = `flex min-w-0 max-w-full shrink-0 flex-col gap-4 bg-[var(--fb-surface)] [overflow-wrap:anywhere] [&_*]:max-w-full ${SURFACE_MOTION} ${
		sheet ? 'w-full' : 'w-[var(--fb-panel-w)] border-l border-[var(--fb-border)] p-[var(--fb-panel-pad)]'
	}`
	const eyebrow = sheet ? null : (
		<div className="text-[calc(var(--fb-font)-1px)] font-semibold text-[var(--fb-muted)]">Details</div>
	)
	const fieldList = 'm-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[calc(var(--fb-font)-1px)]'
	const panelButton = `${commandButton(false)} w-full`
	if (!item) {
		return (
			<aside aria-label="Details" className={panelClass}>
				{eyebrow}
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
					<div
						className={`grid h-[150px] w-full place-items-center rounded-[var(--fb-radius)] bg-[var(--fb-surface-2)] text-[var(--fb-muted)] ${SURFACE_MOTION}`}
					>
						<Info aria-hidden="true" className="size-10" strokeWidth={1.5} />
					</div>
					<h2 className="m-0 text-[var(--fb-font)] font-semibold">No item selected</h2>
				</div>
			</aside>
		)
	}

	if (selectedCount > 1) {
		return (
			<aside aria-label="Details" className={panelClass}>
				{eyebrow}
				<div
					className={`grid h-[150px] place-items-center rounded-[var(--fb-radius)] bg-[var(--fb-accent-soft)] ${ACCENT_INK} ${SURFACE_MOTION}`}
				>
					<CopyIcon aria-hidden="true" className="size-10" strokeWidth={1.5} />
				</div>
				<h2 className="m-0 text-[16px] font-bold">{formatItemCount(selectedCount)} selected</h2>
				<dl className={fieldList}>
					<dt className="text-[var(--fb-muted)]">Total size</dt>
					<dd className="m-0 font-medium">{formatBytes(totalBytes)}</dd>
				</dl>
				<div className="flex flex-col gap-2">
					{canDownload ? (
						<button
							aria-label={`Download ${formatItemCount(selectedCount)}`}
							className={panelButton}
							onClick={onDownload}
							type="button"
						>
							<Download aria-hidden="true" className="size-4" />
							Download
						</button>
					) : null}
					<button
						aria-label={`Copy ${formatItemCount(selectedCount)} paths`}
						className={panelButton}
						onClick={onCopyPath}
						type="button"
					>
						<CopyIcon aria-hidden="true" className="size-4" />
						Copy paths
					</button>
				</div>
			</aside>
		)
	}

	const defaultContent = (
		<>
			<FileTypeTile item={item} size="lg" />
			<h2 className="m-0 truncate text-[16px] font-bold">{item.name}</h2>
			<dl className={fieldList}>
				{item.kind === 'file' ? (
					<>
						<dt className="text-[var(--fb-muted)]">Size</dt>
						<dd className="m-0 font-medium">{formatBytes(item.size ?? 0)}</dd>
					</>
				) : null}
				{item.modifiedAt ? (
					<>
						<dt className="text-[var(--fb-muted)]">Modified</dt>
						<dd className="m-0 font-medium">{new Date(item.modifiedAt).toLocaleDateString()}</dd>
					</>
				) : null}
				<dt className="text-[var(--fb-muted)]">Type</dt>
				<dd className="m-0 font-medium">{item.kind === 'file' && item.mimeType ? item.mimeType : item.kind}</dd>
				<dt className="text-[var(--fb-muted)]">Path</dt>
				<dd className="m-0 font-medium [overflow-wrap:anywhere]">{item.path}</dd>
			</dl>
			<div className="flex flex-col gap-2">
				{canDownload ? (
					<button aria-label={`Download ${item.name}`} className={panelButton} onClick={onDownload} type="button">
						<Download aria-hidden="true" className="size-4" />
						Download
					</button>
				) : null}
				<button aria-label={`Copy path of ${item.name}`} className={panelButton} onClick={onCopyPath} type="button">
					<CopyIcon aria-hidden="true" className="size-4" />
					Copy path
				</button>
			</div>
		</>
	)

	return (
		<aside aria-label="Details" className={panelClass}>
			{eyebrow}
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
			className={`${primaryButton()} no-underline`}
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
			className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-[calc(var(--fb-grid-gap)-4px)] @min-[40rem]/fb:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--fb-card-min)),1fr))] @min-[40rem]/fb:gap-[var(--fb-grid-gap)]"
			role="grid"
		>
			{Array.from({ length: 10 }, (_, index) => (
				<div
					className={`flex min-h-[var(--fb-card-minh)] animate-pulse flex-col gap-2 rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-[var(--fb-card-pad)] motion-reduce:animate-none ${SURFACE_MOTION}`}
					key={index}
				>
					<div className="h-[var(--fb-thumb-h)] rounded-[calc(var(--fb-radius)-2px)] bg-[var(--fb-surface-2)]" />
					<div className="mt-1 h-2.5 w-4/5 rounded-full bg-[var(--fb-surface-2)]" />
					<div className="h-2 w-1/2 rounded-full bg-[color-mix(in_oklch,var(--fb-surface-2)_60%,var(--fb-surface))]" />
				</div>
			))}
		</div>
	)
}

function StateMessage({
	icon,
	title,
	value
}: {
	icon: 'folder' | 'error' | 'lock'
	title: ReactNode
	value?: ReactNode
}) {
	return (
		<div
			className={`grid min-h-[min(320px,50svh)] min-w-0 place-items-center rounded-[calc(var(--fb-radius)+4px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-6 text-center [overflow-wrap:anywhere] [&_*]:max-w-full ${SURFACE_MOTION}`}
		>
			<div className="flex max-w-[340px] flex-col items-center gap-3">
				<span
					aria-hidden="true"
					className={`grid size-16 place-items-center ${
						icon === 'folder'
							? `rounded-[16px] ${FILE_TONE_CLASSES.folder}`
							: icon === 'lock'
								? 'rounded-full bg-[var(--fb-warn-soft)] text-[color-mix(in_oklch,var(--fb-warn)_80%,var(--fb-text))]'
								: 'rounded-full bg-[var(--fb-danger-soft)] text-[var(--fb-danger)]'
					}`}
				>
					{icon === 'folder' ? (
						<Folder className="size-[30px] fill-current" strokeWidth={0} />
					) : icon === 'lock' ? (
						<Lock className="size-[26px]" strokeWidth={2} />
					) : (
						<CircleAlert className="size-7" strokeWidth={2} />
					)}
				</span>
				<div className="text-[17px] font-bold">{title}</div>
				{value === undefined ? null : (
					<div className="text-[var(--fb-font)] leading-relaxed text-[var(--fb-muted)]">{value}</div>
				)}
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
			className="mx-[var(--fb-pad)] mb-2 min-w-0 rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 text-[calc(var(--fb-font)-1px)] text-[var(--fb-text)] [overflow-wrap:anywhere]"
			role="alert"
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-[var(--fb-font)] font-bold">Upload rejected</div>
					<ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
						{rejections.map((rejection) => (
							<li
								className="flex min-w-0 flex-col gap-0.5 rounded-[calc(var(--fb-radius)-2px)] bg-[var(--fb-danger-soft)] px-2.5 py-2"
								key={rejection.relativePath}
							>
								<span className="font-semibold">{rejection.relativePath}</span>
								<span className="text-[color-mix(in_oklch,var(--fb-danger)_80%,var(--fb-text))]">
									{' '}
									{rejection.reasons.join('; ')}
								</span>
							</li>
						))}
					</ul>
				</div>
				<button aria-label="Dismiss upload rejection" className={barButton()} onClick={onDismiss} type="button">
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

const FOCUS_RING =
	'outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)]'

function toolButton(active: boolean) {
	return `inline-flex h-[var(--fb-control-h)] min-w-[var(--fb-control-h)] items-center justify-center gap-1.5 rounded-[var(--fb-radius)] border px-2.5 text-[var(--fb-font)] font-medium disabled:opacity-45 ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
		active
			? `border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] ${ACCENT_INK}`
			: 'border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-muted)] hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)]'
	}`
}

function segmentButton(active: boolean) {
	return `inline-flex h-[calc(var(--fb-control-h)-2px)] w-11 items-center justify-center ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
		active
			? `bg-[var(--fb-accent-soft)] ${ACCENT_INK}`
			: 'bg-transparent text-[var(--fb-muted)] hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)]'
	}`
}

function commandButton(active: boolean) {
	return `inline-flex h-[var(--fb-control-h)] items-center justify-center gap-2 rounded-[var(--fb-radius)] border px-3.5 text-[var(--fb-font)] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
		active
			? `border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] ${ACCENT_INK}`
			: 'border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-surface-2)]'
	}`
}

function barButton(tone: 'default' | 'danger' | 'ghost' = 'default') {
	return `inline-flex h-[var(--fb-bar-control-h)] items-center gap-1.5 rounded-[calc(var(--fb-radius)-2px)] px-3 text-[calc(var(--fb-font)-1px)] disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
		tone === 'ghost'
			? 'border border-transparent bg-transparent text-[var(--fb-muted)] hover:text-[var(--fb-text)]'
			: tone === 'danger'
				? 'border border-[color-mix(in_oklch,var(--fb-danger)_25%,var(--fb-border))] bg-[var(--fb-surface)] text-[var(--fb-danger)] hover:bg-[var(--fb-danger-soft)]'
				: 'border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-surface-2)]'
	}`
}

function primaryButton() {
	return `inline-flex h-[var(--fb-control-h)] items-center justify-center gap-2 rounded-[var(--fb-radius)] border border-transparent bg-[var(--fb-accent)] px-4 text-[var(--fb-font)] font-semibold text-[var(--fb-surface)] hover:bg-[color-mix(in_oklch,var(--fb-accent)_88%,var(--fb-text))] disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION}`
}

function dangerButton() {
	return `inline-flex h-[var(--fb-control-h)] items-center justify-center gap-2 rounded-[var(--fb-radius)] border border-transparent bg-[var(--fb-danger)] px-4 text-[var(--fb-font)] font-semibold text-[var(--fb-surface)] hover:bg-[color-mix(in_oklch,var(--fb-danger)_88%,var(--fb-text))] ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION}`
}

// Native select arrows sit flush against the edge and differ per browser, so the chevron is drawn by us.
function SelectField(props: React.ComponentProps<'select'>) {
	return (
		<span className="relative inline-flex min-w-0 max-w-full shrink-0">
			<select {...props} className={selectInput()} />
			<ChevronDown
				aria-hidden="true"
				className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fb-muted)]"
				strokeWidth={2}
			/>
		</span>
	)
}

function selectInput() {
	return `h-[var(--fb-control-h)] min-w-0 max-w-full appearance-none rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] pl-3 pr-9 text-[var(--fb-font)] font-medium text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] focus:ring-[3px] focus:ring-[color-mix(in_oklch,var(--fb-accent)_15%,transparent)] [@media(pointer:coarse)]:text-[16px] ${TOUCH_CONTROL} ${CONTROL_MOTION}`
}

function textInput(invalid = false) {
	return `h-[max(var(--fb-control-h),calc(var(--fb-gap)*10))] w-full min-w-0 rounded-[var(--fb-radius)] border bg-[var(--fb-surface)] px-3 text-[16px] text-[var(--fb-text)] outline-none @min-[40rem]/fb:text-[var(--fb-font)] ${CONTROL_MOTION} ${
		invalid
			? 'border-[1.5px] border-[var(--fb-danger)] ring-[3px] ring-[color-mix(in_oklch,var(--fb-danger)_12%,transparent)]'
			: 'border-[var(--fb-border)] focus:border-[1.5px] focus:border-[var(--fb-accent)] focus:ring-[3px] focus:ring-[color-mix(in_oklch,var(--fb-accent)_15%,transparent)]'
	}`
}

const DIALOG_SURFACE = `w-full min-w-0 rounded-[calc(var(--fb-radius)+6px)] bg-[var(--fb-surface)] p-[calc(var(--fb-gap)*6)] shadow-[0_24px_60px_color-mix(in_oklch,var(--fb-text)_28%,transparent)] ${SURFACE_MOTION}`
const DIALOG_TITLE = 'm-0 text-[17px] font-bold leading-snug'
const DIALOG_BODY = 'mt-2 text-[var(--fb-font)] leading-relaxed text-[var(--fb-muted)]'
const DIALOG_ACTIONS = 'mt-6 flex flex-wrap justify-end gap-2'

type FileTone = 'folder' | 'danger' | 'ok' | 'accent' | 'warn' | 'neutral'

const FILE_TONE_CLASSES: Record<FileTone, string> = {
	folder:
		'bg-[color-mix(in_oklch,var(--fb-folder)_22%,var(--fb-surface))] text-[color-mix(in_oklch,var(--fb-folder)_70%,var(--fb-text))]',
	danger: 'bg-[var(--fb-danger-soft)] text-[var(--fb-danger)]',
	ok: 'bg-[var(--fb-ok-soft)] text-[var(--fb-ok)]',
	accent: `bg-[var(--fb-accent-soft)] ${ACCENT_INK}`,
	warn: 'bg-[var(--fb-warn-soft)] text-[color-mix(in_oklch,var(--fb-warn)_80%,var(--fb-text))]',
	neutral: 'bg-[var(--fb-surface-2)] text-[var(--fb-muted)]'
}

const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'])

function getFileExtension(name: string) {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function getFileTone<TMetadata>(item: FileNode<TMetadata>): FileTone {
	if (item.kind === 'folder') return 'folder'
	const mime = item.mimeType ?? ''
	const extension = getFileExtension(item.name)
	if (mime === 'application/pdf' || extension === 'pdf') return 'danger'
	if (mime.startsWith('image/')) return 'ok'
	if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'accent'
	if (ARCHIVE_EXTENSIONS.has(extension) || /zip|compressed|x-tar/.test(mime)) return 'warn'
	return 'neutral'
}

function getFileBadge<TMetadata>(item: FileNode<TMetadata>) {
	return getFileExtension(item.name).slice(0, 4).toUpperCase() || 'FILE'
}

function FileTypeTile<TMetadata>({ item, size }: { item: FileNode<TMetadata>; size: 'sm' | 'md' | 'lg' }) {
	const box =
		size === 'sm'
			? 'size-8 rounded-[calc(var(--fb-radius)-2px)] text-[9px]'
			: size === 'md'
				? 'h-[var(--fb-thumb-h)] w-full rounded-[calc(var(--fb-radius)-2px)] text-[13px]'
				: 'h-[150px] w-full rounded-[var(--fb-radius)] text-[15px]'
	const icon = size === 'sm' ? 'size-4' : 'size-10'
	return (
		<span
			aria-hidden="true"
			className={`grid shrink-0 place-items-center overflow-hidden font-bold tracking-[0.06em] ${box} ${FILE_TONE_CLASSES[getFileTone(item)]} ${CONTROL_MOTION}`}
		>
			{item.kind === 'folder' ? (
				<Folder className={`${icon} fill-current`} strokeWidth={0} />
			) : item.thumbnailUrl && size !== 'sm' ? (
				<img alt="" className="size-full object-cover" draggable={false} loading="lazy" src={item.thumbnailUrl} />
			) : (
				getFileBadge(item)
			)}
		</span>
	)
}

function SelectionMark({ selected, visibleOnHover = true }: { selected: boolean; visibleOnHover?: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[var(--fb-surface)] ${CONTROL_MOTION} ${
				selected
					? 'bg-[var(--fb-accent)]'
					: `border-[1.5px] border-[var(--fb-border-strong)] bg-[var(--fb-surface)] ${visibleOnHover ? 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100' : ''}`
			}`}
		>
			{selected ? <Check className="size-3" strokeWidth={3.5} /> : null}
		</span>
	)
}

function formatShortDate(value: string | undefined) {
	if (!value) return null
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
