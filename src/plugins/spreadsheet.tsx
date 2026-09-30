import jspreadsheet from 'jspreadsheet-ce'
import type { CellValue, WorksheetInstance } from 'jspreadsheet-ce'
import { useEffect, useRef } from 'react'

export type SpreadsheetSheet = { name: string; rows: CellValue[][] }

type MenuItem = { title: string; onclick?: () => void; type?: 'line' }

// Preview and edit share one grid size so switching modes does not resize the sheet; the spare
// cells give room to type and are trimmed on save.
const SPARE_COLUMNS = 2
const SPARE_ROWS = 5
const MIN_COLUMNS = 4
const MIN_ROWS = 10

// jspreadsheet and jsuites hardcode a light theme (#fff, #ccc, #f3f3f3, #555 menus, light scrollbars).
// Every rule below is scoped to this component's root and maps that chrome onto --fb-* tokens, so the
// sheet follows the host's light and dark themes like the rest of the browser. Tailwind arbitrary
// variants cannot express these selectors because jspreadsheet class names contain underscores,
// which Tailwind turns into spaces.
const SHEET_CSS = `
[data-fb-sheet] .jss_container, [data-fb-sheet] .jss_content { display: block; width: auto !important; max-width: 100%; height: auto !important; max-height: min(480px, 60dvh); padding: 0; }
[data-fb-sheet] .jss_content { scrollbar-width: thin; scrollbar-color: var(--fb-border-strong) transparent; }
[data-fb-sheet] .jss_content::-webkit-scrollbar-track { background: transparent; }
[data-fb-sheet] .jss_content::-webkit-scrollbar-thumb { background: var(--fb-border-strong); border-radius: 999px; }
[data-fb-sheet] .jss_worksheet {
	background: var(--fb-surface); color: var(--fb-text); font: inherit;
	border: 0;
}
[data-fb-sheet] .jss_worksheet > thead > tr > td,
[data-fb-sheet] .jss_worksheet > tbody > tr > td:first-child {
	background: var(--fb-surface-2); color: var(--fb-muted); font-weight: 600;
	border-top: 1px solid var(--fb-border); border-left: 1px solid var(--fb-border);
}
[data-fb-sheet] .jss_worksheet > thead > tr > td { padding: 6px 8px; }
[data-fb-sheet] .jss_worksheet > thead > tr > td.selected,
[data-fb-sheet] .jss_worksheet > tbody > tr.selected > td:first-child {
	background: color-mix(in oklch, var(--fb-accent) 18%, var(--fb-surface-2)); color: var(--fb-text);
}
[data-fb-sheet] .jss_worksheet > tbody > tr > td {
	background: var(--fb-surface); color: var(--fb-text); padding: 6px 10px; text-align: left;
	border-top: 1px solid var(--fb-border); border-left: 1px solid var(--fb-border);
}
[data-fb-sheet] .jss_worksheet > tbody > tr > td:first-child { text-align: center; padding: 6px 4px; }
[data-fb-sheet] .jss_worksheet > tbody > tr > td.readonly { color: var(--fb-text); }
[data-fb-sheet] .jss_worksheet > tbody > tr > td { position: relative; height: 30px; line-height: 16px; box-sizing: border-box; box-shadow: none !important; }
/* jspreadsheet sizes the in-cell editor inline to the cell's full height and width, then appends it
   inside the cell, so any cell padding would be added on top and the row would grow while typing.
   The editing cell drops its padding and the input carries it instead. */
[data-fb-sheet] .jss_worksheet > tbody > tr > td.editor { padding: 0 !important; }
[data-fb-sheet] .jss_worksheet > tbody > tr > td.editor > input,
[data-fb-sheet] .jss_worksheet > tbody > tr > td.editor > textarea {
	box-sizing: border-box; width: 100% !important; margin: 0; padding: 0 10px; border: 0; outline: 0;
	background: transparent; color: var(--fb-text); font: inherit; line-height: 16px;
}
[data-fb-sheet] .jss_worksheet .highlight { background: color-mix(in oklch, var(--fb-accent) 16%, var(--fb-surface)); }
/* Keep grid lines readable inside a selection: the tint otherwise swallows the plain border colour. */
[data-fb-sheet] .jss_worksheet > tbody > tr > td.highlight {
	border-top-color: color-mix(in oklch, var(--fb-accent) 35%, var(--fb-border));
	border-left-color: color-mix(in oklch, var(--fb-accent) 35%, var(--fb-border));
}
[data-fb-sheet] .jss_worksheet .highlight-selected { background: color-mix(in oklch, var(--fb-accent) 20%, var(--fb-surface)); }
/* Selection outline: jspreadsheet paints it with per-cell borders and box-shadows, which leave dots at
   grid intersections and a light halo. Keep the grid lines untouched and draw the outline on an
   overlay per edge cell instead, so the edges join into one continuous 2px line. Offsets are from the
   padding box: -1px reaches this cell's top/left grid line; -2px crosses its transparent right/bottom
   border and reaches the neighbour's grid line, so the outline sits on the grid on every side. */
[data-fb-sheet] .jss_worksheet > tbody > tr > td:is(.highlight-top, .highlight-left, .highlight-right, .highlight-bottom) {
	border-right-color: transparent; border-bottom-color: transparent;
	/* jspreadsheet clips cells (.jss_overflow td { overflow: hidden }), which cut off the outline's
	   right and bottom edges that sit on the neighbour's grid line. It also writes inline
	   style.overflow = hidden on cells beside an edited cell, so this must be !important. */
	overflow: visible !important;
}
[data-fb-sheet] .jss_worksheet > tbody > tr > td:is(.highlight-top, .highlight-left, .highlight-right, .highlight-bottom)::after {
	content: ''; position: absolute; top: -1px; left: -1px; right: -2px; bottom: -2px;
	border: 0 solid var(--fb-accent); pointer-events: none; z-index: 1;
}
[data-fb-sheet] .jss_worksheet > tbody > tr > td.highlight-top::after { border-top-width: 2px; }
[data-fb-sheet] .jss_worksheet > tbody > tr > td.highlight-left::after { border-left-width: 2px; }
[data-fb-sheet] .jss_worksheet > tbody > tr > td.highlight-right::after { border-right-width: 2px; }
[data-fb-sheet] .jss_worksheet > tbody > tr > td.highlight-bottom::after { border-bottom-width: 2px; }
[data-fb-sheet] .jss_worksheet .selection { background: color-mix(in oklch, var(--fb-accent) 10%, transparent); }
[data-fb-sheet] .jss_worksheet .selection-left, [data-fb-sheet] .jss_worksheet .selection-right,
[data-fb-sheet] .jss_worksheet .selection-top, [data-fb-sheet] .jss_worksheet .selection-bottom { border-color: var(--fb-accent); }
[data-fb-sheet] .jss_corner { background: var(--fb-accent); border-color: var(--fb-surface); }
[data-fb-sheet] .jtabs-headers-container { border-bottom: 1px solid var(--fb-border); background: var(--fb-surface-2); }
[data-fb-sheet] .jtabs-headers > div:not(.jtabs-border) {
	margin: 0; padding: 8px 16px; background: transparent; color: var(--fb-muted); font-weight: 600;
}
[data-fb-sheet] .jtabs-headers > div.jtabs-selected { background: var(--fb-surface); color: var(--fb-text); }
[data-fb-sheet] .jtabs-headers > div > div { color: inherit; }
[data-fb-sheet] .jtabs-border, [data-fb-sheet] .jtabs-controls { display: none; }
[data-fb-sheet][data-fb-sheet-count="1"] .jtabs-headers-container { display: none; }
[data-fb-sheet] .jcontextmenu {
	background: var(--fb-surface); color: var(--fb-text); font: inherit; padding: 6px;
	border: 1px solid var(--fb-border); border-radius: calc(var(--fb-radius) + 2px);
	box-shadow: var(--fb-shadow, 0 12px 32px color-mix(in oklch, black 35%, transparent), 0 0 0 1px color-mix(in oklch, black 10%, transparent));
}
[data-fb-sheet] .jcontextmenu > div { padding: 8px 12px; border-radius: calc(var(--fb-radius) - 2px); }
[data-fb-sheet] .jcontextmenu > div::before { display: none; }
[data-fb-sheet] .jcontextmenu > div, [data-fb-sheet] .jcontextmenu > div a { color: var(--fb-text); }
[data-fb-sheet] .jcontextmenu > div:hover, [data-fb-sheet] .jcontextmenu > div.selected {
	background: color-mix(in oklch, var(--fb-accent-soft) 70%, var(--fb-surface));
}
[data-fb-sheet] .jcontextmenu > div:hover a, [data-fb-sheet] .jcontextmenu > div.selected a { color: var(--fb-text); }
[data-fb-sheet] .jcontextmenu hr { border: 0; border-top: 1px solid var(--fb-border); margin: 4px 6px; }
`

/**
 * Excel-like sheet (jspreadsheet-ce). Editing supports typing, Ctrl/Cmd+C, X, V and Z, and a right-click
 * menu limited to inserting and deleting rows and columns in place. One tab per sheet.
 */
export function Spreadsheet({
	label,
	onChange,
	sheets,
	values = 'raw'
}: {
	label: string
	/** Receives every sheet's cell values after each edit. Omit to render read-only. */
	onChange?: (sheets: CellValue[][][]) => void
	sheets: SpreadsheetSheet[]
	/** `raw` keeps typed formulas such as `=A1*2`; `computed` reports their results. */
	values?: 'raw' | 'computed'
}) {
	const ref = useRef<HTMLDivElement>(null)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange

	useEffect(() => {
		const host = ref.current
		if (!host) return
		// A fresh mount node per effect run: jspreadsheet appends into its element and destroy() leaves
		// that markup behind, so reusing one node would stack sheets under React StrictMode remounts.
		const element = document.createElement('div')
		host.append(element)
		const editable = Boolean(onChangeRef.current)
		let worksheets: WorksheetInstance[] = []
		const report = () => onChangeRef.current?.(worksheets.map((sheet) => sheet.getData(false, values === 'computed')))
		worksheets = jspreadsheet(element, {
			tabs: sheets.length > 1,
			about: false,
			allowExport: false,
			contextMenu: (worksheet, column, row, _event, _items, role) => {
				const menu = editable ? buildMenu(worksheet, Number(column), Number(row), role) : []
				// jspreadsheet falls back to its full default menu for null; `false` suppresses the menu.
				return (menu.length > 0 ? menu : false) as never
			},
			onafterchanges: report,
			oninsertrow: report,
			oninsertcolumn: report,
			ondeleterow: report,
			ondeletecolumn: report,
			onmoverow: report,
			onmovecolumn: report,
			onundo: report,
			onredo: report,
			worksheets: sheets.map((sheet) => {
				const width = Math.max(1, ...sheet.rows.map((row) => row.length))
				return {
					worksheetName: sheet.name,
					data: sheet.rows.length > 0 ? sheet.rows : [[]],
					minDimensions: [
						Math.max(width + SPARE_COLUMNS, MIN_COLUMNS),
						Math.max(sheet.rows.length + SPARE_ROWS, MIN_ROWS)
					],
					editable,
					columns: editable
						? undefined
						: Array.from({ length: Math.max(width + SPARE_COLUMNS, MIN_COLUMNS) }, () => ({ readOnly: true })),
					allowComments: false,
					allowRenameColumn: false,
					columnSorting: false,
					allowInsertColumn: editable,
					allowInsertRow: editable,
					allowDeleteColumn: editable,
					allowDeleteRow: editable,
					allowManualInsertColumn: editable,
					allowManualInsertRow: editable,
					defaultColWidth: 120,
					defaultColAlign: 'left',
					tableOverflow: true,
					tableWidth: '100%',
					tableHeight: 'min(480px, 60dvh)'
				}
			})
		})
		return () => {
			jspreadsheet.destroy(element as never, true)
			element.remove()
		}
		// The sheet owns its data after mount; the file view remounts it (via `key`) to reload.
		// oxlint-disable-next-line react/exhaustive-deps
	}, [])

	return (
		<div
			aria-label={label}
			className="mr-auto w-fit min-w-0 max-w-full overflow-hidden rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[calc(var(--fb-font)-1px)]"
			data-fb-sheet=""
			data-fb-sheet-count={sheets.length}
			ref={ref}
			role="group"
		>
			<style>{SHEET_CSS}</style>
		</div>
	)
}

function buildMenu(worksheet: WorksheetInstance, column: number, row: number, role: string): MenuItem[] {
	const rowItems: MenuItem[] = [
		{ title: 'Insert row above', onclick: () => void worksheet.insertRow(1, row, 1) },
		{ title: 'Insert row below', onclick: () => void worksheet.insertRow(1, row) },
		{ title: 'Delete row', onclick: () => void worksheet.deleteRow(row, 1) }
	]
	const columnItems: MenuItem[] = [
		{ title: 'Insert column left', onclick: () => void worksheet.insertColumn(1, column, true) },
		{ title: 'Insert column right', onclick: () => void worksheet.insertColumn(1, column, false) },
		{ title: 'Delete column', onclick: () => void worksheet.deleteColumn(column, 1) }
	]
	const hasRow = Number.isInteger(row) && row >= 0
	const hasColumn = Number.isInteger(column) && column >= 0
	if (role === 'header' && hasColumn) return columnItems
	if (role === 'row' && hasRow) return rowItems
	if (role === 'cell' && hasRow && hasColumn) return [...rowItems, { title: '', type: 'line' }, ...columnItems]
	return []
}

/** Drop trailing empty rows and columns that the editor's minimum grid adds. */
export function trimSheet(rows: CellValue[][]): CellValue[][] {
	const isEmpty = (value: CellValue | undefined) => value === '' || value === null || value === undefined
	const trimmed = rows.map((row) => {
		let end = row.length
		while (end > 0 && isEmpty(row[end - 1])) end -= 1
		return row.slice(0, end)
	})
	let last = trimmed.length
	while (last > 0 && trimmed[last - 1].length === 0) last -= 1
	const kept = trimmed.slice(0, last)
	const width = Math.max(0, ...kept.map((row) => row.length))
	return kept.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')])
}
