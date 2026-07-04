import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileBrowserAdapter, FileBrowserUploadOptions, FileNode } from '@/index'
import { FileBrowserProvider, useTransferSnapshot, useTransfers } from '@/transfers/file-browser-provider'
import { TransferManager } from '@/transfers/transfer-manager'

const fileOfSize = (name: string, size: number) =>
	new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })

function SnapshotProbe() {
	const snapshot = useTransferSnapshot()
	return <output aria-label="Upload status">{snapshot.uploads.at(0)?.status ?? 'none'}</output>
}

function EnqueueProbe({ adapter }: { adapter: FileBrowserAdapter }) {
	const manager = useTransfers()

	return (
		<button
			onClick={() =>
				manager.enqueueUpload({
					adapter,
					destinationPath: '/demo.bin',
					file: fileOfSize('demo.bin', 10)
				})
			}
			type="button"
		>
			Enqueue upload
		</button>
	)
}

describe('FileBrowserProvider', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test('uses localStorage persistence by default for restored uploads', () => {
		window.localStorage.setItem(
			'react-file-browser-transfers',
			JSON.stringify({
				uploads: [
					{
						id: 'upload-1',
						kind: 'upload',
						status: 'failed',
						path: '/large.bin',
						name: 'large.bin',
						loadedBytes: 5,
						totalBytes: 10,
						completedParts: [],
						createdAt: '2026-07-04T00:00:00.000Z',
						updatedAt: '2026-07-04T00:00:01.000Z'
					}
				],
				downloads: []
			})
		)

		render(
			<FileBrowserProvider>
				<div />
			</FileBrowserProvider>
		)

		expect(screen.getByRole('dialog', { name: 'Resume uploads' })).toHaveTextContent('Resume 1 upload?')
	})

	test('persists default provider uploads to localStorage', async () => {
		const user = userEvent.setup()
		const upload = vi.fn(
			(path: string, file: File): Promise<FileNode> =>
				Promise.resolve({
					path,
					name: file.name,
					kind: 'file',
					size: file.size
				})
		)
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload
		}

		render(
			<FileBrowserProvider>
				<EnqueueProbe adapter={adapter} />
			</FileBrowserProvider>
		)

		await user.click(screen.getByRole('button', { name: 'Enqueue upload' }))

		await waitFor(() => expect(window.localStorage.getItem('react-file-browser-transfers')).toContain('/demo.bin'))
	})

	test('guards hard refresh while transfers are active', async () => {
		const upload = vi.fn(
			(_path: string, _file: File, opts?: FileBrowserUploadOptions): Promise<FileNode> =>
				new Promise((_resolve, reject) => {
					opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
				})
		)
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload
		}
		const manager = new TransferManager({ idFactory: () => 'upload-1' })

		manager.enqueueUpload({
			adapter,
			destinationPath: '/demo.bin',
			file: fileOfSize('demo.bin', 10)
		})

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		const event = new Event('beforeunload', {
			cancelable: true
		})
		Object.defineProperty(event, 'returnValue', {
			configurable: true,
			value: undefined,
			writable: true
		})

		expect(window.dispatchEvent(event)).toBe(false)
		expect(event.defaultPrevented).toBe(true)
		expect(event.returnValue).toBe('')

		await manager.cancelUpload('upload-1')
		await manager.waitForIdle()
	})

	test('floating widget pauses, resumes, and cancels upload transfers', async () => {
		const user = userEvent.setup()
		const ids = ['upload-1']
		const upload = vi.fn(
			(_path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode> =>
				new Promise((_resolve, reject) => {
					opts?.onProgress?.(1, file.size)
					opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
				})
		)
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload
		}
		const manager = new TransferManager({
			idFactory: () => ids.shift() ?? 'upload-next'
		})

		manager.enqueueUpload({
			adapter,
			destinationPath: '/demo.bin',
			file: fileOfSize('demo.bin', 10)
		})

		render(
			<FileBrowserProvider manager={manager}>
				<SnapshotProbe />
			</FileBrowserProvider>
		)

		expect(await screen.findByRole('complementary', { name: 'Transfers' })).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Pause upload demo.bin' }))
		await waitFor(() => expect(screen.getByLabelText('Upload status')).toHaveTextContent('paused'))

		await user.click(screen.getByRole('button', { name: 'Resume upload demo.bin' }))
		await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
		await user.click(screen.getByRole('button', { name: 'Cancel upload demo.bin' }))
		await waitFor(() => expect(screen.getByLabelText('Upload status')).toHaveTextContent('cancelled'))

		await manager.waitForIdle()
	})

	test('floating widget shows upload speed samples', async () => {
		const times = [
			new Date('2026-07-04T00:00:00.000Z'),
			new Date('2026-07-04T00:00:01.000Z'),
			new Date('2026-07-04T00:00:02.000Z'),
			new Date('2026-07-04T00:00:03.000Z')
		]
		const upload = vi.fn(
			(_path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode> =>
				new Promise(() => {
					opts?.onProgress?.(0, file.size)
					opts?.onProgress?.(5, file.size)
				})
		)
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload
		}
		const manager = new TransferManager({
			idFactory: () => 'upload-1',
			now: () => times.shift() ?? new Date('2026-07-04T00:00:03.000Z')
		})

		manager.enqueueUpload({
			adapter,
			destinationPath: '/demo.bin',
			file: fileOfSize('demo.bin', 10)
		})

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		expect(await screen.findByText('uploading, 5 B/s')).toBeInTheDocument()
	})

	test('floating widget shows prepared download expiry', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'))
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload: vi.fn(),
			bulkDownloadUrl: vi.fn(() =>
				Promise.resolve({
					url: 'https://example.test/download.zip',
					expiresAt: '2026-07-04T02:00:00.000Z'
				})
			)
		}
		const manager = new TransferManager({ idFactory: () => 'download-1' })

		await manager.prepareBulkDownload({
			adapter,
			paths: ['/demo.bin'],
			selectedBytes: 10
		})

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		expect(screen.getByRole('link', { name: 'Open prepared download' })).toHaveTextContent(
			'Download ready, expires in 2h'
		)
	})

	test('floating widget uses subtle motion affordances', async () => {
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload: vi.fn(),
			bulkDownloadUrl: vi.fn(() =>
				Promise.resolve({
					url: 'https://example.test/download.zip',
					expiresAt: '2026-07-04T02:00:00.000Z'
				})
			)
		}
		const manager = new TransferManager({ idFactory: () => 'download-1' })

		await manager.prepareBulkDownload({
			adapter,
			paths: ['/demo.bin'],
			selectedBytes: 10
		})

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		expect(screen.getByRole('complementary', { name: 'Transfers' }).className).toContain('duration-200')
		expect(screen.getByRole('link', { name: 'Open prepared download' }).className).toContain('duration-150')
		expect(screen.getByRole('button', { name: 'Dismiss download' }).className).toContain(
			'motion-reduce:transition-none'
		)
	})

	test('floating widget dismisses a ready download after opening it', async () => {
		const user = userEvent.setup()
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload: vi.fn(),
			bulkDownloadUrl: vi.fn(() =>
				Promise.resolve({
					url: 'https://example.test/download.zip',
					expiresAt: '2026-07-04T02:00:00.000Z'
				})
			)
		}
		const manager = new TransferManager({ idFactory: () => 'download-1' })

		await manager.prepareBulkDownload({
			adapter,
			paths: ['/demo.bin'],
			selectedBytes: 10
		})

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		await user.click(screen.getByRole('link', { name: 'Open prepared download' }))

		expect(screen.queryByRole('complementary', { name: 'Transfers' })).not.toBeInTheDocument()
		expect(manager.getSnapshot().downloads).toEqual([])
	})

	test('floating widget groups recursive folder uploads', async () => {
		let uploadCallCount = 0
		const upload = vi.fn((path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode> => {
			uploadCallCount += 1
			opts?.onProgress?.(file.size, file.size)
			if (uploadCallCount === 1) {
				return Promise.resolve({
					path,
					name: file.name,
					kind: 'file',
					size: file.size
				})
			}
			return new Promise(() => undefined)
		})
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload
		}
		const ids = ['upload-1', 'upload-2']
		const manager = new TransferManager({
			idFactory: () => ids.shift() ?? 'upload-next'
		})

		manager.enqueueUpload({
			adapter,
			destinationPath: '/photos/done.txt',
			file: fileOfSize('done.txt', 5),
			group: {
				id: 'tree-1',
				name: 'photos',
				totalFiles: 2,
				createdFolders: 1
			}
		})
		manager.enqueueUpload({
			adapter,
			destinationPath: '/photos/active.txt',
			file: fileOfSize('active.txt', 10),
			group: {
				id: 'tree-1',
				name: 'photos',
				totalFiles: 2,
				createdFolders: 1
			}
		})
		await waitFor(() => expect(manager.getUpload('upload-1')?.status).toBe('completed'))

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		expect(screen.getByText('Uploading photos')).toBeInTheDocument()
		expect(screen.getByText('1 of 2 files, 1 folder created')).toBeInTheDocument()
		expect(screen.getByText('active.txt')).toBeInTheDocument()
	})

	test('prompts for restored uploads after refresh', () => {
		const storageKey = 'rfb-restored-uploads'
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({
				uploads: [
					{
						id: 'upload-1',
						kind: 'upload',
						status: 'failed',
						path: '/large.bin',
						name: 'large.bin',
						loadedBytes: 5,
						totalBytes: 10,
						completedParts: [],
						createdAt: '2026-07-04T00:00:00.000Z',
						updatedAt: '2026-07-04T00:00:01.000Z'
					}
				],
				downloads: []
			})
		)
		const manager = new TransferManager({
			storage: window.localStorage,
			storageKey
		})

		render(
			<FileBrowserProvider manager={manager}>
				<div />
			</FileBrowserProvider>
		)

		expect(screen.getByRole('dialog', { name: 'Resume uploads' })).toHaveTextContent('Resume 1 upload?')
	})

	test('resolves restored uploads through the provider callback', async () => {
		const user = userEvent.setup()
		const storageKey = 'rfb-restored-provider-resume'
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({
				uploads: [
					{
						id: 'upload-1',
						kind: 'upload',
						status: 'failed',
						path: '/demo.bin',
						name: 'demo.bin',
						loadedBytes: 0,
						totalBytes: 10,
						completedParts: [],
						createdAt: '2026-07-04T00:00:00.000Z',
						updatedAt: '2026-07-04T00:00:01.000Z'
					}
				],
				downloads: []
			})
		)
		const upload = vi.fn((path: string, file: File, opts?: FileBrowserUploadOptions): Promise<FileNode> => {
			opts?.onProgress?.(file.size, file.size)
			return Promise.resolve({
				path,
				name: file.name,
				kind: 'file',
				size: file.size
			})
		})
		const adapter: FileBrowserAdapter = {
			list: vi.fn(),
			createFolder: vi.fn(),
			delete: vi.fn(),
			signedUrl: vi.fn(),
			upload
		}
		const manager = new TransferManager({
			storage: window.localStorage,
			storageKey
		})

		render(
			<FileBrowserProvider
				manager={manager}
				resolveRestoredUpload={() =>
					Promise.resolve({
						adapter,
						file: fileOfSize('demo.bin', 10)
					})
				}
			>
				<SnapshotProbe />
			</FileBrowserProvider>
		)

		await user.click(screen.getByRole('button', { name: 'Resume uploads' }))

		await waitFor(() => expect(screen.getByLabelText('Upload status')).toHaveTextContent('completed'))
		expect(upload).toHaveBeenCalledWith('/demo.bin', expect.any(File), expect.any(Object))
	})
})
