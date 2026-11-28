// Eats the one click the browser sends after a held item (a Board card, a
// Timeline bar) is let go, so the release is not also a tap on whatever is
// under the finger: the item's check or title, or an item of the menu that
// the release just opened there. Gives up after CLICK_WINDOW ms if no click
// comes. Used by the Board and the Timeline.
export const CLICK_WINDOW = 400

type Target = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>

export function swallowClick(target: Target = window) {
  const eat = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
    done()
  }
  const done = () => {
    target.removeEventListener('click', eat, true)
    target.clearTimeout(timer)
  }
  target.addEventListener('click', eat, true)
  const timer = target.setTimeout(done, CLICK_WINDOW)
}
