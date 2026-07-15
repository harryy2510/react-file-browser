import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { InMemoryFileBrowserAdapter } from '@/adapters/in-memory'
import { FileBrowserBulkActionError } from '@/core/types'
import type { FileNode } from '@/core/types'
import { useFileBrowser } from '@/core/use-file-browser'

const textFile = (name: string, text = name) => new File([text], name, { type: 'text/plain' })

async function seededAdapter() {
	const adapter = new InMemoryFileBrowserAdapter({ pageSize: 2 })
	if (!adapter.createFolder) {
		throw new Error('adapter under test must include createFolder')
	}
	await adapter.createFolder('/assets')
	await adapter.createFolder('/docs')
	await adapter.upload('/alpha.txt', textFile('alpha.txt'))
	await adapter.upload('/docs/readme.txt', textFile('readme.txt'))
	await adapter.upload('/zeta.txt', textFile('zeta.txt'))
	return adapter
}

describe('useFileBrowser', () => {
	test('lists, paginates, navigates folders, and clears selection on navigate', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))

		await waitFor(() => expect(result.current.status).toBe('ready'))

		expect(result.current.items.map((item) => item.path)).toEqual(['/assets', '/docs'])
		expect(result.current.hasMore).toBe(true)

		await act(async () => {
			await result.current.loadMore()
		})

		expect(result.current.items.map((item) => item.path)).toEqual(['/assets', '/docs', '/alpha.txt', '/zeta.txt'])

		act(() => result.current.selectOnly('/assets'))
		expect(result.current.selectedPaths).toEqual(['/assets'])

		await act(async () => {
			await result.current.navigate('/docs')
		})

		expect(result.current.currentPath).toBe('/docs')
		expect(result.current.selectedPaths).toEqual([])
		expect(result.current.items.map((item) => item.path)).toEqual(['/docs/readme.txt'])
	})

	test('emits programmatic and item navigation context in uncontrolled mode', async () => {
		type RagMetadata = { ragStatus: 'indexed' | 'pending' }
		const onPathChange = vi.fn()
		const adapter = new InMemoryFileBrowserAdapter<RagMetadata>({
			initialEntries: [
				{
					id: 'folder-docs',
					kind: 'folder',
					metadata: { ragStatus: 'indexed' },
					name: 'docs',
					path: '/docs'
				},
				{
					id: 'folder-rag',
					kind: 'folder',
					metadata: { ragStatus: 'pending' },
					name: 'rag',
					path: '/rag'
				}
			]
		})
		const { result } = renderHook(() => useFileBrowser({ adapter, onPathChange }))
		await waitFor(() => expect(result.current.status).toBe('ready'))

		await act(async () => {
			await result.current.navigate('/docs')
		})
		expect(onPathChange).toHaveBeenLastCalledWith('/docs', { source: 'programmatic' })

		await act(async () => {
			await result.current.navigate('/', { source: 'breadcrumb' })
		})
		expect(onPathChange).toHaveBeenLastCalledWith('/', { source: 'breadcrumb' })
		const ragFolder = result.current.items.find((item) => item.path === '/rag')
		if (!ragFolder) {
			throw new Error('expected seeded RAG folder')
		}
		expectTypeOf(ragFolder).toEqualTypeOf<FileNode<RagMetadata>>()

		await act(async () => {
			await result.current.open(ragFolder)
		})
		expect(onPathChange).toHaveBeenLastCalledWith('/rag', {
			item: expect.objectContaining({
				id: 'folder-rag',
				metadata: { ragStatus: 'pending' },
				path: '/rag'
			}),
			source: 'item'
		})
	})

	test('treats path as controlled and loads external Back and Forward changes once', async () => {
		const adapter = await seededAdapter()
		const list = vi.spyOn(adapter, 'list')
		const onPathChange = vi.fn()
		const { result, rerender } = renderHook(
			({ path }: { path: string }) => useFileBrowser({ adapter, onPathChange, path }),
			{ initialProps: { path: '/' } }
		)
		await waitFor(() => expect(result.current.items.map((item) => item.path)).toEqual(['/assets', '/docs']))

		act(() => result.current.selectOnly('/docs'))
		await act(async () => {
			await result.current.navigate('/docs')
		})
		expect(result.current.currentPath).toBe('/')
		expect(onPathChange).toHaveBeenCalledWith('/docs', { source: 'programmatic' })
		expect(list).toHaveBeenCalledTimes(1)

		rerender({ path: '/docs' })
		await waitFor(() => expect(result.current.items.map((item) => item.path)).toEqual(['/docs/readme.txt']))
		expect(result.current.currentPath).toBe('/docs')
		expect(result.current.selectedPaths).toEqual([])
		expect(onPathChange).toHaveBeenCalledTimes(1)

		rerender({ path: '/' })
		await waitFor(() => expect(result.current.items.map((item) => item.path)).toEqual(['/assets', '/docs']))
		expect(result.current.currentPath).toBe('/')
		expect(onPathChange).toHaveBeenCalledTimes(1)
		expect(list.mock.calls.map(([path]) => path)).toEqual(['/', '/docs', '/'])
	})

	test('supports controlled and uncontrolled search state', async () => {
		const adapter = new InMemoryFileBrowserAdapter({
			initialEntries: [
				{ kind: 'file', name: 'Draft.txt', path: '/draft.txt' },
				{ kind: 'file', name: 'Report.txt', path: '/report.txt' }
			]
		})
		const onSearchQueryChange = vi.fn()
		const controlled = renderHook(
			({ searchQuery }: { searchQuery: string }) => useFileBrowser({ adapter, onSearchQueryChange, searchQuery }),
			{ initialProps: { searchQuery: 'report' } }
		)
		await waitFor(() => expect(controlled.result.current.status).toBe('ready'))
		expect(controlled.result.current.filteredItems.map((item) => item.path)).toEqual(['/report.txt'])

		act(() => controlled.result.current.setSearchQuery('draft'))
		expect(controlled.result.current.searchQuery).toBe('report')
		expect(onSearchQueryChange).toHaveBeenCalledWith('draft')
		controlled.rerender({ searchQuery: 'draft' })
		expect(controlled.result.current.filteredItems.map((item) => item.path)).toEqual(['/draft.txt'])

		const uncontrolled = renderHook(() => useFileBrowser({ adapter, initialSearchQuery: 'draft' }))
		await waitFor(() => expect(uncontrolled.result.current.status).toBe('ready'))
		expect(uncontrolled.result.current.filteredItems.map((item) => item.path)).toEqual(['/draft.txt'])
		act(() => uncontrolled.result.current.setSearchQuery((query) => `${query} missing`))
		expect(uncontrolled.result.current.searchQuery).toBe('draft missing')
		expect(uncontrolled.result.current.filteredItems).toEqual([])
	})

	test('supports cmd-toggle, shift range, select all loaded, and clear', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		act(() => result.current.selectOnly('/assets'))
		act(() => result.current.toggleSelection('/alpha.txt'))
		expect(result.current.selectedPaths).toEqual(['/alpha.txt', '/assets'])

		act(() => result.current.selectRange('/zeta.txt'))
		expect(result.current.selectedPaths).toEqual(['/alpha.txt', '/assets', '/docs', '/zeta.txt'])

		act(() => result.current.clearSelection())
		expect(result.current.selectedPaths).toEqual([])

		act(() => result.current.selectAllLoaded())
		expect(result.current.selectedPaths).toHaveLength(4)
	})

	test('sets marquee selection with replace and additive modes', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		act(() => result.current.setSelection(['/alpha.txt', '/docs']))
		expect(result.current.selectedPaths).toEqual(['/alpha.txt', '/docs'])

		act(() => result.current.setSelection(['/zeta.txt'], { additive: true }))
		expect(result.current.selectedPaths).toEqual(['/alpha.txt', '/docs', '/zeta.txt'])
	})

	test('filters by item kind and sorts visible items', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		act(() => {
			result.current.setFilterKind('files')
			result.current.setSortDirection('desc')
		})

		expect(result.current.filteredItems.map((item) => item.path)).toEqual(['/zeta.txt', '/alpha.txt'])
	})

	test('optimistically creates, renames metadata, deletes, and rolls back failed delete', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		await act(async () => {
			await result.current.createFolder('Briefs')
		})
		expect(result.current.items.map((item) => item.path)).toContain('/Briefs')

		await act(async () => {
			await result.current.rename('/alpha.txt', 'Alpha renamed.txt')
		})
		expect(result.current.items.find((item) => item.path === '/alpha.txt')?.name).toBe('Alpha renamed.txt')

		act(() => result.current.selectOnly('/zeta.txt'))
		await act(async () => {
			await result.current.deleteSelected()
		})
		expect(result.current.items.map((item) => item.path)).not.toContain('/zeta.txt')

		const failingAdapter = await seededAdapter()
		failingAdapter.delete = () => Promise.reject(new Error('delete failed'))
		const rollback = renderHook(() => useFileBrowser({ adapter: failingAdapter }))
		await waitFor(() => expect(rollback.result.current.status).toBe('ready'))
		await act(async () => {
			await rollback.result.current.loadMore()
		})
		act(() => rollback.result.current.selectOnly('/zeta.txt'))

		await act(async () => {
			await expect(rollback.result.current.deleteSelected()).rejects.toThrow('delete failed')
		})
		expect(rollback.result.current.items.map((item) => item.path)).toContain('/zeta.txt')
	})

	test('gates clipboard paste by adapter capabilities', async () => {
		const full = await seededAdapter()
		const fullHook = renderHook(() => useFileBrowser({ adapter: full }))
		await waitFor(() => expect(fullHook.result.current.status).toBe('ready'))
		await act(async () => {
			await fullHook.result.current.loadMore()
		})

		act(() => fullHook.result.current.copySelection(['/alpha.txt']))
		await act(async () => {
			await fullHook.result.current.pasteInto('/docs')
		})
		expect((await full.list('/docs')).items.map((item) => item.path)).toContain('/docs/alpha.txt')

		const minimal = new InMemoryFileBrowserAdapter({
			capabilities: { copy: false, move: false, rename: false }
		})
		await minimal.upload('/alpha.txt', textFile('alpha.txt'))
		const minimalHook = renderHook(() => useFileBrowser({ adapter: minimal }))
		await waitFor(() => expect(minimalHook.result.current.status).toBe('ready'))

		expect(minimalHook.result.current.capabilities.copy).toBe(false)
		act(() => minimalHook.result.current.copySelection(['/alpha.txt']))
		await act(async () => {
			await expect(minimalHook.result.current.pasteInto('/')).rejects.toThrow('Copy is not supported')
		})
	})

	test('moves the current selection to a destination folder', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		act(() => result.current.selectOnly('/alpha.txt'))
		await act(async () => {
			await result.current.moveSelectedTo('/docs')
		})

		expect(result.current.selectedPaths).toEqual([])
		expect(result.current.items.map((item) => item.path)).not.toContain('/alpha.txt')
		expect((await adapter.list('/docs')).items.map((item) => item.path)).toContain('/docs/alpha.txt')
	})

	test('keeps successful paths removed after partial bulk move failure', async () => {
		const adapter = await seededAdapter()
		Object.defineProperty(adapter, 'move', {
			value: (paths: string[]) =>
				Promise.reject(
					new FileBrowserBulkActionError('move', {
						succeededPaths: ['/alpha.txt'],
						failures: [{ path: '/zeta.txt', message: 'Move denied' }],
						totalCount: paths.length
					})
				)
		})
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		act(() => {
			result.current.selectOnly('/alpha.txt')
			result.current.toggleSelection('/zeta.txt')
		})
		await act(async () => {
			await expect(result.current.moveSelectedTo('/docs')).rejects.toThrow(FileBrowserBulkActionError)
		})

		expect(result.current.items.map((item) => item.path)).not.toContain('/alpha.txt')
		expect(result.current.items.map((item) => item.path)).toContain('/zeta.txt')
		expect(result.current.selectedPaths).toEqual(['/zeta.txt'])
	})

	test('uploads files into the current folder and refreshes the listing', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))

		await act(async () => {
			await result.current.uploadFiles([textFile('brief.txt', 'brief')])
		})

		expect(result.current.items.map((item) => item.path)).toContain('/brief.txt')

		await act(async () => {
			await result.current.navigate('/docs')
			await result.current.uploadFiles([textFile('nested.txt', 'nested')])
		})

		expect((await adapter.list('/docs')).items.map((item) => item.path)).toContain('/docs/nested.txt')
	})

	test('uploads with explicit conflict resolutions', async () => {
		const adapter = await seededAdapter()
		const { result } = renderHook(() => useFileBrowser({ adapter }))
		await waitFor(() => expect(result.current.status).toBe('ready'))
		await act(async () => {
			await result.current.loadMore()
		})

		await act(async () => {
			await result.current.uploadFiles([textFile('alpha.txt', 'copy')], {
				onConflict: 'keep-both'
			})
		})
		expect(result.current.items.map((item) => item.path)).toContain('/alpha (1).txt')

		await act(async () => {
			const skipped = await result.current.uploadFiles([textFile('alpha.txt', 'skip')], { onConflict: 'skip' })
			expect(skipped).toEqual([])
		})
		expect(result.current.items.map((item) => item.path)).toContain('/alpha (1).txt')
	})
})
