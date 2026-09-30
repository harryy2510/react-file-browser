import {
	Check,
	Minus,
	ListFilter,
	ArrowUpDown,
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
	List,
	MoreHorizontal,
	Pencil,
	Scissors,
	Search,
	Trash2,
	Upload,
	X as XIcon
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import Selecto from 'react-selecto'
import type { OnSelect } from 'react-selecto'
import type { FileBrowserDensity } from '../theme'
import { useFileBrowser } from '../core/use-file-browser'
import type {
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
import { FileView } from './file-view'
import {
	DEFAULT_EDITABLE_BYTES,
	defaultFileBrowserEditors,
	defaultFileBrowserPreviewers,
	findPlugin
} from './file-plugins'
import type { FileBrowserEditor, FileBrowserPreviewer } from './file-plugins'
import { formatBytes, getFileCategory, getFileIcon } from './file-types'
import { ActionSheet, ResponsiveDialog, useBrowserLayout, useLongPress } from './responsive'

export type FileBrowserProps<TMetadata = unknown> = {
	adapter: FileBrowserAdapter<TMetadata>
	className?: string
	emptyState?: {
		title: ReactNode
		description?: ReactNode
	}
	/** The view the browser opens in: `list` (default) or `grid`. */
	initialView?: FileBrowserView
	initialPath?: string
	path?: string
	onPathChange?: (path: string, context: FileBrowserPathChangeContext<TMetadata>) => void
	rootLabel?: string
	searchQuery?: string
	initialSearchQuery?: string
	onSearchQueryChange?: (query: string) => void
	density?: FileBrowserDensity
	readOnly?: boolean
	uploadPolicy?: FileBrowserUploadPolicy
	uploadConflictResolutions?: readonly FileBrowserUploadConflictResolution[]
	allowClientZipFallback?: boolean
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
	warnZipSizeBytes?: number
	/**
	 * Marks individual files or folders read-only: no rename, move, cut, delete, or edit, and a
	 * read-only folder accepts no dropped items. Contents of a read-only folder are judged per item.
	 */
	isItemReadOnly?: (item: FileNode<TMetadata>) => boolean
	/** Inline preview renderers, first match wins. Defaults to `defaultFileBrowserPreviewers`; `[]` disables. */
	previewers?: readonly FileBrowserPreviewer<TMetadata>[]
	/** In-place editors, first match wins. Defaults to `defaultFileBrowserEditors`; `[]` disables editing. */
	editors?: readonly FileBrowserEditor<TMetadata>[]
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
	initialView,
	path,
	onPathChange,
	rootLabel = 'Files',
	searchQuery,
	initialSearchQuery,
	onSearchQueryChange,
	density = 'comfortable',
	readOnly = false,
	uploadPolicy,
	uploadConflictResolutions,
	allowClientZipFallback = true,
	renderItemMeta,
	warnZipSizeBytes,
	isItemReadOnly,
	previewers = defaultFileBrowserPreviewers,
	editors = defaultFileBrowserEditors
}: FileBrowserProps<TMetadata>) {
	const browser = useFileBrowser<TMetadata>({
		adapter,
		initialPath,
		path,
		onPathChange,
		searchQuery,
		initialSearchQuery,
		initialView,
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
	const [openFile, setOpenFile] = useState<{ item: FileNode<TMetadata>; mode: 'preview' | 'edit' } | null>(null)
	const fileOpen = openFile !== null
	const rootRef = useRef<HTMLElement | null>(null)
	const { isNarrow, hasSidebar } = useBrowserLayout(rootRef)
	const [mobileSelectionPath, setMobileSelectionPath] = useState<string | null>(null)
	const [toolbarOpen, setToolbarOpen] = useState(false)
	const [selectionActionsOpen, setSelectionActionsOpen] = useState(false)
	const mobileSelection = isNarrow && mobileSelectionPath === browser.currentPath
	useEffect(() => {
		setMobileSelectionPath(null)
		setSelectionActionsOpen(false)
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
		() => browser.filteredItems.filter((item) => item.kind === 'file'),
		[browser.filteredItems]
	)
	const isLocked = useCallback(
		(item: FileNode<TMetadata>) => readOnly || Boolean(isItemReadOnly?.(item)),
		[isItemReadOnly, readOnly]
	)
	const isItemReadOnlyMark = useCallback(
		(item: FileNode<TMetadata>) => !readOnly && Boolean(isItemReadOnly?.(item)),
		[isItemReadOnly, readOnly]
	)
	const selectionWritable = !readOnly && !browser.selectedItems.some(isLocked)
	const getEditor = useCallback(
		(item: FileNode<TMetadata>) => {
			if (item.kind !== 'file' || isLocked(item)) return undefined
			const editor = findPlugin(editors, item)
			return editor && (item.size ?? 0) <= (editor.maxBytes ?? DEFAULT_EDITABLE_BYTES) ? editor : undefined
		},
		[editors, isLocked]
	)
	const openEditor = useCallback(
		(item: FileNode<TMetadata>) => {
			if (getEditor(item)) setOpenFile({ item, mode: 'edit' })
		},
		[getEditor]
	)
	const openPreview = useCallback((item: FileNode<TMetadata>) => {
		setOpenFile({ item, mode: 'preview' })
	}, [])
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
					const item = browser.filteredItems.find((candidate) => candidate.path === path)
					if (item?.kind === 'folder') void browser.open(item)
					else if (item) openPreview(item)
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
				openPreview(item)
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
			const visibleItems = browser.filteredItems
			if (visibleItems.length === 0) {
				return
			}

			const currentPath = browser.focusedPath ?? browser.selectedPaths.at(-1)
			const currentIndex = visibleItems.findIndex((item) => item.path === currentPath)
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
			// An open file owns the keyboard; it handles Escape itself through its unsaved-changes guard.
			if (
				fileOpen ||
				event.defaultPrevented ||
				(event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))
			)
				return
			if (event.key === 'Escape') {
				browser.clearSelection()
				setMobileSelectionPath(null)
				setToolbarOpen(false)
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
			if (
				selectionWritable &&
				event.key === 'F2' &&
				browser.capabilities.rename &&
				browser.selectedItems.length === 1
			) {
				event.preventDefault()
				const item = browser.selectedItems[0]
				setRenameItem(null)
				setRenameError(null)
				setInlineRenameItem(item)
				setInlineRenameValue(item.name)
				setInlineRenameError(null)
				return
			}
			if (
				selectionWritable &&
				(event.key === 'Delete' || event.key === 'Backspace') &&
				browser.selectedPaths.length > 0
			) {
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
				if (key === 'x' && selectionWritable && browser.capabilities.move && browser.selectedPaths.length > 0) {
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
					openPreview(item)
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
		fileOpen,
		readOnly,
		selectionWritable
	])

	useEffect(() => {
		if (
			!browser.focusedPath ||
			isEditableEventTarget(document.activeElement) ||
			rootRef.current?.querySelector('[role="dialog"], [role="menu"]')
		) {
			return
		}

		const item = rootRef.current?.querySelector<HTMLElement>(
			`[data-fb-path="${escapeAttributeSelector(browser.focusedPath)}"]`
		)
		item?.focus()
	}, [browser.focusedPath, browser.filteredItems, browser.view])

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
		const lockedPaths = new Set(browser.items.filter(isLocked).map((node) => node.path))
		if (paths.some((path) => lockedPaths.has(path))) {
			event.preventDefault()
			return
		}
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
		if (isLocked(item) || !browser.capabilities.move || item.kind !== 'folder') {
			return
		}

		const paths = getActiveDraggedPaths(event.dataTransfer)
		if (paths.length === 0 || paths.some((path) => item.path === path || item.path.startsWith(`${path}/`))) {
			return
		}

		event.preventDefault()
		event.stopPropagation()
		event.dataTransfer.dropEffect = 'move'
		setDropActive(false)
		setFolderDropTargetPath(item.path)
	}

	async function moveDraggedItemsToFolder(item: FileNode<TMetadata>, event: DragEvent) {
		if (isLocked(item) || !browser.capabilities.move || item.kind !== 'folder') {
			return
		}

		const paths = getActiveDraggedPaths(event.dataTransfer)
		if (paths.length === 0) {
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

	function openItemMenu(item: FileNode<TMetadata>, anchor: HTMLElement) {
		if (!browser.selectedPaths.includes(item.path)) {
			browser.selectOnly(item.path)
		}
		const rect = anchor.getBoundingClientRect()
		setContextMenu({
			target: 'item',
			item,
			x: rect.left,
			y: rect.bottom + 4,
			mode: isNarrow ? 'sheet' : 'context'
		})
	}

	function openItem(item: FileNode<TMetadata>) {
		if (item.kind === 'folder') void browser.open(item)
		else openPreview(item)
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

	function stepOpenFile(direction: -1 | 1) {
		if (!openFile || previewFiles.length === 0) {
			return
		}

		const currentIndex = previewFiles.findIndex((item) => item.path === openFile.item.path)
		const safeIndex = currentIndex >= 0 ? currentIndex : 0
		const next = previewFiles[(safeIndex + direction + previewFiles.length) % previewFiles.length]
		setOpenFile({ item: next, mode: 'preview' })
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

	const openFilePosition = openFile ? previewFiles.findIndex((item) => item.path === openFile.item.path) + 1 : 0

	const clipboardStatus = clipboardNotice ? (
		<span
			aria-label="Clipboard status"
			className={`shrink-0 whitespace-nowrap rounded-full bg-[var(--fb-accent-soft)] px-3 py-1 text-[var(--fb-font-sm)] font-semibold ${ACCENT_INK} ${CONTROL_MOTION}`}
			role="status"
		>
			{clipboardNotice}
		</span>
	) : null

	const viewToggle = (
		<div
			aria-label="View"
			className="flex shrink-0 overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)]"
			role="group"
		>
			<button
				aria-label="List view"
				aria-pressed={browser.view === 'list'}
				className={segmentButton(browser.view === 'list')}
				onClick={() => browser.setView('list')}
				title="List view"
				type="button"
			>
				<List aria-hidden="true" className="size-4" strokeWidth={2} />
			</button>
			<button
				aria-label="Grid view"
				aria-pressed={browser.view === 'grid'}
				className={segmentButton(browser.view === 'grid')}
				onClick={() => browser.setView('grid')}
				title="Grid view"
				type="button"
			>
				<LayoutGrid aria-hidden="true" className="size-4" strokeWidth={2} />
			</button>
		</div>
	)

	const secondaryControls = (
		<div className="flex min-w-0 flex-wrap items-center gap-3">
			<SelectField
				aria-label="Filter files"
				icon={ListFilter}
				onChange={(event) => browser.setFilterKind(event.target.value as 'all' | 'files' | 'folders')}
				value={browser.filterKind}
			>
				<option value="all">All kinds</option>
				<option value="folders">Folders</option>
				<option value="files">Files</option>
			</SelectField>
			<SelectField
				aria-label="Sort files"
				icon={ArrowUpDown}
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
			{!isNarrow ? viewToggle : null}
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
			canCut={selectionWritable && browser.capabilities.move}
			canDelete={selectionWritable}
			canMove={selectionWritable && browser.capabilities.move}
			canRename={selectionWritable && browser.capabilities.rename}
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
				{openFile ? (
					<FileView
						adapter={adapter}
						breadcrumbs={(navigate) => (
							<Breadcrumbs
								narrow={isNarrow}
								onNavigate={(nextPath) => Promise.resolve(navigate(nextPath))}
								path={openFile.item.path}
								rootLabel={rootLabel}
							/>
						)}
						editor={getEditor(openFile.item)}
						initialMode={openFile.mode}
						item={openFile.item}
						key={openFile.item.path}
						onClose={() => setOpenFile(null)}
						onDownload={() => void downloadItem(openFile.item)}
						onNavigate={(nextPath) => {
							setOpenFile(null)
							void browser.navigate(nextPath, { source: 'breadcrumb' })
						}}
						onSaved={() => void browser.refresh()}
						onStep={stepOpenFile}
						position={openFilePosition > 0 ? { index: openFilePosition, total: previewFiles.length } : undefined}
						previewer={findPlugin(previewers, openFile.item)}
					/>
				) : (
					<>
						<header
							className={`flex min-h-[var(--fb-header-h)] min-w-0 flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-[var(--fb-border)] px-[var(--fb-pad)] py-3 ${isNarrow ? 'px-4' : ''} ${SURFACE_MOTION}`}
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
									<div className={`flex min-w-0 items-center gap-3 ${isNarrow ? 'flex-1' : 'w-full'}`}>
										<div className="min-w-0 flex-1">
											<Breadcrumbs
												narrow={isNarrow}
												onNavigate={(nextPath) => browser.navigate(nextPath, { source: 'breadcrumb' })}
												path={browser.currentPath}
												rootLabel={rootLabel}
											/>
										</div>
										{clipboardStatus}
									</div>
									{isNarrow ? viewToggle : null}
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
							{mobileSelection ? clipboardStatus : null}
							{!mobileSelection ? (
								<div className="flex w-full min-w-0 flex-wrap items-center gap-3">
									<label className={`relative block min-w-0 ${isNarrow ? 'w-full' : 'min-w-[180px] flex-1'}`}>
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
									isItemReadOnly={isItemReadOnlyMark}
									onItemMenu={openItemMenu}
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
									isItemReadOnly={isItemReadOnlyMark}
									onItemMenu={openItemMenu}
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
					</>
				)}
			</div>

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
					canEdit={contextMenu.target === 'item' && Boolean(getEditor(contextMenu.item))}
					onEdit={(item) => openEditor(item)}
					onOpen={(item) => openItem(item)}
					readOnly={readOnly}
					selectionWritable={selectionWritable}
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
	isItemReadOnly,
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
	onItemMenu,
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
	isItemReadOnly: (item: FileNode<TMetadata>) => boolean
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
	onItemMenu: (item: FileNode<TMetadata>, anchor: HTMLElement) => void
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
						canMove={canMove && !isItemReadOnly(item)}
						onMenu={(anchor) => onItemMenu(item, anchor)}
						readOnlyItem={isItemReadOnly(item)}
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
	onMenu,
	readOnlyItem,
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
	onMenu: (anchor: HTMLElement) => void
	readOnlyItem: boolean
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
					aria-checked={selected}
					aria-label={`Select ${item.name}`}
					role="checkbox"
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
			<span className="absolute right-[calc(var(--fb-card-pad)+4px)] top-[calc(var(--fb-card-pad)+4px)] z-[1]">
				<ItemMenuButton
					className="bg-[color-mix(in_oklch,var(--fb-surface)_85%,transparent)]"
					item={item}
					narrow={narrow}
					onOpen={(_, anchor) => onMenu(anchor)}
					selected={selected}
				/>
			</span>
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
			{readOnlyItem ? (
				<span className="-mt-1 flex items-center gap-1 text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
					<Lock aria-hidden="true" className="size-3.5" /> Read-only
				</span>
			) : null}
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
	isItemReadOnly,
	selectedPaths,
	onContextMenu,
	onDragEnd,
	onDragStart,
	onFolderDragOver,
	onFolderDrop,
	onInlineRenameCancel,
	onInlineRenameChange,
	onInlineRenameCommit,
	onItemMenu,
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
	isItemReadOnly: (item: FileNode<TMetadata>) => boolean
	selectedPaths: string[]
	onContextMenu: (item: FileNode<TMetadata>, event: MouseEvent) => void
	onDragEnd: () => void
	onDragStart: (item: FileNode<TMetadata>, event: DragEvent) => void
	onFolderDragOver: (item: FileNode<TMetadata>, event: DragEvent) => void
	onFolderDrop: (item: FileNode<TMetadata>, event: DragEvent) => void
	onInlineRenameCancel: () => void
	onInlineRenameChange: (value: string) => void
	onInlineRenameCommit: () => void
	onItemMenu: (item: FileNode<TMetadata>, anchor: HTMLElement) => void
	onOpenItem: (item: FileNode<TMetadata>) => void
	onSelectItem: (path: string, event: MouseEvent) => void
	onTouchMenu: (item: FileNode<TMetadata>) => void
	narrow: boolean
	selectionMode: boolean
	onToggleItem: (path: string) => void
	renderItemMeta?: (item: FileNode<TMetadata>, context: { view: FileBrowserView }) => ReactNode
	rootLabel: string
}) {
	const showCheckboxes = !narrow || selectionMode
	const selectedCount = browser.filteredItems.filter((item) => selectedPaths.includes(item.path)).length
	const allSelected = selectedCount > 0 && selectedCount === browser.filteredItems.length
	const headCell = `h-10 border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] text-[var(--fb-font-sm)] font-semibold uppercase tracking-[0.06em] text-[var(--fb-muted)]`
	const bodyCell =
		'h-[var(--fb-row-h)] border-b border-[var(--fb-border)] px-[var(--fb-cell-x)] py-[calc(var(--fb-cell-y)/2)]'
	const checkboxCell = 'w-[calc(var(--fb-cell-x)*2+18px)] pr-0'
	const sortHeader = (label: string, sortBy: 'name' | 'modifiedAt' | 'size', className = '') => {
		const active = browser.sortBy === sortBy
		return (
			<th
				aria-sort={active ? (browser.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
				className={`${headCell} ${className}`}
				scope="col"
			>
				<button
					className={`inline-flex items-center gap-1 rounded-[4px] uppercase tracking-[inherit] hover:text-[var(--fb-text)] ${active ? 'text-[var(--fb-text)]' : ''} ${FOCUS_RING} ${CONTROL_MOTION}`}
					onClick={() => {
						if (active) browser.setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
						else {
							browser.setSortBy(sortBy)
							browser.setSortDirection('asc')
						}
					}}
					type="button"
				>
					{label}
					{active ? (
						<ChevronDown
							aria-hidden="true"
							className={`size-3.5 ${browser.sortDirection === 'desc' ? 'rotate-180' : ''}`}
							strokeWidth={2.5}
						/>
					) : null}
				</button>
			</th>
		)
	}
	return (
		<table
			aria-label={rootLabel}
			className={`w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-left ${SURFACE_MOTION}`}
		>
			<thead>
				<tr>
					{showCheckboxes ? (
						<th className={`${headCell} ${checkboxCell}`} scope="col">
							<button
								aria-checked={allSelected ? true : selectedCount > 0 ? 'mixed' : false}
								aria-label={allSelected ? 'Select none' : 'Select all items'}
								className={`grid place-items-center rounded-[5px] ${FOCUS_RING}`}
								onClick={() => (allSelected ? browser.clearSelection() : browser.selectAllLoaded())}
								role="checkbox"
								type="button"
							>
								<SelectionMark
									mixed={!allSelected && selectedCount > 0}
									selected={allSelected}
									visibleOnHover={false}
								/>
							</button>
						</th>
					) : null}
					{sortHeader('Name', 'name')}
					{!narrow ? sortHeader('Size', 'size', 'w-[140px] text-right') : null}
					{!narrow ? sortHeader('Modified', 'modifiedAt', 'w-[160px] text-right') : null}
					<th className={`${headCell} w-[calc(var(--fb-control-h)+var(--fb-cell-x))]`} scope="col">
						<span className="sr-only">Actions</span>
					</th>
				</tr>
			</thead>
			<tbody>
				{browser.filteredItems.map((item) => {
					const isSelected = selectedPaths.includes(item.path)
					const isDropTarget = folderDropTargetPath === item.path
					const itemReadOnly = isItemReadOnly(item)
					return (
						<TouchRow
							aria-selected={isSelected}
							data-fb-drop-target={isDropTarget ? 'true' : undefined}
							data-fb-path={item.path}
							data-fb-read-only={itemReadOnly ? 'true' : undefined}
							className={`group outline-none focus-visible:bg-[var(--fb-surface-2)] ${CONTROL_MOTION} ${
								isDropTarget
									? 'bg-[var(--fb-accent-soft)] ring-2 ring-inset ring-[var(--fb-accent)]'
									: isSelected
										? 'bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))] shadow-[inset_3px_0_0_var(--fb-accent)]'
										: 'hover:bg-[color-mix(in_oklch,var(--fb-surface-2)_60%,var(--fb-surface))]'
							}`}
							draggable={canMove && !narrow && !itemReadOnly}
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
							{showCheckboxes ? (
								<td className={`${bodyCell} ${checkboxCell}`}>
									<button
										aria-checked={isSelected}
										aria-label={`Select ${item.name}`}
										className={`grid place-items-center rounded-[5px] ${selectionMode ? '-ml-3 size-[calc(var(--fb-gap)*11)]' : ''} ${FOCUS_RING}`}
										data-fb-touch-control
										onClick={(event) => {
											event.stopPropagation()
											onToggleItem(item.path)
										}}
										onDoubleClick={(event) => event.stopPropagation()}
										role="checkbox"
										type="button"
									>
										<SelectionMark selected={isSelected} visibleOnHover={false} />
									</button>
								</td>
							) : null}
							<td className={bodyCell}>
								<div className="flex min-w-0 items-center gap-2.5">
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
											<span className="flex min-w-0 items-center gap-1.5">
												<button
													className={`block min-w-0 truncate rounded-[4px] text-left text-[var(--fb-font)] font-medium outline-none [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${narrow ? 'min-h-[calc(var(--fb-gap)*6)]' : ''} ${CONTROL_MOTION}`}
													onClick={(event) => {
														event.stopPropagation()
														onSelectItem(item.path, event)
													}}
													type="button"
												>
													{item.name}
												</button>
												{itemReadOnly ? <ReadOnlyMark /> : null}
											</span>
										)}
										<ItemMeta item={item} renderItemMeta={renderItemMeta} view="list" />
										{narrow ? (
											<div className="flex flex-wrap gap-x-3 text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
												<span>{item.kind === 'folder' ? 'Folder' : formatBytes(item.size ?? 0)}</span>
												{item.modifiedAt ? <span>{formatModified(item.modifiedAt)}</span> : null}
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
									{item.modifiedAt ? formatModified(item.modifiedAt) : '—'}
								</td>
							) : null}
							<td className={`${bodyCell} pl-0 text-right`}>
								<ItemMenuButton item={item} narrow={narrow} onOpen={onItemMenu} selected={isSelected} />
							</td>
						</TouchRow>
					)
				})}
			</tbody>
		</table>
	)
}

function ItemMenuButton<TMetadata>({
	item,
	narrow,
	onOpen,
	selected,
	className = ''
}: {
	item: FileNode<TMetadata>
	narrow: boolean
	onOpen: (item: FileNode<TMetadata>, anchor: HTMLElement) => void
	selected: boolean
	className?: string
}) {
	return (
		<button
			aria-haspopup="menu"
			aria-label={`More actions for ${item.name}`}
			className={`inline-grid size-[var(--fb-control-h)] place-items-center rounded-[calc(var(--fb-radius)-2px)] text-[var(--fb-muted)] hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)] ${
				narrow || selected
					? ''
					: 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100'
			} ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${className}`}
			data-fb-touch-control
			onClick={(event) => {
				event.stopPropagation()
				onOpen(item, event.currentTarget)
			}}
			onDoubleClick={(event) => event.stopPropagation()}
			type="button"
		>
			<MoreHorizontal aria-hidden="true" className="size-4" />
		</button>
	)
}

function ReadOnlyMark() {
	return (
		<span className="inline-flex shrink-0 text-[var(--fb-muted)]" role="img" aria-label="Read-only" title="Read-only">
			<Lock aria-hidden="true" className="size-3.5" />
		</span>
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
	canEdit,
	onEdit,
	onOpen,
	readOnly,
	selectionWritable
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
	canEdit: boolean
	onEdit: (item: FileNode<TMetadata>) => void
	onOpen: (item: FileNode<TMetadata>) => void
	readOnly: boolean
	selectionWritable: boolean
}) {
	const isItemMenu = menu.target === 'item'
	const single =
		menu.target === 'item' && !(browser.selectedPaths.includes(menu.item.path) && browser.selectedPaths.length > 1)
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
					: 'fixed z-[60] max-h-[calc(100dvh-var(--fb-gap)*4)] min-w-[200px] max-w-[calc(100%-var(--fb-gap)*4)] overflow-y-auto rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] p-1.5 shadow-[var(--fb-shadow,0_12px_32px_color-mix(in_oklch,black_35%,transparent))]'
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
			{isItemMenu && single ? (
				<ContextMenuButton onClick={() => run(() => onOpen(menu.item))}>
					{menu.item.kind === 'folder' ? 'Open' : 'Preview'}
				</ContextMenuButton>
			) : null}
			{isItemMenu && single && canEdit ? (
				<ContextMenuButton onClick={() => run(() => onEdit(menu.item))}>Edit</ContextMenuButton>
			) : null}
			{isItemMenu && single && selectionWritable && browser.capabilities.rename ? (
				<ContextMenuButton onClick={() => run(() => onRename(menu.item))}>Rename</ContextMenuButton>
			) : null}
			{isItemMenu && selectionWritable && browser.capabilities.move ? (
				<ContextMenuButton onClick={() => run(onMove)}>Move</ContextMenuButton>
			) : null}
			{isItemMenu && !readOnly && browser.capabilities.copy ? (
				<ContextMenuButton onClick={() => run(onCopy)}>Copy</ContextMenuButton>
			) : null}
			{isItemMenu && selectionWritable && browser.capabilities.move ? (
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
					{selectionWritable ? <div aria-hidden="true" className="mx-1.5 my-1 h-px bg-[var(--fb-border)]" /> : null}
					{selectionWritable ? (
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
	const [fit, setFit] = useState<BreadcrumbFit | null>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const measureRef = useRef<HTMLDivElement>(null)
	const menuRef = useRef<HTMLSpanElement>(null)
	const parts = path.split('/').filter(Boolean)
	const crumbs: BreadcrumbCrumb[] = [{ label: rootLabel, path: '/' }].concat(
		parts.map((part, index) => ({
			label: part,
			path: `/${parts.slice(0, index + 1).join('/')}`
		}))
	)
	const layout = fit ? getFittedBreadcrumbs(crumbs, fit) : getFallbackBreadcrumbs(crumbs, narrow)

	// Show as much of the path as the row can hold: measure every crumb off-screen, then keep the root plus
	// as many trailing folders as fit, collapsing only the middle.
	useLayoutEffect(() => {
		const list = listRef.current
		const measurer = measureRef.current
		if (!list || !measurer) return
		const measure = () => {
			const available = list.clientWidth
			if (available <= 0) return
			const items = Array.from(measurer.querySelectorAll<HTMLElement>('[data-fb-crumb-measure]'))
			const ellipsis = measurer.querySelector<HTMLElement>('[data-fb-crumb-ellipsis]')
			const widths = items.map((item) => item.getBoundingClientRect().width + BREADCRUMB_GAP_PX)
			const next = fitBreadcrumbs(widths, (ellipsis?.getBoundingClientRect().width ?? 0) + BREADCRUMB_GAP_PX, available)
			setFit((current) => (current?.lead === next.lead && current.tail === next.tail ? current : next))
		}
		measure()
		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(() => measure())
		observer.observe(list)
		return () => observer.disconnect()
	}, [path, rootLabel])

	useEffect(() => {
		if (!ancestorsOpen || narrow) return
		menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
		const close = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setAncestorsOpen(false)
		}
		document.addEventListener('pointerdown', close)
		return () => document.removeEventListener('pointerdown', close)
	}, [ancestorsOpen, narrow])

	function navigateFromMenu(nextPath: string) {
		setAncestorsOpen(false)
		void onNavigate(nextPath)
	}

	const crumbText = `rounded-[calc(var(--fb-radius)-4px)] px-0.5 py-1 [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)]`

	return (
		<nav aria-label="Breadcrumb" className="flex min-w-0 max-w-full items-center gap-1 text-[var(--fb-font)]">
			{narrow && parts.length > 0 ? (
				<button
					aria-label="Parent folder"
					className={`${toolButton(false)} -ml-2 border-transparent bg-transparent text-[var(--fb-text)]`}
					onClick={() => void onNavigate(getFileBrowserDirname(path))}
					type="button"
				>
					<ChevronLeft aria-hidden="true" className="size-4" />
				</button>
			) : null}
			<div className="relative flex min-w-0 flex-1 items-center gap-1.5" ref={listRef}>
				<div
					aria-hidden="true"
					className="pointer-events-none invisible absolute left-0 top-0 flex h-0 items-center gap-1.5 overflow-hidden whitespace-nowrap"
					ref={measureRef}
				>
					{crumbs.map((crumb, index) => (
						<span className="flex shrink-0 items-center gap-1.5" data-fb-crumb-measure key={crumb.path}>
							{index > 0 ? <ChevronRight className="size-3.5 shrink-0" strokeWidth={2} /> : null}
							<span
								className={`${crumbText} block max-w-[240px] truncate ${index === crumbs.length - 1 ? 'font-semibold' : ''}`}
							>
								{crumb.label}
							</span>
						</span>
					))}
					<span className="flex shrink-0 items-center gap-1.5" data-fb-crumb-ellipsis>
						<ChevronRight className="size-3.5 shrink-0" strokeWidth={2} />
						<span className="inline-flex h-[26px] min-w-[26px] px-1.5">…</span>
					</span>
				</div>
				{layout.map((crumb, index) => (
					<span className="flex min-w-0 shrink-0 items-center gap-1.5 last:shrink last:grow" key={crumb.key}>
						{index > 0 ? (
							<ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[var(--fb-muted)]" strokeWidth={2} />
						) : null}
						{crumb.kind === 'collapsed' ? (
							<span className="relative inline-flex" ref={menuRef}>
								<button
									aria-expanded={ancestorsOpen}
									aria-haspopup={narrow ? 'dialog' : 'menu'}
									aria-label="Collapsed breadcrumb"
									className={`inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[calc(var(--fb-radius)-4px)] px-1.5 text-[calc(var(--fb-font)-1px)] hover:text-[var(--fb-text)] ${FOCUS_RING} ${TOUCH_CONTROL} ${CONTROL_MOTION} ${
										ancestorsOpen && !narrow
											? `bg-[var(--fb-accent-soft)] ${ACCENT_INK}`
											: 'bg-[var(--fb-surface-2)] text-[var(--fb-muted)]'
									}`}
									onClick={() => setAncestorsOpen((open) => !open)}
									title={`${crumb.hidden.length} hidden ${crumb.hidden.length === 1 ? 'folder' : 'folders'}`}
									type="button"
								>
									…
								</button>
								{ancestorsOpen && !narrow ? (
									<div
										aria-label="Hidden folders"
										className="absolute left-0 top-[calc(100%+6px)] z-50 flex max-h-[min(360px,60dvh)] w-max min-w-[200px] max-w-[min(420px,80vw)] flex-col overflow-y-auto rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-1.5 shadow-[var(--fb-shadow,0_12px_32px_color-mix(in_oklch,black_35%,transparent))]"
										onKeyDown={(event) => {
											if (event.key === 'Escape' || event.key === 'Tab') {
												event.stopPropagation()
												setAncestorsOpen(false)
												if (event.key === 'Escape') menuRef.current?.querySelector<HTMLElement>('button')?.focus()
												return
											}
											if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
											event.preventDefault()
											event.stopPropagation()
											const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
											const index = items.indexOf(document.activeElement as HTMLElement)
											items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
										}}
										role="menu"
									>
										{crumb.hidden.map((hidden, depth) => (
											<button
												className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[calc(var(--fb-radius)-2px)] pr-2.5 text-left outline-none hover:bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))] focus:bg-[color-mix(in_oklch,var(--fb-accent-soft)_70%,var(--fb-surface))] ${CONTROL_MOTION}`}
												key={hidden.path}
												onClick={() => navigateFromMenu(hidden.path)}
												role="menuitem"
												style={{ paddingLeft: `calc(10px + 12px * ${Math.min(depth, 6)})` }}
												title={hidden.label}
												type="button"
											>
												<Folder
													aria-hidden="true"
													className="size-4 shrink-0 fill-current text-[var(--fb-folder)]"
													strokeWidth={0}
												/>
												<span className="truncate">{hidden.label}</span>
											</button>
										))}
									</div>
								) : null}
							</span>
						) : (
							<button
								aria-current={index === layout.length - 1 ? 'page' : undefined}
								className={`${crumbText} min-w-0 truncate hover:text-[var(--fb-text)] ${FOCUS_RING} ${CONTROL_MOTION} ${
									index === layout.length - 1
										? 'font-semibold text-[var(--fb-text)]'
										: 'max-w-[240px] text-[var(--fb-muted)]'
								}`}
								onClick={() => void onNavigate(crumb.path)}
								title={crumb.label}
								type="button"
							>
								{crumb.label}
							</button>
						)}
					</span>
				))}
			</div>
			{ancestorsOpen && narrow ? (
				<ActionSheet label="Folder path" onClose={() => setAncestorsOpen(false)}>
					<div className="flex min-w-0 flex-col">
						{crumbs.map((crumb) => (
							<button
								key={crumb.path}
								className={`${commandButton(false)} my-[var(--fb-gap)] block w-full truncate text-left`}
								onClick={() => navigateFromMenu(crumb.path)}
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

const BREADCRUMB_GAP_PX = 6

type BreadcrumbCrumb = {
	label: string
	path: string
}

type BreadcrumbFit = {
	lead: number
	tail: number
}

type VisibleBreadcrumbCrumb =
	| (BreadcrumbCrumb & {
			kind: 'crumb'
			key: string
	  })
	| {
			kind: 'collapsed'
			key: string
			hidden: BreadcrumbCrumb[]
	  }

// widths include the separator and gap each crumb brings; lead/tail count crumbs kept at each end.
function fitBreadcrumbs(widths: number[], ellipsisWidth: number, available: number): BreadcrumbFit {
	const count = widths.length
	if (widths.reduce((total, width) => total + width, 0) <= available) return { lead: count, tail: 0 }
	let used = widths[0] + ellipsisWidth + widths[count - 1]
	let tail = 1
	while (tail < count - 2 && used + widths[count - 1 - tail] <= available) {
		used += widths[count - 1 - tail]
		tail += 1
	}
	let lead = 1
	while (lead + tail < count - 1 && used + widths[lead] <= available) {
		used += widths[lead]
		lead += 1
	}
	return { lead, tail }
}

function getFittedBreadcrumbs(crumbs: BreadcrumbCrumb[], fit: BreadcrumbFit): VisibleBreadcrumbCrumb[] {
	const toVisible = (crumb: BreadcrumbCrumb) => ({ ...crumb, kind: 'crumb' as const, key: crumb.path })
	if (fit.lead + fit.tail >= crumbs.length) return crumbs.map(toVisible)
	return [
		...crumbs.slice(0, fit.lead).map(toVisible),
		{ kind: 'collapsed', key: 'collapsed', hidden: crumbs.slice(fit.lead, crumbs.length - fit.tail) },
		...crumbs.slice(crumbs.length - fit.tail).map(toVisible)
	]
}

// Used before layout can be measured (first paint, non-DOM environments).
function getFallbackBreadcrumbs(crumbs: BreadcrumbCrumb[], narrow: boolean): VisibleBreadcrumbCrumb[] {
	if (narrow && crumbs.length > 1) {
		return [
			{ kind: 'collapsed', key: 'collapsed', hidden: crumbs.slice(0, -1) },
			{ ...crumbs[crumbs.length - 1], kind: 'crumb', key: crumbs[crumbs.length - 1].path }
		]
	}
	return crumbs.length <= 4
		? getFittedBreadcrumbs(crumbs, { lead: crumbs.length, tail: 0 })
		: getFittedBreadcrumbs(crumbs, { lead: 2, tail: 2 })
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
function SelectField({ icon: Icon, ...props }: React.ComponentProps<'select'> & { icon?: LucideIcon }) {
	return (
		<span className="relative inline-flex min-w-0 max-w-full shrink-0">
			{Icon ? (
				<Icon
					aria-hidden="true"
					className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fb-muted)]"
					strokeWidth={2}
				/>
			) : null}
			<select {...props} className={selectInput(Boolean(Icon))} />
			<ChevronDown
				aria-hidden="true"
				className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fb-muted)]"
				strokeWidth={2}
			/>
		</span>
	)
}

function selectInput(withIcon = false) {
	return `h-[var(--fb-control-h)] min-w-0 max-w-full appearance-none rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] ${withIcon ? 'pl-9' : 'pl-3'} pr-9 text-[var(--fb-font)] font-medium text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] focus:ring-[3px] focus:ring-[color-mix(in_oklch,var(--fb-accent)_15%,transparent)] [@media(pointer:coarse)]:text-[16px] ${TOUCH_CONTROL} ${CONTROL_MOTION}`
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

function getFileTone<TMetadata>(item: FileNode<TMetadata>): FileTone {
	switch (getFileCategory(item)) {
		case 'folder':
			return 'folder'
		case 'pdf':
			return 'danger'
		case 'image':
		case 'spreadsheet':
			return 'ok'
		case 'video':
		case 'audio':
		case 'presentation':
			return 'accent'
		case 'archive':
			return 'warn'
		default:
			return 'neutral'
	}
}

function FileTypeTile<TMetadata>({ item, size }: { item: FileNode<TMetadata>; size: 'sm' | 'md' | 'lg' }) {
	const box =
		size === 'sm'
			? 'size-8 rounded-[calc(var(--fb-radius)-2px)]'
			: size === 'md'
				? 'h-[var(--fb-thumb-h)] w-full rounded-[calc(var(--fb-radius)-2px)]'
				: 'h-[150px] w-full rounded-[var(--fb-radius)]'
	const icon = size === 'sm' ? 'size-4' : size === 'md' ? 'size-8' : 'size-10'
	const Icon = getFileIcon(item)
	return (
		<span
			aria-hidden="true"
			className={`grid shrink-0 place-items-center overflow-hidden ${box} ${FILE_TONE_CLASSES[getFileTone(item)]} ${CONTROL_MOTION}`}
			data-fb-file-category={getFileCategory(item)}
		>
			{item.kind === 'folder' ? (
				<Folder className={`${icon} fill-current`} strokeWidth={0} />
			) : item.thumbnailUrl && size !== 'sm' ? (
				<img alt="" className="size-full object-cover" draggable={false} loading="lazy" src={item.thumbnailUrl} />
			) : (
				<Icon className={icon} strokeWidth={1.75} />
			)}
		</span>
	)
}

function SelectionMark({
	mixed = false,
	selected,
	visibleOnHover = true
}: {
	mixed?: boolean
	selected: boolean
	visibleOnHover?: boolean
}) {
	return (
		<span
			aria-hidden="true"
			className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[var(--fb-surface)] ${CONTROL_MOTION} ${
				selected || mixed
					? 'bg-[var(--fb-accent)]'
					: `border-[1.5px] border-[var(--fb-border-strong)] bg-[var(--fb-surface)] ${visibleOnHover ? 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100' : ''}`
			}`}
		>
			{selected ? (
				<Check className="size-3" strokeWidth={3.5} />
			) : mixed ? (
				<Minus className="size-3" strokeWidth={3.5} />
			) : null}
		</span>
	)
}

function formatModified(value: string) {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '—'
	const now = new Date()
	const startOfDay = (target: Date) => new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
	const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
	if (dayDelta === 0) return `Today, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
	if (dayDelta === 1) return 'Yesterday'
	return date.toLocaleDateString(
		undefined,
		date.getFullYear() === now.getFullYear()
			? { month: 'short', day: 'numeric' }
			: { month: 'short', day: 'numeric', year: 'numeric' }
	)
}

function formatShortDate(value: string | undefined) {
	if (!value) return null
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
