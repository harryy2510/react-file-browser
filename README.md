# react-file-browser

A standalone, storage-agnostic React file manager. The package ships UI and client logic only. Storage
access goes through a host-provided adapter, and styling reads the host Tailwind v4 tokens through
`--fb-*` variables.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full build spec and
[`docs/design/File-Browser-UI-Spec.dc.html`](docs/design/File-Browser-UI-Spec.dc.html) for the visual
source of truth.

## Install

```bash
bun add react-file-browser
```

React is a peer dependency. The library is ESM-only and emits TypeScript declarations.

## Mount Points

```tsx
import { FileBrowser, FileBrowserProvider } from "react-file-browser";
import { InMemoryFileBrowserAdapter } from "react-file-browser/adapters/in-memory";

const adapter = new InMemoryFileBrowserAdapter();

export function App() {
  return (
    <FileBrowserProvider>
      <FileBrowser adapter={adapter} />
    </FileBrowserProvider>
  );
}
```

`FileBrowserProvider` belongs above your router. It owns the session-scoped `TransferManager`,
floating transfer widget, and refresh guard. `FileBrowser` can mount on any page or modal and can
unmount while transfers keep running.

After a hard refresh, browsers cannot restore the original `File` object automatically. Use
`resolveRestoredUpload` to reattach the host adapter and a user-selected file when the resume prompt is
accepted:

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

## Styling

The package does not ship global CSS. Components use utility classes and CSS variables:

```css
--fb-accent: var(--color-primary-500, oklch(.54 .19 285));
--fb-surface: var(--color-white, #fff);
--fb-border: var(--color-gray-200, #e5e5ee);
--fb-radius: var(--radius-lg, 10px);
--fb-gap: var(--spacing, .25rem);
```

Add the library source to your Tailwind v4 content/source setup so host builds include the classes.
The demo app defines a full theme; the package itself does not.

## Adapters

Core adapter contract:

```ts
import type { FileBrowserAdapter } from "react-file-browser";
```

Available subpaths:

- `react-file-browser/adapters/in-memory`
- `react-file-browser/adapters/s3`
- `react-file-browser/adapters/r2`
- `react-file-browser/adapters/supabase`

The in-memory adapter is usable for tests and demos. It can opt into multipart methods with
`capabilities: { multipart: true }` and `multipartPartSize` so resumable upload flows are testable
without cloud credentials. Cloud adapter subpaths fail closed when used without options, so importing
them is safe.

S3 and R2 use the S3-compatible SDK surface when you provide a client and bucket:

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { S3FileBrowserAdapter } from "react-file-browser/adapters/s3";

const adapter = new S3FileBrowserAdapter({
  bucket: "assets",
  client: new S3Client({ region: "us-east-1" }),
  prefix: "users/123",
});
```

`R2FileBrowserAdapter` accepts the same options. AWS SDK packages and Supabase are optional peer
dependencies; the core import does not load them. Supabase accepts a Supabase client and storage bucket:

```ts
import { createClient } from "@supabase/supabase-js";
import { SupabaseFileBrowserAdapter } from "react-file-browser/adapters/supabase";

const supabase = createClient(url, anonKey);
const adapter = new SupabaseFileBrowserAdapter({
  bucket: "assets",
  client: supabase,
  prefix: "users/123",
});
```

Hosts can also pass a custom storage implementation to delegate required and optional methods:

```ts
import { S3FileBrowserAdapter } from "react-file-browser/adapters/s3";

const adapter = new S3FileBrowserAdapter({
  implementation: hostBackedAdapter,
});
```

Capability gating is based on method presence. If an adapter omits `createFolder`, `move`, `rename`,
`copy`, multipart, or `bulkDownloadUrl`, those UI controls are hidden. Recursive folder drops are
rejected when `createFolder` is absent rather than flattened.

## UI Behavior

- `readOnly` hides upload, create, rename, move, copy, and delete affordances while keeping browsing,
  preview, details, and download available.
- `uploadPolicy` can reject files before enqueueing transfers by MIME type, extension, max file size,
  remaining quota, or a custom validator. Rejections render as an E19-style alert and valid files in the
  same batch still upload.
- Upload conflicts surface a replace / keep both / skip dialog with apply-to-all support.
- Partial bulk failures can be reported with `FileBrowserBulkActionError`; successful paths stay
  applied and failed paths are surfaced in a dialog.
- Single-file download uses `signedUrl`. Folder and multi-select bulk download uses
  `bulkDownloadUrl` when present, otherwise it builds a client zip from signed URLs after the
  configured size warning.
- Move-capable adapters enable the destination tree picker, Cut/Paste, and drag onto folders.
- Keyboard shortcuts include Enter preview/open, F2 rename, Delete confirm, Cmd/Ctrl+A selection, and
  Cmd/Ctrl+C/X/V for adapter-gated copy, cut, and paste.

## Required Backend Lifecycle

The package never creates server routes or lifecycle rules. Hosts must configure:

- Abort incomplete multipart uploads after N days.
- Expire temporary bulk-download zip objects after 4 to 8 hours.
- Keep zip output outside browsed/listed user prefixes.

Skipping these leaks storage cost.

## Scripts

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run validate
```

`validate` runs typecheck, lint, unit tests, library build, and demo build.
