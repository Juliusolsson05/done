// Whether a browser's own description of itself is an iPhone's or an iPad's.
// An iPad asks for the desktop site, so it names itself a Mac; it is told apart
// by having a touch screen, which no Mac has. Apart from backend.ts so it can
// be tested without a page.
export function isIosAgent(userAgent: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)
}

// iPadOS can advertise itself as macOS. Both use the same modifier label.
export const appleKeyboard = /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent ?? '')
export const modifierKey = appleKeyboard ? '⌘' : 'Ctrl'
export const shortcut = (key: string) => appleKeyboard ? '⌘' + key : 'Ctrl+' + key
export const windowsDevice = /Windows NT/.test(globalThis.navigator?.userAgent ?? '')
