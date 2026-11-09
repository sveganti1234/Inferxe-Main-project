import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Amplify } from 'aws-amplify'
import { initializeCognitoContext } from './lib/cognitoContext'

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

const authority = import.meta.env.VITE_COGNITO_AUTHORITY?.trim()
const userPoolId =
  import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim() ||
  authority?.split('/').filter(Boolean).pop()
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID?.trim()
const awsRegion = import.meta.env.VITE_COGNITO_REGION?.trim() || userPoolId?.split('_')[0]
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN?.trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '')
const redirectSignIn = import.meta.env.VITE_COGNITO_REDIRECT_SIGN_IN
  ?.split(',')
  .map((url: string) => url.trim())
  .filter(Boolean)
const redirectSignOut = import.meta.env.VITE_COGNITO_REDIRECT_SIGN_OUT
  ?.split(',')
  .map((url: string) => url.trim())
  .filter(Boolean)

if (!userPoolId || !userPoolClientId || !awsRegion) {
  throw new Error(
    'AWS Cognito configuration is incomplete. Set VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID, and VITE_COGNITO_REGION.',
  )
}
if (userPoolId.split('_')[0] !== awsRegion) {
  throw new Error('VITE_COGNITO_REGION does not match the region encoded in VITE_COGNITO_USER_POOL_ID.')
}

const cognitoConfig = {
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
      loginWith: {
        email: true,
        ...(cognitoDomain && redirectSignIn?.length && redirectSignOut?.length
          ? {
              oauth: {
                domain: cognitoDomain,
                scopes: ['openid', 'email', 'profile'],
                redirectSignIn,
                redirectSignOut,
                responseType: 'code' as const,
              },
            }
          : {}),
      },
    },
  },
} as const

Amplify.configure(cognitoConfig)
initializeCognitoContext(cognitoConfig)
console.info('[amplify-init] Cognito configured.', {
  hasUserPoolId: Boolean(userPoolId),
  hasUserPoolClientId: Boolean(userPoolClientId),
  regionMatchesUserPool: userPoolId.startsWith(`${awsRegion}_`),
})

const { default: App } = await import('./App')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
