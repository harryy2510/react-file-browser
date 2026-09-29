import { FileText, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileBrowser, FileBrowserAdapterError, FileBrowserProvider, FileTree } from '@harryy/react-file-browser'
import type { FileBrowserAdapter, FileBrowserProps, FileNode } from '@harryy/react-file-browser'
import { InMemoryFileBrowserAdapter } from '@harryy/react-file-browser/adapters/in-memory'
import { getFileBrowserDensityAttributes } from '@harryy/react-file-browser/theme'

type DemoMode = {
	id: 'full' | 'readonly' | 'minimal' | 'policy' | 'compact' | 'empty' | 'denied' | 'tree'
	label: string
	description: string
}

const DEMO_MODES: DemoMode[] = [
	{
		id: 'full',
		label: 'Full',
		description: 'All optional in-memory capabilities enabled.'
	},
	{
		id: 'readonly',
		label: 'Read-only',
		description: 'Viewer mode with mutation affordances removed.'
	},
	{
		id: 'minimal',
		label: 'Minimal',
		description: 'Mutations, server zip, and client-zip fallback omitted.'
	},
	{
		id: 'policy',
		label: 'Upload policy',
		description: 'MIME, size, and quota rejection paths enabled.'
	},
	{
		id: 'compact',
		label: 'Compact',
		description: 'Same markup with compact density tokens.'
	},
	{
		id: 'empty',
		label: 'Host empty',
		description: 'Custom root label and React content for a host-specific empty state.'
	},
	{
		id: 'denied',
		label: 'Denied',
		description: 'Access-denied loading state from the adapter.'
	},
	{
		id: 'tree',
		label: 'Tree',
		description: 'FileTree beside a preview of the selected file, over the same adapter.'
	}
]

const demoFile = (name: string, contents: string, type: string) => new File([contents], name, { type })

export function App() {
	const fullAdapter = useMemo(
		() =>
			new InMemoryFileBrowserAdapter({
				capabilities: { multipart: true },
				multipartPartSize: 4
			}),
		[]
	)
	const minimalAdapter = useMemo(
		() =>
			new InMemoryFileBrowserAdapter({
				capabilities: {
					bulkDownloadUrl: false,
					copy: false,
					createFolder: false,
					exists: false,
					move: false,
					rename: false
				}
			}),
		[]
	)
	const emptyAdapter = useMemo(() => new InMemoryFileBrowserAdapter(), [])
	const deniedAdapter = useMemo(() => createAccessDeniedAdapter(), [])
	// Keyed by adapter: a hot reload makes new, empty adapters, which must be seeded again.
	const seededRef = useRef(new WeakSet<InMemoryFileBrowserAdapter>())
	const [mode, setMode] = useState<DemoMode['id']>('full')
	const [ready, setReady] = useState(false)

	useEffect(() => {
		if (seededRef.current.has(fullAdapter)) {
			return
		}
		seededRef.current.add(fullAdapter)

		async function seedDemo() {
			await Promise.all([seedAdapter(fullAdapter), seedAdapter(minimalAdapter)])
			setReady(true)
		}

		void seedDemo()
	}, [fullAdapter, minimalAdapter])

	const activeMode = DEMO_MODES.find((item) => item.id === mode) ?? DEMO_MODES[0]
	const adapter =
		mode === 'minimal'
			? minimalAdapter
			: mode === 'empty'
				? emptyAdapter
				: mode === 'denied'
					? deniedAdapter
					: fullAdapter
	const density: NonNullable<FileBrowserProps['density']> = mode === 'compact' ? 'compact' : 'comfortable'
	const uploadPolicy: FileBrowserProps['uploadPolicy'] =
		mode === 'policy'
			? {
					allowedMimeTypes: ['image/*', 'application/pdf', '.md'],
					maxFileSizeBytes: 1024 * 1024,
					remainingQuotaBytes: 2 * 1024 * 1024
				}
			: undefined

	return (
		<main
			className="demo-shell min-h-svh min-w-0 bg-[var(--fb-bg)] font-sans text-[var(--fb-text)]"
			{...getFileBrowserDensityAttributes(density)}
		>
			<div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-3">
				<FileBrowserProvider>
					<section className="flex flex-wrap items-center gap-2 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-2">
						<div className="mr-auto w-full min-w-0 px-1 lg:w-auto">
							<h1 className="m-0 text-[14px] font-semibold">React File Browser</h1>
							<p className="m-0 mt-0.5 text-[12px] text-[var(--fb-muted)]">{activeMode.description}</p>
						</div>
						<select
							aria-label="Demo mode"
							className="min-h-[calc(var(--fb-gap)*11)] w-full min-w-0 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-[calc(var(--fb-gap)*2)] text-[16px] sm:hidden"
							onChange={(event) => setMode(event.target.value as DemoMode['id'])}
							value={mode}
						>
							{DEMO_MODES.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
						<div className="hidden min-w-0 flex-wrap gap-[calc(var(--fb-gap)*2)] sm:flex">
							{DEMO_MODES.map((item) => (
								<button
									aria-pressed={mode === item.id}
									className={`min-h-[calc(var(--fb-gap)*11)] shrink-0 whitespace-nowrap rounded-[calc(var(--fb-radius)-3px)] border px-2.5 text-[12px] font-medium outline-none transition focus:ring-2 focus:ring-[var(--fb-accent-soft)] sm:min-h-8 [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${
										mode === item.id
											? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] text-[var(--fb-accent)]'
											: 'border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-bg)]'
									}`}
									key={item.id}
									onClick={() => setMode(item.id)}
									type="button"
								>
									{item.label}
								</button>
							))}
						</div>
					</section>

					{mode === 'tree' ? (
						ready ? (
							<TreePreview adapter={fullAdapter} />
						) : null
					) : ready || mode === 'empty' || mode === 'denied' ? (
						<FileBrowser
							allowClientZipFallback={mode !== 'minimal'}
							adapter={adapter}
							density={density}
							emptyState={
								mode === 'empty'
									? {
											description: <span>Upload a source to begin indexing.</span>,
											title: <strong>No RAG sources</strong>
										}
									: undefined
							}
							key={mode}
							readOnly={mode === 'readonly'}
							rootLabel={mode === 'empty' ? 'RAG' : 'Files'}
							uploadConflictResolutions={mode === 'policy' ? ['keep-both', 'skip'] : undefined}
							uploadPolicy={uploadPolicy}
							warnZipSizeBytes={64}
						/>
					) : (
						<div className="grid min-h-[min(520px,100svh)] place-items-center rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[12px] text-[var(--fb-muted)]">
							Loading demo files
						</div>
					)}
				</FileBrowserProvider>
			</div>
		</main>
	)
}

/** The tree on the left, and what the selected file holds on the right, as a memory or notes panel would. */
function TreePreview({ adapter }: { adapter: FileBrowserAdapter }) {
	// Only a file opens the preview; a folder click just opens or closes it in the tree.
	const [selected, setSelected] = useState<FileNode | undefined>(undefined)
	const [contents, setContents] = useState<string | undefined>(undefined)

	useEffect(() => {
		setContents(undefined)
		if (!selected) return
		let cancelled = false
		void adapter
			.signedUrl(selected.path)
			.then((url) => fetch(url))
			.then((response) => response.text())
			.then((text) => {
				if (!cancelled) setContents(text)
			})
		return () => {
			cancelled = true
		}
	}, [adapter, selected])

	return (
		<div
			className={`grid min-h-[min(520px,100svh)] min-w-0 grid-cols-1 overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] ${
				selected ? 'sm:grid-cols-[minmax(200px,280px)_1fr]' : ''
			}`}
		>
			<div className={`min-w-0 p-3 ${selected ? 'border-b border-[var(--fb-border)] sm:border-r sm:border-b-0' : ''}`}>
				<FileTree
					adapter={adapter}
					defaultExpandedPaths={['/docs']}
					onDeleted={(node) => {
						if (node.path === selected?.path) setSelected(undefined)
					}}
					onSelect={(node) => {
						if (node.kind === 'file') setSelected(node)
					}}
					rootLabel="Files"
					selectedPath={selected?.path}
				/>
			</div>
			{selected ? (
				<div className="min-w-0 p-5">
					<div className="flex items-center gap-3 border-b border-[var(--fb-border)] pb-3">
						<FileText aria-hidden className="size-5 shrink-0 text-[var(--fb-muted)]" strokeWidth={1.5} />
						<div className="min-w-0 flex-1">
							<div className="truncate text-[14px] font-semibold">{selected.name}</div>
							<div className="text-[12px] text-[var(--fb-muted)]">
								{`${selected.mimeType ?? 'File'} · ${selected.size ?? 0} bytes`}
							</div>
						</div>
						<button
							aria-label="Close preview"
							className="grid size-8 place-items-center rounded-[calc(var(--fb-radius)-2px)] text-[var(--fb-muted)] transition-colors hover:bg-[var(--fb-surface-2)]"
							onClick={() => setSelected(undefined)}
							type="button"
						>
							<X aria-hidden className="size-4" />
						</button>
					</div>
					<pre className="mt-3 whitespace-pre-wrap font-[inherit] text-[14px] leading-6 [overflow-wrap:anywhere]">
						{contents ?? 'Loading…'}
					</pre>
				</div>
			) : null}
		</div>
	)
}

async function seedAdapter(adapter: InMemoryFileBrowserAdapter) {
	if (!adapter.createFolder) {
		await adapter.upload('/quarterly-report.pdf', demoFile('quarterly-report.pdf', 'PDF', 'application/pdf'))
		await adapter.upload('/hero-banner.jpg', demoFile('hero-banner.jpg', 'image', 'image/jpeg'))
		await adapter.upload('/release-notes.md', demoFile('release-notes.md', '# Release notes', 'text/markdown'))
		return
	}

	await adapter.createFolder('/assets')
	await adapter.createFolder('/assets/brand')
	await adapter.createFolder('/docs')
	await adapter.createFolder('/campaigns')
	await adapter.createFolder('/campaigns/q3-launch')
	await adapter.upload('/docs/quarterly-report.pdf', demoFile('quarterly-report.pdf', 'PDF', 'application/pdf'))
	await adapter.upload('/docs/release-notes.md', demoFile('release-notes.md', '# Release notes', 'text/markdown'))
	await adapter.upload('/hero-banner.jpg', demoFile('hero-banner.jpg', 'image', 'image/jpeg'))
	await adapter.upload('/assets/brand/logo.svg', demoFile('logo.svg', '<svg />', 'image/svg+xml'))
	await adapter.upload('/campaigns/q3-launch/brief.txt', demoFile('brief.txt', 'Launch brief', 'text/plain'))
}

function createAccessDeniedAdapter(): FileBrowserAdapter {
	const denied = (method: string) =>
		Promise.reject(new FileBrowserAdapterError('access_denied', `Demo access denied from ${method}`))

	return {
		createFolder: (path: string) => denied(`createFolder ${path}`),
		delete: (paths: string[]) => denied(`delete ${paths.join(', ')}`),
		list: (path: string) => denied(`list ${path}`),
		signedUrl: (path: string) => denied(`signedUrl ${path}`),
		upload: (path: string, file: File): Promise<FileNode> => {
			void file
			return denied(`upload ${path}`)
		}
	}
}
