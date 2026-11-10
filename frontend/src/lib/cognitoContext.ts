import { createAmplifyContext } from 'aws-amplify'

type CognitoResourcesConfig = Parameters<typeof createAmplifyContext>[0]

let cognitoContext: ReturnType<typeof createAmplifyContext> | null = null

export function initializeCognitoContext(config: CognitoResourcesConfig): void {
  if (cognitoContext) throw new Error('Cognito Auth context has already been initialized.')
  cognitoContext = createAmplifyContext(config)
}

export function getCognitoContext(): ReturnType<typeof createAmplifyContext> {
  if (!cognitoContext) {
    throw new Error(
      'AWS Cognito is unavailable. Set VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID, and VITE_COGNITO_REGION, then restart Vite.',
    )
  }
  return cognitoContext
}
