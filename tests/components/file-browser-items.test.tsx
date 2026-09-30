import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { InMemoryFileBrowserAdapter } from '@/adapters/in-memory'
import { FileBrowser } from '@/components/file-browser'
import type { FileBrowserPreviewer } from '@/components/file-plugins'

const textFile = (name: string, text = name, type = 'text/plain') => new File([text], name, { type })

async function adapterWithFiles() {
	const adapter = new InMemoryFileBrowserAdapter()
	await adapter.createFolder?.('/assets')
	await adapter.createFolder?.('/locked')
	await adapter.upload('/notes.md', textFile('notes.md', '# Notes', 'text/markdown'))
	await adapter.upload('/report.pdf', textFile('report.pdf', 'PDF', 'application/pdf'))
	return adapter
}

function mockFetch(body: string) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(body)))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('FileBrowser list view', () => {
	test('selects with row checkboxes and a header select-all checkbox', async () => {
		const user = userEvent.setup()
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('checkbox', { name: 'Select notes.md' }))
		expect(screen.getByRole('checkbox', { name: 'Select notes.md' })).toHaveAttribute('aria-checked', 'true')
		expect(screen.getByRole('checkbox', { name: 'Select all items' })).toHaveAttribute('aria-checked', 'mixed')

		await user.click(screen.getByRole('checkbox', { name: 'Select all items' }))
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('4 selected')

		await user.click(screen.getByRole('checkbox', { name: 'Select none' }))
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')
	})

	test('sorts from the column headers', async () => {
		const user = userEvent.setup()
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')

		const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
		expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
		await user.click(within(nameHeader).getByRole('button'))
		expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
		await user.click(within(screen.getByRole('columnheader', { name: /Size/ })).getByRole('button'))
		expect(screen.getByRole('columnheader', { name: /Size/ })).toHaveAttribute('aria-sort', 'ascending')
	})

	test('opens the item actions menu from the three-dot button', async () => {
		const user = userEvent.setup()
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'More actions for report.pdf' }))
		const menu = screen.getByRole('menu', { name: 'Item actions' })
		expect(within(menu).getByRole('menuitem', { name: 'Preview' })).toBeInTheDocument()
		expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
		expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
	})

	test('switches views from the always-visible toggle', async () => {
		const user = userEvent.setup()
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')
		expect(screen.getByRole('table', { name: 'Files' })).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Grid view' }))
		expect(screen.getByRole('grid', { name: 'Files' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'More actions for notes.md' })).toBeInTheDocument()
	})
})

describe('FileBrowser read-only items', () => {
	const isItemReadOnly = (item: { path: string }) => item.path === '/locked' || item.path === '/report.pdf'

	test('hides write actions and marks the item', async () => {
		const user = userEvent.setup()
		render(<FileBrowser adapter={await adapterWithFiles()} isItemReadOnly={isItemReadOnly} />)
		await screen.findByText('notes.md')

		const row = screen.getByText('report.pdf').closest('tr')
		expect(row).toHaveAttribute('data-fb-read-only', 'true')
		expect(within(row as HTMLElement).getByRole('img', { name: 'Read-only' })).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'More actions for report.pdf' }))
		const menu = screen.getByRole('menu', { name: 'Item actions' })
		for (const name of ['Rename', 'Move', 'Cut', 'Delete']) {
			expect(within(menu).queryByRole('menuitem', { name })).not.toBeInTheDocument()
		}
		expect(within(menu).getByRole('menuitem', { name: 'Download' })).toBeInTheDocument()
		await user.keyboard('{Escape}')

		const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
		expect(within(toolbar).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
	})

	test('ignores Delete and F2 on read-only items and refuses drops onto read-only folders', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const move = vi.spyOn(adapter, 'move')
		const { container } = render(<FileBrowser adapter={adapter} isItemReadOnly={isItemReadOnly} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'report.pdf' }))
		await user.keyboard('{Delete}')
		await user.keyboard('{F2}')
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(screen.queryByRole('textbox', { name: 'Rename report.pdf' })).not.toBeInTheDocument()

		const data = new Map<string, string>()
		const dataTransfer = {
			getData: (type: string) => data.get(type) ?? '',
			setData: (type: string, value: string) => data.set(type, value)
		} as unknown as DataTransfer
		fireEvent.dragStart(screen.getByRole('button', { name: 'notes.md' }), { dataTransfer })
		fireEvent.dragOver(screen.getByRole('button', { name: 'locked' }), { dataTransfer })
		expect(container.querySelector('[data-fb-path="/locked"]')).not.toHaveAttribute('data-fb-drop-target')
		fireEvent.drop(screen.getByRole('button', { name: 'locked' }), { dataTransfer })
		expect(move).not.toHaveBeenCalled()
	})
})

describe('FileBrowser previews and editors', () => {
	test('renders a host previewer ahead of the defaults', async () => {
		const user = userEvent.setup()
		const previewer: FileBrowserPreviewer = {
			id: 'custom',
			match: (item) => item.name.endsWith('.pdf'),
			component: ({ item, url }) => (
				<p>
					Custom view of {item.name} at {url.slice(0, 5)}
				</p>
			)
		}
		render(<FileBrowser adapter={await adapterWithFiles()} previewers={[previewer]} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'report.pdf' }))
		await user.keyboard('{Enter}')
		expect(await screen.findByText(/Custom view of report.pdf at blob:/)).toBeInTheDocument()
	})

	test('fetches text for text previewers', async () => {
		const user = userEvent.setup()
		mockFetch('# Notes body')
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'notes.md' }))
		await user.keyboard('{Enter}')
		expect(await screen.findByText('# Notes body')).toBeInTheDocument()
	})

	test('edits and saves a text file through the adapter', async () => {
		const user = userEvent.setup()
		mockFetch('# Notes')
		const adapter = await adapterWithFiles()
		const upload = vi.spyOn(adapter, 'upload')
		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'More actions for notes.md' }))
		await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
		const dialog = screen.getByRole('region', { name: 'notes.md' })
		const editor = await within(dialog).findByRole('textbox', { name: 'notes.md contents' })
		expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()

		await user.type(editor, ' updated')
		expect(dialog).toHaveTextContent('Unsaved changes')
		await user.click(within(dialog).getByRole('button', { name: 'Save' }))

		await waitFor(() => expect(upload).toHaveBeenCalledWith('/notes.md', expect.any(File), { onConflict: 'replace' }))
		expect(await (upload.mock.calls[0][1] as File).text()).toBe('# Notes updated')
	})

	test('asks before overwriting a file that changed while editing', async () => {
		const user = userEvent.setup()
		mockFetch('# Notes')
		const adapter = await adapterWithFiles()
		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'More actions for notes.md' }))
		await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
		const dialog = screen.getByRole('region', { name: 'notes.md' })
		await user.type(await within(dialog).findByRole('textbox', { name: 'notes.md contents' }), '!')

		await adapter.upload('/notes.md', textFile('notes.md', '# Changed elsewhere'), { onConflict: 'replace' })
		await user.click(within(dialog).getByRole('button', { name: 'Save' }))

		expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file changed since you opened it')
		expect(within(dialog).getByRole('button', { name: 'Keep my version' })).toBeInTheDocument()
	})

	test('blocks saving past the editor size limit and guards unsaved changes', async () => {
		const user = userEvent.setup()
		mockFetch('ok')
		render(
			<FileBrowser
				adapter={await adapterWithFiles()}
				editors={[{ id: 'small', match: (item) => item.name.endsWith('.md'), maxBytes: 8 }]}
			/>
		)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'More actions for notes.md' }))
		await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
		const dialog = screen.getByRole('region', { name: 'notes.md' })
		await user.type(await within(dialog).findByRole('textbox', { name: 'notes.md contents' }), ' and more')
		expect(within(dialog).getByRole('alert')).toHaveTextContent('Too long')
		expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()

		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
		expect(dialog).toHaveTextContent('Discard unsaved changes?')
	})

	test('hides Edit when editors are disabled', async () => {
		const user = userEvent.setup()
		render(<FileBrowser adapter={await adapterWithFiles()} editors={[]} />)
		await screen.findByText('notes.md')
		await user.click(screen.getByRole('button', { name: 'More actions for notes.md' }))
		expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
	})

	test('opens a file in place in Preview, switches to Edit, and guards unsaved changes', async () => {
		const user = userEvent.setup()
		mockFetch('# Notes')
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')

		await user.dblClick(screen.getByRole('button', { name: 'notes.md' }))
		const view = screen.getByRole('region', { name: 'notes.md' })
		expect(view).toHaveAttribute('data-fb-file-view', 'preview')
		expect(screen.queryByRole('table', { name: 'Files' })).not.toBeInTheDocument()
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(await within(view).findByText('# Notes')).toBeInTheDocument()

		await user.click(within(view).getByRole('button', { name: 'Edit' }))
		await user.type(within(view).getByRole('textbox', { name: 'notes.md contents' }), '!')
		await user.click(within(view).getByRole('button', { name: 'Back to folder' }))
		expect(within(view).getByRole('alert')).toHaveTextContent('Discard unsaved changes?')

		await user.click(within(view).getByRole('button', { name: 'Discard' }))
		expect(screen.getByRole('table', { name: 'Files' })).toBeInTheDocument()
	})

	test('closes a clean file with Escape and shows no details sidebar', async () => {
		const user = userEvent.setup()
		mockFetch('PDF')
		render(<FileBrowser adapter={await adapterWithFiles()} />)
		await screen.findByText('notes.md')

		await user.click(screen.getByRole('button', { name: 'report.pdf' }))
		expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
		await user.keyboard('{Enter}')
		const view = screen.getByRole('region', { name: 'report.pdf' })
		expect(within(view).queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument()
		await user.keyboard('{Escape}')
		expect(screen.getByRole('table', { name: 'Files' })).toBeInTheDocument()
	})
})
