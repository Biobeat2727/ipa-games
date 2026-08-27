import { useEffect, useState } from 'react'

/** Height of the part of the page the on-screen keyboard is NOT covering.
 *
 *  When a phone keyboard opens, the layout viewport (`100vh` / `min-h-screen`)
 *  keeps reporting full window height while the keyboard covers the bottom
 *  third — which is how a submit button underneath a text box ends up
 *  unreachable. `visualViewport.height` shrinks to what is actually visible, so
 *  sizing the answer screens to it keeps the button on screen while typing.
 *
 *  Returns null where the API is unavailable (older browsers); callers fall
 *  back to their normal full-height layout. */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setHeight(vv.height)
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return height
}
