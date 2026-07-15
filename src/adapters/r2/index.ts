import { S3CompatibleFileBrowserAdapter } from '../s3-compatible-adapter'
import type { S3CompatibleFileBrowserAdapterOptions } from '../s3-compatible-adapter'

export type R2FileBrowserAdapterOptions<TMetadata = unknown> = S3CompatibleFileBrowserAdapterOptions<TMetadata>

export class R2FileBrowserAdapter<TMetadata = unknown> extends S3CompatibleFileBrowserAdapter<TMetadata> {
	constructor(options?: R2FileBrowserAdapterOptions<TMetadata>) {
		super('R2', options)
	}
}
