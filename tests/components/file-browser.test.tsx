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

function itemMoveDataTransfer() {
	const data = new Map<string, string>()
	return {
		data,
		dropEffect: 'none',
		effectAllowed: 'uninitialized',
		getData(type: string) {
			return data.get(type) ?? ''
		},
		setData(type: string, value: string) {
			data.set(type, value)
		}
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

	test('applies compact density tokens that differ from comfortable', async () => {
		const adapter = await adapterWithFiles()

		const { container: comfortable } = render(<FileBrowser adapter={adapter} density="comfortable" />)
		const comfortableRoot = comfortable.querySelector<HTMLElement>('[data-fb-density]')
		expect(comfortableRoot).not.toBeNull()
		expect(comfortableRoot?.getAttribute('data-fb-density')).toBe('comfortable')
		expect(comfortableRoot?.style.getPropertyValue('--fb-control-h')).toBe('32px')
		expect(comfortableRoot?.style.getPropertyValue('--fb-card-minh')).toBe('132px')

		const { container: compact } = render(<FileBrowser adapter={adapter} density="compact" />)
		const compactRoot = compact.querySelector<HTMLElement>('[data-fb-density]')
		expect(compactRoot?.getAttribute('data-fb-density')).toBe('compact')
		expect(compactRoot?.style.getPropertyValue('--fb-control-h')).toBe('28px')
		expect(compactRoot?.style.getPropertyValue('--fb-card-minh')).toBe('108px')
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
		let finishDelete: (() => void) | undefined
		const deleteMock = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishDelete = resolve
				})
		)
		adapter.delete = deleteMock

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		expect(screen.getByRole('dialog', { name: 'Delete selected items' })).toHaveTextContent('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(screen.getByRole('button', { name: 'hero-banner.jpg' })).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByRole('button', { name: 'Delete selected' }))
		expect(screen.queryByRole('dialog', { name: 'Delete selected items' })).not.toBeInTheDocument()
		expect(deleteMock).toHaveBeenCalledWith(['/hero-banner.jpg'])

		finishDelete?.()
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
		const dataTransfer = itemMoveDataTransfer()

		const { container } = render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		fireEvent.dragStart(screen.getByRole('button', { name: 'hero-banner.jpg' }), {
			dataTransfer
		})
		fireEvent.dragEnter(screen.getByRole('grid', { name: 'Files' }), {
			dataTransfer
		})
		expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument()

		fireEvent.dragOver(screen.getByRole('button', { name: 'assets' }), {
			dataTransfer
		})
		expect(container.querySelector('[data-fb-path="/assets"]')).toHaveAttribute('data-fb-drop-target', 'true')

		fireEvent.drop(screen.getByRole('button', { name: 'assets' }), {
			dataTransfer
		})
		expect(container.querySelector('[data-fb-path="/assets"]')).not.toHaveAttribute('data-fb-drop-target')

		await waitFor(() => expect(screen.queryByRole('button', { name: 'hero-banner.jpg' })).not.toBeInTheDocument())
		expect((await adapter.list('/assets')).items.map((item) => item.path)).toContain('/assets/hero-banner.jpg')
	})

	test('highlights folder rows as internal move targets in list view', async () => {
		const adapter = await adapterWithFiles()
		const dataTransfer = itemMoveDataTransfer()
		const { container } = render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		fireEvent.click(screen.getByRole('button', { name: 'List view' }))
		fireEvent.dragStart(screen.getByRole('button', { name: 'hero-banner.jpg' }), {
			dataTransfer
		})
		fireEvent.dragOver(screen.getByRole('button', { name: 'assets' }), {
			dataTransfer
		})

		expect(container.querySelector('[data-fb-path="/assets"]')).toHaveAttribute('data-fb-drop-target', 'true')

		fireEvent.dragEnd(screen.getByRole('button', { name: 'hero-banner.jpg' }), {
			dataTransfer
		})
		expect(container.querySelector('[data-fb-path="/assets"]')).not.toHaveAttribute('data-fb-drop-target')
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

	test('copies an item path from the context menu', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.pointer({
			keys: '[MouseRight]',
			target: screen.getByRole('button', { name: 'hero-banner.jpg' })
		})
		await user.click(screen.getByRole('menuitem', { name: 'Copy path' }))

		expect(await navigator.clipboard.readText()).toBe('/hero-banner.jpg')
		expect(screen.getByRole('status', { name: 'Clipboard status' })).toHaveTextContent('Copied path')
	})

	test('keeps the multi-selection when right-clicking a selected item', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{Meta>}')
		await user.click(screen.getByText('quarterly-report.pdf'))
		await user.keyboard('{/Meta}')
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('2 selected')

		await user.pointer({
			keys: '[MouseRight]',
			target: screen.getByRole('button', { name: 'quarterly-report.pdf' })
		})
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('2 selected')

		await user.click(screen.getByRole('menuitem', { name: 'Copy paths' }))

		expect(await navigator.clipboard.readText()).toBe('/hero-banner.jpg, /quarterly-report.pdf')
		expect(screen.getByRole('status', { name: 'Clipboard status' })).toHaveTextContent('Copied 2 paths')
	})

	test('collapses the selection when right-clicking an unselected item', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toHaveTextContent('1 selected')

		await user.pointer({
			keys: '[MouseRight]',
			target: screen.getByRole('button', { name: 'quarterly-report.pdf' })
		})

		await user.click(screen.getByRole('menuitem', { name: 'Copy path' }))
		expect(await navigator.clipboard.readText()).toBe('/quarterly-report.pdf')
	})

	test('copies the selected item path from the details panel', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.click(screen.getByRole('button', { name: 'Copy path of hero-banner.jpg' }))

		expect(await navigator.clipboard.readText()).toBe('/hero-banner.jpg')
		expect(screen.getByRole('status', { name: 'Clipboard status' })).toHaveTextContent('Copied path')
	})

	test('shows a multi-selection summary in the details panel', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))
		await user.keyboard('{Meta>}')
		await user.click(screen.getByText('quarterly-report.pdf'))
		await user.keyboard('{/Meta}')

		const details = screen.getByRole('complementary', { name: 'Details' })
		expect(details).toHaveTextContent('2 items selected')
		expect(details).toHaveTextContent('Total size')

		await user.click(within(details).getByRole('button', { name: 'Copy 2 items paths' }))

		expect(await navigator.clipboard.readText()).toBe('/hero-banner.jpg, /quarterly-report.pdf')
		expect(screen.getByRole('status', { name: 'Clipboard status' })).toHaveTextContent('Copied 2 paths')
	})

	test('clears the clipboard notice after five seconds', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByText('hero-banner.jpg'))

		vi.useFakeTimers()
		try {
			fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
			expect(screen.getByRole('status', { name: 'Clipboard status' })).toBeInTheDocument()

			act(() => {
				vi.advanceTimersByTime(5000)
			})
			expect(screen.queryByRole('status', { name: 'Clipboard status' })).not.toBeInTheDocument()
		} finally {
			vi.useRealTimers()
		}
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
		const user = userEvent.setup({ applyAccept: false })
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser
					adapter={adapter}
					uploadPolicy={{
						allowedMimeTypes: ['image/png', '.pdf'],
						maxFileSizeBytes: 4,
						remainingQuotaBytes: 8
					}}
				/>
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')
		const uploadInput = screen.getByLabelText('Upload files')
		expect(uploadInput).toHaveAttribute('accept', 'image/png,.pdf')

		await user.upload(uploadInput, new File(['too large'], 'notes.txt', { type: 'text/plain' }))

		const alert = screen.getByRole('alert', { name: 'Upload rejected' })
		expect(alert).toHaveTextContent('notes.txt')
		expect(alert).toHaveTextContent('File is larger than 4 B')
		expect(alert).toHaveTextContent('File type text/plain is not allowed')
		expect(manager.getUpload('upload-1')).toBeUndefined()

		await user.click(screen.getByRole('button', { name: 'Dismiss upload rejection' }))
		await user.upload(uploadInput, new File(['abc'], 'ok.png', { type: 'image/png' }))

		await waitFor(() => expect(manager.getUpload('upload-1')).toBeDefined())
	})

	test('applies host surface, root label, and ReactNode empty-state extensions', async () => {
		const adapter = new InMemoryFileBrowserAdapter()
		const { container } = render(
			<FileBrowser
				adapter={adapter}
				className="host-page-surface"
				emptyState={{
					title: <strong>No RAG sources</strong>,
					description: <span>Upload a source to begin indexing.</span>
				}}
				rootLabel="RAG"
			/>
		)

		expect(await screen.findByText('No RAG sources')).toBeInTheDocument()
		expect(screen.getByText('Upload a source to begin indexing.')).toBeInTheDocument()
		expect(container.querySelector('section')).toHaveClass('host-page-surface')
		expect(screen.getByRole('button', { name: 'RAG' })).toBeInTheDocument()
		expect(screen.getByRole('status')).toHaveTextContent('RAG ready.')
	})

	test('passes typed metadata to item renderers and composes single-item details', async () => {
		type FiveStarMetadata = { ragStatus: 'indexed' | 'failed' }
		const user = userEvent.setup()
		const adapter = new InMemoryFileBrowserAdapter<FiveStarMetadata>({
			initialEntries: [
				{
					id: 'file-uuid',
					kind: 'file',
					metadata: { ragStatus: 'indexed' },
					name: 'handbook.pdf',
					path: '/handbook.pdf',
					size: 12
				}
			]
		})

		render(
			<FileBrowser<FiveStarMetadata>
				adapter={adapter}
				renderDetailsContent={(item, defaultContent) => (
					<>
						{defaultContent}
						<div>Details status: {item.metadata?.ragStatus}</div>
					</>
				)}
				renderItemMeta={(item, { view }) => (
					<span>
						{item.id}:{item.metadata?.ragStatus}:{view}
					</span>
				)}
			/>
		)

		expect(await screen.findByText('file-uuid:indexed:grid')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'List view' }))
		expect(screen.getByText('file-uuid:indexed:list')).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'handbook.pdf' }))
		const details = screen.getByRole('complementary', { name: 'Details' })
		expect(details).toHaveTextContent('/handbook.pdf')
		expect(details).toHaveTextContent('Details status: indexed')
	})

	test('emits opaque item identity and breadcrumb sources for controlled navigation', async () => {
		const user = userEvent.setup()
		const onPathChange = vi.fn()
		const adapter = new InMemoryFileBrowserAdapter({
			initialEntries: [{ id: 'folder-uuid', kind: 'folder', name: 'sources', path: '/sources' }]
		})
		const { rerender } = render(<FileBrowser adapter={adapter} onPathChange={onPathChange} path="/" rootLabel="RAG" />)

		await user.dblClick(await screen.findByRole('button', { name: 'sources' }))
		expect(onPathChange).toHaveBeenCalledWith('/sources', {
			item: expect.objectContaining({ id: 'folder-uuid', path: '/sources' }),
			source: 'item'
		})
		expect(screen.getByRole('button', { name: 'sources' })).toBeInTheDocument()

		onPathChange.mockClear()
		rerender(<FileBrowser adapter={adapter} onPathChange={onPathChange} path="/sources" rootLabel="RAG" />)
		expect(await screen.findByText('This folder is empty')).toBeInTheDocument()
		expect(onPathChange).not.toHaveBeenCalled()

		await user.click(screen.getByRole('button', { name: 'RAG' }))
		expect(onPathChange).toHaveBeenCalledWith('/', { source: 'breadcrumb' })
	})

	test('supports controlled search and an uncontrolled initial search query', async () => {
		const onSearchQueryChange = vi.fn()
		const adapter = new InMemoryFileBrowserAdapter({
			initialEntries: [
				{ kind: 'file', name: 'hero.txt', path: '/hero.txt' },
				{ kind: 'file', name: 'report.txt', path: '/report.txt' }
			]
		})
		const { rerender, unmount } = render(
			<FileBrowser adapter={adapter} onSearchQueryChange={onSearchQueryChange} searchQuery="hero" />
		)

		expect(await screen.findByRole('button', { name: 'hero.txt' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'report.txt' })).not.toBeInTheDocument()
		fireEvent.change(screen.getByRole('searchbox', { name: 'Search files' }), { target: { value: 'report' } })
		expect(onSearchQueryChange).toHaveBeenCalledWith('report')
		expect(screen.getByRole('searchbox', { name: 'Search files' })).toHaveValue('hero')

		onSearchQueryChange.mockClear()
		rerender(<FileBrowser adapter={adapter} onSearchQueryChange={onSearchQueryChange} searchQuery="report" />)
		expect(await screen.findByRole('button', { name: 'report.txt' })).toBeInTheDocument()
		expect(onSearchQueryChange).not.toHaveBeenCalled()

		unmount()
		render(<FileBrowser adapter={adapter} initialSearchQuery="report" />)
		expect(await screen.findByRole('button', { name: 'report.txt' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'hero.txt' })).not.toBeInTheDocument()
	})

	test('shows only allowed upload conflict resolutions', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()

		render(<FileBrowser adapter={adapter} uploadConflictResolutions={['keep-both', 'skip']} />)
		await screen.findByText('hero-banner.jpg')
		await user.upload(screen.getByLabelText('Upload files'), textFile('hero-banner.jpg', 'replacement'))

		const dialog = await screen.findByRole('dialog', { name: 'File conflict' })
		expect(within(dialog).getByRole('button', { name: 'Keep both' })).toBeInTheDocument()
		expect(within(dialog).getByRole('button', { name: 'Skip' })).toBeInTheDocument()
		expect(within(dialog).queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument()
	})

	test('fails closed when no upload conflict resolutions are enabled', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} uploadConflictResolutions={[]} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')
		await user.upload(screen.getByLabelText('Upload files'), textFile('hero-banner.jpg', 'replacement'))

		const alert = await screen.findByRole('alert', { name: 'Upload rejected' })
		expect(alert).toHaveTextContent('No upload conflict resolutions are enabled')
		expect(screen.queryByRole('dialog', { name: 'File conflict' })).not.toBeInTheDocument()
		expect(manager.getUpload('upload-1')).toBeUndefined()
	})

	test('hides unsupported client-zip downloads but keeps single-file downloads', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles({ bulkDownloadUrl: false })

		render(<FileBrowser adapter={adapter} allowClientZipFallback={false} />)
		await screen.findByText('hero-banner.jpg')

		await user.click(screen.getByRole('button', { name: 'assets' }))
		expect(within(screen.getByRole('toolbar', { name: 'Selection actions' })).queryByText('Download')).toBeNull()
		expect(screen.queryByRole('button', { name: 'Download assets' })).not.toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'hero-banner.jpg' }))
		expect(within(screen.getByRole('toolbar', { name: 'Selection actions' })).getByText('Download')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Download hero-banner.jpg' })).toBeInTheDocument()

		await user.keyboard('{Meta>}')
		await user.click(screen.getByRole('button', { name: 'quarterly-report.pdf' }))
		await user.keyboard('{/Meta}')
		expect(within(screen.getByRole('toolbar', { name: 'Selection actions' })).queryByText('Download')).toBeNull()
		expect(screen.queryByRole('button', { name: 'Download 2 items' })).not.toBeInTheDocument()
	})

	test('passes the client-zip policy to server-backed bulk downloads', async () => {
		const user = userEvent.setup()
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'download-1' })
		const prepareBulkDownload = vi.spyOn(manager, 'prepareBulkDownload')

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} allowClientZipFallback={false} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')
		await user.click(screen.getByRole('button', { name: 'assets' }))
		await user.click(screen.getByRole('button', { name: 'Download assets' }))

		expect(prepareBulkDownload).toHaveBeenCalledWith(
			expect.objectContaining({ allowClientZipFallback: false, paths: ['/assets'] })
		)
	})

	test('rejects an oversized upload batch before creating folders or enqueueing files', async () => {
		const adapter = await adapterWithFiles()
		const manager = new TransferManager({ idFactory: () => 'upload-1' })
		if (!adapter.createFolder) {
			throw new Error('adapter under test must include createFolder')
		}
		const createFolder = vi.spyOn(adapter, 'createFolder')

		render(
			<FileBrowserProvider manager={manager}>
				<FileBrowser adapter={adapter} uploadPolicy={{ maxFilesPerBatch: 1 }} />
			</FileBrowserProvider>
		)
		await screen.findByText('hero-banner.jpg')
		fireEvent.drop(screen.getByRole('grid', { name: 'Files' }), {
			dataTransfer: dataTransferWithEntry(
				fakeDirectoryEntry('sources', [fakeFileEntry(textFile('one.txt')), fakeFileEntry(textFile('two.txt'))])
			)
		})

		const alert = await screen.findByRole('alert', { name: 'Upload rejected' })
		expect(alert).toHaveTextContent('Batch contains 2 files; maximum is 1')
		expect(createFolder).not.toHaveBeenCalled()
		expect(manager.getUpload('upload-1')).toBeUndefined()
	})
})
