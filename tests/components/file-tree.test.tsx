import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { InMemoryFileBrowserAdapter } from '@/adapters/in-memory'
import { FileTree } from '@/components/file-tree'
import type { FileNode } from '@/core/types'

const folder = (path: string): FileNode => ({ kind: 'folder', name: path.split('/').pop() ?? '', path })
const file = (path: string): FileNode => ({ kind: 'file', name: path.split('/').pop() ?? '', path, size: 1 })

function memoryAdapter() {
	return new InMemoryFileBrowserAdapter({
		initialEntries: [
			folder('/memory'),
			folder('/memory/references'),
			file('/memory/references/email-profile.md'),
			file('/memory/memory.md'),
			file('/memory/episodes.md'),
			folder('/skills'),
			file('/README.md')
		],
		pageSize: 2
	})
}

describe('FileTree', () => {
	test('lists the root with folders first, and opens a folder only when asked', async () => {
		const adapter = memoryAdapter()
		const list = vi.spyOn(adapter, 'list')
		render(<FileTree adapter={adapter} rootLabel="Memory" />)

		const tree = await screen.findByRole('tree', { name: 'Memory' })
		await screen.findByRole('treeitem', { name: 'README.md' })
		expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual(['memory', 'skills', 'README.md'])
		expect(tree).toBeInTheDocument()
		expect(list.mock.calls.every(([path]) => path === '/')).toBe(true)

		await userEvent.click(screen.getByRole('treeitem', { name: 'memory' }))
		await screen.findByRole('treeitem', { name: 'references' })
		// Every page of a folder is read, so nothing past the adapter's page size is missing.
		expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual([
			'memory',
			'references',
			'episodes.md',
			'memory.md',
			'skills',
			'README.md'
		])
		expect(screen.getByRole('treeitem', { name: 'memory' })).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('treeitem', { name: 'episodes.md' })).toHaveAttribute('aria-level', '2')
	})

	test('selects a file by click and marks the controlled selection', async () => {
		const onSelect = vi.fn()
		const { rerender } = render(
			<FileTree adapter={memoryAdapter()} defaultExpandedPaths={['/memory']} onSelect={onSelect} />
		)

		await userEvent.click(await screen.findByRole('treeitem', { name: 'memory.md' }))
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: '/memory/memory.md' }))

		rerender(
			<FileTree
				adapter={memoryAdapter()}
				defaultExpandedPaths={['/memory']}
				onSelect={onSelect}
				selectedPath="/memory/memory.md"
			/>
		)
		expect(await screen.findByRole('treeitem', { name: 'memory.md' })).toHaveAttribute('aria-selected', 'true')
	})

	test('moves, opens, closes and selects with the keyboard', async () => {
		const onSelect = vi.fn()
		render(<FileTree adapter={memoryAdapter()} onSelect={onSelect} />)
		const memory = await screen.findByRole('treeitem', { name: 'memory' })
		memory.focus()

		await userEvent.keyboard('{ArrowRight}')
		await screen.findByRole('treeitem', { name: 'references' })
		await userEvent.keyboard('{ArrowRight}')
		expect(screen.getByRole('treeitem', { name: 'references' })).toHaveFocus()
		await userEvent.keyboard('{ArrowDown}{Enter}')
		expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/memory/episodes.md' }))
		await userEvent.keyboard('{ArrowLeft}')
		expect(memory).toHaveFocus()
		await userEvent.keyboard('{ArrowLeft}')
		expect(memory).toHaveAttribute('aria-expanded', 'false')
		await userEvent.keyboard('{End}')
		expect(screen.getByRole('treeitem', { name: 'README.md' })).toHaveFocus()
		// One tab stop for the whole tree.
		expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0)).toHaveLength(1)
	})

	test('shows a folder that failed to load with a retry, and an empty root', async () => {
		const adapter = memoryAdapter()
		const list = vi.spyOn(adapter, 'list')
		list.mockRejectedValueOnce(new Error('Storage unavailable'))
		render(<FileTree adapter={adapter} />)

		expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable')
		await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
		await waitFor(() => expect(screen.getByRole('treeitem', { name: 'README.md' })).toBeInTheDocument())

		render(<FileTree adapter={new InMemoryFileBrowserAdapter()} emptyState="Nothing saved yet" />)
		expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument()
	})

	test('creates, renames and deletes through the menu, and hides actions the adapter lacks', async () => {
		const adapter = memoryAdapter()
		const onDeleted = vi.fn()
		const onSelect = vi.fn()
		render(<FileTree adapter={adapter} onDeleted={onDeleted} onSelect={onSelect} rootLabel="Memory" />)
		await screen.findByRole('treeitem', { name: 'README.md' })

		await userEvent.upload(
			document.querySelector<HTMLInputElement>('input[type="file"]') ?? document.createElement('input'),
			new File(['hello'], 'notes.md', { type: 'text/markdown' })
		)
		// Uploads go through the transfer queue and appear in their folder when finished.
		await screen.findByRole('treeitem', { name: 'notes.md' })
		expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()

		await userEvent.click(screen.getByRole('button', { name: 'New folder' }))
		await userEvent.type(screen.getByRole('textbox', { name: 'New folder name' }), 'drafts{Enter}')
		await screen.findByRole('treeitem', { name: 'drafts' })

		screen.getByRole('treeitem', { name: 'notes.md' }).focus()
		await userEvent.keyboard('{F2}')
		const name = screen.getByRole('textbox', { name: 'New name' })
		await userEvent.clear(name)
		await userEvent.type(name, 'plan.md{Enter}')
		await screen.findByRole('treeitem', { name: 'plan.md' })

		await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('treeitem', { name: 'plan.md' }) })
		await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
		// The first click only arms delete.
		expect(screen.getByRole('treeitem', { name: 'plan.md' })).toBeInTheDocument()
		await userEvent.click(screen.getByRole('menuitem', { name: 'Click again to delete' }))
		await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'plan.md' })).not.toBeInTheDocument())
		// Rename changes the name, never the storage key.
		expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ name: 'plan.md', path: '/notes.md' }))

		render(<FileTree adapter={{ list: adapter.list.bind(adapter) }} rootLabel="Read only" />)
		await screen.findByRole('tree', { name: 'Read only' })
		expect(screen.getAllByRole('button', { name: 'Upload' })).toHaveLength(1)
	})
})
