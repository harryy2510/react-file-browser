import { zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { FileBrowserAdapterError } from '../core/types'
import type { FileBrowserAdapter, FileBrowserUploadOptions, FileNode, MultipartUploadPart } from '../core/types'
import { getFileBrowserBasename, getFileBrowserDirname, joinFileBrowserPath } from '../core/path'

export type TransferStatus = 'queued' | 'uploading' | 'paused' | 'failed' | 'completed' | 'cancelled'

export type UploadTransfer = {
	id: string
	kind: 'upload'
	status: TransferStatus
	path: string
	name: string
	loadedBytes: number
	totalBytes: number
	bytesPerSecond?: number
	completedParts: MultipartUploadPart[]
	createdAt: string
	updatedAt: string
	error?: string
	uploadId?: string
	partSize?: number
	file?: File
	onConflict?: FileBrowserUploadOptions['onConflict']
	adapter?: FileBrowserAdapter
	result?: FileNode
	abortController?: AbortController
	group?: UploadTransferGroup
}

export type UploadTransferGroup = {
	id: string
	name: string
	totalFiles: number
	createdFolders: number
}

export type BulkDownloadJob = {
	id: string
	kind: 'bulk-download'
	status: 'preparing' | 'warning' | 'ready' | 'failed'
	strategy: 'single' | 'server' | 'client'
	paths: string[]
	selectedBytes: number
	createdAt: string
	updatedAt: string
	url?: string
	expiresAt?: string
	warning?: 'client_zip_size'
	error?: string
}

type InternalBulkDownloadJob = BulkDownloadJob & {
	adapter?: FileBrowserAdapter
}

export type TransferSnapshot = {
	uploads: UploadTransfer[]
	downloads: BulkDownloadJob[]
}

export type EnqueueUploadInput = {
	adapter: FileBrowserAdapter
	destinationPath: string
	file: File
	onConflict?: FileBrowserUploadOptions['onConflict']
	group?: UploadTransferGroup
}

export type ResumeRestoredUploadInput = {
	id: string
	adapter: FileBrowserAdapter
	file: File
	onConflict?: FileBrowserUploadOptions['onConflict']
}

export type PrepareBulkDownloadInput = {
	adapter: FileBrowserAdapter
	paths: string[]
	selectedBytes: number
	warnZipSizeBytes?: number
}

export type PrepareSingleDownloadInput = {
	adapter: FileBrowserAdapter
	path: string
	selectedBytes?: number
}

export type TransferManagerOptions = {
	storage?: Storage
	storageKey?: string
	idFactory?: () => string
	now?: () => Date
}

type UploadSpeedSample = {
	loadedBytes: number
	timeMs: number
}

const DEFAULT_STORAGE_KEY = 'react-file-browser-transfers'
const DOWNLOAD_RETENTION_MS = 24 * 60 * 60 * 1000

export class TransferManager {
	private readonly uploads = new Map<string, UploadTransfer>()
	private readonly downloads = new Map<string, InternalBulkDownloadJob>()
	private readonly uploadSpeedSamples = new Map<string, UploadSpeedSample>()
	private readonly subscribers = new Set<() => void>()
	private readonly activeTasks = new Set<Promise<void>>()
	private readonly storage?: Storage
	private readonly storageKey: string
	private readonly idFactory: () => string
	private readonly now: () => Date
	private snapshotCache: TransferSnapshot | undefined

	constructor(options: TransferManagerOptions = {}) {
		this.storage = options.storage
		this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
		this.idFactory = options.idFactory ?? createId
		this.now = options.now ?? (() => new Date())
		this.restorePersisted()
		if (this.downloads.size > 0) {
			this.pruneExpiredDownloads()
		}
	}

	subscribe(listener: () => void): () => void {
		this.subscribers.add(listener)
		return () => {
			this.subscribers.delete(listener)
		}
	}

	getSnapshot(): TransferSnapshot {
		this.snapshotCache ??= {
			uploads: Array.from(this.uploads.values()).map(cloneUpload),
			downloads: Array.from(this.downloads.values()).map((download) => ({
				...cloneDownload(download)
			}))
		}
		return this.snapshotCache
	}

	getUpload(id: string): UploadTransfer | undefined {
		const upload = this.uploads.get(id)
		return upload ? cloneUpload(upload) : undefined
	}

	getRestorableUploads(): UploadTransfer[] {
		return Array.from(this.uploads.values())
			.filter((upload) => ['queued', 'uploading', 'paused', 'failed'].includes(upload.status))
			.filter((upload) => !upload.file || !upload.adapter)
			.map(cloneUpload)
	}

	dismissRestoredUploads(ids: string[]): void {
		for (const id of ids) {
			const upload = this.uploads.get(id)
			if (!upload) {
				continue
			}
			upload.status = 'cancelled'
			this.uploadSpeedSamples.delete(id)
			upload.updatedAt = this.timestamp()
		}
		this.persistAndNotify()
	}

	dismissDownload(id: string): void {
		const download = this.downloads.get(id)
		if (!download) {
			return
		}

		revokeDownloadUrl(download.url)
		this.downloads.delete(id)
		this.persistAndNotify()
	}

	hasActiveTransfers(): boolean {
		const snapshot = this.getSnapshot()
		return (
			snapshot.uploads.some((upload) => ['queued', 'uploading'].includes(upload.status)) ||
			snapshot.downloads.some((download) => download.status === 'preparing')
		)
	}

	enqueueUpload({ adapter, destinationPath, file, group, onConflict }: EnqueueUploadInput): string {
		const id = this.idFactory()
		const timestamp = this.timestamp()
		const upload: UploadTransfer = {
			id,
			kind: 'upload',
			status: 'queued',
			path: destinationPath,
			name: file.name,
			loadedBytes: 0,
			totalBytes: file.size,
			completedParts: [],
			createdAt: timestamp,
			updatedAt: timestamp,
			adapter,
			file,
			group,
			onConflict,
			abortController: new AbortController()
		}
		this.uploads.set(id, upload)
		this.persistAndNotify()
		this.track(this.runUpload(id))
		return id
	}

	resumeUpload(id: string): Promise<void> {
		const upload = this.uploads.get(id)
		if (!upload || !upload.adapter || !upload.file) {
			return Promise.resolve()
		}

		upload.status = 'queued'
		upload.error = undefined
		upload.bytesPerSecond = undefined
		this.uploadSpeedSamples.delete(id)
		upload.abortController = new AbortController()
		upload.updatedAt = this.timestamp()
		this.persistAndNotify()
		this.track(this.runUpload(id))
		return Promise.resolve()
	}

	resumeRestoredUpload({ adapter, file, id, onConflict }: ResumeRestoredUploadInput): Promise<void> {
		const upload = this.uploads.get(id)
		if (!upload) {
			return Promise.resolve()
		}

		upload.adapter = adapter
		upload.file = file
		upload.name = file.name
		upload.totalBytes = file.size
		upload.onConflict = onConflict ?? upload.onConflict
		upload.status = 'queued'
		upload.error = undefined
		upload.bytesPerSecond = undefined
		this.uploadSpeedSamples.delete(id)
		upload.abortController = new AbortController()
		upload.updatedAt = this.timestamp()
		this.persistAndNotify()
		this.track(this.runUpload(id))
		return Promise.resolve()
	}

	pauseUpload(id: string): void {
		const upload = this.uploads.get(id)
		if (!upload) {
			return
		}
		upload.abortController?.abort()
		upload.status = 'paused'
		this.uploadSpeedSamples.delete(id)
		upload.updatedAt = this.timestamp()
		this.persistAndNotify()
	}

	async cancelUpload(id: string): Promise<void> {
		const upload = this.uploads.get(id)
		if (!upload) {
			return
		}

		upload.abortController?.abort()
		upload.status = 'cancelled'
		this.uploadSpeedSamples.delete(id)
		upload.updatedAt = this.timestamp()
		if (upload.uploadId && upload.adapter?.abortMultipartUpload) {
			await upload.adapter.abortMultipartUpload(upload.uploadId)
		}
		this.persistAndNotify()
	}

	async waitForIdle(): Promise<void> {
		while (this.activeTasks.size > 0) {
			await Promise.allSettled(Array.from(this.activeTasks))
		}
	}

	async prepareBulkDownload({
		adapter,
		paths,
		selectedBytes,
		warnZipSizeBytes = Number.POSITIVE_INFINITY
	}: PrepareBulkDownloadInput): Promise<BulkDownloadJob> {
		const id = this.idFactory()
		const timestamp = this.timestamp()
		const job: InternalBulkDownloadJob = {
			id,
			kind: 'bulk-download',
			status: 'preparing',
			strategy: adapter.bulkDownloadUrl ? 'server' : 'client',
			adapter,
			paths: [...paths],
			selectedBytes,
			createdAt: timestamp,
			updatedAt: timestamp
		}
		this.downloads.set(id, job)
		this.persistAndNotify()

		try {
			if (adapter.bulkDownloadUrl) {
				const result = await adapter.bulkDownloadUrl(paths)
				job.status = 'ready'
				job.url = result.url
				job.expiresAt = result.expiresAt
			} else if (selectedBytes > warnZipSizeBytes) {
				job.status = 'warning'
				job.warning = 'client_zip_size'
			} else {
				job.url = await createClientZipUrl(adapter, paths)
				job.status = 'ready'
			}
		} catch (caught) {
			job.status = 'failed'
			job.error = toErrorMessage(caught)
		}

		job.updatedAt = this.timestamp()
		this.persistAndNotify()
		return cloneDownload(job)
	}

	async prepareSingleDownload({
		adapter,
		path,
		selectedBytes = 0
	}: PrepareSingleDownloadInput): Promise<BulkDownloadJob> {
		const id = this.idFactory()
		const timestamp = this.timestamp()
		const job: InternalBulkDownloadJob = {
			id,
			kind: 'bulk-download',
			status: 'preparing',
			strategy: 'single',
			adapter,
			paths: [path],
			selectedBytes,
			createdAt: timestamp,
			updatedAt: timestamp
		}
		this.downloads.set(id, job)
		this.persistAndNotify()

		try {
			job.url = await adapter.signedUrl(path)
			job.status = 'ready'
		} catch (caught) {
			job.status = 'failed'
			job.error = toErrorMessage(caught)
		}

		job.updatedAt = this.timestamp()
		this.persistAndNotify()
		return cloneDownload(job)
	}

	async confirmBulkDownload(id: string): Promise<BulkDownloadJob | undefined> {
		const job = this.downloads.get(id)
		if (!job) {
			return undefined
		}

		if (job.status !== 'warning') {
			return cloneDownload(job)
		}

		if (!job.adapter) {
			job.status = 'failed'
			job.error = 'This download can no longer continue in the current session.'
			job.updatedAt = this.timestamp()
			this.persistAndNotify()
			return cloneDownload(job)
		}

		job.status = 'preparing'
		job.warning = undefined
		job.updatedAt = this.timestamp()
		this.persistAndNotify()

		try {
			job.url = await createClientZipUrl(job.adapter, job.paths)
			job.status = 'ready'
		} catch (caught) {
			job.status = 'failed'
			job.error = toErrorMessage(caught)
		}

		job.updatedAt = this.timestamp()
		this.persistAndNotify()
		return cloneDownload(job)
	}

	private async runUpload(id: string): Promise<void> {
		const upload = this.uploads.get(id)
		if (!upload?.adapter || !upload.file) {
			return
		}

		upload.status = 'uploading'
		upload.updatedAt = this.timestamp()
		this.persistAndNotify()

		try {
			const result = hasMultipart(upload.adapter)
				? await this.runMultipartUpload(upload)
				: await this.runSimpleUpload(upload)
			upload.status = 'completed'
			upload.loadedBytes = upload.totalBytes
			upload.result = result
			this.uploadSpeedSamples.delete(upload.id)
			upload.updatedAt = this.timestamp()
			this.persistAndNotify()
		} catch (caught) {
			if (['paused', 'cancelled'].includes(upload.status)) {
				this.uploadSpeedSamples.delete(upload.id)
				this.persistAndNotify()
				return
			}
			upload.status = 'failed'
			upload.error = toErrorMessage(caught)
			this.uploadSpeedSamples.delete(upload.id)
			upload.updatedAt = this.timestamp()
			this.persistAndNotify()
		}
	}

	private async runSimpleUpload(upload: UploadTransfer): Promise<FileNode> {
		if (!upload.adapter || !upload.file) {
			throw new Error('Upload is missing adapter or file')
		}

		return upload.adapter.upload(upload.path, upload.file, {
			onConflict: upload.onConflict,
			signal: upload.abortController?.signal,
			onProgress: (loaded, total) => {
				this.updateUploadProgress(upload, loaded, total)
			}
		})
	}

	private async runMultipartUpload(upload: UploadTransfer): Promise<FileNode> {
		const adapter = upload.adapter
		const file = upload.file
		if (!adapter || !file || !hasMultipart(adapter)) {
			throw new Error('Multipart upload is not available')
		}

		if (!upload.uploadId || !upload.partSize) {
			await prepareMultipartDestination(upload)
			const created = await adapter.createMultipartUpload(upload.path, file.size)
			upload.uploadId = created.uploadId
			upload.partSize = created.partSize
			upload.updatedAt = this.timestamp()
			this.persistAndNotify()
		}

		const partSize = upload.partSize
		const partCount = Math.ceil(file.size / partSize)
		for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
			if (upload.completedParts.some((part) => part.partNumber === partNumber)) {
				continue
			}

			const start = (partNumber - 1) * partSize
			const end = Math.min(start + partSize, file.size)
			const chunk = file.slice(start, end)
			const completedBeforePart = completedBytes(upload)
			const result = await adapter.uploadPart({
				uploadId: upload.uploadId,
				partNumber,
				chunk,
				signal: upload.abortController?.signal,
				onProgress: (loaded) => {
					this.updateUploadProgress(upload, completedBeforePart + loaded, upload.totalBytes)
				}
			})
			upload.completedParts = [...upload.completedParts, { partNumber, etag: result.etag }].sort(
				(left, right) => left.partNumber - right.partNumber
			)
			upload.loadedBytes = completedBytes(upload)
			upload.updatedAt = this.timestamp()
			this.persistAndNotify()
		}

		return adapter.completeMultipartUpload({
			uploadId: upload.uploadId,
			parts: upload.completedParts
		})
	}

	private updateUploadProgress(upload: UploadTransfer, loadedBytes: number, totalBytes: number): void {
		const sampledAt = this.now()
		const timeMs = sampledAt.getTime()
		const previous = this.uploadSpeedSamples.get(upload.id)

		upload.loadedBytes = loadedBytes
		upload.totalBytes = totalBytes
		if (previous && loadedBytes > previous.loadedBytes && timeMs > previous.timeMs) {
			upload.bytesPerSecond = ((loadedBytes - previous.loadedBytes) / (timeMs - previous.timeMs)) * 1000
		}
		this.uploadSpeedSamples.set(upload.id, { loadedBytes, timeMs })
		upload.updatedAt = sampledAt.toISOString()
		this.persistAndNotify()
	}

	private track(task: Promise<void>): void {
		this.activeTasks.add(task)
		void task.finally(() => {
			this.activeTasks.delete(task)
		})
	}

	private persistAndNotify(): void {
		this.snapshotCache = undefined
		this.persist()
		for (const subscriber of this.subscribers) {
			subscriber()
		}
	}

	private persist(): void {
		if (!this.storage) {
			return
		}

		const payload = {
			uploads: Array.from(this.uploads.values()).map((upload) => ({
				...cloneUpload(upload),
				file: undefined,
				adapter: undefined,
				abortController: undefined
			})),
			downloads: Array.from(this.downloads.values()).map(cloneDownload)
		}
		this.storage.setItem(this.storageKey, JSON.stringify(payload))
	}

	private restorePersisted(): void {
		if (!this.storage) {
			return
		}

		const raw = this.storage.getItem(this.storageKey)
		if (!raw) {
			return
		}

		try {
			const parsed = JSON.parse(raw) as Partial<TransferSnapshot>
			for (const upload of parsed.uploads ?? []) {
				this.uploads.set(upload.id, {
					...upload,
					file: undefined,
					adapter: undefined,
					abortController: undefined
				})
			}
			for (const download of parsed.downloads ?? []) {
				this.downloads.set(download.id, { ...download })
			}
		} catch {
			this.storage.removeItem(this.storageKey)
		}
	}

	private timestamp(): string {
		return this.now().toISOString()
	}

	private pruneExpiredDownloads(): void {
		const nowMs = this.now().getTime()
		let changed = false

		for (const [id, download] of this.downloads) {
			if (!isExpiredOrStaleDownload(download, nowMs)) {
				continue
			}

			revokeDownloadUrl(download.url)
			this.downloads.delete(id)
			changed = true
		}

		if (!changed) {
			return
		}

		this.snapshotCache = undefined
		this.persist()
	}
}

function hasMultipart(
	adapter: FileBrowserAdapter
): adapter is FileBrowserAdapter &
	Required<Pick<FileBrowserAdapter, 'createMultipartUpload' | 'uploadPart' | 'completeMultipartUpload'>> {
	return (
		typeof adapter.createMultipartUpload === 'function' &&
		typeof adapter.uploadPart === 'function' &&
		typeof adapter.completeMultipartUpload === 'function'
	)
}

function completedBytes(upload: UploadTransfer): number {
	const partSize = upload.partSize ?? upload.totalBytes
	return upload.completedParts.reduce((total, part) => {
		const start = (part.partNumber - 1) * partSize
		return total + Math.min(partSize, upload.totalBytes - start)
	}, 0)
}

async function prepareMultipartDestination(upload: UploadTransfer): Promise<void> {
	const adapter = upload.adapter
	if (!adapter?.exists) {
		return
	}
	const exists: NonNullable<FileBrowserAdapter['exists']> = (paths) => adapter.exists?.(paths) ?? Promise.resolve({})

	const current = await exists([upload.path])
	if (!current[upload.path]) {
		return
	}

	if (upload.onConflict === 'keep-both') {
		upload.path = await nextAvailableUploadPath(exists, upload.path)
		return
	}

	if (upload.onConflict !== 'replace') {
		throw new FileBrowserAdapterError('conflict', `A file browser entry already exists at ${upload.path}`)
	}
}

async function nextAvailableUploadPath(
	exists: NonNullable<FileBrowserAdapter['exists']>,
	path: string
): Promise<string> {
	const dir = getFileBrowserDirname(path)
	const basename = getFileBrowserBasename(path)
	const dotIndex = basename.lastIndexOf('.')
	const hasExtension = dotIndex > 0
	const stem = hasExtension ? basename.slice(0, dotIndex) : basename
	const extension = hasExtension ? basename.slice(dotIndex) : ''

	for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
		const candidate = joinFileBrowserPath(dir, `${stem} (${index})${extension}`)
		const result = await exists([candidate])
		if (!result[candidate]) {
			return candidate
		}
	}

	throw new FileBrowserAdapterError('conflict', `Could not allocate a unique file browser path for ${path}`)
}

function cloneUpload(upload: UploadTransfer): UploadTransfer {
	return {
		...upload,
		group: upload.group ? { ...upload.group } : undefined,
		completedParts: upload.completedParts.map((part) => ({ ...part }))
	}
}

function cloneDownload(download: InternalBulkDownloadJob): BulkDownloadJob {
	const { adapter: _adapter, ...snapshot } = download
	void _adapter
	return {
		...snapshot,
		paths: [...download.paths]
	}
}

function isExpiredOrStaleDownload(download: InternalBulkDownloadJob, nowMs: number): boolean {
	if (download.status === 'preparing') {
		return false
	}

	if (download.expiresAt) {
		const expiresAtMs = Date.parse(download.expiresAt)
		if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
			return true
		}
	}

	const updatedAtMs = Date.parse(download.updatedAt)
	return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs > DOWNLOAD_RETENTION_MS
}

function revokeDownloadUrl(url: string | undefined): void {
	if (!url?.startsWith('blob:') || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
		return
	}

	URL.revokeObjectURL(url)
}

function createId(): string {
	return `transfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function toErrorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught)
}

type ClientZipEntry = {
	path: string
	archivePath: string
}

async function createClientZipUrl(adapter: FileBrowserAdapter, paths: string[]): Promise<string> {
	const entries = await collectClientZipEntries(adapter, paths)
	const zippable: Zippable = {}

	for (const entry of entries) {
		const url = await adapter.signedUrl(entry.path)
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error(`Could not fetch ${entry.path} for the client zip`)
		}
		zippable[entry.archivePath] = new Uint8Array(await response.arrayBuffer())
	}

	const zip = zipSync(zippable)
	return URL.createObjectURL(new Blob([zip], { type: 'application/zip' }))
}

async function collectClientZipEntries(adapter: FileBrowserAdapter, paths: string[]): Promise<ClientZipEntry[]> {
	const entries: ClientZipEntry[] = []
	const seen = new Set<string>()

	for (const path of paths) {
		await collectClientZipPath(adapter, path, entries, seen)
	}

	return entries
}

async function collectClientZipPath(
	adapter: FileBrowserAdapter,
	path: string,
	entries: ClientZipEntry[],
	seen: Set<string>
): Promise<void> {
	if (seen.has(path)) {
		return
	}
	seen.add(path)

	const node = await tryStat(adapter, path)
	if (node?.kind === 'file') {
		entries.push({ path, archivePath: toArchivePath(path) })
		return
	}

	if (node?.kind === 'folder') {
		await collectClientZipFolder(adapter, path, entries, seen)
		return
	}

	const listed = await tryListFolder(adapter, path)
	if (listed) {
		for (const item of listed) {
			await collectClientZipPath(adapter, item.path, entries, seen)
		}
		return
	}

	entries.push({ path, archivePath: toArchivePath(path) })
}

async function collectClientZipFolder(
	adapter: FileBrowserAdapter,
	path: string,
	entries: ClientZipEntry[],
	seen: Set<string>
): Promise<void> {
	let cursor: string | undefined
	do {
		const result = await adapter.list(path, { cursor })
		for (const item of result.items) {
			await collectClientZipPath(adapter, item.path, entries, seen)
		}
		cursor = result.cursor
	} while (cursor)
}

async function tryStat(adapter: FileBrowserAdapter, path: string): Promise<FileNode | undefined> {
	if (!adapter.stat) {
		return undefined
	}

	try {
		return await adapter.stat(path)
	} catch {
		return undefined
	}
}

async function tryListFolder(adapter: FileBrowserAdapter, path: string): Promise<FileNode[] | undefined> {
	try {
		let cursor: string | undefined
		const items: FileNode[] = []
		do {
			const result = await adapter.list(path, { cursor })
			items.push(...result.items)
			cursor = result.cursor
		} while (cursor)
		return items
	} catch {
		return undefined
	}
}

function toArchivePath(path: string): string {
	return path.replace(/^\/+/, '') || 'download'
}
