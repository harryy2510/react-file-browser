import type { ReactNode } from 'react'
import type { FileNode } from '../core/types'
import { getFileCategory, getFileExtension, isTextFile } from './file-types'

/** File body handed to plugins: text for `read: 'text'`, bytes for `read: 'binary'`. */
export type FileBrowserFileContent = string | ArrayBuffer

export type FileBrowserPreviewerProps<TMetadata = unknown> = {
	item: FileNode<TMetadata>
	/** Short-lived URL from `adapter.signedUrl`. Empty when previewing unsaved editor content. */
	url: string
	/** File body when the previewer sets `read`, otherwise `null`. */
	content: FileBrowserFileContent | null
}

export type FileBrowserPreviewer<TMetadata = unknown> = {
	id: string
	match: (item: FileNode<TMetadata>) => boolean
	/**
	 * Fetch the file body before rendering. Omit when the component only needs `url`.
	 * The signed URL must allow `fetch` from the page (CORS).
	 */
	read?: 'text' | 'binary'
	/** Largest file, in bytes, that is fetched for `read`. Defaults to 1 MB. */
	maxBytes?: number
	/** Rendered as a React component, so it may use hooks. */
	component: (props: FileBrowserPreviewerProps<TMetadata>) => ReactNode
}

export type FileBrowserEditorProps<TMetadata = unknown> = {
	item: FileNode<TMetadata>
	/** The saved file body, read as the editor's `read` mode. */
	content: FileBrowserFileContent
	/** Report the edited file body. Strings are saved as text; use a Blob for binary formats. */
	onChange: (next: string | Blob) => void
	/** Save now; the same as the Save button. */
	onSave: () => void
}

export type FileBrowserEditor<TMetadata = unknown> = {
	id: string
	match: (item: FileNode<TMetadata>) => boolean
	/** How the file is read before editing. Defaults to `text`. */
	read?: 'text' | 'binary'
	/** Largest file, in bytes, that can be opened or saved. Defaults to 1 MB. */
	maxBytes?: number
	/** Shown beside Save, for example to explain what saving drops. */
	saveWarning?: string
	/** Return a message to block saving, for example when edited text does not parse. */
	validate?: (content: string) => string | null
	/** Editing surface. Omit to use a plain text area. */
	component?: (props: FileBrowserEditorProps<TMetadata>) => ReactNode
}

export const DEFAULT_TEXT_PREVIEW_BYTES = 1024 * 1024
export const DEFAULT_EDITABLE_BYTES = 1024 * 1024

const MEDIA_CLASS = 'max-h-[min(560px,60dvh)] max-w-full rounded-[var(--fb-radius)]'
const FRAME_CLASS =
	'h-[min(640px,65dvh)] w-full rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)]'

export const imagePreviewer: FileBrowserPreviewer = {
	id: 'image',
	match: (item) => getFileCategory(item) === 'image',
	component: ({ item, url }) => (
		<img alt={item.name} className={`${MEDIA_CLASS} object-contain`} src={url || item.thumbnailUrl} />
	)
}

export const videoPreviewer: FileBrowserPreviewer = {
	id: 'video',
	match: (item) => getFileCategory(item) === 'video',
	// oxlint-disable-next-line jsx-a11y/media-has-caption -- Captions are not available for arbitrary stored files.
	// Videos fill the available width (letterboxed by object-contain) instead of showing at their pixel size.
	component: ({ item, url }) => (
		<video aria-label={item.name} className={`${MEDIA_CLASS} w-full bg-black object-contain`} controls src={url} />
	)
}

export const audioPreviewer: FileBrowserPreviewer = {
	id: 'audio',
	match: (item) => getFileCategory(item) === 'audio',
	// oxlint-disable-next-line jsx-a11y/media-has-caption -- Captions are not available for arbitrary stored files.
	component: ({ item, url }) => <audio aria-label={item.name} className="w-full max-w-[480px]" controls src={url} />
}

export const pdfPreviewer: FileBrowserPreviewer = {
	id: 'pdf',
	match: (item) => getFileCategory(item) === 'pdf',
	component: ({ item, url }) => (
		<object aria-label={item.name} className={FRAME_CLASS} data={url} type="application/pdf">
			<a className="font-semibold text-[var(--fb-accent)] underline" href={url} rel="noreferrer" target="_blank">
				Open {item.name}
			</a>
		</object>
	)
}

export const htmlPreviewer: FileBrowserPreviewer = {
	id: 'html',
	match: (item) => ['html', 'htm'].includes(getFileExtension(item.name)) || item.mimeType === 'text/html',
	read: 'text',
	component: ({ item, content }) => (
		// An empty sandbox blocks scripts, forms, and same-origin access, so stored HTML cannot run.
		<iframe
			className={`${FRAME_CLASS} bg-white`}
			sandbox=""
			srcDoc={typeof content === 'string' ? content : ''}
			title={item.name}
		/>
	)
}

export const textPreviewer: FileBrowserPreviewer = {
	id: 'text',
	match: isTextFile,
	read: 'text',
	component: ({ content }) => (
		<pre className="m-0 max-h-[min(640px,65dvh)] w-full overflow-auto whitespace-pre-wrap rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 text-left font-mono text-[calc(var(--fb-font)-1px)] leading-relaxed text-[var(--fb-text)] [overflow-wrap:anywhere]">
			{typeof content === 'string' ? content : ''}
		</pre>
	)
}

/** Browser-native previews only. Add plugins from `@harryy/react-file-browser/plugins/*` ahead of these. */
export const defaultFileBrowserPreviewers: FileBrowserPreviewer[] = [
	imagePreviewer,
	videoPreviewer,
	audioPreviewer,
	pdfPreviewer,
	htmlPreviewer,
	textPreviewer
]

export const textEditor: FileBrowserEditor = {
	id: 'text',
	match: isTextFile
}

export const defaultFileBrowserEditors: FileBrowserEditor[] = [textEditor]

export function findPlugin<TPlugin extends { match: (item: FileNode<TMetadata>) => boolean }, TMetadata>(
	plugins: readonly TPlugin[],
	item: FileNode<TMetadata>
): TPlugin | undefined {
	return plugins.find((plugin) => plugin.match(item))
}

export async function fetchFileContent(
	url: string,
	read: 'text' | 'binary',
	signal?: AbortSignal
): Promise<FileBrowserFileContent> {
	const response = await fetch(url, { signal })
	if (!response.ok) throw new Error(`Could not load file (${response.status})`)
	return read === 'binary' ? response.arrayBuffer() : response.text()
}
