import dotenv from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSupabaseConnection } from '../auth/customerAuth.js'

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') })

try {
  await checkSupabaseConnection()
  console.log('Supabase connection succeeded.')
} catch (error) {
  console.error('Supabase connection failed:', error.message)
  process.exitCode = 1
}
