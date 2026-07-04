import { FileBrowserAdapterError } from '../core/types'
import type {
	FileBrowserAdapter,
	FileBrowserListOptions,
	FileBrowserListResult,
	FileBrowserUploadOptions,
	FileNode
} from '../core/types'

export type CloudAdapterName = 'S3' | 'R2' | 'Supabase'

export type CloudFileBrowserAdapterOptions = {
	implementation?: FileBrowserAdapter
}

export class UnsupportedCloudFileBrowserAdapter implements FileBrowserAdapter {
	readonly rename?: NonNullable<FileBrowserAdapter['rename']>
	readonly createFolder?: NonNullable<FileBrowserAdapter['createFolder']>
	readonly move?: NonNullable<FileBrowserAdapter['move']>
	readonly copy?: NonNullable<FileBrowserAdapter['copy']>
	readonly stat?: NonNullable<FileBrowserAdapter['stat']>
	readonly exists?: NonNullable<FileBrowserAdapter['exists']>
	readonly createMultipartUpload?: NonNullable<FileBrowserAdapter['createMultipartUpload']>
	readonly uploadPart?: NonNullable<FileBrowserAdapter['uploadPart']>
	readonly completeMultipartUpload?: NonNullable<FileBrowserAdapter['completeMultipartUpload']>
	readonly abortMultipartUpload?: NonNullable<FileBrowserAdapter['abortMultipartUpload']>
	readonly bulkDownloadUrl?: NonNullable<FileBrowserAdapter['bulkDownloadUrl']>

	private readonly implementation?: FileBrowserAdapter

	constructor(
		private readonly adapterName: CloudAdapterName,
		options: CloudFileBrowserAdapterOptions = {}
	) {
		this.implementation = options.implementation

		if (this.implementation?.rename) {
			this.rename = this.implementation.rename.bind(this.implementation)
		}
		if (this.implementation?.createFolder) {
			this.createFolder = this.implementation.createFolder.bind(this.implementation)
		}
		if (this.implementation?.move) {
			this.move = this.implementation.move.bind(this.implementation)
		}
		if (this.implementation?.copy) {
			this.copy = this.implementation.copy.bind(this.implementation)
		}
		if (this.implementation?.stat) {
			this.stat = this.implementation.stat.bind(this.implementation)
		}
		if (this.implementation?.exists) {
			this.exists = this.implementation.exists.bind(this.implementation)
		}
		if (this.implementation?.createMultipartUpload) {
			this.createMultipartUpload = this.implementation.createMultipartUpload.bind(this.implementation)
		}
		if (this.implementation?.uploadPart) {
			this.uploadPart = this.implementation.uploadPart.bind(this.implementation)
		}
		if (this.implementation?.completeMultipartUpload) {
			this.completeMultipartUpload = this.implementation.completeMultipartUpload.bind(this.implementation)
		}
		if (this.implementation?.abortMultipartUpload) {
			this.abortMultipartUpload = this.implementation.abortMultipartUpload.bind(this.implementation)
		}
		if (this.implementation?.bulkDownloadUrl) {
			this.bulkDownloadUrl = this.implementation.bulkDownloadUrl.bind(this.implementation)
		}
	}

	list(path: string, opts?: FileBrowserListOptions): Promise<FileBrowserListResult> {
		if (this.implementation) {
			return this.implementation.list(path, opts)
		}
		void path
		void opts
		return Promise.reject(this.error('list'))
	}

	delete(paths: string[]): Promise<void> {
		if (this.implementation) {
			return this.implementation.delete(paths)
		}
		void paths
		return Promise.reject(this.error('delete'))
	}

	signedUrl(path: string): Promise<string> {
		if (this.implementation) {
			return this.implementation.signedUrl(path)
		}
		void path
		return Promise.reject(this.error('signedUrl'))
	}

	upload(path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode> {
		if (this.implementation) {
			return this.implementation.upload(path, file, opts)
		}
		void path
		void file
		void opts
		return Promise.reject(this.error('upload'))
	}

	private error(method: string): FileBrowserAdapterError {
		return new FileBrowserAdapterError(
			'not_supported',
			`${this.adapterName} adapter method ${method} requires a host-backed implementation.`
		)
	}
}
