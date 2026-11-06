import type { StaffRole } from './types'
/** Support lands on its authorised request dashboard, never on item management. */
export function homeForRole(role: StaffRole) { return role === 'support' ? '/support' : '/items' }
