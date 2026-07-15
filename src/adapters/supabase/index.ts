import { SupabaseStorageFileBrowserAdapter } from './supabase-file-browser-adapter'
import type { SupabaseFileBrowserAdapterOptions } from './supabase-file-browser-adapter'

export type { SupabaseFileBrowserAdapterOptions }

export class SupabaseFileBrowserAdapter<TMetadata = unknown> extends SupabaseStorageFileBrowserAdapter<TMetadata> {
	constructor(options?: SupabaseFileBrowserAdapterOptions<TMetadata>) {
		super(options)
	}
}
