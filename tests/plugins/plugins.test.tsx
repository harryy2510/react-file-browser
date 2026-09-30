import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import jspreadsheet from 'jspreadsheet-ce'
import writeXlsxFile from 'write-excel-file/browser'
import type { FileNode } from '@/core/types'
import { codeEditor, codePreviewer, getCodeLanguage, jsonEditor, markupEditor } from '@/plugins/code'
import { csvEditor, csvPreviewer } from '@/plugins/csv'
import { docxPreviewer } from '@/plugins/docx'
import { htmlToMarkdown, markdownEditor, markdownPreviewer, markdownToHtml } from '@/plugins/markdown'
import { xlsxEditor, xlsxPreviewer } from '@/plugins/xlsx'

const node = (name: string, mimeType?: string): FileNode => ({ path: `/${name}`, name, kind: 'file', mimeType })

describe('markdown plugin', () => {
	test('renders Markdown and ignores raw HTML', () => {
		const Preview = markdownPreviewer.component
		render(<Preview content={'# Title\n\n- one\n\n<script>alert(1)</script>'} item={node('a.md')} url="" />)
		expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
		expect(screen.getByRole('listitem')).toHaveTextContent('one')
		expect(document.querySelector('script')).toBeNull()
		expect(markdownPreviewer.match(node('a.md'))).toBe(true)
		expect(markdownPreviewer.match(node('a.txt'))).toBe(false)
	})
})

describe('code plugin', () => {
	test('maps extensions to Prism languages and highlights previews', () => {
		expect(getCodeLanguage(node('a.json'))).toBe('json')
		expect(getCodeLanguage(node('a.txt'))).toBeUndefined()
		const Preview = codePreviewer.component
		const { container } = render(<Preview content={'{"a": 1}'} item={node('a.json')} url="" />)
		expect(container.querySelector('.token.property')).toHaveTextContent('"a"')
		expect(codePreviewer.match(node('a.txt'))).toBe(false)
		expect(codePreviewer.match(node('logo.svg', 'image/svg+xml'))).toBe(false)
		expect(codePreviewer.match(node('page.html', 'text/html'))).toBe(false)
		expect(codeEditor.match(node('a.txt', 'text/plain'))).toBe(true)
	})

	test('mounts an editable surface with the file text', () => {
		const Editor = codeEditor.component
		if (!Editor) throw new Error('code editor must provide a component')
		render(<Editor content="hello" item={node('a.txt')} onChange={vi.fn()} onSave={vi.fn()} />)
		expect(screen.getByRole('textbox', { name: 'a.txt contents' })).toHaveTextContent('hello')
	})
})

describe('csv plugin', () => {
	test('previews rows in a read-only sheet', () => {
		const Preview = csvPreviewer.component
		render(<Preview content={'name,qty\napples,3\n'} item={node('stock.csv')} url="" />)
		const sheet = screen.getByRole('group', { name: 'stock.csv' })
		expect(sheet).toHaveTextContent('qty')
		expect(sheet).toHaveTextContent('apples')
	})

	test('mounts exactly one sheet under React StrictMode', () => {
		const Preview = csvPreviewer.component
		render(
			<StrictMode>
				<Preview content={'name,qty\napples,3\n'} item={node('stock.csv')} url="" />
			</StrictMode>
		)
		const sheet = screen.getByRole('group', { name: 'stock.csv' })
		expect(sheet.querySelectorAll('table.jss_worksheet')).toHaveLength(1)
		expect(sheet.querySelectorAll('.jss_spreadsheet')).toHaveLength(1)
	})

	test('limits the right-click menu to row and column editing and hides it in previews', async () => {
		const Editor = csvEditor.component
		if (!Editor) throw new Error('csv editor must provide a component')
		const { unmount } = render(
			<Editor content={'name,qty\napples,3\n'} item={node('stock.csv')} onChange={vi.fn()} onSave={vi.fn()} />
		)
		const cell = await waitFor(() => {
			const found = document.querySelector('.jss_worksheet tbody tr td:nth-child(2)')
			if (!found) throw new Error('cell not rendered')
			return found
		})
		fireEvent.mouseDown(cell)
		fireEvent.contextMenu(cell)
		const menu = document.querySelector('.jcontextmenu')
		await waitFor(() => expect(menu).toHaveTextContent('Insert row above'))
		expect(menu).toHaveTextContent('Insert column right')
		for (const text of ['comments', 'Save as', 'Copy', 'Paste', 'Order', 'Rename']) {
			expect(menu).not.toHaveTextContent(text)
		}
		unmount()

		const Preview = csvPreviewer.component
		render(<Preview content={'name,qty\napples,3\n'} item={node('stock.csv')} url="" />)
		const previewCell = await waitFor(() => {
			const found = document.querySelector('.jss_worksheet tbody tr td:nth-child(2)')
			if (!found) throw new Error('cell not rendered')
			return found
		})
		fireEvent.contextMenu(previewCell)
		expect(document.querySelector('.jcontextmenu')?.textContent ?? '').toBe('')
		expect(screen.getByRole('group', { name: 'stock.csv' }).querySelector('style')).toHaveTextContent('--fb-surface')
	})

	test('edits cells, inserts a column in place, and saves CSV with the original delimiter', () => {
		const Editor = csvEditor.component
		if (!Editor) throw new Error('csv editor must provide a component')
		const onChange = vi.fn()
		render(<Editor content={'name;qty\napples;3\n'} item={node('stock.csv')} onChange={onChange} onSave={vi.fn()} />)

		const [sheet] = jspreadsheet.current ? [jspreadsheet.current] : []
		if (!sheet) throw new Error('expected a mounted worksheet')
		sheet.setValueFromCoords(1, 1, '5', false)
		expect(onChange).toHaveBeenLastCalledWith('name;qty\napples;5')

		sheet.insertColumn(1, 0, true)
		expect(onChange).toHaveBeenLastCalledWith(';name;qty\n;apples;5')
	})
})

describe('xlsx plugin', () => {
	test('reads workbook sheets into a grid and warns before lossy saves', async () => {
		const blob = await writeXlsxFile([
			{
				sheet: 'Prices',
				data: [
					['Item', 'Price'],
					['Tea', 4]
				]
			},
			{ sheet: 'Notes', data: [['Hello']] }
		]).toBlob()
		const Preview = xlsxPreviewer.component
		render(<Preview content={await blob.arrayBuffer()} item={node('book.xlsx')} url="" />)
		await waitFor(() => expect(screen.getByRole('group', { name: 'book.xlsx' })).toHaveTextContent('Tea'))
		expect(screen.getByRole('group', { name: 'book.xlsx' })).toHaveTextContent('Notes')
		expect(xlsxEditor.read).toBe('binary')
		expect(xlsxEditor.saveWarning).toMatch(/Formatting, formulas and charts are lost/)
	})
})

describe('docx plugin', () => {
	test('matches Word documents and reads them as binary', () => {
		expect(docxPreviewer.match(node('letter.docx'))).toBe(true)
		expect(docxPreviewer.match(node('letter.pdf'))).toBe(false)
		expect(docxPreviewer.read).toBe('binary')
	})
})

describe('markdown editor', () => {
	test('converts Markdown to HTML and back', () => {
		expect(markdownToHtml('# Notes\n\n- one\n- **two**')).toContain('<h1>Notes</h1>')
		expect(htmlToMarkdown('<h2>Plan</h2><ul><li>one</li><li><b>two</b></li></ul><p><br></p>')).toBe(
			'## Plan\n\n-   one\n-   **two**\n'
		)
	})

	test('mounts one visual editor with a small toolbar under StrictMode', () => {
		const Editor = markdownEditor.component
		if (!Editor) throw new Error('markdown editor must provide a component')
		const { container } = render(
			<StrictMode>
				<Editor
					content={'# Notes\n\nHello <script>alert(1)</script>'}
					item={node('notes.md')}
					onChange={vi.fn()}
					onSave={vi.fn()}
				/>
			</StrictMode>
		)
		expect(container.querySelectorAll('.fb-rt-body')).toHaveLength(1)
		const body = screen.getByRole('textbox', { name: 'notes.md contents' })
		expect(body.querySelector('h1')).toHaveTextContent('Notes')
		expect(body.querySelector('script')).toBeNull()
		const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
		expect(Array.from(toolbar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual([
			'Bold',
			'Italic',
			'Heading',
			'Bulleted list',
			'Numbered list',
			'Link',
			'Code'
		])
	})
})

describe('markup editor', () => {
	test('shows HTML source beside a sandboxed live preview', () => {
		const Editor = markupEditor.component
		if (!Editor) throw new Error('markup editor must provide a component')
		render(<Editor content="<h1>Hi</h1>" item={node('page.html')} onChange={vi.fn()} onSave={vi.fn()} />)
		expect(screen.getByRole('textbox', { name: 'page.html contents' })).toHaveTextContent('<h1>Hi</h1>')
		const frame = screen.getByTitle('page.html preview')
		expect(frame).toHaveAttribute('sandbox', '')
		expect(frame).toHaveAttribute('srcdoc', '<h1>Hi</h1>')
	})

	test('renders SVG previews as an image', () => {
		const Editor = markupEditor.component
		if (!Editor) throw new Error('markup editor must provide a component')
		render(<Editor content="<svg />" item={node('logo.svg')} onChange={vi.fn()} onSave={vi.fn()} />)
		expect(screen.getByRole('img', { name: 'logo.svg preview' }).getAttribute('src')).toContain('image/svg+xml')
		expect(markupEditor.match(node('logo.svg'))).toBe(true)
		expect(markupEditor.match(node('app.ts'))).toBe(false)
	})
})

describe('json editor', () => {
	test('validates JSON and formats it', async () => {
		expect(jsonEditor.validate?.('{"a": 1}')).toBeNull()
		expect(jsonEditor.validate?.('{"a": }')).toMatch(/^Invalid JSON/)
		const Editor = jsonEditor.component
		if (!Editor) throw new Error('json editor must provide a component')
		const onChange = vi.fn()
		render(<Editor content='{"a":1}' item={node('config.json')} onChange={onChange} onSave={vi.fn()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Format' }))
		expect(onChange).toHaveBeenLastCalledWith('{\n  "a": 1\n}\n')
		await waitFor(() =>
			expect(screen.getByRole('textbox', { name: 'config.json contents' })).toHaveTextContent('"a": 1')
		)
	})
})
