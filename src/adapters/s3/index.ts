import { S3CompatibleFileBrowserAdapter } from '../s3-compatible-adapter'
import type { S3CompatibleFileBrowserAdapterOptions } from '../s3-compatible-adapter'

export type S3FileBrowserAdapterOptions = S3CompatibleFileBrowserAdapterOptions

export class S3FileBrowserAdapter extends S3CompatibleFileBrowserAdapter {
	constructor(options?: S3FileBrowserAdapterOptions) {
		super('S3', options)
	}
}
