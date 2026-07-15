export type FileNodeKind = 'file' | 'folder'

export type FileNode<TMetadata = unknown> = {
	id?: string
	path: string
	name: string
	kind: FileNodeKind
	size?: number
	mimeType?: string
	modifiedAt?: string
	etag?: string
	thumbnailUrl?: string
	metadata?: TMetadata
}

export type FileBrowserListOptions = {
	cursor?: string
	signal?: AbortSignal
}

export type FileBrowserListResult<TMetadata = unknown> = {
	items: FileNode<TMetadata>[]
	cursor?: string
}

export type FileBrowserUploadOptions = {
	onProgress?: (loaded: number, total: number) => void
	onConflict?: 'replace' | 'keep-both'
	signal?: AbortSignal
}

export type MultipartUploadPart = {
	partNumber: number
	etag: string
}

export type FileBrowserAdapter<TMetadata = unknown> = {
	list(path: string, opts?: FileBrowserListOptions): Promise<FileBrowserListResult<TMetadata>>
	createFolder?(path: string): Promise<FileNode<TMetadata>>
	delete(paths: string[]): Promise<void>
	signedUrl(path: string): Promise<string>
	upload(path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode<TMetadata>>

	rename?(path: string, newName: string): Promise<FileNode<TMetadata>>
	move?(from: string[], toDir: string): Promise<void>
	copy?(from: string[], toDir: string): Promise<void>
	stat?(path: string): Promise<FileNode<TMetadata>>
	exists?(paths: string[]): Promise<Record<string, boolean>>

	createMultipartUpload?(path: string, size: number): Promise<{ uploadId: string; partSize: number }>
	uploadPart?(args: {
		uploadId: string
		partNumber: number
		chunk: Blob
		signal?: AbortSignal
		onProgress?: (loaded: number) => void
	}): Promise<{ etag: string }>
	completeMultipartUpload?(args: { uploadId: string; parts: MultipartUploadPart[] }): Promise<FileNode<TMetadata>>
	abortMultipartUpload?(uploadId: string): Promise<void>

	bulkDownloadUrl?(paths: string[]): Promise<{ url: string; expiresAt: string }>
}

export class FileBrowserAdapterError extends Error {
	readonly code: 'access_denied' | 'aborted' | 'conflict' | 'invalid_path' | 'not_found' | 'not_supported'

	constructor(code: FileBrowserAdapterError['code'], message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'FileBrowserAdapterError'
		this.code = code
	}
}

export type FileBrowserBulkAction = 'delete' | 'move' | 'copy'

export type FileBrowserBulkActionFailure = {
	path: string
	message: string
}

export class FileBrowserBulkActionError extends Error {
	readonly action: FileBrowserBulkAction
	readonly succeededPaths: string[]
	readonly failures: FileBrowserBulkActionFailure[]
	readonly totalCount: number

	constructor(
		action: FileBrowserBulkAction,
		options: {
			succeededPaths: string[]
			failures: FileBrowserBulkActionFailure[]
			totalCount: number
			message?: string
		}
	) {
		super(options.message ?? `${options.succeededPaths.length} of ${options.totalCount} ${action} operations completed`)
		this.name = 'FileBrowserBulkActionError'
		this.action = action
		this.succeededPaths = options.succeededPaths
		this.failures = options.failures
		this.totalCount = options.totalCount
	}
}
