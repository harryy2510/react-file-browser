import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
	const storage = createMemoryStorage()
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: storage
	})

	Object.defineProperty(window.navigator, 'clipboard', {
		configurable: true,
		value: createMemoryClipboard()
	})
}

function createMemoryClipboard(): { readText: () => Promise<string>; writeText: (text: string) => Promise<void> } {
	let text = ''
	return {
		readText() {
			return Promise.resolve(text)
		},
		writeText(next: string) {
			text = next
			return Promise.resolve()
		}
	}
}

function createMemoryStorage(): Storage {
	const data = new Map<string, string>()
	return {
		get length() {
			return data.size
		},
		clear() {
			data.clear()
		},
		getItem(key: string) {
			return data.get(key) ?? null
		},
		key(index: number) {
			return Array.from(data.keys()).at(index) ?? null
		},
		removeItem(key: string) {
			data.delete(key)
		},
		setItem(key: string, value: string) {
			data.set(key, value)
		}
	}
}
