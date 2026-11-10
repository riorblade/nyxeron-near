// Who the player is tonight. One account can be both (the CEO gets the margin, a guest gets the units), so this is only
// which screen the City shows, remembered in this browser.
import { useState } from 'react'

export type Role = 'ceo' | 'guest'
const KEY = 'nyxeron.role.v1'

export const asRole = (v: unknown): Role | null => (v === 'ceo' || v === 'guest' ? v : null)

export function useRole() {
  const [role, setRoleState] = useState<Role | null>(() => {
    try {
      return asRole(localStorage.getItem(KEY))
    } catch {
      return null
    }
  })
  const setRole = (r: Role) => {
    setRoleState(r)
    try {
      localStorage.setItem(KEY, r)
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
  }
  return [role, setRole] as const
}
