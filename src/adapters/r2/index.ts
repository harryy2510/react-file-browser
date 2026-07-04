import {
  S3CompatibleFileBrowserAdapter,
  type S3CompatibleFileBrowserAdapterOptions,
} from "../s3-compatible-adapter";

export type R2FileBrowserAdapterOptions =
  S3CompatibleFileBrowserAdapterOptions;

export class R2FileBrowserAdapter extends S3CompatibleFileBrowserAdapter {
  constructor(options?: R2FileBrowserAdapterOptions) {
    super("R2", options);
  }
}
