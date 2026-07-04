import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { InMemoryFileBrowserAdapter } from '@/adapters/in-memory'
import { FileBrowser } from '@/components/file-browser'
import { FileBrowserAdapterError, FileBrowserBulkActionError } from '@/core/types'
import { FileBrowserProvider } from '@/transfers/file-browser-provider'
import { TransferManager } from '@/transfers/transfer-manager'

const textFile = (name: string, text = name) => new File([text], name, { type: 'text/plain' })

type FakeFileEntry = {
	isFile: true
	isDirectory: false
	name: string
	file: (success: (file: File) => void) => void
}

type FakeDirectoryEntry = {
	isFile: false
	isDirectory: true
	name: string
	createReader: () => {
		readEntries: (success: (entries: Array<FakeFileEntry | FakeDirectoryEntry>) => void) => void
	}
}

function fakeFileEntry(file: File): FakeFileEntry {
	return {
		isFile: true,
		isDirectory: false,
		name: file.name,
		file: (success) => success(file)
	}
}

function fakeDirectoryEntry(name: string, entries: Array<FakeFileEntry | FakeDirectoryEntry>): FakeDirectoryEntry {
	return {
		isFile: false,
		isDirectory: true,
		name,
		createReader: () => {
			let read = false
			return {
				readEntries: (success) => {
					success(read ? [] : entries)
					read = true
				}
			}
		}
	}
}

function dataTransferWithEntry(entry: FakeFileEntry | FakeDirectoryEntry) {
	return {
		files: [],
		items: [
			{
				webkitGetAsEntry: () => entry
			}
		]
	} as unknown as DataTransfer
}

async function adapterWithFiles(capabilities = {}) {
	const adapter = new InMemoryFileBrowserAdapter({ capabilities })
	await adapter.createFolder?.('/assets')
	await adapter.upload('/hero-banner.jpg', textFile('hero-banner.jpg'))
	await adapter.upload('/quarterly-report.pdf', textFile('quarterly-report.pdf'))
	return adapter
}

describe('FileBrowser', () => {
	test('renders toolbar, grid/list toggle, selection details, and preview modal', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(
			<FileBrowserProvider>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)

		expect(screen.getByRole('grid', { name: 'Files' })).toBeInTheDocument()
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'List view' }))
		expect(screen.getByRole('table', { name: 'Files' })).toBeInTheDocument()

		await user.click(screen.getByText('quarterly-report.pdf'))
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('quarterly-report.pdf')

		await user.keyboard('{Enter}')
		expect(screen.getByRole('dialog', { name: /Preview/ })).toHaveTextContent('quarterly-report.pdf')
	})

	test('keeps selection chrome stable and clears selection from empty canvas', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('No item selected')

		await user.click(screen.getByText('hero-banner.jpg'))
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('hero-banner.jpg')

		await user.click(screen.getByRole('grid', { name: 'Files' }))

		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('No item selected')
	})

	test('applies subtle motion to core browser chrome', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.getByRole('button', { name: 'Upload' }).className).toContain('duration-150')
		expect(screen.getByRole('button', { name: 'Upload' }).className).toContain('motion-reduce:transition-none')
		expect(screen.getByText('hero-banner.jpg').closest('article')?.className).toContain('duration-200')
		expect(screen.getByRole('toolbar', { name: 'Selection actions' }).className).toContain('duration-200')
		expect(screen.getByRole('complementary', { name: 'Details' }).className).toContain('duration-200')
	})

	test('toggles off a selected item with a plain click', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')
		vi.useFakeTimers()
		try {
			const fileButton = screen.getByRole('button', { name: 'hero-banner.jpg' })
			fireEvent.click(fileButton, { detail: 1 })
			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')

			fireEvent.click(fileButton, { detail: 1 })
			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')

			act(() => {
				vi.advanceTimersByTime(221)
			})

			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')
			expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('No item selected')
		} finally {
			vi.useRealTimers()
		}
	})

	test('does not unselect a selected item while double-clicking it', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')
		vi.useFakeTimers()
		try {
			const fileButton = screen.getByRole('button', { name: 'hero-banner.jpg' })
			fireEvent.click(fileButton, { detail: 1 })
			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')

			fireEvent.click(fileButton, { detail: 1 })
			fireEvent.click(fileButton, { detail: 2 })
			fireEvent.doubleClick(fileButton)

			act(() => {
				vi.advanceTimersByTime(221)
			})

			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')
		} finally {
			vi.useRealTimers()
		}
	})

	test('does not count a slow second click as a double-click', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')
		vi.useFakeTimers()
		try {
			const fileButton = screen.getByRole('button', { name: 'hero-banner.jpg' })
			fireEvent.click(fileButton, { detail: 1 })
			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')

			fireEvent.click(fileButton, { detail: 1 })
			act(() => {
				vi.advanceTimersByTime(221)
			})
			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')

			fireEvent.click(fileButton, { detail: 2 })
			fireEvent.doubleClick(fileButton)

			expect(screen.queryByRole('dialog', { name: /Preview/ })).not.toBeInTheDocument()
			expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')
		} finally {
			vi.useRealTimers()
		}
	})

	test('centers the empty details panel state', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.getByText('No item selected').parentElement).toHaveClass('text-center')
	})

	test('can hide the details panel', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} showDetailsPanel={false} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument()
	})

	test('offers explicit select all and select none controls', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'Select all' }))
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('3 selected')

		await user.click(screen.getByRole('button', { name: 'Select none' }))
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('0 selected')
	})

	test('selection action buttons use a consistent icon treatment', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')
		await user.click(screen.getByText('hero-banner.jpg'))

		const toolbar = screen.getByRole('toolbar', { name: 'Selection actions' })
		for (const name of ['Select all', 'Select none', 'Rename', 'Move', 'Copy', 'Cut', 'Download', 'Delete']) {
			expect(within(toolbar).getByRole('button', { name }).querySelector('svg')).not.toBeNull()
		}
	})

	test('clipboard actions announce simple feedback', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Copy' }))

		expect(screen.getByRole('status', { name: 'Clipboard status' })).toHaveTextContent('Copied 1 item')
	})

	test('announces folder state and selection count for screen readers', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.getByRole('status')).toHaveTextContent('Files ready. 3 items. 0 selected.')
		await user.click(screen.getByText('hero-banner.jpg'))
		expect(screen.getByRole('status')).toHaveTextContent('Files ready. 3 items. 1 selected.')
	})

	test('downloads the selected item from the details panel', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const bulkDownloadUrl = vi.fn(() =>
			Promise.resolve({
				url: 'https://files.example/hero.zip',
				expiresAt: '2026-07-04T04:00:00.000Z'
			})
		)
		const signedUrl = vi.fn(() => Promise.resolve('https://files.example/hero-banner.jpg'))
		Object.defineProperty(adapter, 'bulkDownloadUrl', {
			value: bulkDownloadUrl
		})
		Object.defineProperty(adapter, 'signedUrl', {
			value: signedUrl
		})
		const manager = new TransferManager({ idFactory: () => 'download-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Download hero-banner.jpg' }))

		await waitFor(() =>
			expect(manager.getSnapshot().downloads.at(0)).toMatchObject({
				status: 'ready',
				strategy: 'single',
				url: 'https://files.example/hero-banner.jpg'
			})
		)
		expect(signedUrl).toHaveBeenCalledWith('/hero-banner.jpg')
		expect(bulkDownloadUrl).not.toHaveBeenCalled()
	})

	test('steps through previewable files in the modal', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{Enter}')

		expect(screen.getByRole('dialog', { name: /Preview/ })).toHaveTextContent('hero-banner.jpg')
		await user.click(screen.getByRole('button', { name: 'Next file' }))
		expect(screen.getByRole('dialog', { name: /Preview/ })).toHaveTextContent('quarterly-report.pdf')
		await user.click(screen.getByRole('button', { name: 'Previous file' }))
		expect(screen.getByRole('dialog', { name: /Preview/ })).toHaveTextContent('hero-banner.jpg')
	})

	test('loads a signed URL for file previews', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const signedUrl = vi.fn(() => Promise.resolve('https://files.example/preview/hero-banner.jpg'))
		Object.defineProperty(adapter, 'signedUrl', {
			value: signedUrl
		})

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{Enter}')

		const dialog = screen.getByRole('dialog', { name: /Preview/ })
		expect(
			await within(dialog).findByRole('link', {
				name: 'Open original hero-banner.jpg'
			})
		).toHaveAttribute('href', 'https://files.example/preview/hero-banner.jpg')
		expect(signedUrl).toHaveBeenCalledWith('/hero-banner.jpg')
	})

	test('hides unsupported move rename copy controls instead of disabling them', async () => {
		const adapter = await adapterWithFiles({
			createFolder: false,
			rename: false,
			move: false,
			copy: false
		})

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument()
	})

	test('does not label the loaded boundary as End', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.queryByText('End')).not.toBeInTheDocument()
	})

	test('grid selection surface fills the scrollable file area', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.getByRole('grid', { name: 'Files' })).toHaveClass('min-h-full')
	})

	test('creates folders and filters sorted results', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'New folder' }))
		await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Briefs')
		await user.click(screen.getByRole('button', { name: 'Create folder' }))

		await waitFor(() => expect(screen.getByText('Briefs')).toBeInTheDocument())

		await user.type(screen.getByRole('searchbox', { name: 'Search files' }), 'hero')
		expect(screen.getByText('hero-banner.jpg')).toBeInTheDocument()
		expect(screen.queryByText('quarterly-report.pdf')).not.toBeInTheDocument()
	})

	test('keeps the new folder dialog open on name conflicts', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'New folder' }))
		await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'assets')
		await user.click(screen.getByRole('button', { name: 'Create folder' }))

		const dialog = await screen.findByRole('dialog', { name: 'New folder' })
		expect(dialog).toHaveTextContent('A file browser entry already exists at /assets')
		expect(within(dialog).getByRole('textbox', { name: 'Folder name' })).toHaveValue('assets')
	})

	test('collapses middle breadcrumbs for deep paths', async () => {
		const adapter = new InMemoryFileBrowserAdapter()
		if (!adapter.createFolder) {
			throw new Error('adapter under test must include createFolder')
		}
		await adapter.createFolder('/workspace')
		await adapter.createFolder('/workspace/clients')
		await adapter.createFolder('/workspace/clients/acme')
		await adapter.createFolder('/workspace/clients/acme/briefs')

		render(<FileBrowser adapter={adapter} initialPath="/workspace/clients/acme/briefs" />)
		await screen.findByRole('grid', { name: 'Files' })

		const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
		expect(within(breadcrumb).getByRole('button', { name: 'Files' })).toBeInTheDocument()
		expect(within(breadcrumb).getByRole('button', { name: 'workspace' })).toBeInTheDocument()
		expect(within(breadcrumb).queryByRole('button', { name: 'clients' })).not.toBeInTheDocument()
		expect(within(breadcrumb).getByLabelText('Collapsed breadcrumb')).toHaveTextContent('...')
		expect(within(breadcrumb).getByRole('button', { name: 'acme' })).toBeInTheDocument()
		expect(within(breadcrumb).getByRole('button', { name: 'briefs' })).toBeInTheDocument()
	})

	test('filters visible files from the toolbar', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.selectOptions(screen.getByRole('combobox', { name: 'Filter files' }), 'folders')

		expect(screen.getByRole('button', { name: 'assets' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'hero-banner.jpg' })).not.toBeInTheDocument()
	})

	test('renames a selected item with a custom dialog', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Rename' }))
		const input = screen.getByRole('textbox', { name: 'New name' })
		await user.clear(input)
		await user.type(input, 'hero-renamed.jpg')
		await user.click(screen.getByRole('button', { name: 'Rename item' }))

		expect(await screen.findByRole('button', { name: 'hero-renamed.jpg' })).toBeInTheDocument()
	})

	test('confirms before deleting selected items', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		expect(screen.getByRole('dialog', { name: 'Delete selected items' })).toHaveTextContent('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(screen.getByRole('button', { name: 'hero-banner.jpg' })).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByRole('button', { name: 'Delete selected' }))

		await waitFor(() => expect(screen.queryByRole('button', { name: 'hero-banner.jpg' })).not.toBeInTheDocument())
	})

	test('surfaces partial bulk delete failures without rolling back successes', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const originalDelete = adapter.delete.bind(adapter)
		adapter.delete = async (paths) => {
			await originalDelete(['/hero-banner.jpg'])
			throw new FileBrowserBulkActionError('delete', {
				succeededPaths: ['/hero-banner.jpg'],
				failures: [
					{
						path: '/quarterly-report.pdf',
						message: 'Locked by retention policy'
					}
				],
				totalCount: paths.length
			})
		}

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{Control>}')
		await user.click(screen.getByRole('button', { name: 'quarterly-report.pdf' }))
		await user.keyboard('{/Control}')
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByRole('button', { name: 'Delete selected' }))

		const dialog = await screen.findByRole('dialog', {
			name: 'Partial bulk failure'
		})
		expect(dialog).toHaveTextContent('1 of 2 completed')
		expect(dialog).toHaveTextContent('quarterly-report.pdf')
		expect(dialog).toHaveTextContent('Locked by retention policy')
		expect(screen.queryByRole('button', { name: 'hero-banner.jpg' })).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'quarterly-report.pdf' })).toBeInTheDocument()
	})

	test('renames inline from keyboard shortcuts', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{F2}')
		const input = screen.getByRole('textbox', {
			name: 'Rename hero-banner.jpg'
		})
		await user.clear(input)
		await user.type(input, 'hero-inline.jpg')
		await user.keyboard('{Enter}')
		expect(await screen.findByRole('button', { name: 'hero-inline.jpg' })).toBeInTheDocument()

		await user.keyboard('{Delete}')
		expect(screen.getByRole('dialog', { name: 'Delete selected items' })).toBeInTheDocument()
	})

	test('keeps inline rename open on adapter conflicts', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		Object.defineProperty(adapter, 'rename', {
			value: () => Promise.reject(new FileBrowserAdapterError('conflict', 'Name already exists'))
		})

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{F2}')
		const input = screen.getByRole('textbox', {
			name: 'Rename hero-banner.jpg'
		})
		await user.clear(input)
		await user.type(input, 'quarterly-report.pdf')
		await user.keyboard('{Enter}')

		expect(await screen.findByRole('alert')).toHaveTextContent('Name already exists')
		await waitFor(() =>
			expect(screen.getByRole('textbox', { name: 'Rename hero-banner.jpg' })).toHaveValue('quarterly-report.pdf')
		)
		expect(screen.getByRole('gridcell', { selected: true })).toHaveAttribute('data-fb-path', '/hero-banner.jpg')
		await waitFor(() =>
			expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('hero-banner.jpg')
		)
	})

	test('moves item focus and selection with keyboard arrows', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.keyboard('{ArrowDown}')
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('assets')
		await waitFor(() => expect(screen.getByRole('gridcell', { name: 'assets Folder' })).toHaveFocus())

		await user.keyboard('{ArrowDown}')
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('hero-banner.jpg')
		await waitFor(() => expect(screen.getByRole('gridcell', { name: 'hero-banner.jpg 15 B' })).toHaveFocus())

		await user.keyboard('{End}')
		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('quarterly-report.pdf')
	})

	test('moves list-row focus with keyboard arrows', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'List view' }))
		await user.keyboard('{ArrowDown}')

		expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('assets')
		await waitFor(() => expect(screen.getByRole('row', { name: /assets/ })).toHaveFocus())
	})

	test('moves selected items through a destination picker', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		if (!adapter.createFolder) {
			throw new Error('adapter under test must include createFolder')
		}
		await adapter.createFolder('/assets/archive')

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Move' }))
		const dialog = screen.getByRole('dialog', { name: 'Move selected items' })
		expect(dialog).toBeInTheDocument()

		await user.click(
			await within(dialog).findByRole('button', {
				name: 'Move destination /assets/archive'
			})
		)
		await user.click(within(dialog).getByRole('button', { name: 'Move here' }))

		await waitFor(() => expect(screen.queryByRole('button', { name: 'hero-banner.jpg' })).not.toBeInTheDocument())
		expect((await adapter.list('/assets/archive')).items.map((item) => item.path)).toContain(
			'/assets/archive/hero-banner.jpg'
		)
	})

	test('moves dragged items onto folders when move is supported', async () => {
		const adapter = await adapterWithFiles()
		const dataTransfer = {
			data: new Map<string, string>(),
			dropEffect: 'none',
			effectAllowed: 'uninitialized',
			getData(type: string) {
				return this.data.get(type) ?? ''
			},
			setData(type: string, value: string) {
				this.data.set(type, value)
			}
		}

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		fireEvent.dragStart(screen.getByRole('button', { name: 'hero-banner.jpg' }), {
			dataTransfer
		})
		fireEvent.dragOver(screen.getByRole('button', { name: 'assets' }), {
			dataTransfer
		})
		fireEvent.drop(screen.getByRole('button', { name: 'assets' }), {
			dataTransfer
		})

		await waitFor(() => expect(screen.queryByRole('button', { name: 'hero-banner.jpg' })).not.toBeInTheDocument())
		expect((await adapter.list('/assets')).items.map((item) => item.path)).toContain('/assets/hero-banner.jpg')
	})

	test('offers cut then paste into another folder', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Cut' }))
		await user.click(screen.getByRole('button', { name: 'assets' }))
		await user.keyboard('{Enter}')
		await screen.findByText('This folder is empty')

		await user.pointer({
			keys: '[MouseRight]',
			target: screen.getByText('This folder is empty')
		})
		await user.click(screen.getByRole('menuitem', { name: 'Paste here' }))

		expect(await screen.findByRole('button', { name: 'hero-banner.jpg' })).toBeInTheDocument()
		expect((await adapter.list('/')).items.map((item) => item.path)).not.toContain('/hero-banner.jpg')
	})

	test('renders access denied as a distinct state', async () => {
		const adapter = await adapterWithFiles()
		adapter.list = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))

		render(<FileBrowser adapter={adapter} />)

		expect(await screen.findByText('Access denied')).toBeInTheDocument()
		expect(screen.getByText('Forbidden')).toBeInTheDocument()
	})

	test('opens an item context menu with capability-gated actions', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.pointer({
			keys: '[MouseRight]',
			target: screen.getByRole('button', { name: 'hero-banner.jpg' })
		})

		const menu = screen.getByRole('menu', { name: 'Item actions' })
		expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
		expect(within(menu).getByRole('menuitem', { name: 'Move' })).toBeInTheDocument()
		expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
	})

	test('opens item actions as a bottom sheet after mobile long press', async () => {
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		vi.useFakeTimers()
		try {
			fireEvent.touchStart(screen.getByRole('button', { name: 'hero-banner.jpg' }))
			act(() => {
				vi.advanceTimersByTime(560)
			})

			const menu = screen.getByRole('menu', { name: 'Item actions' })
			expect(menu).toHaveAttribute('data-fb-menu', 'sheet')
			expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
		} finally {
			vi.useRealTimers()
		}
	})

	test('opens an empty-space context menu', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.pointer({
			keys: '[MouseRight]',
			target: screen.getByRole('grid', { name: 'Files' })
		})

		const menu = screen.getByRole('menu', { name: 'Folder actions' })
		expect(within(menu).getByRole('menuitem', { name: 'New folder' })).toBeInTheDocument()
		expect(within(menu).getByRole('menuitem', { name: 'Upload' })).toBeInTheDocument()
	})

	test('supports read-only viewer mode', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} readOnly />)
		await screen.findByText('hero-banner.jpg')

		expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()

		await user.click(screen.getByText('hero-banner.jpg'))
		expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
	})

	test('resolves upload name conflicts with keep both', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.upload(screen.getByLabelText('Upload files'), textFile('hero-banner.jpg', 'replacement'))

		const dialog = screen.getByRole('dialog', { name: 'File conflict' })
		expect(dialog).toHaveTextContent('hero-banner.jpg')
		await user.click(within(dialog).getByRole('button', { name: 'Keep both' }))

		expect(await screen.findByRole('button', { name: 'hero-banner (1).jpg' })).toBeInTheDocument()
	})

	test('uploads through the provider transfer manager', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		await user.upload(screen.getByLabelText('Upload files'), textFile('provider-upload.txt', 'provider'))

		await waitFor(() => expect(manager.getUpload('upload-1')).toBeDefined())
		await manager.waitForIdle()

		expect(manager.getUpload('upload-1')).toMatchObject({
			status: 'completed',
			path: '/provider-upload.txt'
		})
		expect(await screen.findByRole('button', { name: 'provider-upload.txt' })).toBeInTheDocument()
	})

	test('uploads pasted clipboard images through provider transfers', async () => {
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		fireEvent.paste(screen.getByRole('grid', { name: 'Files' }), {
			clipboardData: {
				files: [
					new File(['image'], 'clipboard-shot.png', {
						type: 'image/png'
					})
				]
			}
		})

		await waitFor(() => expect(manager.getUpload('upload-1')).toBeDefined())
		await manager.waitForIdle()

		expect(manager.getUpload('upload-1')).toMatchObject({
			status: 'completed',
			path: '/clipboard-shot.png'
		})
		expect(await screen.findByRole('button', { name: 'clipboard-shot.png' })).toBeInTheDocument()
	})

	test('uploads dropped nested folders through provider transfers', async () => {
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		fireEvent.drop(screen.getByRole('grid', { name: 'Files' }), {
			dataTransfer: dataTransferWithEntry(
				fakeDirectoryEntry('photos', [fakeFileEntry(textFile('nested-photo.txt', 'nested'))])
			)
		})

		await waitFor(() => expect(manager.getUpload('upload-1')).toBeDefined())
		await manager.waitForIdle()

		expect(manager.getUpload('upload-1')).toMatchObject({
			status: 'completed',
			path: '/photos/nested-photo.txt',
			group: {
				id: '/photos',
				name: 'photos',
				totalFiles: 1,
				createdFolders: 1
			}
		})
		expect((await adapter.list('/photos')).items.map((item) => item.path)).toContain('/photos/nested-photo.txt')
	})

	test('detects nested upload conflicts by listing when exists is absent', async () => {
		const adapter = await adapterWithFiles({ exists: false })
		const manager = new TransferManager({ idFactory: () => 'upload-1' })
		if (!adapter.createFolder) {
			throw new Error('adapter under test must include createFolder')
		}
		await adapter.createFolder('/photos')
		await adapter.upload('/photos/nested-photo.txt', textFile('nested-photo.txt', 'existing'))

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		fireEvent.drop(screen.getByRole('grid', { name: 'Files' }), {
			dataTransfer: dataTransferWithEntry(
				fakeDirectoryEntry('photos', [fakeFileEntry(textFile('nested-photo.txt', 'replacement'))])
			)
		})

		const dialog = await screen.findByRole('dialog', { name: 'File conflict' })
		expect(dialog).toHaveTextContent('photos/nested-photo.txt')
		expect(manager.getUpload('upload-1')).toBeUndefined()
	})

	test('rejects nested folder drops when folder creation is unavailable', async () => {
		const adapter = await adapterWithFiles({ createFolder: false })
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		fireEvent.drop(screen.getByRole('grid', { name: 'Files' }), {
			dataTransfer: dataTransferWithEntry(
				fakeDirectoryEntry('photos', [fakeFileEntry(textFile('nested-photo.txt', 'nested'))])
			)
		})

		const alert = await screen.findByRole('alert', { name: 'Upload rejected' })
		expect(alert).toHaveTextContent('photos/nested-photo.txt')
		expect(alert).toHaveTextContent('Folder uploads require folder creation support')
		expect(manager.getUpload('upload-1')).toBeUndefined()
	})

	test('rejects uploads that violate size type and quota policy', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser
					adapter={adapter}
					uploadPolicy={{
						allowedMimeTypes: ['image/png'],
						maxFileSizeBytes: 4,
						remainingQuotaBytes: 8
					}}
				/>
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')

		await user.upload(
			screen.getByLabelText('Upload files'),
			new File(['too large'], 'notes.txt', { type: 'text/plain' })
		)

		const alert = screen.getByRole('alert', { name: 'Upload rejected' })
		expect(alert).toHaveTextContent('notes.txt')
		expect(alert).toHaveTextContent('File is larger than 4 B')
		expect(alert).toHaveTextContent('File type text/plain is not allowed')
		expect(manager.getUpload('upload-1')).toBeUndefined()

		await user.click(screen.getByRole('button', { name: 'Dismiss upload rejection' }))
		await user.upload(screen.getByLabelText('Upload files'), new File(['abc'], 'ok.png', { type: 'image/png' }))

		await waitFor(() => expect(manager.getUpload('upload-1')).toBeDefined())
	})
})
