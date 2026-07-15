import { unzipSync } from 'fflate'
import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { InMemoryFileBrowserAdapter, createInMemoryFileBrowserAdapter } from '@/adapters/in-memory'
import type { FileNode } from '@/core/types'
import { defineFileBrowserAdapterContract } from './adapter-contract'

defineFileBrowserAdapterContract({
	name: 'in-memory',
	createAdapter: () => new InMemoryFileBrowserAdapter()
})

describe('InMemoryFileBrowserAdapter capabilities', () => {
	test('preserves opaque ids and typed metadata through listing and mutations', async () => {
		type RagMetadata = {
			ragStatus: 'indexed' | 'pending'
		}
		const adapter = new InMemoryFileBrowserAdapter<RagMetadata>({
			initialEntries: [
				{
					id: 'archive-id',
					kind: 'folder',
					metadata: { ragStatus: 'indexed' },
					name: 'archive',
					path: '/archive'
				},
				{
					id: 'report-id',
					kind: 'file',
					metadata: { ragStatus: 'pending' },
					name: 'report.txt',
					path: '/report.txt'
				}
			]
		})

		const listed = await adapter.list('/')
		expectTypeOf(listed.items).toEqualTypeOf<FileNode<RagMetadata>[]>()
		expect(listed.items.find((item) => item.path === '/report.txt')).toMatchObject({
			id: 'report-id',
			metadata: { ragStatus: 'pending' }
		})

		const renamed = await adapter.rename?.('/report.txt', 'Indexed report.txt')
		expect(renamed).toMatchObject({
			id: 'report-id',
			metadata: { ragStatus: 'pending' },
			name: 'Indexed report.txt',
			path: '/report.txt'
		})

		await adapter.copy?.(['/report.txt'], '/archive')
		expect((await adapter.list('/archive')).items).toEqual([
			expect.objectContaining({
				id: 'report-id',
				metadata: { ragStatus: 'pending' },
				path: '/archive/report.txt'
			})
		])
	})

	test('keeps both files by allocating a non-conflicting name', async () => {
		const adapter = new InMemoryFileBrowserAdapter()
		const file = new File(['first'], 'hero-banner.jpg', { type: 'text/plain' })
		const replacement = new File(['second'], 'hero-banner.jpg', {
			type: 'text/plain'
		})

		await adapter.upload('/hero-banner.jpg', file)
		const kept = await adapter.upload('/hero-banner.jpg', replacement, {
			onConflict: 'keep-both'
		})

		expect(kept.path).toBe('/hero-banner (1).jpg')
		expect((await adapter.list('/')).items.map((item) => item.path)).toEqual([
			'/hero-banner (1).jpg',
			'/hero-banner.jpg'
		])
	})

	test('can omit optional methods so UI capability checks see them as absent', () => {
		const adapter = createInMemoryFileBrowserAdapter({
			capabilities: {
				rename: false,
				createFolder: false,
				move: false,
				copy: false,
				exists: false,
				stat: false,
				bulkDownloadUrl: false,
				multipart: false
			}
		})

		expect(adapter.createFolder).toBeUndefined()
		expect(adapter.rename).toBeUndefined()
		expect(adapter.move).toBeUndefined()
		expect(adapter.copy).toBeUndefined()
		expect(adapter.exists).toBeUndefined()
		expect(adapter.stat).toBeUndefined()
		expect(adapter.bulkDownloadUrl).toBeUndefined()
		expect(adapter.createMultipartUpload).toBeUndefined()
		expect(adapter.uploadPart).toBeUndefined()
		expect(adapter.completeMultipartUpload).toBeUndefined()
		expect(adapter.abortMultipartUpload).toBeUndefined()
	})

	test('checks path existence in batches when exists capability is enabled', async () => {
		const adapter = new InMemoryFileBrowserAdapter()

		if (!adapter.exists || !adapter.createFolder) {
			throw new Error('adapter under test must include exists and createFolder')
		}

		await adapter.createFolder('/docs')

		await expect(adapter.exists(['/docs', '/missing'])).resolves.toEqual({
			'/docs': true,
			'/missing': false
		})
	})

	test('creates a zip blob for bulk downloads instead of a JSON manifest', async () => {
		const adapter = new InMemoryFileBrowserAdapter()
		const createdBlobs: Blob[] = []
		const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: vi.fn((blob: Blob) => {
				createdBlobs.push(blob)
				return 'blob:download.zip'
			})
		})

		try {
			await adapter.upload('/alpha.txt', new File(['alpha'], 'alpha.txt'))
			await adapter.createFolder?.('/docs')
			await adapter.upload('/docs/beta.txt', new File(['beta'], 'beta.txt'))

			const result = await adapter.bulkDownloadUrl?.(['/alpha.txt', '/docs'])

			expect(result).toMatchObject({ url: 'blob:download.zip' })
			expect(createdBlobs).toHaveLength(1)
			expect(createdBlobs[0].type).toBe('application/zip')
			const archive = unzipSync(new Uint8Array(await createdBlobs[0].arrayBuffer()))
			expect(new TextDecoder().decode(archive['alpha.txt'])).toBe('alpha')
			expect(new TextDecoder().decode(archive['docs/beta.txt'])).toBe('beta')
		} finally {
			if (originalCreateObjectUrlDescriptor) {
				Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrlDescriptor)
			}
		}
	})

	test('supports multipart uploads with resumable completed parts', async () => {
		const adapter = new InMemoryFileBrowserAdapter({
			capabilities: { multipart: true },
			multipartPartSize: 4
		})

		if (!adapter.createMultipartUpload || !adapter.uploadPart || !adapter.completeMultipartUpload) {
			throw new Error('adapter under test must include multipart methods')
		}

		const created = await adapter.createMultipartUpload('/big.bin', 10)
		expect(created).toEqual({
			uploadId: expect.stringMatching(/^memory-multipart-/),
			partSize: 4
		})

		const first = await adapter.uploadPart({
			uploadId: created.uploadId,
			partNumber: 1,
			chunk: new Blob(['abcd'])
		})
		const third = await adapter.uploadPart({
			uploadId: created.uploadId,
			partNumber: 3,
			chunk: new Blob(['ij'])
		})
		const second = await adapter.uploadPart({
			uploadId: created.uploadId,
			partNumber: 2,
			chunk: new Blob(['efgh'])
		})

		const completed = await adapter.completeMultipartUpload({
			uploadId: created.uploadId,
			parts: [
				{ partNumber: 1, etag: first.etag },
				{ partNumber: 2, etag: second.etag },
				{ partNumber: 3, etag: third.etag }
			]
		})

		expect(completed).toMatchObject({
			path: '/big.bin',
			name: 'big.bin',
			kind: 'file',
			size: 10
		})
		expect((await adapter.list('/')).items.map((item) => item.path)).toEqual(['/big.bin'])
	})

	test('aborts multipart uploads without creating an entry', async () => {
		const adapter = new InMemoryFileBrowserAdapter({
			capabilities: { multipart: true },
			multipartPartSize: 4
		})

		if (
			!adapter.createMultipartUpload ||
			!adapter.uploadPart ||
			!adapter.completeMultipartUpload ||
			!adapter.abortMultipartUpload
		) {
			throw new Error('adapter under test must include multipart methods')
		}

		const created = await adapter.createMultipartUpload('/cancelled.bin', 8)
		await adapter.uploadPart({
			uploadId: created.uploadId,
			partNumber: 1,
			chunk: new Blob(['abcd'])
		})
		await adapter.abortMultipartUpload(created.uploadId)

		await expect(
			adapter.completeMultipartUpload({
				uploadId: created.uploadId,
				parts: [{ partNumber: 1, etag: 'memory-part-1' }]
			})
		).rejects.toMatchObject({ code: 'not_found' })
		expect((await adapter.list('/')).items).toEqual([])
	})
})
