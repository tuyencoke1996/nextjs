import { RedirectStatusCode } from './redirect-status-code'

export const REDIRECT_ERROR_CODE = 'NEXT_REDIRECT'

export enum RedirectType {
  push = 'push',
  replace = 'replace',
}

export type RedirectError = Error & {
  digest: `${typeof REDIRECT_ERROR_CODE};${RedirectType};${string};${RedirectStatusCode};`
}

/**
 * Checks an error to determine if it's an error generated by the
 * `redirect(url)` helper.
 *
 * @param error the error that may reference a redirect error
 * @returns true if the error is a redirect error
 */
export function isRedirectError(error: unknown): error is RedirectError {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('digest' in error) ||
    typeof error.digest !== 'string'
  ) {
    return false
  }

  const digest = error.digest.split(';')
  const [errorCode, type] = digest
  const destination = digest.slice(2, -2).join(';')
  const status = digest.at(-2)

  const statusCode = Number(status)

  return (
    errorCode === REDIRECT_ERROR_CODE &&
    (type === 'replace' || type === 'push') &&
    typeof destination === 'string' &&
    !isNaN(statusCode) &&
    statusCode in RedirectStatusCode
  )
}
