import { expect, it } from 'vitest'
import { asRole } from './role.ts'

it('accepts only the two roles', () => {
  expect(asRole('ceo')).toBe('ceo')
  expect(asRole('guest')).toBe('guest')
  expect(asRole(null)).toBeNull()
  expect(asRole('admin')).toBeNull()
})
