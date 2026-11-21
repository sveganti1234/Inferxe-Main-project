import { Fragment } from 'react'
import { LAYERS } from '../../data/content'
import { Plate } from '../ui/Glass'
import { Reveal } from '../ui/Reveal'

/** Architecture rendered as four rack-mounted units with live LEDs and pluggable modules. */
export function RackStack() {
  return (
    <div className="rack">
      {LAYERS.map((l, i) => (
        <Fragment key={l.id}>
          <Reveal delay={i * 0.06}>
            <Plate className="rack__unit">
              <div className="rack__main">
                <span className="engrave">{l.tag}</span>
                <h3 className="h3 rack__title">
                  <span className="icon-tile icon-tile--sm">
                    <l.icon />
                  </span>
                  {l.title}
                </h3>
                <p>{l.body}</p>
              </div>
              <div className="rack__slots">
                {l.chips.map((c) => {
                  const live = c.includes('live')
                  const future = c.includes('Phase 2')
                  return (
                    <span key={c} className={`slot ${live ? 'slot--live' : ''} ${future ? 'slot--future' : ''}`}>
                      {c}
                    </span>
                  )
                })}
              </div>
              <div className="rack__vents" aria-hidden>
                {Array.from({ length: 14 }).map((_, k) => (
                  <i key={k} />
                ))}
              </div>
            </Plate>
          </Reveal>
          {i < LAYERS.length - 1 && (
            <div className="rack__link" aria-hidden>
              <i />
              <i />
              <i />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
