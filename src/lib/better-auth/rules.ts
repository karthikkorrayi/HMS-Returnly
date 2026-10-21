// Sign-in rules shared by the server and the sign-in form in the browser.
// No imports, so it is safe to bundle into client code.
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/
export const MIN_PASSWORD = 10
export const MAX_PASSWORD = 128
export const SESSION_HOURS = 12
export const SIGN_IN_ATTEMPTS_PER_MINUTE = 5
