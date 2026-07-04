import { FileBrowserAdapterError } from './types'

export const ROOT_PATH = '/'

export function normalizeFileBrowserPath(path: string): string {
	const trimmed = path.trim()

	if (!trimmed || trimmed === ROOT_PATH) {
		return ROOT_PATH
	}

	const normalized = `/${trimmed}`.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')

	return normalized === '' ? ROOT_PATH : normalized
}

export function getFileBrowserBasename(path: string): string {
	const normalized = normalizeFileBrowserPath(path)

	if (normalized === ROOT_PATH) {
		return ''
	}

	return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function getFileBrowserDirname(path: string): string {
	const normalized = normalizeFileBrowserPath(path)

	if (normalized === ROOT_PATH) {
		return ROOT_PATH
	}

	const index = normalized.lastIndexOf('/')
	return index <= 0 ? ROOT_PATH : normalized.slice(0, index)
}

export function joinFileBrowserPath(dir: string, name: string): string {
	assertValidFileBrowserName(name)
	const normalizedDir = normalizeFileBrowserPath(dir)
	return normalizeFileBrowserPath(normalizedDir === ROOT_PATH ? `/${name}` : `${normalizedDir}/${name}`)
}

export function assertValidFileBrowserName(name: string): void {
	const trimmed = name.trim()

	if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
		throw new FileBrowserAdapterError('invalid_path', `Invalid file browser name: ${name}`)
	}
}

export function isFileBrowserDescendantOrSelf(parentPath: string, candidatePath: string): boolean {
	const parent = normalizeFileBrowserPath(parentPath)
	const candidate = normalizeFileBrowserPath(candidatePath)

	if (parent === ROOT_PATH) {
		return true
	}

	return candidate === parent || candidate.startsWith(`${parent}/`)
}

export function replaceFileBrowserPathPrefix(path: string, fromPrefix: string, toPrefix: string): string {
	const normalizedPath = normalizeFileBrowserPath(path)
	const normalizedFrom = normalizeFileBrowserPath(fromPrefix)
	const normalizedTo = normalizeFileBrowserPath(toPrefix)

	if (normalizedPath === normalizedFrom) {
		return normalizedTo
	}

	if (!normalizedPath.startsWith(`${normalizedFrom}/`)) {
		return normalizedPath
	}

	return normalizeFileBrowserPath(`${normalizedTo}${normalizedPath.slice(normalizedFrom.length)}`)
}
