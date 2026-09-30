import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react()],
	resolve: {
		tsconfigPaths: true
	},
	build: {
		lib: {
			entry: {
				index: resolve(__dirname, 'src/index.ts'),
				'adapters/in-memory/index': resolve(__dirname, 'src/adapters/in-memory/index.ts'),
				'adapters/s3/index': resolve(__dirname, 'src/adapters/s3/index.ts'),
				'adapters/r2/index': resolve(__dirname, 'src/adapters/r2/index.ts'),
				'adapters/supabase/index': resolve(__dirname, 'src/adapters/supabase/index.ts'),
				'plugins/code/index': resolve(__dirname, 'src/plugins/code/index.tsx'),
				'plugins/markdown/index': resolve(__dirname, 'src/plugins/markdown/index.tsx'),
				'plugins/csv/index': resolve(__dirname, 'src/plugins/csv/index.tsx'),
				'plugins/xlsx/index': resolve(__dirname, 'src/plugins/xlsx/index.tsx'),
				'plugins/docx/index': resolve(__dirname, 'src/plugins/docx/index.tsx'),
				'theme/index': resolve(__dirname, 'src/theme/index.ts')
			},
			formats: ['es']
		},
		rollupOptions: {
			external: [
				/^prismjs(\/.*)?$/,
				/^read-excel-file(\/.*)?$/,
				/^write-excel-file(\/.*)?$/,
				'codejar',
				'docx-preview',
				'papaparse',
				'jspreadsheet-ce',
				'react-markdown',
				'squire-rte',
				'turndown',
				'marked',
				'dompurify',
				'@aws-sdk/client-s3',
				'@aws-sdk/s3-request-presigner',
				'@supabase/supabase-js',
				'react',
				'react-dom',
				'react/jsx-runtime',
				'react-selecto'
			],
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: 'chunks/[name]-[hash].js',
				assetFileNames: 'assets/[name]-[hash][extname]'
			}
		},
		sourcemap: true,
		emptyOutDir: true
	},
	test: {
		environment: 'jsdom',
		environmentOptions: {
			jsdom: {
				url: 'http://localhost/'
			}
		},
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
		coverage: {
			provider: 'v8',
			reportsDirectory: './coverage'
		}
	}
})
