import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react'

// Focus a field once it is on screen. Done a moment later rather than with
// autoFocus, because a menu that is still closing takes focus back.
export function useFocus(select = false) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.focus()
      if (select) ref.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [select])
  return ref
}

// A name typed in place (a new project, a rename) is kept when the field is
// left or Enter is pressed, and dropped on Escape. `settled` makes sure that
// happens once: closing the field can blur it a second time.
export function useNameField(commit: (value: string) => void) {
  const settled = useRef(false)
  return {
    onBlur(event: FocusEvent<HTMLInputElement>) {
      if (settled.current) return
      settled.current = true
      commit(event.target.value)
    },
    onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Enter') event.currentTarget.blur()
      // The field itself is closed by the app's Escape key.
      if (event.key === 'Escape') settled.current = true
    },
  }
}
