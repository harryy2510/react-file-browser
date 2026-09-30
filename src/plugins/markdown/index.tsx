import Markdown from 'react-markdown'
import { marked } from 'marked'
import TurndownService from 'turndown'
import type { FileBrowserEditor, FileBrowserPreviewer } from '../../components/file-plugins'
import { getFileExtension } from '../../components/file-types'
import type { FileNode } from '../../core/types'
import { RichTextSurface } from '../rich-text'

const isMarkdown = (item: FileNode<unknown>) =>
	['md', 'markdown', 'mdx'].includes(getFileExtension(item.name)) || item.mimeType === 'text/markdown'

// react-markdown renders to React elements and ignores raw HTML by default, so stored Markdown
// cannot inject markup. The classes below style its output with --fb-* tokens only.
const PROSE = [
	'max-h-[min(640px,65dvh)] w-full overflow-auto rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-5 text-left leading-relaxed text-[var(--fb-text)] [overflow-wrap:anywhere]',
	'[&>*+*]:mt-3 [&_h1]:text-[22px] [&_h1]:font-bold [&_h2]:text-[19px] [&_h2]:font-bold [&_h3]:text-[16px] [&_h3]:font-bold',
	'[&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0 [&_ul]:m-0 [&_ol]:m-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
	'[&_a]:text-[var(--fb-accent)] [&_a]:underline [&_blockquote]:m-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--fb-border-strong)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--fb-muted)]',
	'[&_code]:rounded-[4px] [&_code]:bg-[var(--fb-surface-2)] [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.92em]',
	'[&_pre]:m-0 [&_pre]:overflow-auto [&_pre]:rounded-[calc(var(--fb-radius)-2px)] [&_pre]:bg-[var(--fb-surface-2)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
	'[&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--fb-border)] [&_img]:max-w-full',
	'[&_table]:border-collapse [&_th]:border [&_td]:border [&_th]:border-[var(--fb-border)] [&_td]:border-[var(--fb-border)] [&_th]:px-2 [&_td]:px-2'
].join(' ')

/** Rendered Markdown preview (react-markdown). */
export const markdownPreviewer: FileBrowserPreviewer = {
	id: 'markdown',
	match: isMarkdown,
	read: 'text',
	component: ({ content }) => (
		<div className={PROSE}>
			<Markdown>{typeof content === 'string' ? content : ''}</Markdown>
		</div>
	)
}

const turndown = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-',
	emDelimiter: '*'
})

/** Markdown to the HTML the visual editor shows. */
export function markdownToHtml(markdown: string): string {
	return marked.parse(markdown, { async: false, gfm: true })
}

/** Visual editor HTML back to Markdown, without the empty paragraphs the editor keeps for the caret. */
export function htmlToMarkdown(html: string): string {
	const markdown = turndown
		.turndown(html)
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
	return markdown ? `${markdown}\n` : ''
}

/**
 * WYSIWYG Markdown editor (Squire, with marked and turndown converting to and from Markdown).
 * Saving rewrites the file's Markdown, so spacing and list markers may be normalized.
 */
export const markdownEditor: FileBrowserEditor = {
	id: 'markdown',
	match: isMarkdown,
	read: 'text',
	component: ({ content, item, onChange }) => {
		const source = typeof content === 'string' ? content : ''
		return (
			<RichTextSurface
				html={markdownToHtml(source)}
				label={`${item.name} contents`}
				onChange={(html) => {
					const next = htmlToMarkdown(html)
					if (next !== source) onChange(next)
				}}
			/>
		)
	}
}
