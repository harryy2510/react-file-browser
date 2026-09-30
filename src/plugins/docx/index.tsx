import { renderAsync } from 'docx-preview'
import { useEffect, useRef, useState } from 'react'
import type { FileBrowserPreviewer } from '../../components/file-plugins'
import { getFileExtension } from '../../components/file-types'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function DocxView({ content }: { content: ArrayBuffer | string | null }) {
	const bodyRef = useRef<HTMLDivElement>(null)
	const styleRef = useRef<HTMLDivElement>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const body = bodyRef.current
		if (!body || !(content instanceof ArrayBuffer)) return
		body.replaceChildren()
		// docx-preview scopes its generated styles under the `docx` class inside the style container.
		renderAsync(content, body, styleRef.current ?? undefined, { className: 'docx', inWrapper: true }).catch(
			(caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))
		)
	}, [content])

	return (
		<div className="max-h-[min(640px,65dvh)] w-full overflow-auto rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface-2)]">
			{error ? <p className="m-0 p-4 text-[var(--fb-danger)]">{error}</p> : null}
			<div hidden ref={styleRef} />
			<div ref={bodyRef} />
		</div>
	)
}

/** Word document preview (docx-preview). */
export const docxPreviewer: FileBrowserPreviewer = {
	id: 'docx',
	match: (item) => getFileExtension(item.name) === 'docx' || item.mimeType === DOCX_MIME,
	read: 'binary',
	maxBytes: 20 * 1024 * 1024,
	component: ({ content }) => <DocxView content={content} />
}
