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

// Which desktop download a browser visitor is offered. This is the tested
// source of the rule; the landing page (crates/server/src/feedback.html)
// cannot import the interface and keeps an inline copy of it. Nothing here
// leaves the page.
export type Os = 'windows' | 'mac' | 'ios' | 'android' | 'linux' | 'other'
// Known only where the browser says so (Chromium's high-entropy client hints).
// Safari and Firefox freeze their user agents, so an unknown chip stays unknown.
export type Arch = 'x86' | 'arm'
export interface Detected {
  os: Os
  arch?: Arch
}
// navigator.userAgentData's platform, and the architecture its
// getHighEntropyValues(['architecture']) answered.
export interface AgentData {
  platform?: string
  architecture?: string
}

const BY_HINT: Record<string, Os> = { windows: 'windows', macos: 'mac', android: 'android', linux: 'linux', 'chrome os': 'other', chromeos: 'other', ios: 'ios' }

export function detectPlatform(userAgent: string, platform: string, maxTouchPoints: number, data?: AgentData): Detected {
  // First: an iPad asking for the desktop site says Mac in every field but touch.
  const os: Os = isIosAgent(userAgent, maxTouchPoints)
    ? 'ios'
    : (BY_HINT[(data?.platform ?? '').toLowerCase()] ??
      (/Android/.test(userAgent)
        ? 'android'
        : /CrOS/.test(userAgent)
          ? 'other'
          : /Windows NT/.test(userAgent) || /^Win/.test(platform)
            ? 'windows'
            : /Macintosh|Mac OS X/.test(userAgent) || /^Mac/.test(platform)
              ? 'mac'
              : /Linux|X11/.test(userAgent) || /Linux/.test(platform)
                ? 'linux'
                : 'other'))
  const arch = data?.architecture === 'x86' ? 'x86' : data?.architecture === 'arm' ? 'arm' : undefined
  return arch && (os === 'windows' || os === 'mac') ? { os, arch } : { os }
}

export type Download = 'windows' | 'mac'
export interface Offer {
  // The one button: a download, or done in the browser.
  primary: Download | 'browser'
  label: string
  // A short line under it, when there is something honest to add.
  note?: string
  // The other downloads, as small links ("Also for Mac · Windows").
  also: Download[]
}

export function downloadOffer({ os, arch }: Detected): Offer {
  if (os === 'windows' && arch !== 'arm') return { primary: 'windows', label: 'Download for Windows', also: ['mac'] }
  if (os === 'windows') return { primary: 'browser', label: 'Open done in your browser', note: 'There is no build for Windows on ARM yet.', also: ['windows', 'mac'] }
  if (os === 'mac' && arch !== 'x86') return { primary: 'mac', label: 'Download for Mac', note: 'For Macs with Apple silicon.', also: ['windows'] }
  if (os === 'mac') return { primary: 'browser', label: 'Open done in your browser', note: 'The Mac app needs Apple silicon, and this Mac has an Intel chip.', also: ['mac', 'windows'] }
  if (os === 'ios') return { primary: 'browser', label: 'Use done in the browser', also: ['mac', 'windows'] }
  return { primary: 'browser', label: 'Open done in your browser', also: ['mac', 'windows'] }
}

// The page's own answer, then the chip where the browser will say.
type Navigator_ = { userAgent?: string; platform?: string; maxTouchPoints?: number; userAgentData?: { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> } }
const nav = (): Navigator_ => (globalThis.navigator ?? {}) as Navigator_

export function currentPlatform(data?: AgentData): Detected {
  const n = nav()
  return detectPlatform(n.userAgent ?? '', n.platform ?? '', n.maxTouchPoints ?? 0, { platform: n.userAgentData?.platform, ...data })
}

export async function readPlatform(): Promise<Detected> {
  const architecture = await nav().userAgentData?.getHighEntropyValues?.(['architecture']).then((v) => v.architecture, () => undefined)
  return currentPlatform({ architecture })
}
