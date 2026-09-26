/** DEV-ONLY entry for /wrapped-preview.html (see WrappedPreview.tsx). */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WrappedPreview } from './WrappedPreview'
import '../index.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><WrappedPreview /></StrictMode>)
