import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	UploadPartCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { FileBrowserAdapterError } from '../core/types'
import type {
	FileBrowserAdapter,
	FileBrowserListOptions,
	FileBrowserListResult,
	FileBrowserUploadOptions,
	FileNode,
	MultipartUploadPart
} from '../core/types'
import { getFileBrowserBasename, joinFileBrowserPath, normalizeFileBrowserPath } from '../core/path'
import { UnsupportedCloudFileBrowserAdapter } from './cloud-adapter-base'
import type { CloudAdapterName, CloudFileBrowserAdapterOptions } from './cloud-adapter-base'

export type S3CompatibleClient = {
	send(command: object): Promise<unknown>
}

export type S3CompatibleFileBrowserAdapterOptions<TMetadata = unknown> = CloudFileBrowserAdapterOptions<TMetadata> & {
	bucket?: string
	client?: S3CompatibleClient
	multipartPartSize?: number
	prefix?: string
	signedUrlExpiresIn?: number
}

type S3SdkConfig = {
	bucket: string
	client: S3CompatibleClient
	multipartPartSize: number
	prefix: string
	signedUrlExpiresIn: number
}

type S3ListResponse = {
	CommonPrefixes?: Array<{ Prefix?: string }>
	Contents?: Array<{
		ContentType?: string
		ETag?: string
		Key?: string
		LastModified?: Date
		Size?: number
	}>
	NextContinuationToken?: string
}

type S3HeadResponse = {
	ContentLength?: number
	ContentType?: string
	ETag?: string
	LastModified?: Date
}

type S3PutResponse = {
	ETag?: string
}

type S3MultipartCreateResponse = {
	UploadId?: string
}

type S3UploadPartResponse = {
	ETag?: string
}

type S3MultipartSession = {
	key: string
	path: string
	size: number
}

const DEFAULT_SIGNED_URL_EXPIRES_IN = 60 * 60
const DEFAULT_MULTIPART_PART_SIZE = 8 * 1024 * 1024

export class S3CompatibleFileBrowserAdapter<TMetadata = unknown> implements FileBrowserAdapter<TMetadata> {
	createFolder?: NonNullable<FileBrowserAdapter<TMetadata>['createFolder']>
	rename?: NonNullable<FileBrowserAdapter<TMetadata>['rename']>
	move?: NonNullable<FileBrowserAdapter<TMetadata>['move']>
	copy?: NonNullable<FileBrowserAdapter<TMetadata>['copy']>
	stat?: NonNullable<FileBrowserAdapter<TMetadata>['stat']>
	exists?: NonNullable<FileBrowserAdapter<TMetadata>['exists']>
	createMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['createMultipartUpload']>
	uploadPart?: NonNullable<FileBrowserAdapter<TMetadata>['uploadPart']>
	completeMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['completeMultipartUpload']>
	abortMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['abortMultipartUpload']>
	bulkDownloadUrl?: NonNullable<FileBrowserAdapter<TMetadata>['bulkDownloadUrl']>

	private readonly delegate?: UnsupportedCloudFileBrowserAdapter<TMetadata>
	private readonly multipartSessions = new Map<string, S3MultipartSession>()
	private readonly sdk?: S3SdkConfig

	constructor(adapterName: CloudAdapterName, options: S3CompatibleFileBrowserAdapterOptions<TMetadata> = {}) {
		if (!options.client || !options.bucket) {
			this.delegate = new UnsupportedCloudFileBrowserAdapter<TMetadata>(adapterName, options)
			this.createFolder = this.delegate.createFolder?.bind(this.delegate)
			this.rename = this.delegate.rename?.bind(this.delegate)
			this.move = this.delegate.move?.bind(this.delegate)
			this.copy = this.delegate.copy?.bind(this.delegate)
			this.stat = this.delegate.stat?.bind(this.delegate)
			this.exists = this.delegate.exists?.bind(this.delegate)
			this.createMultipartUpload = this.delegate.createMultipartUpload?.bind(this.delegate)
			this.uploadPart = this.delegate.uploadPart?.bind(this.delegate)
			this.completeMultipartUpload = this.delegate.completeMultipartUpload?.bind(this.delegate)
			this.abortMultipartUpload = this.delegate.abortMultipartUpload?.bind(this.delegate)
			this.bulkDownloadUrl = this.delegate.bulkDownloadUrl?.bind(this.delegate)
			return
		}

		this.sdk = {
			bucket: options.bucket,
			client: options.client,
			multipartPartSize: Math.max(1, options.multipartPartSize ?? DEFAULT_MULTIPART_PART_SIZE),
			prefix: normalizeObjectPrefix(options.prefix),
			signedUrlExpiresIn: options.signedUrlExpiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN
		}
		this.createFolder = this.createFolderEntry.bind(this)
		this.copy = this.copyEntries.bind(this)
		this.stat = this.statEntry.bind(this)
		this.exists = this.existsEntries.bind(this)
		this.createMultipartUpload = this.createMultipartUploadEntry.bind(this)
		this.uploadPart = this.uploadMultipartPart.bind(this)
		this.completeMultipartUpload = this.completeMultipartUploadEntry.bind(this)
		this.abortMultipartUpload = this.abortMultipartUploadEntry.bind(this)
	}

	async list(path: string, opts: FileBrowserListOptions = {}): Promise<FileBrowserListResult<TMetadata>> {
		if (!this.sdk) {
			return this.delegate!.list(path, opts)
		}

		throwIfAborted(opts.signal)
		const response = await this.send<S3ListResponse>(
			new ListObjectsV2Command({
				Bucket: this.sdk.bucket,
				ContinuationToken: opts.cursor,
				Delimiter: '/',
				Prefix: this.pathToPrefix(path)
			})
		)
		const folderItems =
			response.CommonPrefixes?.flatMap((entry) => {
				if (!entry.Prefix) {
					return []
				}
				return [
					{
						kind: 'folder' as const,
						name: getFileBrowserBasename(this.keyToPath(entry.Prefix, true)),
						path: this.keyToPath(entry.Prefix, true)
					}
				]
			}) ?? []
		const fileItems =
			response.Contents?.flatMap((entry) => {
				if (!entry.Key || entry.Key.endsWith('/')) {
					return []
				}
				const path = this.keyToPath(entry.Key)
				if (path === normalizeFileBrowserPath(path)) {
					return [
						{
							etag: cleanEtag(entry.ETag),
							kind: 'file' as const,
							mimeType: entry.ContentType,
							modifiedAt: entry.LastModified?.toISOString(),
							name: getFileBrowserBasename(path),
							path,
							size: entry.Size
						}
					]
				}
				return []
			}) ?? []

		return {
			cursor: response.NextContinuationToken,
			items: [...folderItems, ...fileItems].sort(compareNodes)
		}
	}

	private async createFolderEntry(path: string): Promise<FileNode<TMetadata>> {
		const sdk = this.sdk
		if (!sdk) {
			throw new FileBrowserAdapterError(
				'not_supported',
				'S3 adapter method createFolder requires a host-backed implementation.'
			)
		}
		const normalized = normalizeFileBrowserPath(path)
		await this.send<S3PutResponse>(
			new PutObjectCommand({
				Body: '',
				Bucket: sdk.bucket,
				ContentType: 'application/x-directory',
				Key: this.pathToPrefix(normalized)
			})
		)
		return {
			kind: 'folder',
			name: getFileBrowserBasename(normalized),
			path: normalized
		}
	}

	async delete(paths: string[]): Promise<void> {
		if (!this.sdk) {
			return this.delegate!.delete(paths)
		}

		const keys = new Set<string>()
		for (const path of paths) {
			for (const key of await this.resolveKeysForPath(path)) {
				keys.add(key)
			}
		}

		for (const chunk of chunkArray(Array.from(keys), 1000)) {
			if (chunk.length === 0) {
				continue
			}
			await this.send<unknown>(
				new DeleteObjectsCommand({
					Bucket: this.sdk.bucket,
					Delete: {
						Objects: chunk.map((key) => ({ Key: key })),
						Quiet: true
					}
				})
			)
		}
	}

	async signedUrl(path: string): Promise<string> {
		if (!this.sdk) {
			return this.delegate!.signedUrl(path)
		}

		return getSignedUrl(
			this.sdk.client as never,
			new GetObjectCommand({
				Bucket: this.sdk.bucket,
				Key: this.pathToKey(path)
			}),
			{ expiresIn: this.sdk.signedUrlExpiresIn }
		)
	}

	async upload(path: string, file: File, opts: FileBrowserUploadOptions = {}): Promise<FileNode<TMetadata>> {
		if (!this.sdk) {
			return this.delegate!.upload(path, file, opts)
		}

		throwIfAborted(opts.signal)
		const normalized = await this.resolveUploadPath(path, opts.onConflict)
		opts.onProgress?.(0, file.size)
		throwIfAborted(opts.signal)

		const response = await this.send<S3PutResponse>(
			new PutObjectCommand({
				Body: file,
				Bucket: this.sdk.bucket,
				ContentType: file.type || undefined,
				Key: this.pathToKey(normalized)
			})
		)
		opts.onProgress?.(file.size, file.size)

		return {
			etag: cleanEtag(response.ETag),
			kind: 'file',
			mimeType: file.type || undefined,
			name: getFileBrowserBasename(normalized) || file.name,
			path: normalized,
			size: file.size
		}
	}

	private async statEntry(path: string): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)
		const key = this.pathToKey(normalized)

		try {
			const response = await this.send<S3HeadResponse>(
				new HeadObjectCommand({
					Bucket: this.sdk!.bucket,
					Key: key
				})
			)
			return {
				etag: cleanEtag(response.ETag),
				kind: 'file',
				mimeType: response.ContentType,
				modifiedAt: response.LastModified?.toISOString(),
				name: getFileBrowserBasename(normalized),
				path: normalized,
				size: response.ContentLength
			}
		} catch (error) {
			if (!isAdapterNotFound(error)) {
				throw error
			}
		}

		const response = await this.send<S3ListResponse>(
			new ListObjectsV2Command({
				Bucket: this.sdk!.bucket,
				MaxKeys: 1,
				Prefix: this.pathToPrefix(normalized)
			})
		)
		if ((response.Contents?.length ?? 0) > 0) {
			return {
				kind: 'folder',
				name: getFileBrowserBasename(normalized),
				path: normalized
			}
		}

		throw new FileBrowserAdapterError('not_found', `No file browser entry exists at ${normalized}`)
	}

	private async existsEntries(paths: string[]): Promise<Record<string, boolean>> {
		const entries: Record<string, boolean> = {}
		await Promise.all(
			paths.map(async (path) => {
				const normalized = normalizeFileBrowserPath(path)
				try {
					await this.statEntry(normalized)
					entries[normalized] = true
				} catch (error) {
					if (!isAdapterNotFound(error)) {
						throw error
					}
					entries[normalized] = false
				}
			})
		)
		return entries
	}

	private async copyEntries(from: string[], toDir: string): Promise<void> {
		for (const sourcePath of from) {
			const normalizedSource = normalizeFileBrowserPath(sourcePath)
			const sourceBase = this.pathToPrefix(normalizedSource)
			const destinationBase = this.pathToKey(joinFileBrowserPath(toDir, getFileBrowserBasename(normalizedSource)))
			const keys = await this.resolveKeysForPath(normalizedSource)

			for (const sourceKey of keys) {
				const suffix = sourceKey.startsWith(sourceBase)
					? sourceKey.slice(sourceBase.length)
					: getFileBrowserBasename(this.keyToPath(sourceKey))
				const destinationKey = suffix ? `${destinationBase}/${suffix}` : destinationBase
				await this.send<unknown>(
					new CopyObjectCommand({
						Bucket: this.sdk!.bucket,
						CopySource: encodeCopySource(this.sdk!.bucket, sourceKey),
						Key: destinationKey
					})
				)
			}
		}
	}

	private async createMultipartUploadEntry(
		path: string,
		size: number
	): Promise<{ uploadId: string; partSize: number }> {
		const normalized = normalizeFileBrowserPath(path)
		const key = this.pathToKey(normalized)
		const response = await this.send<S3MultipartCreateResponse>(
			new CreateMultipartUploadCommand({
				Bucket: this.sdk!.bucket,
				Key: key
			})
		)
		if (!response.UploadId) {
			throw new FileBrowserAdapterError('not_supported', 'S3-compatible multipart upload did not return an upload id.')
		}
		this.multipartSessions.set(response.UploadId, {
			key,
			path: normalized,
			size
		})
		return {
			partSize: this.sdk!.multipartPartSize,
			uploadId: response.UploadId
		}
	}

	private async uploadMultipartPart({
		chunk,
		onProgress,
		partNumber,
		signal,
		uploadId
	}: {
		uploadId: string
		partNumber: number
		chunk: Blob
		signal?: AbortSignal
		onProgress?: (loaded: number) => void
	}): Promise<{ etag: string }> {
		throwIfAborted(signal)
		const session = this.getMultipartSession(uploadId)
		const response = await this.send<S3UploadPartResponse>(
			new UploadPartCommand({
				Body: chunk,
				Bucket: this.sdk!.bucket,
				Key: session.key,
				PartNumber: partNumber,
				UploadId: uploadId
			})
		)
		onProgress?.(chunk.size)
		return {
			etag: cleanEtag(response.ETag) ?? `part-${partNumber}`
		}
	}

	private async completeMultipartUploadEntry({
		parts,
		uploadId
	}: {
		uploadId: string
		parts: MultipartUploadPart[]
	}): Promise<FileNode<TMetadata>> {
		const session = this.getMultipartSession(uploadId)
		const response = await this.send<S3PutResponse>(
			new CompleteMultipartUploadCommand({
				Bucket: this.sdk!.bucket,
				Key: session.key,
				MultipartUpload: {
					Parts: parts.map((part) => ({
						ETag: part.etag,
						PartNumber: part.partNumber
					}))
				},
				UploadId: uploadId
			})
		)
		this.multipartSessions.delete(uploadId)
		return {
			etag: cleanEtag(response.ETag),
			kind: 'file',
			name: getFileBrowserBasename(session.path),
			path: session.path,
			size: session.size
		}
	}

	private async abortMultipartUploadEntry(uploadId: string): Promise<void> {
		const session = this.getMultipartSession(uploadId)
		await this.send<unknown>(
			new AbortMultipartUploadCommand({
				Bucket: this.sdk!.bucket,
				Key: session.key,
				UploadId: uploadId
			})
		)
		this.multipartSessions.delete(uploadId)
	}

	private async resolveKeysForPath(path: string): Promise<string[]> {
		const normalized = normalizeFileBrowserPath(path)
		const exactKey = this.pathToKey(normalized)
		const keys = new Set<string>()

		if (await this.objectExists(exactKey)) {
			keys.add(exactKey)
		}

		const folderPrefix = this.pathToPrefix(normalized)
		let cursor: string | undefined
		do {
			const response = await this.send<S3ListResponse>(
				new ListObjectsV2Command({
					Bucket: this.sdk!.bucket,
					ContinuationToken: cursor,
					Prefix: folderPrefix
				})
			)
			for (const entry of response.Contents ?? []) {
				if (entry.Key) {
					keys.add(entry.Key)
				}
			}
			cursor = response.NextContinuationToken
		} while (cursor)

		return Array.from(keys)
	}

	private async objectExists(key: string): Promise<boolean> {
		try {
			await this.send<S3HeadResponse>(
				new HeadObjectCommand({
					Bucket: this.sdk!.bucket,
					Key: key
				})
			)
			return true
		} catch (error) {
			if (isAdapterNotFound(error)) {
				return false
			}
			throw error
		}
	}

	private async resolveUploadPath(path: string, onConflict: FileBrowserUploadOptions['onConflict']): Promise<string> {
		let normalized = normalizeFileBrowserPath(path)
		if (onConflict === 'replace') {
			return normalized
		}

		if (!(await this.objectExists(this.pathToKey(normalized)))) {
			return normalized
		}

		if (onConflict !== 'keep-both') {
			throw new FileBrowserAdapterError('conflict', `A file browser entry already exists at ${normalized}`)
		}

		for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
			normalized = addCopySuffix(path, index)
			if (!(await this.objectExists(this.pathToKey(normalized)))) {
				return normalized
			}
		}

		throw new FileBrowserAdapterError('conflict', `Could not allocate a unique file browser path for ${path}`)
	}

	private getMultipartSession(uploadId: string): S3MultipartSession {
		const session = this.multipartSessions.get(uploadId)
		if (!session) {
			throw new FileBrowserAdapterError('not_found', `No multipart upload session exists for ${uploadId}`)
		}
		return session
	}

	private pathToKey(path: string): string {
		const normalized = normalizeFileBrowserPath(path)
		const relative = normalized === '/' ? '' : normalized.slice(1)
		if (this.sdk!.prefix && relative) {
			return `${this.sdk!.prefix}/${relative}`
		}
		return this.sdk!.prefix || relative
	}

	private pathToPrefix(path: string): string {
		const key = this.pathToKey(path)
		return key ? `${key.replace(/\/$/, '')}/` : ''
	}

	private keyToPath(key: string, folder = false): string {
		let relative = key
		if (this.sdk!.prefix && relative === this.sdk!.prefix) {
			relative = ''
		} else if (this.sdk!.prefix && relative.startsWith(`${this.sdk!.prefix}/`)) {
			relative = relative.slice(this.sdk!.prefix.length + 1)
		}
		if (folder) {
			relative = relative.replace(/\/$/, '')
		}
		return normalizeFileBrowserPath(`/${relative}`)
	}

	private async send<T>(command: object): Promise<T> {
		try {
			return (await this.sdk!.client.send(command)) as T
		} catch (error) {
			throw toS3AdapterError(error)
		}
	}
}

function normalizeObjectPrefix(prefix: string | undefined): string {
	return (prefix ?? '').trim().replace(/^\/+|\/+$/g, '')
}

function cleanEtag(etag: string | undefined): string | undefined {
	return etag?.replace(/^"|"$/g, '')
}

function compareNodes(left: FileNode, right: FileNode): number {
	if (left.kind !== right.kind) {
		return left.kind === 'folder' ? -1 : 1
	}
	return left.name.localeCompare(right.name)
}

function encodeCopySource(bucket: string, key: string): string {
	return `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`
}

function addCopySuffix(path: string, index: number): string {
	const normalized = normalizeFileBrowserPath(path)
	const basename = getFileBrowserBasename(normalized)
	const dotIndex = basename.lastIndexOf('.')
	const hasExtension = dotIndex > 0
	const stem = hasExtension ? basename.slice(0, dotIndex) : basename
	const extension = hasExtension ? basename.slice(dotIndex) : ''
	const dir = normalized.slice(0, Math.max(1, normalized.lastIndexOf('/')))
	return normalizeFileBrowserPath(`${dir}/${stem} (${index})${extension}`)
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new FileBrowserAdapterError('aborted', 'The operation was aborted.')
	}
}

function isAdapterNotFound(error: unknown): boolean {
	return error instanceof FileBrowserAdapterError && error.code === 'not_found'
}

function toS3AdapterError(error: unknown): FileBrowserAdapterError {
	if (error instanceof FileBrowserAdapterError) {
		return error
	}

	const candidate = error as {
		$metadata?: { httpStatusCode?: number }
		message?: string
		name?: string
	}
	const status = candidate.$metadata?.httpStatusCode
	if (candidate.name === 'AbortError') {
		return new FileBrowserAdapterError('aborted', 'The operation was aborted.', {
			cause: error
		})
	}
	if (status === 403 || candidate.name === 'AccessDenied') {
		return new FileBrowserAdapterError('access_denied', candidate.message ?? 'Access denied by the object store.', {
			cause: error
		})
	}
	if (status === 404 || candidate.name === 'NotFound' || candidate.name === 'NoSuchKey') {
		return new FileBrowserAdapterError('not_found', candidate.message ?? 'The object does not exist.', { cause: error })
	}
	return new FileBrowserAdapterError('not_supported', candidate.message ?? 'The object store request failed.', {
		cause: error
	})
}
