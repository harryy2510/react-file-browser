import DOMPurify from 'dompurify'
import { Bold, Code, Heading2, Italic, Link as LinkIcon, List, ListOrdered } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Squire from 'squire-rte'

type Command = { id: string; label: string; icon: LucideIcon; tag: string; run: (editor: Squire) => void }

const COMMANDS: Array<Command | '|'> = [
	{ id: 'bold', label: 'Bold', icon: Bold, tag: 'B', run: (editor) => toggle(editor, 'B', 'bold', 'removeBold') },
	{
		id: 'italic',
		label: 'Italic',
		icon: Italic,
		tag: 'I',
		run: (editor) => toggle(editor, 'I', 'italic', 'removeItalic')
	},
	'|',
	{ id: 'heading', label: 'Heading', icon: Heading2, tag: 'H2', run: toggleHeading },
	{
		id: 'bullets',
		label: 'Bulleted list',
		icon: List,
		tag: 'UL',
		run: (editor) => (editor.hasFormat('UL') ? editor.removeList() : editor.makeUnorderedList())
	},
	{
		id: 'numbers',
		label: 'Numbered list',
		icon: ListOrdered,
		tag: 'OL',
		run: (editor) => (editor.hasFormat('OL') ? editor.removeList() : editor.makeOrderedList())
	},
	'|',
	{ id: 'link', label: 'Link', icon: LinkIcon, tag: 'A', run: () => undefined },
	{ id: 'code', label: 'Code', icon: Code, tag: 'CODE', run: (editor) => editor.toggleCode() }
]

function toggle(editor: Squire, tag: string, add: 'bold' | 'italic', remove: 'removeBold' | 'removeItalic') {
	if (editor.hasFormat(tag)) editor[remove]()
	else editor[add]()
}

function toggleHeading(editor: Squire) {
	const makeHeading = !editor.hasFormat('H2')
	editor.modifyBlocks((fragment) => {
		for (const block of Array.from(fragment.children)) {
			const next = document.createElement(makeHeading ? 'h2' : 'p')
			next.append(...Array.from(block.childNodes))
			block.replaceWith(next)
		}
		return fragment
	})
}

// Squire ships no stylesheet. These scoped rules style the editable document and toolbar with --fb-*
// tokens only, so the editor follows the host's light and dark themes without extra CSS.
const RICH_TEXT_CSS = `
[data-fb-rich-text] .fb-rt-body {
	min-height: min(480px, 60dvh); max-height: min(640px, 65dvh); overflow: auto; padding: 16px 20px; outline: none;
	color: var(--fb-text); font: inherit; font-size: var(--fb-font); line-height: 1.6; overflow-wrap: anywhere;
}
[data-fb-rich-text] .fb-rt-body > * + * { margin-top: 10px; }
[data-fb-rich-text] .fb-rt-body :is(p, div, ul, ol, pre, blockquote) { margin-bottom: 0; }
[data-fb-rich-text] .fb-rt-body p { margin-top: 0; }
[data-fb-rich-text] .fb-rt-body h1 { font-size: 22px; font-weight: 700; margin: 0; }
[data-fb-rich-text] .fb-rt-body h2 { font-size: 18px; font-weight: 700; margin: 0; }
[data-fb-rich-text] .fb-rt-body h3 { font-size: 16px; font-weight: 700; margin: 0; }
[data-fb-rich-text] .fb-rt-body ul { list-style: disc; padding-left: 22px; }
[data-fb-rich-text] .fb-rt-body ol { list-style: decimal; padding-left: 22px; }
[data-fb-rich-text] .fb-rt-body a { color: var(--fb-accent); text-decoration: underline; }
[data-fb-rich-text] .fb-rt-body code {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em;
	background: var(--fb-surface-2); border-radius: 4px; padding: 1px 4px;
}
[data-fb-rich-text] .fb-rt-body pre {
	background: var(--fb-surface-2); border-radius: calc(var(--fb-radius) - 2px); padding: 10px 12px; overflow: auto;
}
[data-fb-rich-text] .fb-rt-body pre code { background: transparent; padding: 0; }
[data-fb-rich-text] .fb-rt-body blockquote { border-left: 3px solid var(--fb-border-strong); padding-left: 10px; color: var(--fb-muted); margin-left: 0; }
[data-fb-rich-text] .fb-rt-body img { max-width: 100%; }
`

const TOOL =
	'grid size-[30px] shrink-0 place-items-center rounded-[calc(var(--fb-radius)-2px)] text-[var(--fb-muted)] outline-none hover:bg-[var(--fb-surface)] hover:text-[var(--fb-text)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklch,var(--fb-accent)_22%,transparent)] [@media(pointer:coarse)]:size-[calc(var(--fb-gap)*11)]'

/**
 * WYSIWYG editing surface (Squire). Loaded and pasted HTML is cleaned with DOMPurify, so scripts and
 * event handlers never reach the page. Reports the edited HTML after every change.
 */
export function RichTextSurface({
	html,
	label,
	onChange
}: {
	html: string
	label: string
	onChange: (html: string) => void
}) {
	const hostRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<Squire | null>(null)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange
	const [path, setPath] = useState('')
	const [linkOpen, setLinkOpen] = useState(false)
	const [linkUrl, setLinkUrl] = useState('https://')

	useEffect(() => {
		const host = hostRef.current
		if (!host) return
		// A fresh node per effect run so React StrictMode remounts never leave a second editor behind.
		const body = document.createElement('div')
		body.className = 'fb-rt-body'
		body.setAttribute('role', 'textbox')
		body.setAttribute('aria-multiline', 'true')
		body.setAttribute('aria-label', label)
		host.append(body)
		const editor = new Squire(body, {
			blockTag: 'P',
			sanitizeToDOMFragment: (dirty) => DOMPurify.sanitize(dirty, { RETURN_DOM_FRAGMENT: true })
		})
		editor.setHTML(html)
		editorRef.current = editor
		editor.addEventListener('input', () => onChangeRef.current(editor.getHTML()))
		editor.addEventListener('pathChange', () => setPath(editor.getPath()))
		return () => {
			editor.destroy()
			body.remove()
			editorRef.current = null
		}
		// The editor owns its document after mount; the file view remounts it (via `key`) to reload.
		// oxlint-disable-next-line react/exhaustive-deps
	}, [])

	const run = (command: Command) => {
		const editor = editorRef.current
		if (!editor) return
		if (command.id === 'link') {
			if (editor.hasFormat('A')) {
				editor.removeLink()
				onChangeRef.current(editor.getHTML())
			} else {
				setLinkOpen(true)
			}
			return
		}
		command.run(editor)
		editor.focus()
		onChangeRef.current(editor.getHTML())
	}

	const applyLink = () => {
		const editor = editorRef.current
		const url = linkUrl.trim()
		setLinkOpen(false)
		if (!editor || !/^(https?:|mailto:|\/|#)/i.test(url)) return
		editor.makeLink(url)
		editor.focus()
		onChangeRef.current(editor.getHTML())
	}

	const activeTags = new Set(path.split('>').map((segment) => segment.split(/[.#[]/)[0].toUpperCase()))

	return (
		<div
			className="flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-left"
			data-fb-rich-text=""
			ref={hostRef}
		>
			<style>{RICH_TEXT_CSS}</style>
			<div
				aria-label="Formatting"
				className="flex min-w-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--fb-border)] bg-[var(--fb-surface-2)] p-1.5"
				role="toolbar"
			>
				{COMMANDS.map((command, index) =>
					command === '|' ? (
						// oxlint-disable-next-line react/no-array-index-key -- Dividers are static and positional.
						<span aria-hidden="true" className="mx-1.5 h-[18px] w-px bg-[var(--fb-border)]" key={`divider-${index}`} />
					) : (
						<button
							aria-label={command.label}
							aria-pressed={activeTags.has(command.tag)}
							className={`${TOOL} ${activeTags.has(command.tag) ? 'bg-[var(--fb-accent-soft)] text-[var(--fb-text)]' : ''}`}
							key={command.id}
							// Keep the editor's selection: a toolbar click must not move focus first.
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => run(command)}
							title={command.label}
							type="button"
						>
							<command.icon aria-hidden="true" className="size-4" strokeWidth={2} />
						</button>
					)
				)}
				{linkOpen ? (
					<form
						className="ml-2 flex min-w-0 items-center gap-1.5"
						onSubmit={(event) => {
							event.preventDefault()
							applyLink()
						}}
					>
						<input
							aria-label="Link address"
							autoFocus
							className="h-[30px] w-[220px] min-w-0 rounded-[calc(var(--fb-radius)-2px)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-2 text-[calc(var(--fb-font)-1px)] text-[var(--fb-text)] outline-none focus:border-[var(--fb-accent)]"
							onChange={(event) => setLinkUrl(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Escape') {
									event.preventDefault()
									event.stopPropagation()
									setLinkOpen(false)
								}
							}}
							value={linkUrl}
						/>
						<button
							className="h-[30px] rounded-[calc(var(--fb-radius)-2px)] bg-[var(--fb-accent)] px-3 text-[calc(var(--fb-font)-1px)] font-semibold text-[var(--fb-surface)]"
							onMouseDown={(event) => event.preventDefault()}
							type="submit"
						>
							Add link
						</button>
					</form>
				) : null}
			</div>
		</div>
	)
}
