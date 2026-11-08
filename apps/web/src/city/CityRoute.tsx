import { WithPrivy } from '../auth/WithPrivy.tsx'
import City from './City.tsx'

export default function CityRoute() {
  return (
    <WithPrivy>
      <City />
    </WithPrivy>
  )
}
