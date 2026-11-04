import { WithPrivy } from '../auth/WithPrivy.tsx'
import { PrivySpike } from './PrivySpike.tsx'

export default function SpikeRoute() {
  return (
    <WithPrivy>
      <PrivySpike />
    </WithPrivy>
  )
}
