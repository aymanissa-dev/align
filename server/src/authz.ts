export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum]
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}
