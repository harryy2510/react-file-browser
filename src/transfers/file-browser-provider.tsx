import { ChevronDown, ChevronUp, Download, Pause, Play, X } from 'lucide-react'
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsWithChildren } from 'react'
import { createPortal } from 'react-dom'
import { TransferManager } from './transfer-manager'
import { ResponsiveDialog, useNarrowViewport } from '../components/responsive'
import type {
	BulkDownloadJob,
	ResumeRestoredUploadInput,
	TransferManagerOptions,
	TransferSnapshot,
	UploadTransfer,
	UploadTransferGroup
} from './transfer-manager'

const TransferContext = createContext<TransferManager | null>(null)
const WIDGET_CONTROL_MOTION =
	'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out motion-reduce:transition-none'
const WIDGET_SURFACE_MOTION =
	'transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none'
const WIDGET_TOUCH_CONTROL =
	'min-h-[calc(var(--fb-gap)*11)] min-w-[calc(var(--fb-gap)*11)] shrink-0 whitespace-nowrap sm:min-h-7 sm:min-w-7 [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] [@media(pointer:coarse)]:min-w-[calc(var(--fb-gap)*11)]'

export type FileBrowserProviderProps = PropsWithChildren<{
	manager?: TransferManager
	options?: TransferManagerOptions
	resolveRestoredUpload?: (
		upload: UploadTransfer
	) => Omit<ResumeRestoredUploadInput, 'id'> | Promise<Omit<ResumeRestoredUploadInput, 'id'> | undefined> | undefined
	showFloatingWidget?: boolean
}>

export function FileBrowserProvider({
	children,
	manager,
	options,
	resolveRestoredUpload,
	showFloatingWidget = true
}: FileBrowserProviderProps) {
	const [providerManager] = useState(() => manager ?? new TransferManager(withDefaultStorage(options)))
	const transferManager = manager ?? providerManager
	const snapshot = useTransfersSnapshot(transferManager)
	const [resumePromptDismissed, setResumePromptDismissed] = useState(false)
	const restorableUploads = transferManager.getRestorableUploads()

	useBeforeUnloadGuard(transferManager)

	async function resumeRestoredUploads(uploads: UploadTransfer[]) {
		for (const upload of uploads) {
			if (upload.adapter && upload.file) {
				await transferManager.resumeUpload(upload.id)
				continue
			}

			const resolved = await resolveRestoredUpload?.(upload)
			if (resolved) {
				await transferManager.resumeRestoredUpload({
					id: upload.id,
					...resolved
				})
			}
		}
		setResumePromptDismissed(true)
	}

	return (
		<TransferContext.Provider value={transferManager}>
			{children}
			{showFloatingWidget ? <FloatingTransferWidget manager={transferManager} snapshot={snapshot} /> : null}
			{!resumePromptDismissed && restorableUploads.length > 0 ? (
				<ResumeUploadsPrompt
					count={restorableUploads.length}
					onDismiss={() => {
						transferManager.dismissRestoredUploads(restorableUploads.map((upload) => upload.id))
						setResumePromptDismissed(true)
					}}
					onResume={() => {
						void resumeRestoredUploads(restorableUploads)
					}}
				/>
			) : null}
		</TransferContext.Provider>
	)
}

export function useTransfers(): TransferManager {
	const manager = useContext(TransferContext)
	return manager ?? fallbackTransferManager
}

export function useTransferSnapshot(): TransferSnapshot {
	return useTransfersSnapshot(useTransfers())
}

function useTransfersSnapshot(manager: TransferManager): TransferSnapshot {
	return useSyncExternalStore(
		(listener) => manager.subscribe(listener),
		() => manager.getSnapshot(),
		() => ({ uploads: [], downloads: [] })
	)
}

function useBeforeUnloadGuard(manager: TransferManager): void {
	useEffect(() => {
		const listener = (event: BeforeUnloadEvent) => {
			if (!manager.hasActiveTransfers()) {
				return
			}
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', listener)
		return () => window.removeEventListener('beforeunload', listener)
	}, [manager])
}

function withDefaultStorage(options: TransferManagerOptions | undefined): TransferManagerOptions {
	if (options?.storage !== undefined) {
		return options
	}

	const storage = typeof window === 'undefined' ? undefined : window.localStorage
	if (!storage) {
		return options ?? {}
	}

	return {
		...options,
		storage
	}
}

function FloatingTransferWidget({ manager, snapshot }: { manager: TransferManager; snapshot: TransferSnapshot }) {
	const narrow = useNarrowViewport()
	const [expanded, setExpanded] = useState<boolean | null>(null)
	const isExpanded = expanded ?? !narrow
	const activeUploads = snapshot.uploads.filter(isVisibleUpload)
	const uploadGroups = getActiveUploadGroups(snapshot.uploads)
	const groupedUploadIds = new Set(uploadGroups.flatMap((group) => group.activeUploads.map((upload) => upload.id)))
	const standaloneUploads = activeUploads.filter((upload) => !groupedUploadIds.has(upload.id))
	const downloads = snapshot.downloads.filter((download) =>
		['preparing', 'warning', 'ready', 'failed'].includes(download.status)
	)

	if (activeUploads.length === 0 && downloads.length === 0) {
		return null
	}

	const content = (
		<aside
			aria-label="Transfers"
			className={`fixed bottom-[calc(env(safe-area-inset-bottom)+var(--fb-gap)*28)] right-[max(calc(var(--fb-gap)*3),env(safe-area-inset-right))] z-50 flex max-h-[50dvh] max-w-[calc(100%-var(--fb-gap)*6)] flex-col rounded-[calc(var(--fb-radius)+2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-4 py-3.5 text-[13px] text-[var(--fb-text)] shadow-[0_12px_32px_color-mix(in_oklch,var(--fb-text)_12%,transparent)] sm:bottom-[calc(env(safe-area-inset-bottom)+var(--fb-gap)*5)] sm:right-[max(calc(var(--fb-gap)*5),env(safe-area-inset-right))] ${isExpanded ? 'w-[320px]' : 'w-auto'} ${WIDGET_SURFACE_MOTION}`}
		>
			<div className="flex shrink-0 items-center justify-between gap-2">
				<div className="font-bold">Transfers</div>
				<div className="ml-auto text-[12px] text-[var(--fb-muted)]">
					{activeUploads.length + downloads.length} active
				</div>
				<button
					aria-expanded={isExpanded}
					aria-label={isExpanded ? 'Collapse transfers' : 'Expand transfers'}
					className={widgetIconButton()}
					onClick={() => setExpanded(!isExpanded)}
					type="button"
				>
					{isExpanded ? (
						<ChevronDown aria-hidden="true" className="size-4" />
					) : (
						<ChevronUp aria-hidden="true" className="size-4" />
					)}
				</button>
			</div>
			{isExpanded ? (
				<div className="mt-2.5 flex min-h-0 min-w-0 flex-col gap-3.5 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]">
					{uploadGroups.map((group) => (
						<UploadGroupCard group={group} key={group.group.id} manager={manager} />
					))}
					{standaloneUploads.map((upload) => (
						<UploadTransferRow key={upload.id} manager={manager} upload={upload} />
					))}
					{downloads.map((download) => (
						<div className="text-[12px] text-[var(--fb-muted)]" key={download.id}>
							{download.status === 'ready' && download.url ? (
								<div className="flex items-center justify-between gap-2 rounded-[var(--fb-radius)] bg-[var(--fb-ok-soft)] py-1 pl-1 pr-1.5">
									<a
										aria-label="Open prepared download"
										className={`inline-flex min-h-[calc(var(--fb-gap)*11)] min-w-0 items-center gap-1.5 rounded-[calc(var(--fb-radius)-2px)] px-2 py-1 font-semibold text-[color-mix(in_oklch,var(--fb-ok)_85%,var(--fb-text))] hover:bg-[color-mix(in_oklch,var(--fb-ok-soft)_60%,var(--fb-surface))] sm:min-h-8 [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${WIDGET_CONTROL_MOTION}`}
										download
										href={download.url}
										onClick={() => manager.dismissDownload(download.id)}
									>
										<Download aria-hidden="true" className="size-3.5 shrink-0" />
										<span className="truncate">{formatDownloadReadyLabel(download)}</span>
									</a>
									<button
										aria-label="Dismiss download"
										className={widgetIconButton()}
										onClick={() => manager.dismissDownload(download.id)}
										type="button"
									>
										<X aria-hidden="true" className="size-3.5" />
									</button>
								</div>
							) : null}
							{download.status === 'warning' ? (
								<div className="flex items-center justify-between gap-2">
									<span>Large client zip</span>
									<button
										className={widgetTextButton()}
										onClick={() => void manager.confirmBulkDownload(download.id)}
										type="button"
									>
										Continue
									</button>
								</div>
							) : null}
							{download.status === 'preparing' ? (
								<div className="flex flex-col gap-1.5">
									<span className="font-semibold text-[var(--fb-text)]">Preparing zip</span>
									<span className="relative h-1.5 overflow-hidden rounded-full bg-[var(--fb-surface-2)]">
										<span className="absolute inset-y-0 left-[20%] w-[30%] animate-pulse rounded-full bg-[var(--fb-accent)] motion-reduce:animate-none" />
									</span>
								</div>
							) : null}
							{download.status === 'failed' ? (
								<span className="text-[var(--fb-danger)]">{download.error ?? 'Download failed'}</span>
							) : null}
						</div>
					))}
				</div>
			) : null}
		</aside>
	)

	return createPortal(content, document.body)
}

type ActiveUploadGroup = {
	group: UploadTransferGroup
	uploads: UploadTransfer[]
	activeUploads: UploadTransfer[]
	completedCount: number
}

function UploadGroupCard({ group, manager }: { group: ActiveUploadGroup; manager: TransferManager }) {
	return (
		<div className={WIDGET_SURFACE_MOTION}>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate font-semibold">Uploading {group.group.name}</div>
					<div className="text-[12px] text-[var(--fb-muted)]">{formatUploadGroupSummary(group)}</div>
				</div>
				<button
					aria-label={`Cancel upload group ${group.group.name}`}
					className={widgetIconButton()}
					onClick={() => {
						for (const upload of group.activeUploads) {
							void manager.cancelUpload(upload.id)
						}
					}}
					title="Cancel"
					type="button"
				>
					<X aria-hidden="true" className="size-3.5" />
				</button>
			</div>
			<div
				className={`mt-2.5 flex flex-col gap-2.5 border-l-2 border-[var(--fb-border)] pl-3 ${WIDGET_SURFACE_MOTION}`}
			>
				{group.activeUploads.map((upload) => (
					<UploadTransferRow compact key={upload.id} manager={manager} upload={upload} />
				))}
			</div>
		</div>
	)
}

function UploadTransferRow({
	compact = false,
	manager,
	upload
}: {
	compact?: boolean
	manager: TransferManager
	upload: UploadTransfer
}) {
	return (
		<div className={WIDGET_SURFACE_MOTION}>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<span className="block truncate font-semibold">{upload.name}</span>
					<span className="text-[12px] text-[var(--fb-muted)]">{formatUploadStatus(upload)}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{['queued', 'uploading'].includes(upload.status) ? (
						<button
							aria-label={`Pause upload ${upload.name}`}
							className={widgetIconButton()}
							onClick={() => manager.pauseUpload(upload.id)}
							title="Pause"
							type="button"
						>
							<Pause aria-hidden="true" className="size-3.5" />
						</button>
					) : null}
					{['failed', 'paused'].includes(upload.status) ? (
						<button
							aria-label={`Resume upload ${upload.name}`}
							className={widgetIconButton()}
							onClick={() => void manager.resumeUpload(upload.id)}
							title="Resume"
							type="button"
						>
							<Play aria-hidden="true" className="size-3.5" />
						</button>
					) : null}
					<button
						aria-label={`Cancel upload ${upload.name}`}
						className={widgetIconButton()}
						onClick={() => void manager.cancelUpload(upload.id)}
						title="Cancel"
						type="button"
					>
						<X aria-hidden="true" className="size-3.5" />
					</button>
				</div>
			</div>
			<div
				className={`h-1.5 overflow-hidden rounded-full bg-[var(--fb-surface-2)] ${WIDGET_SURFACE_MOTION} ${
					compact ? 'mt-1' : 'mt-1.5'
				}`}
			>
				<div
					className="h-full rounded-full bg-[var(--fb-accent)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
					style={{
						width: `${Math.min(100, upload.totalBytes ? (upload.loadedBytes / upload.totalBytes) * 100 : 0)}%`
					}}
				/>
			</div>
		</div>
	)
}

function ResumeUploadsPrompt({
	count,
	onDismiss,
	onResume
}: {
	count: number
	onDismiss: () => void
	onResume: () => void
}) {
	const narrow = useNarrowViewport()
	return createPortal(
		<ResponsiveDialog label="Resume uploads" narrow={narrow} onClose={onDismiss}>
			<div
				className={`w-[min(400px,100%)] rounded-[calc(var(--fb-radius)+6px)] bg-[var(--fb-surface)] p-6 shadow-[0_24px_60px_color-mix(in_oklch,var(--fb-text)_28%,transparent)] ${WIDGET_SURFACE_MOTION}`}
			>
				<h2 className="m-0 text-[17px] font-bold">Resume uploads</h2>
				<p className="mt-2 text-[14px] leading-relaxed text-[var(--fb-muted)]">
					Resume {count} upload{count === 1 ? '?' : 's?'}
				</p>
				<div className="mt-6 flex flex-wrap justify-end gap-2">
					<button className={widgetTextButton()} onClick={onDismiss} type="button">
						Dismiss
					</button>
					<button className={widgetPrimaryButton()} onClick={onResume} type="button">
						Resume uploads
					</button>
				</div>
			</div>
		</ResponsiveDialog>,
		document.body
	)
}

const fallbackTransferManager = new TransferManager()

function widgetIconButton() {
	return `grid size-8 place-items-center rounded-[calc(var(--fb-radius)-2px)] border border-transparent bg-transparent text-[var(--fb-muted)] outline-none hover:bg-[var(--fb-surface-2)] hover:text-[var(--fb-text)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)] ${WIDGET_TOUCH_CONTROL} ${WIDGET_CONTROL_MOTION}`
}

function widgetTextButton() {
	return `inline-flex h-9 items-center justify-center rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-3.5 text-[13px] font-semibold text-[var(--fb-text)] outline-none hover:bg-[var(--fb-surface-2)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)] ${WIDGET_TOUCH_CONTROL} ${WIDGET_CONTROL_MOTION}`
}

function widgetPrimaryButton() {
	return `inline-flex h-9 items-center justify-center rounded-[var(--fb-radius)] border border-transparent bg-[var(--fb-accent)] px-3.5 text-[13px] font-semibold text-[var(--fb-surface)] outline-none hover:bg-[color-mix(in_oklch,var(--fb-accent)_88%,var(--fb-text))] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)] ${WIDGET_TOUCH_CONTROL} ${WIDGET_CONTROL_MOTION}`
}

function isVisibleUpload(upload: UploadTransfer): boolean {
	return ['queued', 'uploading', 'failed', 'paused'].includes(upload.status)
}

function getActiveUploadGroups(uploads: UploadTransfer[]): ActiveUploadGroup[] {
	const groups = new Map<string, ActiveUploadGroup>()

	for (const upload of uploads) {
		if (!upload.group) {
			continue
		}

		const existing = groups.get(upload.group.id) ?? {
			group: upload.group,
			uploads: [],
			activeUploads: [],
			completedCount: 0
		}
		existing.uploads.push(upload)
		if (upload.status === 'completed') {
			existing.completedCount += 1
		}
		if (isVisibleUpload(upload)) {
			existing.activeUploads.push(upload)
		}
		groups.set(upload.group.id, existing)
	}

	return Array.from(groups.values()).filter((group) => group.activeUploads.length > 0)
}

function formatUploadGroupSummary(group: ActiveUploadGroup): string {
	const folders = group.group.createdFolders
	const files = `${group.completedCount} of ${group.group.totalFiles} files`
	if (folders <= 0) {
		return files
	}

	return `${files}, ${folders} folder${folders === 1 ? '' : 's'} created`
}

function formatUploadStatus(upload: UploadTransfer): string {
	if (
		upload.status !== 'uploading' ||
		typeof upload.bytesPerSecond !== 'number' ||
		!Number.isFinite(upload.bytesPerSecond) ||
		upload.bytesPerSecond <= 0
	) {
		return upload.status
	}

	return `${upload.status}, ${formatTransferBytes(upload.bytesPerSecond)}/s`
}

function formatTransferBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	let value = Math.max(0, bytes)
	let unitIndex = 0

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024
		unitIndex += 1
	}

	const formatted = unitIndex === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1)
	return `${formatted} ${units[unitIndex]}`
}

function formatDownloadReadyLabel(download: BulkDownloadJob): string {
	const expiresIn = download.expiresAt ? formatExpiresIn(download.expiresAt) : undefined

	return expiresIn ? `Download ready, expires in ${expiresIn}` : 'Download ready'
}

function formatExpiresIn(expiresAt: string): string | undefined {
	const remainingMs = Date.parse(expiresAt) - Date.now()
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
		return undefined
	}

	if (remainingMs < 60 * 60 * 1000) {
		return `${Math.ceil(remainingMs / (60 * 1000))}m`
	}

	if (remainingMs < 24 * 60 * 60 * 1000) {
		return `${Math.ceil(remainingMs / (60 * 60 * 1000))}h`
	}

	return `${Math.ceil(remainingMs / (24 * 60 * 60 * 1000))}d`
}
