# react-file-browser

A standalone, storage-agnostic React file manager. Desktop-grade UX (grid/list, nested folders,
multi-select + drag-marquee, cut/copy/paste, resumable chunked upload, server-zip bulk download),
**theme-native** (ships no global CSS — reads your Tailwind v4 tokens), and backend-agnostic (pluggable
class adapters; the library has no server of its own).

> 🚧 In development. See **[`docs/DESIGN.md`](docs/DESIGN.md)** for the full spec.

## Highlights

- **UI + client logic only, no server** — all storage I/O goes through an adapter you provide.
- **Adapters** ship as subpath exports: `react-file-browser/adapters/{s3,r2,supabase}` (cloud SDKs are
  optional peer deps). Bring your own by implementing `FileBrowserAdapter`.
- **Capability-gated** — features appear only when the adapter supports them (`move`, `rename`, `copy`,
  resumable multipart, server-zip).
- **Theme-native** — components read `--fb-*` CSS variables that fall back to your Tailwind v4 tokens.
  Light + dark by swapping token values; the library never defines a palette.
- **Transfers survive navigation** — uploads and zip downloads keep running when the browser unmounts or
  you navigate your SPA; a floating progress widget follows the user. Resumable chunked upload continues
  from the last completed part, even after a refresh.

## Two mount points

```tsx
// once, at your SPA root — owns transfers, the floating widget, the refresh guard
<FileBrowserProvider>
  <App />
</FileBrowserProvider>

// anywhere — the manager UI
<FileBrowser adapter={new S3Adapter({ /* ... */ })} />
```

## Required backend lifecycle (don't skip — see DESIGN.md §7)

- Abort-incomplete-multipart after N days (purges orphaned upload parts).
- Expire temp zip objects after 4–8h (bulk-download zips).

## License

MIT (TBD).
