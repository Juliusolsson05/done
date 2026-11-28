import { describe, expect, it } from 'vitest'
import { detectPlatform, downloadOffer, isIosAgent } from '@/lib/platform'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
// What an iPad's web view says: the same as a Mac's.
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

describe('isIosAgent', () => {
  it('knows an iPhone, and an iPad that calls itself a Mac', () => {
    expect(isIosAgent(IPHONE, 5)).toBe(true)
    expect(isIosAgent(MAC, 5)).toBe(true)
  })

  it('knows a Mac, which has no touch screen', () => {
    expect(isIosAgent(MAC, 0)).toBe(false)
  })
})

// Real user agents, as these browsers send them (late 2026 versions).
const UA = {
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
}

describe('detectPlatform', () => {
  it('knows Windows 11 in Chrome, Edge and Firefox, and its chip only where Chromium says', () => {
    expect(detectPlatform(UA.winChrome, 'Win32', 0, { platform: 'Windows', architecture: 'x86' })).toEqual({ os: 'windows', arch: 'x86' })
    expect(detectPlatform(UA.winEdge, 'Win32', 0, { platform: 'Windows', architecture: 'arm' })).toEqual({ os: 'windows', arch: 'arm' })
    // Firefox on an ARM PC also says x64, so its chip is left unknown.
    expect(detectPlatform(UA.winFirefox, 'Win32', 0)).toEqual({ os: 'windows' })
  })

  it('knows a Mac, and claims no chip for Safari, whose agent always says Intel', () => {
    expect(detectPlatform(UA.macSafari, 'MacIntel', 0)).toEqual({ os: 'mac' })
    expect(detectPlatform(UA.macChrome, 'MacIntel', 0, { platform: 'macOS', architecture: 'arm' })).toEqual({ os: 'mac', arch: 'arm' })
    expect(detectPlatform(UA.macChrome, 'MacIntel', 0, { platform: 'macOS', architecture: 'x86' })).toEqual({ os: 'mac', arch: 'x86' })
  })

  it('knows an iPhone, and an iPad in desktop mode by its touch screen', () => {
    expect(detectPlatform(UA.iphone, 'iPhone', 5)).toEqual({ os: 'ios' })
    expect(detectPlatform(UA.macSafari, 'MacIntel', 5)).toEqual({ os: 'ios' })
  })

  it('knows Android before the Linux in its agent, Linux, and ChromeOS', () => {
    expect(detectPlatform(UA.android, 'Linux armv81', 5, { platform: 'Android' })).toEqual({ os: 'android' })
    expect(detectPlatform(UA.android, 'Linux armv81', 5)).toEqual({ os: 'android' })
    expect(detectPlatform(UA.linuxFirefox, 'Linux x86_64', 0)).toEqual({ os: 'linux' })
    expect(detectPlatform(UA.chromeOs, 'Linux x86_64', 0, { platform: 'Chrome OS' })).toEqual({ os: 'other' })
    expect(detectPlatform(UA.chromeOs, 'Linux x86_64', 0)).toEqual({ os: 'other' })
    expect(detectPlatform('', '', 0)).toEqual({ os: 'other' })
  })
})

describe('downloadOffer', () => {
  it('offers the installer to Windows, unless the PC says it is ARM', () => {
    expect(downloadOffer({ os: 'windows' })).toEqual({ primary: 'windows', label: 'Download for Windows', also: ['mac'] })
    expect(downloadOffer({ os: 'windows', arch: 'arm' })).toMatchObject({ primary: 'browser', note: 'There is no build for Windows on ARM yet.', also: ['windows', 'mac'] })
  })

  it('offers the Mac app with its chip said, unless the Mac says it is Intel', () => {
    expect(downloadOffer({ os: 'mac' })).toEqual({ primary: 'mac', label: 'Download for Mac', note: 'For Macs with Apple silicon.', also: ['windows'] })
    expect(downloadOffer({ os: 'mac', arch: 'x86' })).toMatchObject({ primary: 'browser', also: ['mac', 'windows'] })
  })

  it('offers the browser to phones and everything else, with the downloads underneath', () => {
    expect(downloadOffer({ os: 'ios' })).toEqual({ primary: 'browser', label: 'Use done in the browser', also: ['mac', 'windows'] })
    for (const os of ['android', 'linux', 'other'] as const) {
      expect(downloadOffer({ os })).toEqual({ primary: 'browser', label: 'Open done in your browser', also: ['mac', 'windows'] })
    }
  })
})
