import { useEffect, useMemo, useRef, useState } from 'react'
import {
	FileBrowser,
	FileBrowserAdapterError,
	FileBrowserProvider,
	defaultFileBrowserEditors,
	defaultFileBrowserPreviewers
} from '@harryy/react-file-browser'
import type { FileBrowserAdapter, FileBrowserProps, FileNode } from '@harryy/react-file-browser'
import { InMemoryFileBrowserAdapter } from '@harryy/react-file-browser/adapters/in-memory'
import { codeEditor, codePreviewer, jsonEditor, markupEditor } from '@harryy/react-file-browser/plugins/code'
import { csvEditor, csvPreviewer } from '@harryy/react-file-browser/plugins/csv'
import { docxPreviewer } from '@harryy/react-file-browser/plugins/docx'
import { markdownEditor, markdownPreviewer } from '@harryy/react-file-browser/plugins/markdown'
import { xlsxEditor, xlsxPreviewer } from '@harryy/react-file-browser/plugins/xlsx'
import { getFileBrowserDensityAttributes } from '@harryy/react-file-browser/theme'
import clipUrl from './samples/clip.webm?url'
// ?raw keeps the file byte-for-byte; fetching it through the dev server would inject Vite's HMR scripts.
import pageHtml from './samples/page.html?raw'
import photoUrl from './samples/photo.jpg?url'
import toneUrl from './samples/tone.ogg?url'

type DemoMode = {
	id: 'full' | 'readonly' | 'minimal' | 'policy' | 'compact' | 'empty' | 'denied'
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
	}
]

const demoFile = (name: string, contents: string, type: string) => new File([contents], name, { type })

// Real sample media so image, video, audio and HTML previews and editors have something to show.
const SAMPLE_MEDIA = [
	{ path: '/media/photo.jpg', url: photoUrl, type: 'image/jpeg' },
	{ path: '/media/clip.webm', url: clipUrl, type: 'video/webm' },
	{ path: '/media/tone.ogg', url: toneUrl, type: 'audio/ogg' }
]

async function sampleFile(url: string, path: string, type: string) {
	const blob = await (await fetch(url)).blob()
	return new File([blob], path.slice(path.lastIndexOf('/') + 1), { type })
}

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
	const seededRef = useRef(false)
	const [mode, setMode] = useState<DemoMode['id']>('full')
	const [ready, setReady] = useState(false)

	useEffect(() => {
		if (seededRef.current) {
			return
		}
		seededRef.current = true

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

					{ready || mode === 'empty' || mode === 'denied' ? (
						<FileBrowser
							allowClientZipFallback={mode !== 'minimal'}
							adapter={adapter}
							density={density}
							editors={editors}
							isItemReadOnly={(item) => item.path === '/docs/quarterly-report.pdf'}
							previewers={previewers}
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

// Plugins go ahead of the browser-native defaults; the first match wins.
const previewers = [
	markdownPreviewer,
	csvPreviewer,
	xlsxPreviewer,
	docxPreviewer,
	codePreviewer,
	...defaultFileBrowserPreviewers
]
const editors = [
	csvEditor,
	xlsxEditor,
	markdownEditor,
	markupEditor,
	jsonEditor,
	codeEditor,
	...defaultFileBrowserEditors
]

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
	await adapter.upload('/hero-banner.jpg', await sampleFile(photoUrl, '/hero-banner.jpg', 'image/jpeg'))
	await adapter.upload(
		'/assets/brand/logo.svg',
		demoFile(
			'logo.svg',
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#6d5dfc"/><path d="M36 64l16 16 32-40" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			'image/svg+xml'
		)
	)
	await adapter.createFolder('/media')
	await adapter.upload('/docs/page.html', demoFile('page.html', pageHtml, 'text/html'))
	for (const sample of SAMPLE_MEDIA) {
		await adapter.upload(sample.path, await sampleFile(sample.url, sample.path, sample.type))
	}
	await adapter.upload('/campaigns/q3-launch/brief.txt', demoFile('brief.txt', 'Launch brief', 'text/plain'))
	await adapter.upload('/docs/budget.csv', demoFile('budget.csv', 'item,amount\nAds,1200\nEvents,800\n', 'text/csv'))
	await adapter.upload(
		'/docs/config.json',
		demoFile('config.json', '{"launch": "Q3", "channels": 4}', 'application/json')
	)
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
