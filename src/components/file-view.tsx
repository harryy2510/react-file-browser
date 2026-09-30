import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { FileBrowserAdapter, FileNode } from '../core/types'
import { DEFAULT_EDITABLE_BYTES, DEFAULT_TEXT_PREVIEW_BYTES, fetchFileContent } from './file-plugins'
import type { FileBrowserEditor, FileBrowserFileContent, FileBrowserPreviewer } from './file-plugins'
import { formatBytes, getFileIcon, getFileTypeLabel } from './file-types'

type Phase = { type: 'loading' } | { type: 'ready' } | { type: 'saving' } | { type: 'conflict' }

const FOCUS =
	'outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)]'
const BUTTON = `inline-flex h-[var(--fb-bar-control-h,30px)] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--fb-radius)-2px)] border px-3 text-[calc(var(--fb-font)-1px)] font-semibold disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${FOCUS}`
const SECONDARY = `${BUTTON} border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-surface-2)]`
const PRIMARY = `${BUTTON} border-transparent bg-[var(--fb-accent)] text-[var(--fb-surface)] hover:bg-[color-mix(in_oklch,var(--fb-accent)_88%,var(--fb-text))]`
const DANGER = `${BUTTON} border-transparent bg-[var(--fb-danger)] text-[var(--fb-surface)]`
const ICON_BUTTON = `grid size-[var(--fb-bar-control-h,30px)] shrink-0 place-items-center rounded-[calc(var(--fb-radius)-2px)] text-[var(--fb-muted)] hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)] disabled:opacity-40 [@media(pointer:coarse)]:size-[calc(var(--fb-gap)*11)] ${FOCUS}`

/**
 * A file opened inside the browser: preview first, with an Edit switch when an editor matches.
 * Leaving (back, breadcrumb, previous/next, Escape) goes through the unsaved-changes guard.
 */
export function FileView<TMetadata>({
	adapter,
	breadcrumbs,
	editor,
	initialMode,
	item,
	onClose,
	onDownload,
	onNavigate,
	onSaved,
	onStep,
	position,
	previewer
}: {
	adapter: FileBrowserAdapter<TMetadata>
	breadcrumbs: (navigate: (path: string) => void) => ReactNode
	editor?: FileBrowserEditor<TMetadata>
	initialMode: 'preview' | 'edit'
	item: FileNode<TMetadata>
	onClose: () => void
	onDownload?: () => void
	onNavigate: (path: string) => void
	onSaved: (node: FileNode<TMetadata>) => void
	onStep?: (direction: -1 | 1) => void
	position?: { index: number; total: number }
	previewer?: FileBrowserPreviewer<TMetadata>
}) {
	const read = editor ? (editor.read ?? 'text') : previewer?.read
	const readLimit = editor
		? (editor.maxBytes ?? DEFAULT_EDITABLE_BYTES)
		: (previewer?.maxBytes ?? DEFAULT_TEXT_PREVIEW_BYTES)
	const maxBytes = editor?.maxBytes ?? DEFAULT_EDITABLE_BYTES
	const [mode, setMode] = useState<'preview' | 'edit'>(editor ? initialMode : 'preview')
	const [phase, setPhase] = useState<Phase>({ type: 'loading' })
	const [error, setError] = useState<string | null>(null)
	const [url, setUrl] = useState('')
	const [content, setContent] = useState<FileBrowserFileContent | null>(null)
	const [edited, setEdited] = useState<string | Blob | null>(null)
	const [revision, setRevision] = useState(0)
	const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
	const baselineRef = useRef<FileNode<TMetadata>>(item)
	const rootRef = useRef<HTMLElement>(null)
	// Hosts often pass plugin arrays inline; read the latest values without reloading on every render.
	const latestRef = useRef({ adapter, hasEditor: Boolean(editor), item, read, readLimit })
	latestRef.current = { adapter, hasEditor: Boolean(editor), item, read, readLimit }
	const dirty = edited !== null
	const bytes = edited !== null ? byteLength(edited) : content !== null ? byteLength(content) : (item.size ?? 0)
	const tooLong = Boolean(editor) && bytes > maxBytes
	const invalid = typeof edited === 'string' && editor?.validate ? editor.validate(edited) : null
	const blocked = tooLong || invalid !== null

	const load = useCallback(async () => {
		const { adapter, hasEditor, item, read, readLimit } = latestRef.current
		setPhase({ type: 'loading' })
		setError(null)
		try {
			const latest = hasEditor && adapter.stat ? await adapter.stat(item.path) : item
			const signed = await adapter.signedUrl(item.path)
			baselineRef.current = latest
			setUrl(signed)
			setContent(read && (item.size ?? 0) <= readLimit ? await fetchFileContent(signed, read) : null)
		} catch (caught) {
			setError(toMessage(caught))
		}
		setEdited(null)
		// Remount the editing surface so it starts from the loaded content.
		setRevision((current) => current + 1)
		setPhase({ type: 'ready' })
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	// Take focus on open so Escape and Cmd/Ctrl+S reach the view even though the clicked row is gone.
	useEffect(() => {
		rootRef.current?.focus({ preventScroll: true })
	}, [])

	const write = useCallback(async () => {
		if (edited === null) return
		setPhase({ type: 'saving' })
		try {
			const file = new File([edited], item.name, {
				type: item.mimeType ?? (typeof edited === 'string' ? 'text/plain' : edited.type)
			})
			const saved = await adapter.upload(item.path, file, { onConflict: 'replace' })
			baselineRef.current = saved
			setContent(typeof edited === 'string' ? edited : await edited.arrayBuffer())
			setEdited(null)
			setPhase({ type: 'ready' })
			onSaved(saved)
		} catch (caught) {
			setError(toMessage(caught))
			setPhase({ type: 'ready' })
		}
	}, [adapter, edited, item, onSaved])

	const save = useCallback(async () => {
		if (blocked || !dirty || phase.type !== 'ready') return
		if (adapter.stat) {
			setPhase({ type: 'saving' })
			try {
				if (hasChanged(baselineRef.current, await adapter.stat(item.path))) {
					setPhase({ type: 'conflict' })
					return
				}
			} catch {
				// A failing stat should not block saving; the upload reports real failures.
			}
		}
		await write()
	}, [adapter, blocked, dirty, item.path, phase.type, write])

	const guard = (action: () => void) => {
		if (dirty) setPendingLeave(() => action)
		else action()
	}
	const discardEdits = () => {
		setEdited(null)
		setRevision((current) => current + 1)
		setMode('preview')
	}

	const Editor = editor?.component
	const Preview = previewer?.component
	const Icon = getFileIcon(item)
	const text = typeof edited === 'string' ? edited : typeof content === 'string' ? content : ''
	const previewContent = typeof edited === 'string' ? edited : content

	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape and Cmd/Ctrl+S apply anywhere in the open file.
		<section
			aria-label={item.name}
			className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
			data-fb-file-view={mode}
			ref={rootRef}
			tabIndex={-1}
			onKeyDown={(event) => {
				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && mode === 'edit') {
					event.preventDefault()
					void save()
				}
				if (event.key === 'Escape' && !event.defaultPrevented) {
					event.preventDefault()
					guard(onClose)
				}
			}}
		>
			<header className="flex min-h-[var(--fb-header-h,52px)] min-w-0 items-center gap-2 border-b border-[var(--fb-border)] px-[var(--fb-pad)] py-2">
				<button aria-label="Back to folder" className={ICON_BUTTON} onClick={() => guard(onClose)} type="button">
					<ChevronLeft aria-hidden="true" className="size-4" />
				</button>
				<div className="min-w-0 flex-1">{breadcrumbs((path) => guard(() => onNavigate(path)))}</div>
				{onStep && position && position.total > 1 ? (
					<span className="flex shrink-0 items-center gap-1 text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
						<button
							aria-label="Previous file"
							className={ICON_BUTTON}
							onClick={() => guard(() => onStep(-1))}
							type="button"
						>
							<ChevronLeft aria-hidden="true" className="size-4" />
						</button>
						{position.index} of {position.total}
						<button aria-label="Next file" className={ICON_BUTTON} onClick={() => guard(() => onStep(1))} type="button">
							<ChevronRight aria-hidden="true" className="size-4" />
						</button>
					</span>
				) : null}
			</header>

			<div className="flex min-w-0 items-center gap-3 border-b border-[var(--fb-border)] px-[var(--fb-pad)] py-2.5">
				<span
					aria-hidden="true"
					className="grid size-8 shrink-0 place-items-center rounded-[calc(var(--fb-radius)-2px)] bg-[var(--fb-accent-soft)] text-[var(--fb-text)]"
				>
					<Icon className="size-4" strokeWidth={1.75} />
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<h2 className="m-0 truncate text-[var(--fb-font)] font-semibold">{item.name}</h2>
					<span className="truncate text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
						{getFileTypeLabel(item)} · {formatBytes(item.size ?? 0)}
					</span>
				</div>
				{editor ? (
					<div
						aria-label="View mode"
						className="flex shrink-0 overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)]"
						role="group"
					>
						{(['preview', 'edit'] as const).map((option) => (
							<button
								aria-pressed={mode === option}
								className={`h-[var(--fb-bar-control-h,30px)] px-3 text-[calc(var(--fb-font)-1px)] font-semibold [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${FOCUS} ${
									mode === option
										? 'bg-[var(--fb-surface-2)] text-[var(--fb-text)]'
										: 'text-[var(--fb-muted)] hover:text-[var(--fb-text)]'
								}`}
								key={option}
								onClick={() => setMode(option)}
								type="button"
							>
								{option === 'edit' ? 'Edit' : 'Preview'}
							</button>
						))}
					</div>
				) : null}
			</div>

			{phase.type === 'conflict' ? (
				<Banner tone="danger">
					<span className="min-w-0 flex-1">
						<strong>This file changed since you opened it.</strong> Reload to get the latest version, or keep yours and
						overwrite those changes.
					</span>
					<button className={SECONDARY} onClick={() => void load()} type="button">
						Reload
					</button>
					<button className={DANGER} onClick={() => void write()} type="button">
						Keep my version
					</button>
				</Banner>
			) : null}
			{pendingLeave ? (
				<Banner tone="neutral">
					<span className="min-w-0 flex-1 font-semibold">Discard unsaved changes?</span>
					<button className={SECONDARY} onClick={() => setPendingLeave(null)} type="button">
						Keep editing
					</button>
					<button
						className={DANGER}
						onClick={() => {
							const action = pendingLeave
							setPendingLeave(null)
							setEdited(null)
							action()
						}}
						type="button"
					>
						Discard
					</button>
				</Banner>
			) : null}
			{error ? (
				<Banner tone="danger">
					<span className="min-w-0 flex-1">{error}</span>
					<button className={SECONDARY} onClick={() => void load()} type="button">
						Try again
					</button>
				</Banner>
			) : null}

			<div className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--fb-bg)] p-[var(--fb-pad)]">
				{phase.type === 'loading' ? (
					<p className="m-0 text-[var(--fb-muted)]" role="status">
						Loading…
					</p>
				) : mode === 'edit' && editor ? (
					Editor ? (
						<Editor
							content={content ?? ''}
							item={item}
							key={revision}
							onChange={setEdited}
							onSave={() => void save()}
						/>
					) : (
						<textarea
							aria-label={`${item.name} contents`}
							className="block h-full min-h-[min(420px,55dvh)] w-full min-w-0 resize-y rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 font-mono text-[calc(var(--fb-font)-1px)] leading-relaxed text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)] [@media(pointer:coarse)]:text-[16px]"
							onChange={(event) => setEdited(event.target.value)}
							spellCheck={false}
							value={text}
						/>
					)
				) : Preview && url && (!previewer?.read || previewContent !== null) ? (
					<div className="flex min-w-0 justify-center">
						<Preview content={previewContent} item={item} url={url} />
					</div>
				) : (
					<div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
						<span
							aria-hidden="true"
							className="grid size-16 place-items-center rounded-[var(--fb-radius)] bg-[var(--fb-surface-2)] text-[var(--fb-muted)]"
						>
							<Icon className="size-8" strokeWidth={1.5} />
						</span>
						<div className="font-semibold">No preview for this file</div>
						<div className="text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
							Download it to open it on your device.
						</div>
					</div>
				)}
			</div>

			<footer className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 border-t border-[var(--fb-border)] px-[var(--fb-pad)] py-2 text-[var(--fb-font-sm)] text-[var(--fb-muted)]">
				{mode === 'edit' && editor ? (
					<>
						<span aria-live="polite" className={tooLong ? 'font-semibold text-[var(--fb-danger)]' : ''}>
							{formatBytes(bytes)} of {formatBytes(maxBytes)}
							{dirty ? ' · Unsaved changes' : ''}
						</span>
						{/* Save blockers sit in the footer so they never push the editor down while typing. */}
						{invalid || tooLong ? (
							<span className="min-w-0 truncate font-semibold text-[var(--fb-danger)]" role="alert">
								{invalid ?? `Too long. Shorten it to ${formatBytes(maxBytes)} or less to save.`}
							</span>
						) : null}
						<span aria-hidden="true" className="mr-auto" />
						{editor.saveWarning && dirty ? (
							<span className="flex items-center gap-1.5">
								<TriangleAlert aria-hidden="true" className="size-3.5 text-[var(--fb-danger)]" />
								{editor.saveWarning}
							</span>
						) : null}
						<button className={SECONDARY} onClick={() => guard(discardEdits)} type="button">
							Cancel
						</button>
						<button
							className={PRIMARY}
							disabled={phase.type !== 'ready' || blocked || !dirty}
							onClick={() => void save()}
							type="button"
						>
							<Check aria-hidden="true" className="size-3.5" />
							{phase.type === 'saving' ? 'Saving…' : 'Save'}
						</button>
					</>
				) : (
					<>
						<span className="mr-auto">
							{item.modifiedAt ? `Modified ${new Date(item.modifiedAt).toLocaleString()}` : ''}
						</span>
						{url ? (
							<a
								aria-label={`Open original ${item.name}`}
								className={`${SECONDARY} no-underline`}
								href={url}
								rel="noreferrer"
								target="_blank"
							>
								<ExternalLink aria-hidden="true" className="size-3.5" />
								Open original
							</a>
						) : null}
						{onDownload ? (
							<button aria-label={`Download ${item.name}`} className={PRIMARY} onClick={onDownload} type="button">
								<Download aria-hidden="true" className="size-3.5" />
								Download
							</button>
						) : null}
					</>
				)}
			</footer>
		</section>
	)
}

function Banner({ children, tone }: { children: ReactNode; tone: 'danger' | 'neutral' }) {
	return (
		<div
			className={`flex flex-wrap items-center gap-3 border-b border-[var(--fb-border)] px-[var(--fb-pad)] py-2.5 ${
				tone === 'danger' ? 'bg-[var(--fb-danger-soft)] text-[var(--fb-text)]' : 'bg-[var(--fb-surface-2)]'
			}`}
			role="alert"
		>
			{children}
		</div>
	)
}

function byteLength(value: FileBrowserFileContent | Blob) {
	if (typeof value === 'string') return new TextEncoder().encode(value).length
	return value instanceof Blob ? value.size : value.byteLength
}

function hasChanged(before: FileNode<unknown>, after: FileNode<unknown>) {
	if (before.etag && after.etag) return before.etag !== after.etag
	if (before.modifiedAt && after.modifiedAt) return before.modifiedAt !== after.modifiedAt
	return false
}

function toMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
