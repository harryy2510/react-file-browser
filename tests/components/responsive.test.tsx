import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { InMemoryFileBrowserAdapter } from '@/adapters/in-memory'
import { FileBrowser } from '@/components/file-browser'
import { ActionSheet } from '@/components/responsive'
import { FileBrowserProvider } from '@/transfers/file-browser-provider'
import { TransferManager } from '@/transfers/transfer-manager'

let resize: (width: number) => void
const disconnect = vi.fn()

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(callback: ResizeObserverCallback) {
				resize = (width) =>
					callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
			}
			observe() {}
			disconnect = disconnect
		}
	)
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

async function setup(width = 375, props: Partial<React.ComponentProps<typeof FileBrowser>> = {}) {
	const adapter = new InMemoryFileBrowserAdapter()
	await adapter.createFolder?.('/assets')
	await adapter.upload('/notes.txt', new File(['Notes'], 'notes.txt', { type: 'text/plain' }))
	await adapter.upload('/report.txt', new File(['Report'], 'report.txt', { type: 'text/plain' }))
	if (props.initialPath) {
		let path = ''
		for (const part of props.initialPath.split('/').filter(Boolean)) {
			path += `/${part}`
			await adapter.createFolder?.(path)
		}
	}
	const result = render(<FileBrowser adapter={adapter} {...props} />)
	if (props.initialPath) await screen.findByText('This folder is empty')
	else await screen.findByRole('button', { name: 'notes.txt' })
	act(() => resize(width))
	return { ...result, adapter, user: userEvent.setup() }
}

async function switchToList(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole('button', { name: 'Browser options' }))
	await user.click(screen.getByRole('button', { name: 'List view' }))
	await user.click(screen.getByRole('button', { name: 'Close Browser options' }))
}

async function longPress(name: string) {
	const button = screen.getByRole('button', { name })
	vi.useFakeTimers()
	fireEvent.touchStart(button)
	await act(() => vi.advanceTimersByTime(510))
	fireEvent.touchEnd(button)
	fireEvent.click(button)
	vi.useRealTimers()
}

const selectedItem = () => document.querySelector('[data-fb-path][aria-selected="true"]')
const openFileView = () => document.querySelector('[data-fb-file-view]')

describe('responsive file browser', () => {
	test('uses its container width, supports live resizing, and disconnects its observer', async () => {
		const { container, unmount } = await setup()
		expect(window.innerWidth).toBeGreaterThan(640)
		expect(container.querySelector('[data-fb-layout]')).toHaveAttribute('data-fb-layout', 'narrow')
		expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument()
		act(() => resize(800))
		expect(screen.getByRole('button', { name: 'New folder' })).toBeInTheDocument()
		act(() => resize(1100))
		expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
		act(() => resize(639))
		expect(screen.getByRole('button', { name: 'Browser options' })).toBeInTheDocument()
		unmount()
		expect(disconnect).toHaveBeenCalled()
	})

	test.each(['grid', 'list'])('single taps open files and folders in the narrow %s view', async (view) => {
		const { user } = await setup()
		if (view === 'list') await switchToList(user)
		await user.click(screen.getByRole('button', { name: 'notes.txt' }))
		expect(screen.getByRole('region', { name: 'notes.txt' })).toBeInTheDocument()
		await user.keyboard('{Escape}')
		await user.click(screen.getByRole('button', { name: 'assets' }))
		await screen.findByText('This folder is empty')
		expect(screen.getByRole('button', { name: 'Parent folder' })).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Parent folder' }))
		expect(await screen.findByRole('button', { name: 'notes.txt' })).toBeInTheDocument()
	})

	test.each(['grid', 'list'])('long press enters selection and suppresses opening in %s view', async (view) => {
		const { user } = await setup()
		if (view === 'list') await switchToList(user)
		await longPress('notes.txt')
		expect(openFileView()).not.toBeInTheDocument()
		expect(screen.getByRole('checkbox', { name: 'Select notes.txt' })).toHaveAttribute('aria-checked', 'true')
		await user.click(screen.getByRole('button', { name: 'report.txt' }))
		expect(screen.getByRole('checkbox', { name: 'Select report.txt' })).toHaveAttribute('aria-checked', 'true')
		await user.click(screen.getByRole('checkbox', { name: 'Select notes.txt' }))
		expect(screen.getByRole('checkbox', { name: 'Select notes.txt' })).toHaveAttribute('aria-checked', 'false')
		await user.click(screen.getByRole('button', { name: 'Exit selection' }))
		expect(screen.queryByRole('checkbox', { name: 'Select report.txt' })).not.toBeInTheDocument()
	})

	test.each(['touchMove', 'touchCancel', 'touchEnd'])('cancels a long press on %s', async (event) => {
		await setup()
		vi.useFakeTimers()
		const target = screen.getByRole('button', { name: 'notes.txt' })
		fireEvent.touchStart(target)
		fireEvent[event as 'touchMove' | 'touchCancel' | 'touchEnd'](target)
		await act(() => vi.advanceTimersByTime(600))
		expect(screen.queryByRole('button', { name: 'Exit selection' })).not.toBeInTheDocument()
	})

	test('cancels a pending long press when the item unmounts', async () => {
		const { unmount } = await setup()
		vi.useFakeTimers()
		fireEvent.touchStart(screen.getByRole('button', { name: 'notes.txt' }))
		unmount()
		expect(vi.getTimerCount()).toBe(0)
	})

	test('does not swallow a later mouse click when a touch long press emits no click', async () => {
		const { user } = await setup()
		vi.useFakeTimers()
		const button = screen.getByRole('button', { name: 'notes.txt' })
		fireEvent.touchStart(button)
		await act(() => vi.advanceTimersByTime(510))
		fireEvent.touchEnd(button)
		await act(() => vi.advanceTimersByTime(400))
		vi.useRealTimers()
		await user.click(screen.getByRole('button', { name: 'Exit selection' }))
		await user.click(button)
		expect(screen.getByRole('region', { name: 'notes.txt' })).toBeInTheDocument()
	})

	test('lets keyboard users toggle mobile checkboxes without opening a preview', async () => {
		const { user } = await setup()
		await longPress('notes.txt')
		const checkbox = screen.getByRole('checkbox', { name: 'Select notes.txt' })
		checkbox.focus()
		await user.keyboard('{Enter}')
		expect(checkbox).toHaveAttribute('aria-checked', 'false')
		expect(openFileView()).not.toBeInTheDocument()
		expect(screen.getByLabelText('Upload files')).toBeInTheDocument()
	})

	test('does not open the selected file when Enter activates a toolbar control', async () => {
		const { user } = await setup(1100)
		await user.click(screen.getByRole('button', { name: 'notes.txt' }))
		screen.getByRole('button', { name: 'New folder' }).focus()
		await user.keyboard('{Enter}')
		expect(screen.getByRole('dialog', { name: 'New folder' })).toBeInTheDocument()
		expect(openFileView()).not.toBeInTheDocument()
	})

	test('keeps mobile mutation actions gated when optional adapter methods are absent', async () => {
		const adapter = new InMemoryFileBrowserAdapter({
			capabilities: { createFolder: false, rename: false, move: false, copy: false }
		})
		await adapter.upload('/notes.txt', new File(['notes'], 'notes.txt'))
		const { user } = await setup(375, { adapter })
		await user.click(screen.getByRole('button', { name: 'Browser options' }))
		expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Select items' }))
		await user.click(screen.getByRole('button', { name: 'notes.txt' }))
		await user.click(screen.getByRole('button', { name: 'Actions' }))
		for (const name of ['Rename', 'Copy', 'Cut', 'Move']) {
			expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
		}
		expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
	})

	test('keeps a selected item unchanged while navigating a desktop context menu', async () => {
		const { user } = await setup(1100)
		fireEvent.contextMenu(screen.getByRole('button', { name: 'notes.txt' }), { clientX: 1000, clientY: 750 })
		expect(screen.getByRole('menuitem', { name: 'Preview' })).toHaveFocus()
		await user.keyboard('{ArrowDown}')
		expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
		expect(selectedItem()).toHaveTextContent('notes.txt')
		await user.keyboard('{Escape}')
		expect(screen.queryByRole('menu', { name: 'Item actions' })).not.toBeInTheDocument()
	})

	test('offers selection, sort, filter, and view controls without requiring touch', async () => {
		const { user } = await setup()
		await user.click(screen.getByRole('button', { name: 'Browser options' }))
		await user.selectOptions(screen.getByLabelText('Sort files'), 'size')
		await user.selectOptions(screen.getByLabelText('Filter files'), 'files')
		await user.click(screen.getByRole('button', { name: 'Select items' }))
		await user.click(screen.getByRole('button', { name: 'Select all' }))
		expect(screen.getByText('3 selected')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Actions' }))
		expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
	})

	test('preserves capability and read-only gating in narrow controls', async () => {
		const { user } = await setup(375, { readOnly: true })
		expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Browser options' }))
		expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Select items' }))
		await user.click(screen.getByRole('button', { name: 'notes.txt' }))
		await user.click(screen.getByRole('button', { name: 'Actions' }))
		for (const name of ['Delete', 'Rename', 'Copy', 'Cut', 'Move']) {
			expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
		}
		expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
	})

	test('keeps deep breadcrumb ancestors reachable', async () => {
		const { user } = await setup(375, { initialPath: '/workspace/clients/acme/briefs' })
		await user.click(screen.getByRole('button', { name: 'Collapsed breadcrumb' }))
		const sheet = screen.getByRole('dialog', { name: 'Folder path' })
		expect(within(sheet).getByRole('button', { name: 'clients' })).toBeInTheDocument()
		await user.click(within(sheet).getByRole('button', { name: 'Files' }))
		expect(await screen.findByRole('button', { name: 'notes.txt' })).toBeInTheDocument()
	})

	test('opens mutation dialogs as sheets and leaves selection intact while typing', async () => {
		const { user } = await setup()
		await user.click(screen.getByRole('button', { name: 'Browser options' }))
		await user.click(screen.getByRole('button', { name: 'New folder' }))
		const dialog = screen.getByRole('dialog', { name: 'New folder' })
		expect(dialog).toHaveAttribute('data-fb-dialog', 'sheet')
		expect(screen.getByRole('textbox', { name: 'Folder name' })).toHaveFocus()
		await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'new-folder')
		await user.click(screen.getByRole('button', { name: 'Create folder' }))
		expect(await screen.findByRole('button', { name: 'new-folder' })).toBeInTheDocument()
	})

	test('stacks conflict actions in a narrow sheet', async () => {
		const { container } = await setup()
		fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [new File(['new'], 'notes.txt')] } })
		const dialog = await screen.findByRole('dialog', { name: 'File conflict' })
		expect(dialog).toHaveAttribute('data-fb-dialog', 'sheet')
		expect(within(dialog).getByRole('button', { name: 'Keep both' }).parentElement).toHaveClass('flex-col')
		expect(container.querySelector('[data-fb-layout]')).toHaveAttribute('data-fb-layout', 'narrow')
	})

	test('uses touch-sized controls even with compact density', async () => {
		const { container } = await setup(320, { density: 'compact' })
		expect((container.querySelector('[data-fb-density]') as HTMLElement).style.getPropertyValue('--fb-control-h')).toBe(
			'calc(var(--fb-gap) * 11)'
		)
	})
})

describe('responsive overlays', () => {
	test('traps focus, dismisses with Escape, and restores the opener', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		const opener = document.createElement('button')
		document.body.append(opener)
		opener.focus()
		const { unmount } = render(
			<ActionSheet label="Actions" onClose={onClose}>
				<button type="button">Last action</button>
			</ActionSheet>
		)
		await user.tab()
		expect(screen.getByRole('button', { name: 'Close Actions' })).toHaveFocus()
		await user.tab({ shift: true })
		expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus()
		await user.keyboard('{Escape}')
		expect(onClose).toHaveBeenCalledOnce()
		unmount()
		expect(opener).toHaveFocus()
		opener.remove()
	})

	test('starts mobile transfers collapsed and retains working controls after expansion', async () => {
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
		)
		const adapter = new InMemoryFileBrowserAdapter()
		const manager = new TransferManager({ storage: null })
		const id = manager.enqueueUpload({ adapter, destinationPath: '/notes.txt', file: new File(['notes'], 'notes.txt') })
		manager.pauseUpload(id)
		const user = userEvent.setup()
		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)
		expect(screen.queryByRole('button', { name: 'Cancel upload notes.txt' })).not.toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Expand transfers' }))
		expect(screen.getByRole('button', { name: 'Resume upload notes.txt' })).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Cancel upload notes.txt' }))
		expect(screen.queryByRole('complementary', { name: 'Transfers' })).not.toBeInTheDocument()
	})
})
