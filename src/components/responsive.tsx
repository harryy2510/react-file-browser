import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, RefObject, TouchEvent } from 'react'

export function useNarrowViewport() {
	const [narrow, setNarrow] = useState(false)
	useEffect(() => {
		const query = window.matchMedia?.('(max-width: 39.999rem)')
		if (!query) return
		const update = () => setNarrow(query.matches)
		update()
		query.addEventListener('change', update)
		return () => query.removeEventListener('change', update)
	}, [])
	return narrow
}

export function useBrowserLayout(ref: RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState<number | null>(null)
	const [rem, setRem] = useState(16)

	useEffect(() => {
		const element = ref.current
		if (!element) return

		const measure = (nextWidth = element.clientWidth) => {
			setRem(Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
			if (nextWidth > 0) setWidth(nextWidth)
		}
		measure()
		const observer =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(([entry]) => measure(entry.contentRect.width))
		observer?.observe(element)
		const onResize = () => measure()
		window.addEventListener('resize', onResize)
		return () => {
			observer?.disconnect()
			window.removeEventListener('resize', onResize)
		}
	}, [ref])

	return {
		isNarrow: width !== null && width < 40 * rem,
		hasSidebar: width === null || width >= 64 * rem
	}
}

export function useLongPress(onLongPress: () => void) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pressed = useRef(false)
	const callback = useRef(onLongPress)
	callback.current = onLongPress

	function cancel() {
		if (timer.current !== null) clearTimeout(timer.current)
		timer.current = null
	}

	useEffect(() => cancel, [])

	return {
		onTouchStart(event: TouchEvent) {
			cancel()
			pressed.current = false
			if (event.touches?.length > 1 || (event.target as Element).closest('input, [data-fb-touch-control]')) return
			timer.current = setTimeout(() => {
				timer.current = null
				pressed.current = true
				callback.current()
			}, 500)
		},
		onTouchMove: cancel,
		onTouchCancel() {
			cancel()
			pressed.current = false
		},
		onTouchEnd() {
			cancel()
			if (pressed.current) {
				timer.current = setTimeout(() => {
					timer.current = null
					pressed.current = false
				}, 350)
			}
		},
		onClickCapture(event: MouseEvent) {
			if (!pressed.current) return
			cancel()
			pressed.current = false
			event.preventDefault()
			event.stopPropagation()
		},
		onContextMenuCapture(event: MouseEvent) {
			if (pressed.current) {
				event.preventDefault()
				event.stopPropagation()
			}
		}
	}
}

const FOCUSABLE =
	'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

export function ResponsiveDialog({
	children,
	label,
	narrow = false,
	onClose
}: {
	children: ReactNode
	label: string
	narrow?: boolean
	onClose: () => void
}) {
	const ref = useRef<HTMLDivElement>(null)
	const closeRef = useRef(onClose)
	closeRef.current = onClose

	useEffect(() => {
		const previousFocus = document.activeElement
		const dialog = ref.current
		if (!dialog?.contains(document.activeElement)) {
			const input = dialog?.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"])')
			;(input ?? dialog)?.focus({ preventScroll: true })
		}
		return () => {
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
				previousFocus.focus({ preventScroll: true })
			}
		}
	}, [])

	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- A dialog owns focus trapping and backdrop dismissal.
		<div
			aria-label={label}
			aria-modal="true"
			className={`fixed inset-0 z-[60] flex min-w-0 justify-center overflow-y-auto overscroll-contain bg-[color-mix(in_oklch,var(--fb-text)_40%,transparent)] p-[calc(var(--fb-gap)*3)] text-[var(--fb-text)] outline-none [overflow-wrap:anywhere] ${
				narrow ? 'items-end' : 'items-center'
			}`}
			data-fb-dialog={narrow ? 'sheet' : 'modal'}
			onClick={(event) => {
				event.stopPropagation()
				if (event.target === event.currentTarget) closeRef.current()
			}}
			onKeyDown={(event) => {
				event.stopPropagation()
				if (event.key === 'Escape') {
					event.preventDefault()
					closeRef.current()
				}
				if (event.key !== 'Tab') return
				const targets = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
					(element) => !element.closest('[hidden]') && getComputedStyle(element).display !== 'none'
				)
				const first = targets[0]
				const last = targets.at(-1)
				if (!first) {
					event.preventDefault()
					ref.current?.focus()
				} else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
					event.preventDefault()
					last?.focus()
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault()
					first.focus()
				}
			}}
			ref={ref}
			role="dialog"
			style={{
				paddingBottom: 'max(calc(var(--fb-gap) * 3), env(safe-area-inset-bottom))',
				paddingTop: 'max(calc(var(--fb-gap) * 3), env(safe-area-inset-top))'
			}}
			tabIndex={-1}
		>
			<div className="flex max-h-[calc(100dvh-max(calc(var(--fb-gap)*6),env(safe-area-inset-bottom)+env(safe-area-inset-top)))] w-full min-w-0 max-w-[calc(var(--fb-gap)*180)] flex-col items-center overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [&>*]:shrink-0">
				{children}
			</div>
		</div>
	)
}

export function ActionSheet({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
	return (
		<ResponsiveDialog label={label} narrow onClose={onClose}>
			<section className="w-full min-w-0 max-w-[calc(var(--fb-gap)*120)] rounded-[20px] bg-[var(--fb-surface)] px-4 pb-5 pt-2.5 shadow-[0_-8px_30px_color-mix(in_oklch,var(--fb-text)_14%,transparent)]">
				<div aria-hidden="true" className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-[var(--fb-border-strong)]" />
				<header className="mb-2 flex items-center justify-between gap-[calc(var(--fb-gap)*2)] border-b border-[var(--fb-border)] pb-2">
					<h2 className="m-0 min-w-0 truncate text-[15px] font-bold">{label}</h2>
					<button
						aria-label={`Close ${label}`}
						className="min-h-[calc(var(--fb-gap)*11)] shrink-0 rounded-[var(--fb-radius)] px-[calc(var(--fb-gap)*3)] font-semibold text-[color-mix(in_oklch,var(--fb-accent)_80%,var(--fb-text))] focus-visible:outline-2 focus-visible:outline-[var(--fb-accent)]"
						onClick={onClose}
						type="button"
					>
						Close
					</button>
				</header>
				{children}
			</section>
		</ResponsiveDialog>
	)
}
