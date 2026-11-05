
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Amplify } from 'aws-amplify'

import '@fontsource-variable/rubik'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'

import './styles/tokens.css'
import './styles/base.css'
import './styles/surfaces.css'
import './styles/layout.css'
import './styles/widgets.css'
import './styles/pages.css'
import './styles/inner.css'
import './styles/how.css'
import './styles/gpus.css'
import './styles/pricing.css'
import './styles/dev.css'
import './styles/security.css'
import './styles/company.css'
import './styles/contact.css'
import './styles/dashboard.css'
import './styles/auth.css'
import './styles/bot.css'
import './styles/dashboard-extra.css'
import './styles/index.css'

import App from './App'

// AWS Cognito configuration: Derive configuration directly from VITE_COGNITO_AUTHORITY and VITE_COGNITO_CLIENT_ID
const rawAuthority = (import.meta.env.VITE_COGNITO_AUTHORITY as string | undefined)?.trim()
const derivedPoolId = rawAuthority ? rawAuthority.replace(/\/+$/, '').split('/').pop() : undefined

const userPoolId =
  (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined)?.trim() ||
  derivedPoolId ||
  'ap-south-1_cYw1QjgbQ'

const userPoolClientId =
  (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined)?.trim() ||
  '334trhnhmim8v42gq4bgk7umst'
  '334trhnhmim8v42gq4bgk7umst'

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
      loginWith: {
        email: true,
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

