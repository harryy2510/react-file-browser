import { describe, expect, test, vi } from 'vitest'
import { R2FileBrowserAdapter } from '@/adapters/r2'
import { S3FileBrowserAdapter } from '@/adapters/s3'
import { SupabaseFileBrowserAdapter } from '@/adapters/supabase'
import type { FileBrowserAdapter } from '@/index'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: vi.fn((_client: unknown, command: { input: { Key?: string } }) =>
		Promise.resolve(`https://signed.test/${command.input.Key ?? ''}`)
	)
}))

type AwsCommand = {
	constructor: { name: string }
	input: Record<string, unknown>
}

function asAwsCommand(command: unknown): AwsCommand {
	return command as AwsCommand
}

describe('cloud adapter subpath exports', () => {
	test('export adapter classes that fail closed without host credentials', async () => {
		await expect(new S3FileBrowserAdapter().list('/')).rejects.toMatchObject({
			code: 'not_supported'
		})
		await expect(new R2FileBrowserAdapter().list('/')).rejects.toMatchObject({
			code: 'not_supported'
		})
		await expect(new SupabaseFileBrowserAdapter().list('/')).rejects.toMatchObject({
			code: 'not_supported'
		})
		expect(new S3FileBrowserAdapter().createFolder).toBeUndefined()
		expect(new R2FileBrowserAdapter().createFolder).toBeUndefined()
		expect(new SupabaseFileBrowserAdapter().createFolder).toBeUndefined()
	})

	test('delegate to host-backed implementations when provided', async () => {
		const implementation: FileBrowserAdapter = {
			list: () =>
				Promise.resolve({
					items: [{ path: '/asset.jpg', name: 'asset.jpg', kind: 'file' }]
				}),
			createFolder: (path: string) => Promise.resolve({ path, name: 'New folder', kind: 'folder' }),
			delete: () => Promise.resolve(),
			signedUrl: (path: string) => Promise.resolve(`https://files.test${path}`),
			upload: (path: string, file: File) =>
				Promise.resolve({
					path,
					name: file.name,
					kind: 'file',
					size: file.size
				}),
			rename: (path: string, name: string) => Promise.resolve({ path, name, kind: 'file' })
		}

		const adapter = new S3FileBrowserAdapter({ implementation })

		await expect(adapter.list('/')).resolves.toEqual({
			items: [{ path: '/asset.jpg', name: 'asset.jpg', kind: 'file' }]
		})
		await expect(adapter.signedUrl('/asset.jpg')).resolves.toBe('https://files.test/asset.jpg')
		await expect(adapter.createFolder?.('/docs')).resolves.toMatchObject({
			kind: 'folder',
			path: '/docs'
		})
		await expect(adapter.rename?.('/asset.jpg', 'Hero')).resolves.toMatchObject({
			name: 'Hero'
		})
		expect(adapter.move).toBeUndefined()
	})

	test('S3 adapter maps SDK list signed URL and upload operations', async () => {
		const commands: AwsCommand[] = []
		const client = {
			send: vi.fn((command: unknown) => {
				const awsCommand = asAwsCommand(command)
				commands.push(awsCommand)
				if (awsCommand.constructor.name === 'ListObjectsV2Command') {
					return Promise.resolve({
						CommonPrefixes: [{ Prefix: 'users/1/docs/' }],
						Contents: [
							{
								ETag: '"etag-hero"',
								Key: 'users/1/hero.jpg',
								LastModified: new Date('2026-07-04T00:00:00.000Z'),
								Size: 5
							}
						],
						NextContinuationToken: 'next-page'
					})
				}
				if (awsCommand.constructor.name === 'PutObjectCommand') {
					return Promise.resolve({ ETag: '"etag-upload"' })
				}
				if (awsCommand.constructor.name === 'HeadObjectCommand') {
					return Promise.reject(
						Object.assign(new Error('not found'), {
							$metadata: { httpStatusCode: 404 },
							name: 'NotFound'
						})
					)
				}
				return Promise.resolve({})
			})
		}
		const adapter = new S3FileBrowserAdapter({
			bucket: 'assets',
			client,
			prefix: 'users/1',
			signedUrlExpiresIn: 120
		})

		await expect(adapter.list('/', { cursor: 'cursor-1' })).resolves.toEqual({
			cursor: 'next-page',
			items: [
				{
					kind: 'folder',
					name: 'docs',
					path: '/docs'
				},
				{
					etag: 'etag-hero',
					kind: 'file',
					modifiedAt: '2026-07-04T00:00:00.000Z',
					name: 'hero.jpg',
					path: '/hero.jpg',
					size: 5
				}
			]
		})
		expect(commands[0]?.input).toMatchObject({
			Bucket: 'assets',
			ContinuationToken: 'cursor-1',
			Delimiter: '/',
			Prefix: 'users/1/'
		})

		const progress: Array<[number, number]> = []
		await expect(
			adapter.upload('/upload.jpg', new File(['image'], 'upload.jpg'), {
				onProgress: (loaded, total) => progress.push([loaded, total])
			})
		).resolves.toMatchObject({
			etag: 'etag-upload',
			kind: 'file',
			path: '/upload.jpg',
			size: 5
		})
		expect(commands.at(-1)?.constructor.name).toBe('PutObjectCommand')
		expect(commands.at(-1)?.input).toMatchObject({
			Bucket: 'assets',
			Key: 'users/1/upload.jpg'
		})
		expect(progress).toEqual([
			[0, 5],
			[5, 5]
		])

		await expect(adapter.signedUrl('/hero.jpg')).resolves.toBe('https://signed.test/users/1/hero.jpg')
		expect(getSignedUrl).toHaveBeenCalledWith(
			client,
			expect.objectContaining({
				input: expect.objectContaining({
					Bucket: 'assets',
					Key: 'users/1/hero.jpg'
				})
			}),
			{ expiresIn: 120 }
		)
	})

	test('R2 adapter uses the S3-compatible SDK surface', async () => {
		const client = {
			send: vi.fn((command: unknown) => {
				void command
				return Promise.resolve({
					Contents: []
				})
			})
		}
		const adapter = new R2FileBrowserAdapter({
			bucket: 'r2-assets',
			client,
			prefix: 'tenant'
		})

		await expect(adapter.list('/')).resolves.toEqual({ items: [] })
		expect(asAwsCommand(client.send.mock.calls[0]?.[0]).input).toMatchObject({
			Bucket: 'r2-assets',
			Delimiter: '/',
			Prefix: 'tenant/'
		})
	})

	test('Supabase adapter maps storage list signed URL and upload operations', async () => {
		const bucket = {
			createSignedUrl: vi.fn(() =>
				Promise.resolve({
					data: { signedUrl: 'https://signed.supabase.test/hero.jpg' },
					error: null
				})
			),
			list: vi.fn(() =>
				Promise.resolve({
					data: [
						{
							id: null,
							metadata: null,
							name: 'docs',
							updated_at: '2026-07-04T00:00:00.000Z'
						},
						{
							id: 'file-1',
							metadata: { mimetype: 'image/jpeg', size: 5 },
							name: 'hero.jpg',
							updated_at: '2026-07-04T00:00:00.000Z'
						}
					],
					error: null
				})
			),
			upload: vi.fn(() =>
				Promise.resolve({
					data: { path: 'users/1/hero.jpg' },
					error: null
				})
			)
		}
		const client = {
			storage: {
				from: vi.fn(() => bucket)
			}
		}
		const adapter = new SupabaseFileBrowserAdapter({
			bucket: 'assets',
			client,
			pageSize: 2,
			prefix: 'users/1',
			signedUrlExpiresIn: 120
		})

		await expect(adapter.list('/', { cursor: '50' })).resolves.toEqual({
			cursor: '52',
			items: [
				{
					kind: 'folder',
					modifiedAt: '2026-07-04T00:00:00.000Z',
					name: 'docs',
					path: '/docs'
				},
				{
					kind: 'file',
					mimeType: 'image/jpeg',
					modifiedAt: '2026-07-04T00:00:00.000Z',
					name: 'hero.jpg',
					path: '/hero.jpg',
					size: 5
				}
			]
		})
		expect(client.storage.from).toHaveBeenCalledWith('assets')
		expect(bucket.list).toHaveBeenCalledWith('users/1', expect.objectContaining({ limit: 2, offset: 50 }))

		await expect(adapter.upload('/upload.jpg', new File(['image'], 'upload.jpg'))).resolves.toMatchObject({
			kind: 'file',
			path: '/upload.jpg',
			size: 5
		})
		expect(bucket.upload).toHaveBeenCalledWith(
			'users/1/upload.jpg',
			expect.any(File),
			expect.objectContaining({ upsert: false })
		)

		await expect(adapter.signedUrl('/hero.jpg')).resolves.toBe('https://signed.supabase.test/hero.jpg')
		expect(bucket.createSignedUrl).toHaveBeenCalledWith('users/1/hero.jpg', 120)
	})
})
