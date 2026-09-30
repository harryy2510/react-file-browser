import type { CellValue } from 'jspreadsheet-ce'
import { useEffect, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import type { Sheet } from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'
import type { Cell } from 'write-excel-file/browser'
import type { FileBrowserEditor, FileBrowserFileContent, FileBrowserPreviewer } from '../../components/file-plugins'
import { getFileExtension } from '../../components/file-types'
import type { FileNode } from '../../core/types'
import { Spreadsheet, trimSheet } from '../spreadsheet'

type SheetCell = Sheet['data'][number][number]

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const isXlsx = (item: FileNode<unknown>) => getFileExtension(item.name) === 'xlsx' || item.mimeType === XLSX_MIME

function formatCell(cell: SheetCell): string {
	if (cell === null || cell === undefined) return ''
	if (cell instanceof Date) return cell.toISOString().slice(0, 10)
	return String(cell)
}

// Unchanged cells keep their original type; edited cells become numbers or booleans when they look like one.
function toWritableCell(original: SheetCell | undefined, text: string): Cell {
	if (original !== undefined && formatCell(original) === text) {
		return original instanceof Date ? { value: original, type: Date, format: 'yyyy-mm-dd' } : (original as Cell)
	}
	if (text === '') return null
	if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
	if (text === 'TRUE' || text === 'FALSE') return text === 'TRUE'
	return text
}

function useSheets(content: FileBrowserFileContent | null) {
	const [state, setState] = useState<{ sheets: Sheet[]; error: string | null } | null>(null)
	useEffect(() => {
		let active = true
		if (!(content instanceof ArrayBuffer)) return
		readXlsxFile(content).then(
			(sheets) => active && setState({ sheets, error: null }),
			(error: unknown) =>
				active && setState({ sheets: [], error: error instanceof Error ? error.message : String(error) })
		)
		return () => {
			active = false
		}
	}, [content])
	return state
}

function Workbook({
	content,
	item,
	onChange
}: {
	content: FileBrowserFileContent | null
	item: FileNode<unknown>
	onChange?: (next: Blob) => void
}) {
	const loaded = useSheets(content)
	if (!loaded) return <p className="m-0 text-[var(--fb-muted)]">Loading workbook…</p>
	if (loaded.error) return <p className="m-0 text-[var(--fb-danger)]">{loaded.error}</p>

	const save = async (edited: CellValue[][][]) => {
		if (!onChange) return
		const blob = await writeXlsxFile(
			loaded.sheets.map((entry, index) => ({
				sheet: entry.sheet,
				data: trimSheet(edited[index] ?? []).map((row, rowIndex) =>
					row.map((value, column) => toWritableCell(entry.data[rowIndex]?.[column], String(value ?? '')))
				)
			}))
		).toBlob()
		onChange(blob)
	}

	return (
		<Spreadsheet
			label={item.name}
			onChange={onChange ? (sheets) => void save(sheets) : undefined}
			sheets={loaded.sheets.map((entry) => ({ name: entry.sheet, rows: entry.data.map((row) => row.map(formatCell)) }))}
			values="computed"
		/>
	)
}

/** Read-only XLSX preview with one tab per sheet (read-excel-file + jspreadsheet-ce). */
export const xlsxPreviewer: FileBrowserPreviewer = {
	id: 'xlsx',
	match: isXlsx,
	read: 'binary',
	maxBytes: 10 * 1024 * 1024,
	component: ({ content, item }) => <Workbook content={content} item={item} />
}

/** Spreadsheet-style XLSX editor, one tab per sheet. Saving rewrites cell values only (write-excel-file). */
export const xlsxEditor: FileBrowserEditor = {
	id: 'xlsx',
	match: isXlsx,
	read: 'binary',
	maxBytes: 10 * 1024 * 1024,
	saveWarning: 'Saving keeps cell values only. Formatting, formulas and charts are lost.',
	component: ({ content, item, onChange }) => <Workbook content={content} item={item} onChange={onChange} />
}
