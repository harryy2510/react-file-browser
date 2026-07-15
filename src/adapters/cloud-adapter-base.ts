import { FileBrowserAdapterError } from '../core/types'
import type {
	FileBrowserAdapter,
	FileBrowserListOptions,
	FileBrowserListResult,
	FileBrowserUploadOptions,
	FileNode
} from '../core/types'

export type CloudAdapterName = 'S3' | 'R2' | 'Supabase'

export type CloudFileBrowserAdapterOptions<TMetadata = unknown> = {
	implementation?: FileBrowserAdapter<TMetadata>
}

export class UnsupportedCloudFileBrowserAdapter<TMetadata = unknown> implements FileBrowserAdapter<TMetadata> {
	readonly rename?: NonNullable<FileBrowserAdapter<TMetadata>['rename']>
	readonly createFolder?: NonNullable<FileBrowserAdapter<TMetadata>['createFolder']>
	readonly move?: NonNullable<FileBrowserAdapter<TMetadata>['move']>
	readonly copy?: NonNullable<FileBrowserAdapter<TMetadata>['copy']>
	readonly stat?: NonNullable<FileBrowserAdapter<TMetadata>['stat']>
	readonly exists?: NonNullable<FileBrowserAdapter<TMetadata>['exists']>
	readonly createMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['createMultipartUpload']>
	readonly uploadPart?: NonNullable<FileBrowserAdapter<TMetadata>['uploadPart']>
	readonly completeMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['completeMultipartUpload']>
	readonly abortMultipartUpload?: NonNullable<FileBrowserAdapter<TMetadata>['abortMultipartUpload']>
	readonly bulkDownloadUrl?: NonNullable<FileBrowserAdapter<TMetadata>['bulkDownloadUrl']>

	private readonly implementation?: FileBrowserAdapter<TMetadata>

	constructor(
		private readonly adapterName: CloudAdapterName,
		options: CloudFileBrowserAdapterOptions<TMetadata> = {}
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

	list(path: string, opts?: FileBrowserListOptions): Promise<FileBrowserListResult<TMetadata>> {
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

	upload(path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode<TMetadata>> {
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
