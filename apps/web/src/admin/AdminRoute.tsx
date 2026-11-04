import { WithPrivy } from '../auth/WithPrivy.tsx'
import Admin from './Admin.tsx'

export default function AdminRoute() {
  return (
    <WithPrivy>
      <Admin />
    </WithPrivy>
  )
}
