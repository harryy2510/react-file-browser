import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const demoDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	root: demoDir,
	plugins: [react(), tailwindcss()],
	resolve: {
		tsconfigPaths: true
	},
	server: {
		host: '127.0.0.1'
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true
	}
})
