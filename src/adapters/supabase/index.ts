import {
  SupabaseStorageFileBrowserAdapter,
  type SupabaseFileBrowserAdapterOptions,
} from "./supabase-file-browser-adapter";

export type { SupabaseFileBrowserAdapterOptions };

export class SupabaseFileBrowserAdapter extends SupabaseStorageFileBrowserAdapter {
  constructor(options?: SupabaseFileBrowserAdapterOptions) {
    super(options);
  }
}
