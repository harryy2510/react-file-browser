import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import 'jspreadsheet-ce/dist/jspreadsheet.css'
import 'jspreadsheet-ce/dist/jspreadsheet.themes.css'
import 'jsuites/dist/jsuites.css'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
	throw new Error('Demo root element was not found')
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>
)
