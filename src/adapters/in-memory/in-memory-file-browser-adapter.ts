import { zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { FileBrowserAdapterError } from '../../core/types'
import type {
	FileBrowserAdapter,
	FileBrowserListOptions,
	FileBrowserListResult,
	FileBrowserUploadOptions,
	FileNode
} from '../../core/types'
import {
	ROOT_PATH,
	getFileBrowserBasename,
	getFileBrowserDirname,
	isFileBrowserDescendantOrSelf,
	joinFileBrowserPath,
	normalizeFileBrowserPath,
	replaceFileBrowserPathPrefix
} from '../../core/path'

export type InMemoryFileBrowserCapability =
	| 'createFolder'
	| 'rename'
	| 'move'
	| 'copy'
	| 'stat'
	| 'exists'
	| 'bulkDownloadUrl'
	| 'multipart'

export type InMemoryFileBrowserAdapterOptions<TMetadata = unknown> = {
	capabilities?: Partial<Record<InMemoryFileBrowserCapability, boolean>>
	initialEntries?: readonly FileNode<TMetadata>[]
	multipartPartSize?: number
	pageSize?: number
	now?: () => Date
}

type InMemoryEntry<TMetadata> = FileNode<TMetadata> & {
	blob?: Blob
}

type InMemoryMultipartUpload = {
	path: string
	size: number
	partSize: number
	parts: Map<number, { blob: Blob; etag: string }>
}

const DEFAULT_CAPABILITIES: Record<InMemoryFileBrowserCapability, boolean> = {
	createFolder: true,
	rename: true,
	move: true,
	copy: true,
	stat: true,
	exists: true,
	bulkDownloadUrl: true,
	multipart: false
}

export class InMemoryFileBrowserAdapter<TMetadata = unknown> implements FileBrowserAdapter<TMetadata> {
	readonly createFolder?: NonNullable<FileBrowserAdapter<TMetadata>['createFolder']>
	readonly rename?: NonNullable<FileBrowserAdapter<TMetadata>['rename']>
	readonly move?: NonNullable<FileBrowserAdapter<TMetadata>['move']>
	readonly copy?: NonNullable<FileBrowserAdapter<TMetadata>['copy']>
	readonly stat?: NonNullable<FileBrowserAdapter<TMetadata>['stat']>
	readonly exists?: NonNullable<FileBrowserAdapter<TMetadata>['exists']>
	readonly bulkDownloadUrl?: NonNullable<FileBrowserAdapter<TMetadata>['bulkDownloadUrl']>
	readonly createMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['createMultipartUpload']>
	readonly uploadPart?: NonNullable<FileBrowserAdapter<TMetadata>['uploadPart']>
	readonly completeMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['completeMultipartUpload']>
	readonly abortMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['abortMultipartUpload']>

	private readonly entries = new Map<string, InMemoryEntry<TMetadata>>()
	private readonly multipartUploads = new Map<string, InMemoryMultipartUpload>()
	private readonly multipartPartSize: number
	private readonly pageSize?: number
	private readonly now: () => Date
	private etagSequence = 0
	private multipartSequence = 0

	constructor(options: InMemoryFileBrowserAdapterOptions<TMetadata> = {}) {
		const capabilities = {
			...DEFAULT_CAPABILITIES,
			...options.capabilities
		}

		this.pageSize = options.pageSize
		this.multipartPartSize = Math.max(1, options.multipartPartSize ?? 5 * 1024 * 1024)
		this.now = options.now ?? (() => new Date())
		this.entries.set(ROOT_PATH, {
			path: ROOT_PATH,
			name: '',
			kind: 'folder',
			modifiedAt: this.timestamp()
		})
		for (const node of options.initialEntries ?? []) {
			const normalized = normalizeFileBrowserPath(node.path)
			this.entries.set(normalized, { ...node, path: normalized })
		}

		if (capabilities.createFolder) {
			this.createFolder = this.createFolderEntry.bind(this)
		}

		if (capabilities.rename) {
			this.rename = this.renameEntry.bind(this)
		}

		if (capabilities.move) {
			this.move = this.moveEntries.bind(this)
		}

		if (capabilities.copy) {
			this.copy = this.copyEntries.bind(this)
		}

		if (capabilities.stat) {
			this.stat = this.statEntry.bind(this)
		}

		if (capabilities.exists) {
			this.exists = this.existsEntries.bind(this)
		}

		if (capabilities.bulkDownloadUrl) {
			this.bulkDownloadUrl = this.createBulkDownloadUrl.bind(this)
		}

		if (capabilities.multipart) {
			this.createMultipartUpload = this.createMultipartUploadEntry.bind(this)
			this.uploadPart = this.uploadMultipartPart.bind(this)
			this.completeMultipartUpload = this.completeMultipartUploadEntry.bind(this)
			this.abortMultipartUpload = this.abortMultipartUploadEntry.bind(this)
		}
	}

	list(path: string, opts: FileBrowserListOptions = {}): Promise<FileBrowserListResult<TMetadata>> {
		throwIfAborted(opts.signal)
		const normalized = normalizeFileBrowserPath(path)
		const folder = this.getEntry(normalized)

		if (folder.kind !== 'folder') {
			throw new FileBrowserAdapterError('invalid_path', `Cannot list a file path: ${normalized}`)
		}

		const allItems = Array.from(this.entries.values())
			.filter((entry) => entry.path !== ROOT_PATH)
			.filter((entry) => getFileBrowserDirname(entry.path) === normalized)
			.sort(compareEntries)
			.map(cloneNode)

		if (!this.pageSize) {
			return Promise.resolve({ items: allItems })
		}

		const start = opts.cursor ? Number.parseInt(opts.cursor, 10) : 0
		const safeStart = Number.isFinite(start) && start > 0 ? start : 0
		const items = allItems.slice(safeStart, safeStart + this.pageSize)
		const next = safeStart + items.length

		return Promise.resolve({
			items,
			cursor: next < allItems.length ? String(next) : undefined
		})
	}

	private createFolderEntry(path: string): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)

		if (normalized === ROOT_PATH) {
			return Promise.resolve(cloneNode(this.getEntry(ROOT_PATH)))
		}

		if (this.entries.has(normalized)) {
			throw new FileBrowserAdapterError('conflict', `A file browser entry already exists at ${normalized}`)
		}

		this.assertFolderExists(getFileBrowserDirname(normalized))

		const entry: InMemoryEntry<TMetadata> = {
			path: normalized,
			name: getFileBrowserBasename(normalized),
			kind: 'folder',
			modifiedAt: this.timestamp(),
			etag: this.nextEtag()
		}

		this.entries.set(normalized, entry)
		return Promise.resolve(cloneNode(entry))
	}

	delete(paths: string[]): Promise<void> {
		for (const path of paths.map(normalizeFileBrowserPath)) {
			if (path === ROOT_PATH) {
				throw new FileBrowserAdapterError('invalid_path', 'Cannot delete the root folder')
			}

			this.getEntry(path)

			for (const candidate of Array.from(this.entries.keys())) {
				if (isFileBrowserDescendantOrSelf(path, candidate)) {
					this.entries.delete(candidate)
				}
			}
		}

		return Promise.resolve()
	}

	signedUrl(path: string): Promise<string> {
		const entry = this.getEntry(path)

		if (entry.kind !== 'file' || !entry.blob) {
			throw new FileBrowserAdapterError('invalid_path', `Cannot create a signed URL for a folder: ${entry.path}`)
		}

		return Promise.resolve(URL.createObjectURL(entry.blob))
	}

	upload(path: string, file: File, opts: FileBrowserUploadOptions = {}): Promise<FileNode<TMetadata>> {
		throwIfAborted(opts.signal)
		let normalized = normalizeFileBrowserPath(path)
		this.assertFolderExists(getFileBrowserDirname(normalized))

		if (this.entries.has(normalized) && opts.onConflict !== 'replace') {
			if (opts.onConflict === 'keep-both') {
				normalized = this.nextAvailablePath(normalized)
			} else {
				throw new FileBrowserAdapterError('conflict', `A file browser entry already exists at ${normalized}`)
			}
		}

		opts.onProgress?.(0, file.size)
		throwIfAborted(opts.signal)

		const entry: InMemoryEntry<TMetadata> = {
			path: normalized,
			name: getFileBrowserBasename(normalized) || file.name,
			kind: 'file',
			size: file.size,
			mimeType: file.type || undefined,
			modifiedAt: this.timestamp(),
			etag: this.nextEtag(),
			blob: file
		}

		this.entries.set(normalized, entry)
		opts.onProgress?.(file.size, file.size)

		return Promise.resolve(cloneNode(entry))
	}

	private nextAvailablePath(path: string): string {
		const dir = getFileBrowserDirname(path)
		const basename = getFileBrowserBasename(path)
		const dotIndex = basename.lastIndexOf('.')
		const hasExtension = dotIndex > 0
		const stem = hasExtension ? basename.slice(0, dotIndex) : basename
		const extension = hasExtension ? basename.slice(dotIndex) : ''

		for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
			const candidate = joinFileBrowserPath(dir, `${stem} (${index})${extension}`)
			if (!this.entries.has(candidate)) {
				return candidate
			}
		}

		throw new FileBrowserAdapterError('conflict', `Could not allocate a unique file browser path for ${path}`)
	}

	private renameEntry(path: string, newName: string): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)
		const entry = this.getEntry(normalized)
		const trimmedName = newName.trim()

		if (!trimmedName || trimmedName.includes('/') || trimmedName.includes('\\')) {
			throw new FileBrowserAdapterError('invalid_path', `Invalid file browser name: ${newName}`)
		}

		const updated: InMemoryEntry<TMetadata> = {
			...entry,
			name: trimmedName,
			modifiedAt: this.timestamp(),
			etag: this.nextEtag()
		}

		this.entries.set(normalized, updated)
		return Promise.resolve(cloneNode(updated))
	}

	private async moveEntries(from: string[], toDir: string): Promise<void> {
		await this.copyEntries(from, toDir)

		for (const path of from) {
			await this.delete([path])
		}
	}

	private copyEntries(from: string[], toDir: string): Promise<void> {
		const normalizedToDir = normalizeFileBrowserPath(toDir)
		this.assertFolderExists(normalizedToDir)

		const copies = new Map<string, InMemoryEntry<TMetadata>>()

		for (const sourcePath of from.map(normalizeFileBrowserPath)) {
			const source = this.getEntry(sourcePath)
			const destinationRoot = joinFileBrowserPath(normalizedToDir, getFileBrowserBasename(source.path))

			for (const entry of this.collectTree(source.path)) {
				const destinationPath = replaceFileBrowserPathPrefix(entry.path, source.path, destinationRoot)

				if (this.entries.has(destinationPath) || copies.has(destinationPath)) {
					throw new FileBrowserAdapterError('conflict', `A file browser entry already exists at ${destinationPath}`)
				}

				copies.set(destinationPath, {
					...entry,
					path: destinationPath,
					name: entry.path === source.path ? getFileBrowserBasename(destinationPath) : entry.name,
					modifiedAt: this.timestamp(),
					etag: this.nextEtag()
				})
			}
		}

		for (const [path, entry] of copies) {
			this.entries.set(path, entry)
		}

		return Promise.resolve()
	}

	private statEntry(path: string): Promise<FileNode<TMetadata>> {
		return Promise.resolve(cloneNode(this.getEntry(path)))
	}

	private existsEntries(paths: string[]): Promise<Record<string, boolean>> {
		return Promise.resolve(
			Object.fromEntries(
				paths.map((path) => {
					const normalized = normalizeFileBrowserPath(path)
					return [normalized, this.entries.has(normalized)]
				})
			)
		)
	}

	private async createBulkDownloadUrl(paths: string[]): Promise<{ url: string; expiresAt: string }> {
		const zippable: Zippable = {}

		for (const path of paths) {
			this.getEntry(path)
			const tree = this.collectTree(path)
			for (const entry of tree) {
				if (entry.kind === 'folder' || !entry.blob) {
					continue
				}
				zippable[toArchivePath(entry.path)] = new Uint8Array(await entry.blob.arrayBuffer())
			}
		}

		const archive = new Blob([zipSync(zippable)], {
			type: 'application/zip'
		})

		return {
			url: URL.createObjectURL(archive),
			expiresAt: new Date(this.now().getTime() + 4 * 60 * 60 * 1000).toISOString()
		}
	}

	private createMultipartUploadEntry(path: string, size: number): Promise<{ uploadId: string; partSize: number }> {
		const normalized = normalizeFileBrowserPath(path)
		this.assertFolderExists(getFileBrowserDirname(normalized))

		const existing = this.entries.get(normalized)
		if (existing?.kind === 'folder') {
			throw new FileBrowserAdapterError('conflict', `A file browser entry already exists at ${normalized}`)
		}

		this.multipartSequence += 1
		const uploadId = `memory-multipart-${this.multipartSequence}`
		this.multipartUploads.set(uploadId, {
			path: normalized,
			size,
			partSize: this.multipartPartSize,
			parts: new Map()
		})

		return Promise.resolve({ uploadId, partSize: this.multipartPartSize })
	}

	private uploadMultipartPart({
		chunk,
		onProgress,
		partNumber,
		signal,
		uploadId
	}: Parameters<NonNullable<FileBrowserAdapter<TMetadata>['uploadPart']>>[0]): Promise<{
		etag: string
	}> {
		return Promise.resolve().then(() => {
			throwIfAborted(signal)
			const upload = this.getMultipartUpload(uploadId)
			const etag = `memory-part-${partNumber}`
			upload.parts.set(partNumber, { blob: chunk, etag })
			onProgress?.(chunk.size)
			throwIfAborted(signal)

			return { etag }
		})
	}

	private completeMultipartUploadEntry({
		parts,
		uploadId
	}: Parameters<NonNullable<FileBrowserAdapter<TMetadata>['completeMultipartUpload']>>[0]): Promise<
		FileNode<TMetadata>
	> {
		return Promise.resolve().then(() => {
			const upload = this.getMultipartUpload(uploadId)
			const blobs: Blob[] = []

			for (const part of parts.sort((left, right) => left.partNumber - right.partNumber)) {
				const uploaded = upload.parts.get(part.partNumber)
				if (!uploaded || uploaded.etag !== part.etag) {
					throw new FileBrowserAdapterError('not_found', `No uploaded part ${part.partNumber} exists for ${uploadId}`)
				}
				blobs.push(uploaded.blob)
			}

			const blob = new Blob(blobs)
			if (blob.size !== upload.size) {
				throw new FileBrowserAdapterError('invalid_path', `Multipart upload ${uploadId} size mismatch`)
			}

			const entry: InMemoryEntry<TMetadata> = {
				path: upload.path,
				name: getFileBrowserBasename(upload.path),
				kind: 'file',
				size: blob.size,
				modifiedAt: this.timestamp(),
				etag: this.nextEtag(),
				blob
			}
			this.entries.set(upload.path, entry)
			this.multipartUploads.delete(uploadId)

			return cloneNode(entry)
		})
	}

	private abortMultipartUploadEntry(uploadId: string): Promise<void> {
		return Promise.resolve().then(() => {
			this.getMultipartUpload(uploadId)
			this.multipartUploads.delete(uploadId)
		})
	}

	private getMultipartUpload(uploadId: string): InMemoryMultipartUpload {
		const upload = this.multipartUploads.get(uploadId)
		if (!upload) {
			throw new FileBrowserAdapterError('not_found', `No multipart upload exists for ${uploadId}`)
		}
		return upload
	}

	private collectTree(path: string): InMemoryEntry<TMetadata>[] {
		const normalized = normalizeFileBrowserPath(path)
		return Array.from(this.entries.values())
			.filter((entry) => isFileBrowserDescendantOrSelf(normalized, entry.path))
			.sort((left, right) => left.path.localeCompare(right.path))
	}

	private assertFolderExists(path: string): void {
		const entry = this.getEntry(path)

		if (entry.kind !== 'folder') {
			throw new FileBrowserAdapterError('invalid_path', `Expected a folder at ${entry.path}`)
		}
	}

	private getEntry(path: string): InMemoryEntry<TMetadata> {
		const normalized = normalizeFileBrowserPath(path)
		const entry = this.entries.get(normalized)

		if (!entry) {
			throw new FileBrowserAdapterError('not_found', `No file browser entry exists at ${normalized}`)
		}

		return entry
	}

	private timestamp(): string {
		return this.now().toISOString()
	}

	private nextEtag(): string {
		this.etagSequence += 1
		return `memory-${this.etagSequence}`
	}
}

export function createInMemoryFileBrowserAdapter<TMetadata = unknown>(
	options?: InMemoryFileBrowserAdapterOptions<TMetadata>
): InMemoryFileBrowserAdapter<TMetadata> {
	return new InMemoryFileBrowserAdapter<TMetadata>(options)
}

function cloneNode<TMetadata>(entry: InMemoryEntry<TMetadata>): FileNode<TMetadata> {
	const node: FileNode<TMetadata> = {
		path: entry.path,
		name: entry.name,
		kind: entry.kind
	}

	if (entry.id !== undefined) {
		node.id = entry.id
	}

	if (entry.size !== undefined) {
		node.size = entry.size
	}

	if (entry.mimeType !== undefined) {
		node.mimeType = entry.mimeType
	}

	if (entry.modifiedAt !== undefined) {
		node.modifiedAt = entry.modifiedAt
	}

	if (entry.etag !== undefined) {
		node.etag = entry.etag
	}

	if (entry.thumbnailUrl !== undefined) {
		node.thumbnailUrl = entry.thumbnailUrl
	}

	if (entry.metadata !== undefined) {
		node.metadata = entry.metadata
	}

	return node
}

function compareEntries<TMetadata>(left: InMemoryEntry<TMetadata>, right: InMemoryEntry<TMetadata>): number {
	if (left.kind !== right.kind) {
		return left.kind === 'folder' ? -1 : 1
	}

	return left.name.localeCompare(right.name, undefined, {
		numeric: true,
		sensitivity: 'base'
	})
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new FileBrowserAdapterError('aborted', 'Operation was aborted')
	}
}

function toArchivePath(path: string): string {
	return path.replace(/^\/+/, '') || 'download'
}
