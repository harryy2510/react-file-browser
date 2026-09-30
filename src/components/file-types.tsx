import {
	File,
	FileArchive,
	FileAudio,
	FileCode,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileVideo,
	Folder,
	Presentation
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FileNode } from '../core/types'

export type FileBrowserFileCategory =
	| 'folder'
	| 'pdf'
	| 'image'
	| 'video'
	| 'audio'
	| 'archive'
	| 'spreadsheet'
	| 'presentation'
	| 'document'
	| 'code'
	| 'text'
	| 'other'

/** Extensions treated as plain text for previews and the built-in editor. */
export const FILE_BROWSER_TEXT_EXTENSIONS: readonly string[] = [
	'txt',
	'text',
	'md',
	'markdown',
	'mdx',
	'csv',
	'tsv',
	'json',
	'jsonl',
	'html',
	'htm',
	'xml',
	'svg',
	'yaml',
	'yml',
	'toml',
	'ini',
	'cfg',
	'conf',
	'log',
	'css',
	'scss',
	'js',
	'mjs',
	'cjs',
	'jsx',
	'ts',
	'tsx',
	'py',
	'rb',
	'go',
	'rs',
	'java',
	'kt',
	'swift',
	'php',
	'sh',
	'sql',
	'graphql',
	'rtf'
]

const CODE_EXTENSIONS = new Set([
	'json',
	'jsonl',
	'html',
	'htm',
	'xml',
	'yaml',
	'yml',
	'toml',
	'ini',
	'css',
	'scss',
	'js',
	'mjs',
	'cjs',
	'jsx',
	'ts',
	'tsx',
	'py',
	'rb',
	'go',
	'rs',
	'java',
	'kt',
	'swift',
	'php',
	'sh',
	'sql',
	'graphql'
])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'])
const SPREADSHEET_EXTENSIONS = new Set(['xls', 'xlsx', 'ods', 'numbers', 'csv', 'tsv'])
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'key', 'odp'])
const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'pages', 'rtf'])
const TEXT_MIME_TYPES = new Set([
	'application/json',
	'application/xml',
	'application/javascript',
	'application/x-yaml',
	'application/yaml',
	'application/sql',
	'image/svg+xml'
])

const TYPE_LABELS: Record<string, string> = {
	pdf: 'PDF document',
	doc: 'Word document',
	docx: 'Word document',
	xls: 'Excel spreadsheet',
	xlsx: 'Excel spreadsheet',
	ppt: 'PowerPoint deck',
	pptx: 'PowerPoint deck',
	csv: 'CSV spreadsheet',
	tsv: 'TSV spreadsheet',
	md: 'Markdown',
	markdown: 'Markdown',
	txt: 'Plain text',
	json: 'JSON',
	html: 'HTML page',
	htm: 'HTML page',
	svg: 'SVG image',
	zip: 'ZIP archive'
}

const CATEGORY_LABELS: Record<FileBrowserFileCategory, string> = {
	folder: 'Folder',
	pdf: 'PDF document',
	image: 'Image',
	video: 'Video',
	audio: 'Audio',
	archive: 'Archive',
	spreadsheet: 'Spreadsheet',
	presentation: 'Presentation',
	document: 'Document',
	code: 'Code',
	text: 'Text',
	other: 'File'
}

const CATEGORY_ICONS: Record<FileBrowserFileCategory, LucideIcon> = {
	folder: Folder,
	pdf: FileText,
	image: FileImage,
	video: FileVideo,
	audio: FileAudio,
	archive: FileArchive,
	spreadsheet: FileSpreadsheet,
	presentation: Presentation,
	document: FileText,
	code: FileCode,
	text: FileText,
	other: File
}

export function getFileExtension(name: string): string {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isTextFile<TMetadata>(item: FileNode<TMetadata>): boolean {
	if (item.kind !== 'file') return false
	const extension = getFileExtension(item.name)
	if (
		extension !== 'svg' &&
		(IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension))
	)
		return false
	const mime = item.mimeType ?? ''
	return mime.startsWith('text/') || TEXT_MIME_TYPES.has(mime) || FILE_BROWSER_TEXT_EXTENSIONS.includes(extension)
}

export function getFileCategory<TMetadata>(item: FileNode<TMetadata>): FileBrowserFileCategory {
	if (item.kind === 'folder') return 'folder'
	const mime = item.mimeType ?? ''
	const extension = getFileExtension(item.name)
	if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
	if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image'
	if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video'
	if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio'
	if (ARCHIVE_EXTENSIONS.has(extension) || /zip|compressed|x-tar/.test(mime)) return 'archive'
	if (SPREADSHEET_EXTENSIONS.has(extension) || /spreadsheet|excel|csv/.test(mime)) return 'spreadsheet'
	if (PRESENTATION_EXTENSIONS.has(extension) || /presentation|powerpoint/.test(mime)) return 'presentation'
	if (DOCUMENT_EXTENSIONS.has(extension) || /msword|wordprocessing/.test(mime)) return 'document'
	if (CODE_EXTENSIONS.has(extension)) return 'code'
	if (isTextFile(item)) return 'text'
	return 'other'
}

export function getFileTypeLabel<TMetadata>(item: FileNode<TMetadata>): string {
	if (item.kind === 'folder') return 'Folder'
	return TYPE_LABELS[getFileExtension(item.name)] ?? CATEGORY_LABELS[getFileCategory(item)]
}

export function getFileIcon<TMetadata>(item: FileNode<TMetadata>): LucideIcon {
	return CATEGORY_ICONS[getFileCategory(item)]
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`
	}
	const kib = bytes / 1024
	if (kib < 1024) {
		return `${kib.toFixed(1)} KB`
	}
	return `${(kib / 1024).toFixed(1)} MB`
}
