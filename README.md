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
- **List and grid views** with row checkboxes, sortable columns, a per-item actions menu, file-type
  icons, search, filter, sort, drag-and-drop move, cut/copy/paste, multi-select, and keyboard shortcuts.
- **Files open in place** — double-click or Enter opens a file inside the browser in Preview, with an
  Edit switch when an editor matches, Save/Cancel, a size counter, and conflict and unsaved-changes guards.
- **Preview and edit plugins** — browser-native previews for images, video, audio, PDF, HTML, and
  text, plus opt-in plugins for code, Markdown, CSV, XLSX, and DOCX. Configure them or bring your own.
- **Per-item read-only** — lock individual files or folders with `isItemReadOnly`.
- **Bulk download** — uses the adapter's `bulkDownloadUrl` when present, otherwise builds a client-side
  zip from signed URLs.
- **Upload policies** — reject files by MIME type, size, remaining quota, or a custom validator before
  they enqueue.
- **Host extension points** — controlled path and search state, opaque item ids, typed metadata,
  custom item metadata rendering, conflict policy, and custom empty states.
- **Themeable** with CSS variables that inherit your Tailwind v4 / design-system tokens. No global CSS
  shipped.
- **Read-only mode**, comfortable/compact density, ESM-only, fully typed.

### Responsive layouts

The browser responds to its **container width**, including when embedded in a narrow modal or split
pane. Below 40rem (640px with the default root font size), tap an item to open it. Long-press for
multi-selection, or choose **Browser options → Select items**, then use the visible checkboxes and
bottom action bar. Search stays visible; filter, sort, view, and folder creation live in Browser
options. Upload remains available above the footer.

Selection actions live in the toolbar above the list (and a bottom action bar on narrow layouts);
there is no details sidebar. Custom item renderers should use fluid widths.

Dialogs fit the available viewport height. Narrow menus and conflicts use bottom sheets. The
provider's transfer widget responds to the viewport, starts collapsed on phones, and expands into a
scrollable queue without changing transfer state. Desktop mouse and keyboard interactions remain
available, and touch controls retain their minimum target size in compact density.

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

### Host integration

`FileNode.path` remains the immutable storage key used by browser operations. Hosts can additionally
provide an opaque `id` and typed, sanitized metadata for domain-specific routes and rendering:

```tsx
import type { FileBrowserAdapter } from "@harryy/react-file-browser";
import { FileBrowser } from "@harryy/react-file-browser";

type IndexingMetadata = {
  indexingStatus: "pending" | "ready" | "failed";
  indexingError?: string;
};

declare const adapter: FileBrowserAdapter<IndexingMetadata>;

<FileBrowser<IndexingMetadata>
  adapter={adapter}
  rootLabel="Knowledge base"
  path={path}
  onPathChange={(nextPath, context) => {
    if (context.source === "item" && context.item.id) {
      navigateToFolder(context.item.id);
    }
    setPath(nextPath);
  }}
  searchQuery={searchQuery}
  onSearchQueryChange={setSearchQuery}
  renderItemMeta={(item) =>
    item.metadata ? <IndexingStatus status={item.metadata.indexingStatus} /> : null
  }
  uploadConflictResolutions={["keep-both", "skip"]}
  allowClientZipFallback={false}
/>;
```

`onPathChange` receives the target `FileNode` for item-originated folder navigation. Breadcrumb and
programmatic navigation may not have a node. Externally changing controlled `path` or `searchQuery`
updates the browser without firing the corresponding change callback again.

Controlled search does not require putting the query in the URL. Hosts handling sensitive filenames or
search terms should keep that state out of URLs, analytics, and other durable history surfaces unless
their data policy explicitly permits it.

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
| `initialView` | `'list' \| 'grid'` | `'list'` | The view the browser opens in. |
| `path` | `string` | None | Controlled current directory. |
| `onPathChange` | `(path, context) => void` | None | Receives item, breadcrumb, and programmatic navigation. |
| `searchQuery` | `string` | None | Controlled local search query. |
| `initialSearchQuery` | `string` | `""` | Initial uncontrolled search query. |
| `onSearchQueryChange` | `(query) => void` | None | Receives user-driven search changes. |
| `density` | `"comfortable" \| "compact"` | `"comfortable"` | Row/tile density. |
| `readOnly` | `boolean` | `false` | Hides all mutating affordances. |
| `uploadPolicy` | `FileBrowserUploadPolicy` | None | Reject files before they enqueue. |
| `uploadConflictResolutions` | `FileBrowserUploadConflictResolution[]` | all | Allowed conflict-dialog actions. |
| `allowClientZipFallback` | `boolean` | `true` | Allows browser-built ZIPs when no server ZIP exists. |
| `warnZipSizeBytes` | `number` | None | Warn before building a large client-side zip. |
| `rootLabel` | `string` | `"Files"` | Root breadcrumb and navigation label. |
| `emptyState` | `{ title: ReactNode; description?: ReactNode }` | built in | Empty-folder content. |
| `renderItemMeta` | `(item, { view }) => ReactNode` | None | Host metadata below grid/list item names. |
| `isItemReadOnly` | `(item) => boolean` | None | Locks items: no rename, move, cut, delete, edit, or drops into a locked folder. |
| `previewers` | `FileBrowserPreviewer[]` | `defaultFileBrowserPreviewers` | Inline preview renderers; first match wins. `[]` disables. |
| `editors` | `FileBrowserEditor[]` | `defaultFileBrowserEditors` | In-place editors; first match wins. `[]` disables editing. |
| `className` | `string` | None | Class name merged onto the root browser surface. |

### `<FileBrowserProvider>` props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `manager` | `TransferManager` | auto-created | Bring your own transfer manager. |
| `options` | `TransferManagerOptions` | — | Storage, concurrency, storage key, id factory, clock. |
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

It also accepts controlled `path`, `searchQuery`, and their change callbacks. `navigate(path)` emits a
`programmatic` path-change source, while `open(folder)` emits the complete target item.

### Entry points

| Import | Contents |
| --- | --- |
| `@harryy/react-file-browser` | `FileBrowser`, `FileBrowserProvider`, `useFileBrowser`, `TransferManager`, adapter types and errors, path utilities. |
| `@harryy/react-file-browser/adapters/in-memory` | `InMemoryFileBrowserAdapter`, `createInMemoryFileBrowserAdapter`. |
| `@harryy/react-file-browser/adapters/s3` | `S3FileBrowserAdapter`. |
| `@harryy/react-file-browser/adapters/r2` | `R2FileBrowserAdapter`. |
| `@harryy/react-file-browser/adapters/supabase` | `SupabaseFileBrowserAdapter`. |
| `@harryy/react-file-browser/plugins/code` | `codeEditor`, `codePreviewer`, `jsonEditor`, `markupEditor`, `getCodeLanguage`. |
| `@harryy/react-file-browser/plugins/markdown` | `markdownEditor`, `markdownPreviewer`, `markdownToHtml`, `htmlToMarkdown`. |
| `@harryy/react-file-browser/plugins/csv` | `csvEditor`, `csvPreviewer`. |
| `@harryy/react-file-browser/plugins/xlsx` | `xlsxEditor`, `xlsxPreviewer`. |
| `@harryy/react-file-browser/plugins/docx` | `docxPreviewer`. |
| `@harryy/react-file-browser/theme` | `FILE_BROWSER_THEME_CONTRACT`, `getFileBrowserDensityAttributes`. |

## Previews and editing

Out of the box the browser previews images, video, audio, PDF (the browser's own viewer), HTML (in a
sandboxed iframe that cannot run scripts), and plain text, and edits text files in a plain text area.
Everything else is opt-in: each plugin is its own import, and its npm package is an optional peer
dependency you install only if you use it.

| Plugin | Install | Does | Approx. gzip |
| --- | --- | --- | --- |
| `plugins/code` | `codejar prismjs` | Syntax-highlighted code editing and preview; HTML and SVG editing with a live preview beside the source (`markupEditor`); JSON editing with Format and an invalid-JSON save guard (`jsonEditor`) | 21 KB |
| `plugins/markdown` | `react-markdown squire-rte marked turndown dompurify` | Rendered Markdown preview (raw HTML ignored) and a WYSIWYG Markdown editor with a small toolbar (`markdownEditor`) | 92 KB |
| `plugins/csv` | `papaparse jspreadsheet-ce` | Spreadsheet-style CSV/TSV editing and preview | 136 KB |
| `plugins/xlsx` | `read-excel-file write-excel-file jspreadsheet-ce` | Spreadsheet-style XLSX editing and preview, one tab per sheet | 162 KB |
| `plugins/docx` | `docx-preview` | Word document preview | 50 KB |

Pass plugins ahead of the defaults; the first match wins:

```tsx
import { FileBrowser, defaultFileBrowserEditors, defaultFileBrowserPreviewers } from '@harryy/react-file-browser'
import { codeEditor, codePreviewer, jsonEditor, markupEditor } from '@harryy/react-file-browser/plugins/code'
import { csvEditor, csvPreviewer } from '@harryy/react-file-browser/plugins/csv'
import { markdownEditor, markdownPreviewer } from '@harryy/react-file-browser/plugins/markdown'
// Once, if you use the csv or xlsx plugin:
import 'jspreadsheet-ce/dist/jspreadsheet.css'
import 'jspreadsheet-ce/dist/jspreadsheet.themes.css'
import 'jsuites/dist/jsuites.css'

<FileBrowser
  adapter={adapter}
  previewers={[markdownPreviewer, csvPreviewer, codePreviewer, ...defaultFileBrowserPreviewers]}
  editors={[csvEditor, markdownEditor, markupEditor, jsonEditor, codeEditor, ...defaultFileBrowserEditors]}
/>
```

Notes:

- The csv and xlsx plugins use jspreadsheet-ce. Editing supports typing, Ctrl/Cmd+C, X, V and Z, and a
  right-click menu that inserts or deletes rows and columns in place. Comments, sorting, column
  renaming, and export are turned off. Previews are read-only with no menu. The plugin restyles the
  sheet, tabs, and menu with scoped `--fb-*` rules, so it follows your light and dark themes; the host
  still imports jspreadsheet's layout CSS (above).
- CSV saves keep typed formulas as text (`=A1*2`); XLSX saves write their computed values.
- Saving an XLSX writes cell values only. Formatting, formulas, charts, and images are lost, and the
  editor says so beside Save.
- Previewers and editors that read file contents `fetch` the adapter's signed URL, so that URL must
  allow cross-origin reads from your app.
- The editor checks `adapter.stat` before saving. If the file's `etag` (or `modifiedAt`) changed since
  it was opened, it offers Reload or Keep my version instead of overwriting. Saves go through
  `adapter.upload` with `onConflict: 'replace'`.
- The Markdown editor is visual: it converts Markdown to HTML (marked) to edit and back (turndown) to
  save, so saving may normalize formatting such as list markers and spacing.
  It cleans loaded and pasted markup with DOMPurify.
- Editors may set `validate(text)`; a returned message shows above the editor and disables Save.
- Write your own with the `FileBrowserPreviewer` and `FileBrowserEditor` types: `match(item)`,
  optional `read: 'text' | 'binary'`, `maxBytes`, and a `component`.

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
  preview and download available.
- `uploadPolicy` can reject files before enqueueing transfers by MIME type, extension, max file size,
  remaining quota, maximum files per batch, or a custom validator. A batch over `maxFilesPerBatch` is
  rejected before folders are created or transfers enqueue. Other rejections render as an alert and
  valid files in the same batch still upload.
- Upload conflicts surface a replace / keep both / skip dialog with apply-to-all support.
- Partial bulk failures can be reported with `FileBrowserBulkActionError`; successful paths stay
  applied and failed paths are surfaced in a dialog.
- Single-file download uses `signedUrl`. Folder and multi-select bulk download uses `bulkDownloadUrl`
  when present, otherwise it builds a client zip from signed URLs after the configured size warning.
  Set `allowClientZipFallback={false}` to require server ZIP support for folder and multi-file download.
- Move-capable adapters enable the destination tree picker, Cut/Paste, and drag onto folders.
- Keyboard shortcuts include Enter preview/open, F2 rename, Delete confirm, Cmd/Ctrl+A selection, and
  Cmd/Ctrl+C/X/V for adapter-gated copy, cut, and paste.
- The list view has row checkboxes with a select-all header, sortable Name/Size/Modified columns, and a
  three-dot actions menu per row (also on grid tiles).
- Opening a file (double-click, Enter, or Preview in the menu) replaces the list with the file: the
  breadcrumb extends to the file name, Previous/Next step through the folder's files, and Back or Escape
  returns to the list. It opens in Preview; Edit (or Edit in the menu) switches to the matching editor.
  Leaving with unsaved edits asks to discard them first.
- `isItemReadOnly(item)` locks individual items. Locked items show a lock icon;
  rename, move, cut, delete, and edit are hidden for them (and for any selection that includes one),
  F2 and Delete do nothing, they cannot be dragged, and a locked folder refuses dropped items. Download,
  copy path, and preview stay available. Items inside a locked folder are judged on their own.

### Transfer persistence and concurrency

Provider-owned managers use `window.localStorage` by default so resumable state can survive a refresh.
Set `options={{ storage: null }}` to keep transfer state in memory only. This preserves transfers across
SPA navigation and browser unmounts but writes no filenames, paths, results, or metadata to durable web
storage. Transfer persistence serializes only the fields needed to restore transfer status and resume
multipart work; arbitrary `FileNode.metadata` is never persisted.

Set `maxConcurrentUploads` in provider options to bound active uploads across every browser using that
provider. Queued, resumed, and restored uploads share the same limit:

```tsx
<FileBrowserProvider options={{ maxConcurrentUploads: MAX_CONCURRENT_UPLOADS, storage: null }}>
  <App />
</FileBrowserProvider>
```

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
