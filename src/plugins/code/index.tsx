import { CodeJar } from 'codejar'
import Prism from 'prismjs'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-java'
import { useEffect, useRef, useState } from 'react'
import type { FileBrowserEditor, FileBrowserPreviewer } from '../../components/file-plugins'
import { getFileCategory, getFileExtension, isTextFile } from '../../components/file-types'
import type { FileNode } from '../../core/types'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	md: 'markdown',
	markdown: 'markdown',
	mdx: 'markdown',
	json: 'json',
	jsonl: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	html: 'markup',
	htm: 'markup',
	xml: 'markup',
	svg: 'markup',
	css: 'css',
	scss: 'css',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'jsx',
	ts: 'typescript',
	tsx: 'tsx',
	py: 'python',
	sh: 'bash',
	sql: 'sql',
	go: 'go',
	rs: 'rust',
	java: 'java'
}

/** Prism language id for a file, or `undefined` for plain text. */
export function getCodeLanguage(item: FileNode<unknown>): string | undefined {
	const language = LANGUAGE_BY_EXTENSION[getFileExtension(item.name)]
	return language && Prism.languages[language] ? language : undefined
}

// Prism emits `.token.*` spans; these map them onto --fb-* tokens instead of shipping a Prism theme.
const TOKEN_COLORS = [
	'[&_.token.comment]:text-[var(--fb-muted)] [&_.token.comment]:italic',
	'[&_.token.prolog]:text-[var(--fb-muted)] [&_.token.doctype]:text-[var(--fb-muted)]',
	'[&_.token.keyword]:text-[var(--fb-accent)] [&_.token.atrule]:text-[var(--fb-accent)]',
	'[&_.token.important]:text-[var(--fb-accent)] [&_.token.title]:font-bold [&_.token.title]:text-[var(--fb-accent)]',
	'[&_.token.string]:text-[var(--fb-ok,var(--fb-text))] [&_.token.attr-value]:text-[var(--fb-ok,var(--fb-text))]',
	'[&_.token.number]:text-[var(--fb-folder)] [&_.token.boolean]:text-[var(--fb-folder)]',
	'[&_.token.tag]:text-[var(--fb-danger)] [&_.token.property]:text-[var(--fb-danger)]',
	'[&_.token.function]:text-[var(--fb-folder)] [&_.token.attr-name]:text-[var(--fb-folder)]',
	'[&_.token.punctuation]:text-[var(--fb-muted)] [&_.token.bold]:font-bold [&_.token.italic]:italic'
].join(' ')

const SURFACE = `min-h-[min(520px,60dvh)] w-full min-w-0 overflow-auto whitespace-pre-wrap rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-4 text-left font-mono text-[calc(var(--fb-font)-1px)] leading-relaxed text-[var(--fb-text)] outline-none [overflow-wrap:anywhere] [tab-size:2] focus:border-[var(--fb-accent)] ${TOKEN_COLORS}`

// Prism escapes the source before wrapping tokens, so its output is safe to assign as HTML.
function highlight(code: string, language: string | undefined) {
	return language ? Prism.highlight(code, Prism.languages[language], language) : null
}

function CodeSurface({
	content,
	item,
	onChange,
	onSave
}: {
	content: string
	item: FileNode<unknown>
	onChange: (next: string) => void
	onSave: () => void
}) {
	const ref = useRef<HTMLDivElement>(null)
	const handlers = useRef({ onChange, onSave })
	handlers.current = { onChange, onSave }

	useEffect(() => {
		const element = ref.current
		if (!element) return
		const language = getCodeLanguage(item)
		const jar = CodeJar(
			element,
			(editor) => {
				const html = highlight(editor.textContent ?? '', language)
				if (html !== null) editor.innerHTML = html
			},
			{ tab: '  ', spellcheck: false }
		)
		jar.updateCode(content)
		jar.onUpdate((code) => {
			if (code !== content) handlers.current.onChange(code)
		})
		return () => jar.destroy()
		// The editor owns its text after mount; the dialog remounts it (via `key`) to reload.
		// oxlint-disable-next-line react/exhaustive-deps
	}, [])

	return (
		<div
			aria-label={`${item.name} contents`}
			aria-multiline="true"
			className={SURFACE}
			ref={ref}
			role="textbox"
			tabIndex={0}
		/>
	)
}

/** Plain-text and code editing with syntax highlighting (codejar + Prism). */
export const codeEditor: FileBrowserEditor = {
	id: 'code',
	match: isTextFile,
	read: 'text',
	component: ({ content, item, onChange, onSave }) => (
		<CodeSurface content={typeof content === 'string' ? content : ''} item={item} onChange={onChange} onSave={onSave} />
	)
}

/** Read-only syntax-highlighted view for code and structured text files. */
export const codePreviewer: FileBrowserPreviewer = {
	id: 'code',
	// SVG and HTML are text too, but they preview rendered (image / sandboxed page); only editors show source.
	match: (item) =>
		isTextFile(item) && getFileCategory(item) !== 'image' && !isHtml(item) && getCodeLanguage(item) !== undefined,
	read: 'text',
	component: ({ content, item }) => {
		const html = highlight(typeof content === 'string' ? content : '', getCodeLanguage(item)) ?? ''
		return (
			<pre
				className={`m-0 max-h-[min(640px,65dvh)] ${SURFACE.replace('min-h-[min(520px,60dvh)] ', '')}`}
				// oxlint-disable-next-line react/no-danger -- Prism escapes the source; only its token spans are HTML.
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		)
	}
}

const isHtml = (item: FileNode<unknown>) =>
	['html', 'htm'].includes(getFileExtension(item.name)) || item.mimeType === 'text/html'
const isSvg = (item: FileNode<unknown>) => getFileExtension(item.name) === 'svg' || item.mimeType === 'image/svg+xml'

function MarkupSurface({
	content,
	item,
	onChange,
	onSave
}: {
	content: string
	item: FileNode<unknown>
	onChange: (next: string) => void
	onSave: () => void
}) {
	const [source, setSource] = useState(content)
	return (
		<div className="grid w-full min-w-0 grid-cols-1 gap-3 @min-[48rem]/fb:grid-cols-2">
			<CodeSurface
				content={content}
				item={item}
				onChange={(next) => {
					setSource(next)
					onChange(next)
				}}
				onSave={onSave}
			/>
			<div
				aria-label={`${item.name} live preview`}
				className="min-h-[min(520px,60dvh)] min-w-0 overflow-auto rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface-2)]"
				role="group"
			>
				{isSvg(item) ? (
					// An <img> renders SVG without running its scripts or loading external resources.
					<img
						alt={`${item.name} preview`}
						className="m-auto block max-h-full max-w-full p-4"
						src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`}
					/>
				) : (
					// An empty sandbox blocks scripts, forms, and same-origin access for the edited HTML.
					<iframe
						className="size-full min-h-[min(520px,60dvh)] border-0 bg-white"
						sandbox=""
						srcDoc={source}
						title={`${item.name} preview`}
					/>
				)}
			</div>
		</div>
	)
}

/** HTML and SVG source editing with a live preview beside it (codejar + Prism). */
export const markupEditor: FileBrowserEditor = {
	id: 'markup',
	match: (item) => isHtml(item) || isSvg(item),
	read: 'text',
	component: ({ content, item, onChange, onSave }) => (
		<MarkupSurface
			content={typeof content === 'string' ? content : ''}
			item={item}
			onChange={onChange}
			onSave={onSave}
		/>
	)
}

const isJson = (item: FileNode<unknown>) =>
	getFileExtension(item.name) === 'json' || item.mimeType === 'application/json'

function jsonError(text: string): string | null {
	if (!text.trim()) return null
	try {
		JSON.parse(text)
		return null
	} catch (error) {
		return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}. Fix it to save.`
	}
}

function JsonSurface({
	content,
	item,
	onChange,
	onSave
}: {
	content: string
	item: FileNode<unknown>
	onChange: (next: string) => void
	onSave: () => void
}) {
	const [source, setSource] = useState({ text: content, version: 0 })
	const canFormat = source.text.trim() !== '' && jsonError(source.text) === null
	return (
		<div className="flex w-full min-w-0 flex-col gap-2">
			<div className="flex justify-end">
				<button
					className="inline-flex h-[var(--fb-bar-control-h,30px)] items-center rounded-[calc(var(--fb-radius)-2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-3 text-[calc(var(--fb-font)-1px)] font-semibold text-[var(--fb-text)] hover:bg-[var(--fb-surface-2)] disabled:cursor-not-allowed disabled:opacity-45"
					disabled={!canFormat}
					onClick={() => {
						const text = `${JSON.stringify(JSON.parse(source.text), null, 2)}\n`
						// Remount the code surface so it starts from the formatted text.
						setSource((current) => ({ text, version: current.version + 1 }))
						if (text !== content) onChange(text)
					}}
					type="button"
				>
					Format
				</button>
			</div>
			<CodeSurface
				content={source.text}
				item={item}
				key={source.version}
				onChange={(next) => {
					setSource((current) => ({ ...current, text: next }))
					onChange(next)
				}}
				onSave={onSave}
			/>
		</div>
	)
}

/** JSON editing with syntax highlighting, a Format button, and saving blocked while the JSON is invalid. */
export const jsonEditor: FileBrowserEditor = {
	id: 'json',
	match: isJson,
	read: 'text',
	validate: jsonError,
	component: ({ content, item, onChange, onSave }) => (
		<JsonSurface content={typeof content === 'string' ? content : ''} item={item} onChange={onChange} onSave={onSave} />
	)
}
