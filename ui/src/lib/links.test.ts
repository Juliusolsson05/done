import { describe, expect, it } from 'vitest'
import { linkParts } from '@/lib/links'

describe('linkParts', () => {
  it('leaves text without an address as it is', () => {
    expect(linkParts('call the bank')).toEqual([{ text: 'call the bank' }])
    // A name with a dot is not an address: only http(s) and www. are.
    expect(linkParts('install done.app')).toEqual([{ text: 'install done.app' }])
  })

  it('finds an address and the text around it', () => {
    expect(linkParts('deck: https://docs.google.com/x/edit now')).toEqual([
      { text: 'deck: ' },
      { text: 'https://docs.google.com/x/edit', href: 'https://docs.google.com/x/edit' },
      { text: ' now' },
    ])
  })

  it('finds two addresses on two lines', () => {
    const parts = linkParts('https://a.com\nhttp://b.com/path?q=1')
    expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual(['https://a.com', 'http://b.com/path?q=1'])
  })

  it('opens a www. address over https', () => {
    expect(linkParts('www.example.com')).toEqual([{ text: 'www.example.com', href: 'https://www.example.com' }])
  })

  it('leaves the punctuation that ends a sentence outside the link', () => {
    expect(linkParts('See https://x.com/a.')).toEqual([{ text: 'See ' }, { text: 'https://x.com/a', href: 'https://x.com/a' }, { text: '.' }])
    expect(linkParts('(https://x.com/a), then')).toEqual([{ text: '(' }, { text: 'https://x.com/a', href: 'https://x.com/a' }, { text: '), then' }])
  })

  it('keeps a bracket that belongs to the address', () => {
    expect(linkParts('https://en.wikipedia.org/wiki/Done_(app)')[0].href).toBe('https://en.wikipedia.org/wiki/Done_(app)')
  })
})
