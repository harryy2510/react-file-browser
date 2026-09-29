import { ChevronRight, Ellipsis, FileText, Folder, FolderPlus, RotateCw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { ROOT_PATH, getFileBrowserDirname, joinFileBrowserPath, normalizeFileBrowserPath } from '../core/path'
import type { FileBrowserAdapter, FileNode } from '../core/types'
import { getFileBrowserDensityAttributes } from '../theme'
import { useTransferSnapshot, useTransfers } from '../transfers/file-browser-provider'
import type { FileBrowserDensity } from '../theme'

export type FileTreeProps<TMetadata = unknown> = {
	/**
	 * `list` is required. Upload needs a full adapter (`upload`, `delete`, `signedUrl`) and runs through
	 * the `FileBrowserProvider` transfer queue. New folder (`createFolder`), Rename (`rename`), Delete
	 * (`delete`) and Download (`signedUrl`) appear only when the adapter has that method.
	 */
	adapter: Pick<FileBrowserAdapter<TMetadata>, 'list'> &
		Partial<Pick<FileBrowserAdapter<TMetadata>, 'upload' | 'createFolder' | 'rename' | 'delete' | 'signedUrl'>>
	/** Hides every action that changes storage, whatever the adapter supports. */
	readOnly?: boolean
	/** The folder whose contents are the tree's top level. Defaults to the root. */
	rootPath?: string
	/** Accessible name of the tree. */
	rootLabel?: string
	/** The selected file or folder, controlled by the host. */
	selectedPath?: string
	/** Called when a file or folder is chosen, by click or Enter. */
	onSelect?: (node: FileNode<TMetadata>) => void
	/** Folders open on first render, such as the ancestors of `selectedPath`. */
	defaultExpandedPaths?: readonly string[]
	density?: FileBrowserDensity
	className?: string
	/** Extra content at the end of a row, such as a status badge. */
	renderItemMeta?: (node: FileNode<TMetadata>) => ReactNode
	/** Shown when the root folder is empty. */
	emptyState?: ReactNode
	/** Called after a file or folder is deleted, so the host can drop it if it was selected. */
	onDeleted?: (node: FileNode<TMetadata>) => void
}

type TreeAction = 'upload' | 'new-folder' | 'rename' | 'delete' | 'download'

/** A name being typed: a new item under a folder, or a new name for an item. */
type Draft<TMetadata> = { kind: 'new-folder'; parentPath: string } | { kind: 'rename'; node: FileNode<TMetadata> }

type FolderState<TMetadata> =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; items: FileNode<TMetadata>[] }

/** A row the tree shows: an item, or a folder's loading or error line under it. */
type VisibleRow<TMetadata> =
	| { kind: 'item'; node: FileNode<TMetadata>; level: number; parentPath: string; expanded: boolean }
	| { kind: 'status'; folderPath: string; level: number; state: Exclude<FolderState<TMetadata>, { status: 'ready' }> }
	| { kind: 'draft'; level: number; draft: Extract<Draft<TMetadata>, { parentPath: string }> }

const INDENT_PX = 20

function canUpload<TMetadata>(adapter: FileTreeProps<TMetadata>['adapter']): adapter is FileBrowserAdapter<TMetadata> {
	return (
		typeof adapter.upload === 'function' &&
		typeof adapter.delete === 'function' &&
		typeof adapter.signedUrl === 'function'
	)
}

function byFoldersThenName<TMetadata>(left: FileNode<TMetadata>, right: FileNode<TMetadata>): number {
	if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
	return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * A lazily loaded tree of the adapter's folders and files, for navigation beside an editor or
 * preview. Each folder is listed, every page of it, the first time it is opened. Keyboard follows
 * the WAI-ARIA tree pattern: arrows move and open, Home and End jump, Enter selects.
 */
export function FileTree<TMetadata = unknown>({
	adapter,
	rootPath = ROOT_PATH,
	rootLabel = 'Files',
	selectedPath,
	onSelect,
	defaultExpandedPaths = [],
	density,
	className = '',
	renderItemMeta,
	emptyState = 'No files',
	readOnly = false,
	onDeleted
}: FileTreeProps<TMetadata>) {
	const root = normalizeFileBrowserPath(rootPath)
	const [folders, setFolders] = useState<ReadonlyMap<string, FolderState<TMetadata>>>(new Map())
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(
		() => new Set(defaultExpandedPaths.map(normalizeFileBrowserPath))
	)
	const [focusedPath, setFocusedPath] = useState<string | undefined>(undefined)
	const rowRefs = useRef(new Map<string, HTMLDivElement>())
	const requested = useRef(new Set<string>())
	const [draft, setDraft] = useState<Draft<TMetadata> | undefined>(undefined)
	const [menu, setMenu] = useState<{ node: FileNode<TMetadata>; x: number; y: number } | undefined>(undefined)
	const [actionError, setActionError] = useState<string | undefined>(undefined)
	const [dropTarget, setDropTarget] = useState<string | undefined>(undefined)
	const fileInput = useRef<HTMLInputElement>(null)
	const uploadFolder = useRef(root)
	const transfers = useTransfers()
	const { uploads } = useTransferSnapshot()
	const refreshedUploads = useRef(new Set<string>())
	const uploadable = !readOnly && canUpload(adapter)

	function actionsFor(node: FileNode<TMetadata> | undefined): TreeAction[] {
		const folder = !node || node.kind === 'folder'
		const actions: TreeAction[] = []
		if (uploadable && folder) actions.push('upload')
		if (!readOnly && folder && adapter.createFolder) actions.push('new-folder')
		if (node && !folder && adapter.signedUrl) actions.push('download')
		if (!readOnly && node && adapter.rename) actions.push('rename')
		if (!readOnly && node && adapter.delete) actions.push('delete')
		return actions
	}

	const load = useCallback(
		async (path: string) => {
			requested.current.add(path)
			setFolders((current) => new Map(current).set(path, { status: 'loading' }))
			try {
				const items: FileNode<TMetadata>[] = []
				let cursor: string | undefined
				do {
					const page = await adapter.list(path, cursor ? { cursor } : undefined)
					items.push(...page.items)
					cursor = page.cursor
				} while (cursor)
				setFolders((current) => new Map(current).set(path, { status: 'ready', items: items.sort(byFoldersThenName) }))
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Could not load this folder'
				setFolders((current) => new Map(current).set(path, { status: 'error', message }))
			}
		},
		[adapter]
	)

	// A finished upload, from this tree or anywhere else, shows up in its folder if that folder was loaded.
	useEffect(() => {
		for (const upload of uploads) {
			if (upload.status !== 'completed' || !upload.result || refreshedUploads.current.has(upload.id)) continue
			refreshedUploads.current.add(upload.id)
			const folder = getFileBrowserDirname(upload.result.path)
			if (requested.current.has(folder)) void load(folder)
		}
	}, [uploads, load])

	// The root, and any folder open before its contents were fetched, loads once.
	useEffect(() => {
		for (const path of [root, ...expanded]) {
			if (!requested.current.has(path)) void load(path)
		}
	}, [root, expanded, load])

	const rows = useMemo(() => {
		const visible: VisibleRow<TMetadata>[] = []
		const walk = (path: string, level: number) => {
			if (draft && draft.kind !== 'rename' && draft.parentPath === path) visible.push({ kind: 'draft', level, draft })
			const state = folders.get(path)
			if (!state) return
			if (state.status !== 'ready') {
				if (path !== root) visible.push({ kind: 'status', folderPath: path, level, state })
				return
			}
			for (const node of state.items) {
				const nodePath = normalizeFileBrowserPath(node.path)
				const isOpen = node.kind === 'folder' && expanded.has(nodePath)
				visible.push({ kind: 'item', node, level, parentPath: path, expanded: isOpen })
				if (isOpen) walk(nodePath, level + 1)
			}
		}
		walk(root, 0)
		return visible
	}, [folders, expanded, root, draft])

	const items = rows.filter((row): row is Extract<VisibleRow<TMetadata>, { kind: 'item' }> => row.kind === 'item')
	const selected = selectedPath === undefined ? undefined : normalizeFileBrowserPath(selectedPath)
	const tabStop = items.find((row) => normalizeFileBrowserPath(row.node.path) === (focusedPath ?? selected))
		? (focusedPath ?? selected)
		: items[0] && normalizeFileBrowserPath(items[0].node.path)

	const focus = (path: string | undefined) => {
		if (!path) return
		setFocusedPath(path)
		rowRefs.current.get(path)?.focus()
	}

	const toggle = (path: string) => {
		setExpanded((current) => {
			const next = new Set(current)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	}

	const choose = (node: FileNode<TMetadata>) => {
		const path = normalizeFileBrowserPath(node.path)
		setFocusedPath(path)
		if (node.kind === 'folder') toggle(path)
		onSelect?.(node)
	}

	async function attempt(work: () => Promise<void>) {
		setActionError(undefined)
		try {
			await work()
		} catch (error) {
			setActionError(error instanceof Error ? error.message : 'That did not work')
		}
	}

	function act(action: TreeAction, node: FileNode<TMetadata> | undefined) {
		setMenu(undefined)
		const path = node ? normalizeFileBrowserPath(node.path) : root
		if (action === 'upload') {
			uploadFolder.current = path
			fileInput.current?.click()
		} else if (action === 'new-folder') {
			if (path !== root) setExpanded((current) => new Set(current).add(path))
			setDraft({ kind: action, parentPath: path })
		} else if (action === 'rename' && node) {
			setDraft({ kind: 'rename', node })
		} else if (action === 'delete' && node && adapter.delete) {
			const remove = adapter.delete.bind(adapter)
			void attempt(async () => {
				await remove([node.path])
				await load(getFileBrowserDirname(path))
				onDeleted?.(node)
			})
		} else if (action === 'download' && node && adapter.signedUrl) {
			const sign = adapter.signedUrl.bind(adapter)
			void attempt(async () => {
				const link = document.createElement('a')
				link.href = await sign(node.path)
				link.download = node.name
				link.click()
			})
		}
	}

	function submitDraft(current: Draft<TMetadata>, value: string) {
		setDraft(undefined)
		const name = value.trim()
		if (!name || (current.kind === 'rename' && name === current.node.name)) return
		void attempt(async () => {
			if (current.kind === 'rename') {
				if (!adapter.rename) return
				const from = normalizeFileBrowserPath(current.node.path)
				const renamed = await adapter.rename(from, name)
				setExpanded((open) => {
					if (!open.has(from)) return open
					const next = new Set(open)
					next.delete(from)
					return next.add(normalizeFileBrowserPath(renamed.path))
				})
				await load(getFileBrowserDirname(from))
				if (from === selected) onSelect?.(renamed)
				return
			}
			if (!adapter.createFolder) return
			await adapter.createFolder(joinFileBrowserPath(current.parentPath, name))
			await load(current.parentPath)
		})
	}

	function uploadTo(folder: string, files: Iterable<File>) {
		if (!canUpload(adapter)) return
		if (folder !== root) setExpanded((current) => new Set(current).add(folder))
		for (const file of files) {
			transfers.enqueueUpload({ adapter, destinationPath: joinFileBrowserPath(folder, file.name), file })
		}
	}

	/** Drops land in the folder under the pointer, or beside the file under it. */
	function dropHandlers(folder: string) {
		if (!uploadable) return {}
		return {
			onDragOver(event: DragEvent) {
				if (!event.dataTransfer.types.includes('Files')) return
				event.preventDefault()
				event.stopPropagation()
				setDropTarget(folder)
			},
			onDragLeave(event: DragEvent) {
				if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
					setDropTarget(undefined)
			},
			onDrop(event: DragEvent) {
				event.preventDefault()
				event.stopPropagation()
				setDropTarget(undefined)
				uploadTo(folder, event.dataTransfer.files)
			}
		}
	}

	function openMenu(node: FileNode<TMetadata>, x: number, y: number) {
		if (actionsFor(node).length > 0) setMenu({ node, x, y })
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
		const row = items[index]
		if (!row) return
		const path = normalizeFileBrowserPath(row.node.path)
		const pathAt = (at: number) => {
			const target = items.at(at)
			return target && at >= 0 ? normalizeFileBrowserPath(target.node.path) : undefined
		}
		const handled = (() => {
			switch (event.key) {
				case 'ArrowDown':
					focus(pathAt(index + 1))
					return true
				case 'ArrowUp':
					focus(pathAt(index - 1))
					return true
				case 'Home':
					focus(pathAt(0))
					return true
				case 'End':
					focus(pathAt(items.length - 1))
					return true
				case 'ArrowRight':
					if (row.node.kind !== 'folder') return true
					if (!row.expanded) toggle(path)
					else if (items[index + 1]?.parentPath === path) focus(pathAt(index + 1))
					return true
				case 'ArrowLeft':
					if (row.node.kind === 'folder' && row.expanded) toggle(path)
					else if (row.parentPath !== root) focus(row.parentPath)
					return true
				case 'Enter':
				case ' ':
					choose(row.node)
					return true
				case 'F2':
					if (actionsFor(row.node).includes('rename')) act('rename', row.node)
					return true
				case 'ContextMenu': {
					const box = event.currentTarget.getBoundingClientRect()
					openMenu(row.node, box.left + 24, box.bottom)
					return true
				}
				default:
					if (event.key === 'F10' && event.shiftKey) {
						const box = event.currentTarget.getBoundingClientRect()
						openMenu(row.node, box.left + 24, box.bottom)
						return true
					}
					return false
			}
		})()
		if (handled) event.preventDefault()
	}

	const rootState = folders.get(root)
	const rootActions = actionsFor(undefined)

	return (
		<div
			{...getFileBrowserDensityAttributes(density)}
			className={`flex min-w-0 flex-col text-[14px] text-[var(--fb-text)] [font-family:inherit] ${className}`}
		>
			{rootActions.length > 0 ? (
				<div className="mb-1 flex items-center gap-1 pr-1 pl-2">
					<span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--fb-muted)]">{rootLabel}</span>
					{rootActions.includes('upload') ? (
						<IconButton label="Upload" onClick={() => act('upload', undefined)}>
							<Upload aria-hidden className="size-4" />
						</IconButton>
					) : null}
					{rootActions.includes('new-folder') ? (
						<IconButton label="New folder" onClick={() => act('new-folder', undefined)}>
							<FolderPlus aria-hidden className="size-4" />
						</IconButton>
					) : null}
				</div>
			) : null}
			{actionError ? (
				<div className="mx-2 mb-1 text-[12px] text-[var(--fb-danger)]" role="alert">
					{actionError}
				</div>
			) : null}
			{uploadable ? (
				<input
					aria-hidden
					className="hidden"
					multiple
					onChange={(event) => {
						uploadTo(uploadFolder.current, Array.from(event.currentTarget.files ?? []))
						event.currentTarget.value = ''
					}}
					ref={fileInput}
					tabIndex={-1}
					type="file"
				/>
			) : null}
			<div
				aria-label={rootLabel}
				className={`flex min-h-16 min-w-0 flex-1 flex-col gap-px rounded-[calc(var(--fb-radius)-2px)] ${
					dropTarget === root ? 'bg-[var(--fb-accent-soft)]' : ''
				}`}
				role="tree"
				{...dropHandlers(root)}
			>
				{rootState?.status === 'error' ? (
					<FolderStatus level={0} message={rootState.message} onRetry={() => void load(root)} />
				) : rootState?.status === 'ready' && rootState.items.length === 0 && !draft ? (
					<div className="px-2 py-2 text-[13px] text-[var(--fb-muted)]">{emptyState}</div>
				) : !rootState || rootState.status === 'loading' ? (
					<FolderStatus level={0} />
				) : null}
				{rows.map((row) => {
					if (row.kind === 'draft') {
						return (
							<div
								className="flex min-h-[calc(var(--fb-control-h,32px)+6px)] items-center gap-2 pr-2"
								key="draft"
								role="none"
								style={{ paddingLeft: `${row.level * INDENT_PX + 30}px` }}
							>
								<Folder aria-hidden className="size-5 shrink-0 fill-[var(--fb-folder)] text-[var(--fb-folder)]" />
								<NameInput
									initial=""
									label="New folder name"
									onCancel={() => setDraft(undefined)}
									onSubmit={(value) => submitDraft(row.draft, value)}
								/>
							</div>
						)
					}
					if (row.kind === 'status') {
						return (
							<FolderStatus
								key={`status:${row.folderPath}`}
								level={row.level}
								message={row.state.status === 'error' ? row.state.message : undefined}
								onRetry={() => void load(row.folderPath)}
							/>
						)
					}
					const path = normalizeFileBrowserPath(row.node.path)
					const index = items.indexOf(row)
					const isFolder = row.node.kind === 'folder'
					const isSelected = path === selected
					const renaming = draft?.kind === 'rename' && normalizeFileBrowserPath(draft.node.path) === path
					const hasActions = actionsFor(row.node).length > 0
					return (
						<div
							aria-expanded={isFolder ? row.expanded : undefined}
							aria-level={row.level + 1}
							aria-selected={isSelected}
							className={`group flex min-h-[calc(var(--fb-control-h,32px)+6px)] cursor-default items-center gap-2 rounded-[calc(var(--fb-radius)-2px)] pr-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--fb-accent)] ${
								dropTarget === path
									? 'bg-[var(--fb-accent-soft)] ring-1 ring-inset ring-[var(--fb-accent)]'
									: isSelected
										? 'bg-[var(--fb-surface-2)] font-medium'
										: 'hover:bg-[var(--fb-surface-2)]'
							}`}
							key={path}
							{...dropHandlers(isFolder ? path : row.parentPath)}
							onClick={() => choose(row.node)}
							onContextMenu={(event) => {
								if (!hasActions) return
								event.preventDefault()
								openMenu(row.node, event.clientX, event.clientY)
							}}
							onFocus={() => setFocusedPath(path)}
							onKeyDown={(event) => onKeyDown(event, index)}
							ref={(element) => {
								if (element) rowRefs.current.set(path, element)
								else rowRefs.current.delete(path)
							}}
							role="treeitem"
							style={{ paddingLeft: `${row.level * INDENT_PX + 6}px` }}
							tabIndex={path === tabStop ? 0 : -1}
						>
							<ChevronRight
								aria-hidden
								className={`size-4 shrink-0 text-[var(--fb-muted)] transition-transform ${
									isFolder ? '' : 'invisible'
								} ${row.expanded ? 'rotate-90' : ''}`}
							/>
							{isFolder ? (
								<Folder aria-hidden className="size-5 shrink-0 fill-[var(--fb-folder)] text-[var(--fb-folder)]" />
							) : (
								<FileText aria-hidden className="size-5 shrink-0 text-[var(--fb-muted)]" strokeWidth={1.5} />
							)}
							{renaming && draft?.kind === 'rename' ? (
								<NameInput
									initial={row.node.name}
									label="New name"
									onCancel={() => setDraft(undefined)}
									onSubmit={(value) => submitDraft(draft, value)}
								/>
							) : (
								<span className="min-w-0 flex-1 truncate">{row.node.name}</span>
							)}
							{renderItemMeta?.(row.node)}
							{hasActions && !renaming ? (
								<button
									aria-label={`Actions for ${row.node.name}`}
									className={`grid size-7 shrink-0 place-items-center rounded-[calc(var(--fb-radius)-4px)] text-[var(--fb-muted)] hover:bg-[var(--fb-bg)] hover:text-[var(--fb-text)] [@media(hover:none)]:opacity-100 ${
										menu?.node.path === row.node.path
											? 'opacity-100'
											: 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
									}`}
									onClick={(event) => {
										event.stopPropagation()
										const box = event.currentTarget.getBoundingClientRect()
										openMenu(row.node, box.right, box.bottom + 4)
									}}
									tabIndex={-1}
									type="button"
								>
									<Ellipsis aria-hidden className="size-4" />
								</button>
							) : null}
						</div>
					)
				})}
			</div>
			{menu ? (
				<TreeMenu
					actions={actionsFor(menu.node)}
					label={`Actions for ${menu.node.name}`}
					onAction={(action) => act(action, menu.node)}
					onClose={() => {
						const path = normalizeFileBrowserPath(menu.node.path)
						setMenu(undefined)
						rowRefs.current.get(path)?.focus()
					}}
					x={menu.x}
					y={menu.y}
				/>
			) : null}
		</div>
	)
}

const ACTION_LABELS: Record<TreeAction, string> = {
	upload: 'Upload',
	'new-folder': 'New folder',
	download: 'Download',
	rename: 'Rename',
	delete: 'Delete'
}

function TreeMenu({
	actions,
	label,
	onAction,
	onClose,
	x,
	y
}: {
	actions: TreeAction[]
	label: string
	onAction: (action: TreeAction) => void
	onClose: () => void
	x: number
	y: number
}) {
	const ref = useRef<HTMLDivElement>(null)
	const [confirmDelete, setConfirmDelete] = useState(false)

	const close = useRef(onClose)
	close.current = onClose

	useEffect(() => {
		ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
		const dismiss = (event: PointerEvent) => {
			if (!(event.target instanceof Node && ref.current?.contains(event.target))) close.current()
		}
		document.addEventListener('pointerdown', dismiss)
		return () => document.removeEventListener('pointerdown', dismiss)
	}, [])

	return (
		<div
			aria-label={label}
			className="fixed z-[60] min-w-40 rounded-[calc(var(--fb-radius)-2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-1 text-[13px] text-[var(--fb-text)] shadow-[0_16px_44px_color-mix(in_oklch,var(--fb-text)_16%,transparent)]"
			onKeyDown={(event) => {
				if (event.key === 'Escape' || event.key === 'Tab') {
					event.preventDefault()
					onClose()
					return
				}
				if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
				event.preventDefault()
				const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
				const index = buttons.findIndex((button) => button === document.activeElement)
				buttons.at((index + (event.key === 'ArrowDown' ? 1 : -1)) % buttons.length)?.focus()
			}}
			ref={ref}
			role="menu"
			style={{ left: Math.min(x, window.innerWidth - 176), top: Math.min(y, window.innerHeight - 200) }}
		>
			{actions.map((action) => (
				<button
					className={`flex min-h-[var(--fb-control-h,32px)] w-full items-center rounded-[calc(var(--fb-radius)-4px)] px-2 text-left font-medium outline-none hover:bg-[var(--fb-bg)] focus:bg-[var(--fb-bg)] ${
						action === 'delete' ? 'text-[var(--fb-danger)]' : ''
					}`}
					key={action}
					onClick={() => {
						// Delete asks once more in place, since the tree has no undo.
						if (action === 'delete' && !confirmDelete) setConfirmDelete(true)
						else onAction(action)
					}}
					role="menuitem"
					type="button"
				>
					{action === 'delete' && confirmDelete ? 'Click again to delete' : ACTION_LABELS[action]}
				</button>
			))}
		</div>
	)
}

function NameInput({
	initial,
	label,
	onSubmit,
	onCancel
}: {
	initial: string
	label: string
	onSubmit: (value: string) => void
	onCancel: () => void
}) {
	const done = useRef(false)
	function finish(value: string | undefined) {
		if (done.current) return
		done.current = true
		if (value === undefined) onCancel()
		else onSubmit(value)
	}
	return (
		<input
			aria-label={label}
			// oxlint-disable-next-line jsx-a11y/no-autofocus -- the field appears because the user asked to name something
			autoFocus
			className="h-7 min-w-0 flex-1 rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-accent)] bg-[var(--fb-surface)] px-1.5 text-[14px] outline-none"
			defaultValue={initial}
			onBlur={(event) => finish(event.currentTarget.value)}
			onClick={(event) => event.stopPropagation()}
			onFocus={(event) => {
				const dot = initial.lastIndexOf('.')
				event.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length)
			}}
			onKeyDown={(event) => {
				event.stopPropagation()
				if (event.key === 'Enter') finish(event.currentTarget.value)
				else if (event.key === 'Escape') finish(undefined)
			}}
		/>
	)
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
	return (
		<button
			aria-label={label}
			className="grid size-7 place-items-center rounded-[calc(var(--fb-radius)-4px)] text-[var(--fb-muted)] transition-colors hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)]"
			onClick={onClick}
			title={label}
			type="button"
		>
			{children}
		</button>
	)
}

function FolderStatus({ level, message, onRetry }: { level: number; message?: string; onRetry?: () => void }) {
	return (
		<div
			className="flex min-h-[calc(var(--fb-control-h,32px)+6px)] items-center gap-2 pr-2 text-[13px] text-[var(--fb-muted)]"
			role="none"
			style={{ paddingLeft: `${level * INDENT_PX + 34}px` }}
		>
			{message === undefined ? (
				<span aria-live="polite">Loading…</span>
			) : (
				<>
					<span className="min-w-0 truncate text-[var(--fb-danger)]" role="alert">
						{message}
					</span>
					<button
						aria-label="Retry"
						className="rounded p-1 hover:bg-[var(--fb-surface-2)]"
						onClick={onRetry}
						type="button"
					>
						<RotateCw aria-hidden className="size-3.5" />
					</button>
				</>
			)}
		</div>
	)
}
