import { Download, Pause, Play, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsWithChildren } from 'react'
import { createPortal } from 'react-dom'
import { TransferManager } from './transfer-manager'
import type {
	BulkDownloadJob,
	ResumeRestoredUploadInput,
	TransferManagerOptions,
	TransferSnapshot,
	UploadTransfer,
	UploadTransferGroup
} from './transfer-manager'

const TransferContext = createContext<TransferManager | null>(null)

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
	const transferManager = useMemo(() => manager ?? new TransferManager(withDefaultStorage(options)), [manager, options])
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
	if (options?.storage) {
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
			className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-3 text-[12px] text-[var(--fb-text)] shadow-[0_16px_44px_color-mix(in_oklch,var(--fb-text)_16%,transparent)]"
		>
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="font-semibold">Transfers</div>
				<div className="text-[11px] text-[var(--fb-muted)]">{activeUploads.length + downloads.length} active</div>
			</div>
			<div className="flex flex-col gap-2">
				{uploadGroups.map((group) => (
					<UploadGroupCard group={group} key={group.group.id} manager={manager} />
				))}
				{standaloneUploads.map((upload) => (
					<UploadTransferRow key={upload.id} manager={manager} upload={upload} />
				))}
				{downloads.map((download) => (
					<div className="text-[11px] text-[var(--fb-muted)]" key={download.id}>
						{download.status === 'ready' && download.url ? (
							<div className="flex items-center justify-between gap-2">
								<a
									aria-label="Open prepared download"
									className="inline-flex min-w-0 items-center gap-1 rounded-[calc(var(--fb-radius)-4px)] px-1.5 py-1 font-medium text-[var(--fb-accent)] hover:bg-[var(--fb-accent-soft)]"
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
						{download.status === 'preparing' ? <span>Preparing zip</span> : null}
						{download.status === 'failed' ? (
							<span className="text-[var(--fb-danger)]">{download.error ?? 'Download failed'}</span>
						) : null}
					</div>
				))}
			</div>
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
		<div>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate font-semibold">Uploading {group.group.name}</div>
					<div className="text-[11px] text-[var(--fb-muted)]">{formatUploadGroupSummary(group)}</div>
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
			<div className="mt-2 flex flex-col gap-1.5 border-l border-[var(--fb-border)] pl-3">
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
		<div>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<span className="block truncate font-medium">{upload.name}</span>
					<span className="text-[11px] text-[var(--fb-muted)]">{formatUploadStatus(upload)}</span>
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
			<div className={`h-1.5 overflow-hidden rounded-full bg-[var(--fb-surface-2)] ${compact ? 'mt-1' : 'mt-1.5'}`}>
				<div
					className="h-full rounded-full bg-[var(--fb-accent)]"
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
	return createPortal(
		<div
			aria-label="Resume uploads"
			aria-modal="true"
			className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fb-text)_20%,transparent)] p-4 text-[13px] text-[var(--fb-text)]"
			role="dialog"
		>
			<div className="w-[min(380px,100%)] rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 shadow-[0_18px_50px_color-mix(in_oklch,var(--fb-text)_18%,transparent)]">
				<h2 className="m-0 text-[14px] font-semibold">Resume uploads</h2>
				<p className="mt-2 text-[12px] text-[var(--fb-muted)]">
					Resume {count} upload{count === 1 ? '?' : 's?'}
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<button className={widgetTextButton()} onClick={onDismiss} type="button">
						Dismiss
					</button>
					<button className={widgetPrimaryButton()} onClick={onResume} type="button">
						Resume uploads
					</button>
				</div>
			</div>
		</div>,
		document.body
	)
}

const fallbackTransferManager = new TransferManager()

function widgetIconButton() {
	return 'grid size-7 place-items-center rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-muted)] outline-none transition hover:bg-[var(--fb-bg)] focus:ring-2 focus:ring-[var(--fb-accent-soft)]'
}

function widgetTextButton() {
	return 'inline-flex h-7 items-center rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-2 text-[11px] font-medium text-[var(--fb-text)] outline-none transition hover:bg-[var(--fb-bg)] focus:ring-2 focus:ring-[var(--fb-accent-soft)]'
}

function widgetPrimaryButton() {
	return 'inline-flex h-7 items-center rounded-[calc(var(--fb-radius)-4px)] border border-[var(--fb-accent)] bg-[var(--fb-accent)] px-2 text-[11px] font-semibold text-[var(--fb-surface)] outline-none transition hover:opacity-90 focus:ring-2 focus:ring-[var(--fb-accent-soft)]'
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
