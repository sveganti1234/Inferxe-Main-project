import { createAmplifyContext } from 'aws-amplify'

type CognitoResourcesConfig = Parameters<typeof createAmplifyContext>[0]

let cognitoContext: ReturnType<typeof createAmplifyContext> | null = null

export function initializeCognitoContext(config: CognitoResourcesConfig): void {
  if (cognitoContext) throw new Error('Cognito Auth context has already been initialized.')
  cognitoContext = createAmplifyContext(config)
}

export function getCognitoContext(): ReturnType<typeof createAmplifyContext> {
  if (!cognitoContext) throw new Error('Cognito Auth context has not been initialized.')
  return cognitoContext
}
