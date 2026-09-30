import Papa from 'papaparse'
import type { FileBrowserEditor, FileBrowserPreviewer } from '../../components/file-plugins'
import { getFileExtension } from '../../components/file-types'
import type { FileNode } from '../../core/types'
import { Spreadsheet, trimSheet } from '../spreadsheet'

const isDelimited = (item: FileNode<unknown>) =>
	['csv', 'tsv'].includes(getFileExtension(item.name)) || item.mimeType === 'text/csv'

function parse(content: unknown) {
	const result = Papa.parse<string[]>(typeof content === 'string' ? content : '', { skipEmptyLines: 'greedy' })
	return { rows: result.data, delimiter: result.meta.delimiter || ',', newline: result.meta.linebreak || '\n' }
}

/** Read-only CSV/TSV sheet (papaparse + jspreadsheet-ce). */
export const csvPreviewer: FileBrowserPreviewer = {
	id: 'csv',
	match: isDelimited,
	read: 'text',
	component: ({ content, item }) => (
		<Spreadsheet label={item.name} sheets={[{ name: item.name, rows: parse(content).rows }]} />
	)
}

/** Spreadsheet-style CSV/TSV editor that keeps the file's delimiter and line endings. */
export const csvEditor: FileBrowserEditor = {
	id: 'csv',
	match: isDelimited,
	read: 'text',
	component: ({ content, item, onChange }) => {
		const parsed = parse(content)
		return (
			<Spreadsheet
				label={item.name}
				onChange={([rows]) =>
					onChange(
						Papa.unparse(
							trimSheet(rows ?? []).map((row) => row.map((cell) => String(cell ?? ''))),
							{
								delimiter: parsed.delimiter,
								newline: parsed.newline
							}
						)
					)
				}
				sheets={[{ name: item.name, rows: parsed.rows }]}
			/>
		)
	}
}
