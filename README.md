# @harryy/react-file-browser

A standalone, storage-agnostic React file manager component. Ships UI and client logic only, with
zero server code. Storage access goes through a host-provided adapter, so the same component drives
S3, Cloudflare R2, Supabase Storage, an in-memory store, or any backend you implement.

[![npm version](https://img.shields.io/npm/v/@harryy/react-file-browser.svg)](https://www.npmjs.com/package/@harryy/react-file-browser)
[![npm downloads](https://img.shields.io/npm/dm/@harryy/react-file-browser.svg)](https://www.npmjs.com/package/@harryy/react-file-browser)
[![CI](https://github.com/harryy2510/react-file-browser/actions/workflows/ci.yml/badge.svg)](https://github.com/harryy2510/react-file-browser/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@harryy/react-file-browser)](https://bundlephobia.com/package/@harryy/react-file-browser)
[![types](https://img.shields.io/npm/types/@harryy/react-file-browser.svg)](https://www.npmjs.com/package/@harryy/react-file-browser)
[![license](https://img.shields.io/npm/l/@harryy/react-file-browser.svg)](LICENSE)

**[Live demo →](https://harryy2510.github.io/react-file-browser/)**

## Features

- **Storage-agnostic** — one component, pluggable adapters. Ships adapters for S3, R2, Supabase, and
  in-memory, or implement the `FileBrowserAdapter` interface for any backend.
- **Capability-gated UI** — controls appear only when the adapter supports them. Omit `rename` and the
  rename affordance disappears; no config flags to keep in sync.
- **Resumable uploads** — session-scoped transfer manager with multipart support, a floating transfer
  widget, progress, and a resume prompt after a hard refresh.
- **Grid and list views**, search, filter, sort, drag-and-drop move, cut/copy/paste, multi-select,
  keyboard shortcuts, file preview, and a details panel.
- **Bulk download** — uses the adapter's `bulkDownloadUrl` when present, otherwise builds a client-side
  zip from signed URLs.
- **Upload policies** — reject files by MIME type, size, remaining quota, or a custom validator before
  they enqueue.
- **Themeable** with CSS variables that inherit your Tailwind v4 / design-system tokens. No global CSS
  shipped.
- **Read-only mode**, comfortable/compact density, ESM-only, fully typed.

## Install

```bash
bun add @harryy/react-file-browser
# or: npm install @harryy/react-file-browser
```

`react` and `react-dom` (>=18 <20) are peer dependencies. The AWS SDK and Supabase client are
optional peers, needed only for their respective adapters.

## Quick start

```tsx
import { FileBrowser, FileBrowserProvider } from "@harryy/react-file-browser";
import { InMemoryFileBrowserAdapter } from "@harryy/react-file-browser/adapters/in-memory";

const adapter = new InMemoryFileBrowserAdapter();

export function App() {
  return (
    <FileBrowserProvider>
      <FileBrowser adapter={adapter} />
    </FileBrowserProvider>
  );
}
```

`FileBrowserProvider` belongs above your router. It owns the session-scoped `TransferManager`, the
floating transfer widget, and the refresh guard. `FileBrowser` can mount on any page or modal and can
unmount while transfers keep running.

## Mount points

After a hard refresh, browsers cannot restore the original `File` object automatically. Use
`resolveRestoredUpload` to reattach the host adapter and a user-selected file when the resume prompt
is accepted:

```tsx
<FileBrowserProvider
  resolveRestoredUpload={async (upload) => {
    const file = await askUserForFile(upload.name);
    return file ? { adapter, file } : undefined;
  }}
>
  <App />
</FileBrowserProvider>
```

## Adapters

The core contract is the `FileBrowserAdapter` interface. Available built-in adapters:

- `@harryy/react-file-browser/adapters/in-memory`
- `@harryy/react-file-browser/adapters/s3`
- `@harryy/react-file-browser/adapters/r2`
- `@harryy/react-file-browser/adapters/supabase`

The in-memory adapter is usable for tests and demos. It can opt into multipart methods with
`capabilities: { multipart: true }` and `multipartPartSize` so resumable upload flows are testable
without cloud credentials. Cloud adapter subpaths fail closed when used without options, so importing
them is safe.

### S3 and R2

S3 and R2 use the S3-compatible SDK surface when you provide a client and bucket:

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { S3FileBrowserAdapter } from "@harryy/react-file-browser/adapters/s3";

const adapter = new S3FileBrowserAdapter({
  bucket: "assets",
  client: new S3Client({ region: "us-east-1" }),
  prefix: "users/123",
});
```

`R2FileBrowserAdapter` accepts the same options. Both require `@aws-sdk/client-s3` and
`@aws-sdk/s3-request-presigner` to be installed.

### Supabase

```ts
import { createClient } from "@supabase/supabase-js";
import { SupabaseFileBrowserAdapter } from "@harryy/react-file-browser/adapters/supabase";

const supabase = createClient(url, anonKey);
const adapter = new SupabaseFileBrowserAdapter({
  bucket: "assets",
  client: supabase,
  prefix: "users/123",
});
```

### Custom backends

Implement the `FileBrowserAdapter` interface directly, or pass a custom `implementation` to any cloud
adapter to delegate required and optional methods:

```ts
import { S3FileBrowserAdapter } from "@harryy/react-file-browser/adapters/s3";

const adapter = new S3FileBrowserAdapter({
  implementation: hostBackedAdapter,
});
```

Only `list`, `delete`, `signedUrl`, and `upload` are required. Everything else is optional and toggles
UI capabilities by presence. If an adapter omits `createFolder`, `move`, `rename`, `copy`, multipart,
or `bulkDownloadUrl`, those controls are hidden. Recursive folder drops are rejected when
`createFolder` is absent rather than flattened.

## API reference

### `<FileBrowser>` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `adapter` | `FileBrowserAdapter` | — (required) | Storage backend. |
| `initialPath` | `string` | `"/"` | Directory to open on mount. |
| `density` | `"comfortable" \| "compact"` | `"comfortable"` | Row/tile density. |
| `readOnly` | `boolean` | `false` | Hides all mutating affordances. |
| `showDetailsPanel` | `boolean` | `true` | Toggles the right-hand details panel. |
| `uploadPolicy` | `FileBrowserUploadPolicy` | — | Reject files before they enqueue. |
| `warnZipSizeBytes` | `number` | — | Warn before building a large client-side zip. |

### `<FileBrowserProvider>` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `manager` | `TransferManager` | auto-created | Bring your own transfer manager. |
| `options` | `TransferManagerOptions` | — | Storage, storage key, id factory, clock. |
| `resolveRestoredUpload` | `(upload) => ... \| undefined` | — | Reattach a `File` when resuming after reload. |
| `showFloatingWidget` | `boolean` | `true` | Toggles the floating transfer widget. |

### `FileBrowserAdapter` interface

**Required:** `list`, `delete`, `signedUrl`, `upload`.

**Optional (each toggles a UI capability):** `createFolder`, `rename`, `move`, `copy`, `stat`,
`exists`, `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`,
`bulkDownloadUrl`.

Throw `FileBrowserAdapterError` with a code (`access_denied`, `aborted`, `conflict`, `invalid_path`,
`not_found`, `not_supported`) for correct error mapping, and `FileBrowserBulkActionError` for partial
bulk failures so successful paths stay applied and failed paths roll back.

### Headless usage

`useFileBrowser({ adapter, initialPath })` exposes the full state and actions if you want to build your
own UI. The `FileBrowser` component is a consumer of this hook.

### Entry points

| Import | Contents |
| --- | --- |
| `@harryy/react-file-browser` | `FileBrowser`, `FileBrowserProvider`, `useFileBrowser`, `TransferManager`, adapter types and errors, path utilities. |
| `@harryy/react-file-browser/adapters/in-memory` | `InMemoryFileBrowserAdapter`, `createInMemoryFileBrowserAdapter`. |
| `@harryy/react-file-browser/adapters/s3` | `S3FileBrowserAdapter`. |
| `@harryy/react-file-browser/adapters/r2` | `R2FileBrowserAdapter`. |
| `@harryy/react-file-browser/adapters/supabase` | `SupabaseFileBrowserAdapter`. |
| `@harryy/react-file-browser/theme` | `FILE_BROWSER_THEME_CONTRACT`, `getFileBrowserDensityAttributes`. |

## Styling

The package does not ship global CSS. Components use utility classes and `--fb-*` CSS variables that
fall back to your Tailwind v4 / design-system tokens:

```css
--fb-accent: var(--color-primary-500, oklch(.54 .19 285));
--fb-surface: var(--color-white, #fff);
--fb-border: var(--color-gray-200, #e5e5ee);
--fb-radius: var(--radius-lg, 10px);
--fb-gap: var(--spacing, .25rem);
```

Add the library source to your Tailwind v4 content/source setup so host builds include the classes.
The demo app defines a full theme; the package itself does not. `FILE_BROWSER_THEME_CONTRACT`
documents every token and its default.

## UI behavior

- `readOnly` hides upload, create, rename, move, copy, and delete affordances while keeping browsing,
  preview, details, and download available.
- `uploadPolicy` can reject files before enqueueing transfers by MIME type, extension, max file size,
  remaining quota, or a custom validator. Rejections render as an alert and valid files in the same
  batch still upload.
- Upload conflicts surface a replace / keep both / skip dialog with apply-to-all support.
- Partial bulk failures can be reported with `FileBrowserBulkActionError`; successful paths stay
  applied and failed paths are surfaced in a dialog.
- Single-file download uses `signedUrl`. Folder and multi-select bulk download uses `bulkDownloadUrl`
  when present, otherwise it builds a client zip from signed URLs after the configured size warning.
- Move-capable adapters enable the destination tree picker, Cut/Paste, and drag onto folders.
- Keyboard shortcuts include Enter preview/open, F2 rename, Delete confirm, Cmd/Ctrl+A selection, and
  Cmd/Ctrl+C/X/V for adapter-gated copy, cut, and paste.

## Required backend lifecycle

The package never creates server routes or lifecycle rules. Hosts must configure:

- Abort incomplete multipart uploads after N days.
- Expire temporary bulk-download zip objects after 4 to 8 hours.
- Keep zip output outside browsed/listed user prefixes.

Skipping these leaks storage cost.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, conventions, and
the release process. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Hariom Sharma
