import { Plate } from '../ui/Glass'

const ROWS = [
  { k: 'Catalogue', v: 'GPU SKUs, VRAM, regions and pricing, normalized' },
  { k: 'Capacity', v: 'Live availability per region and GPU class' },
  { k: 'Lifecycle', v: 'Provision, start, stop and terminate' },
  { k: 'Errors', v: 'Mapped to platform-standard error codes' },
]

/** Skeuomorphic readout of the provider-adapter contract. */
export function AdapterContract() {
  return (
    <Plate className="adapter">
      <div className="adapter__head">
        <span className="row" style={{ gap: 10 }}>
          <span className="engrave">Adapter contract</span>
        </span>
        <span className="tag">one per provider</span>
      </div>
      <ul className="adapter__rows">
        {ROWS.map((r, i) => (
          <li key={r.k} className="well adapter__row">
            <span className="readout-label">{String(i + 1).padStart(2, '0')}</span>
            <b className="readout">{r.k}</b>
            <span>{r.v}</span>
          </li>
        ))}
      </ul>
      <div className="adapter__foot">
        <span className="slot slot--live">
          JarvisLabs · live in MVP
        </span>
        <span className="slot">
          Mock adapter
        </span>
        <span className="slot slot--future">
          More · Phase 2
        </span>
      </div>
    </Plate>
  )
}
