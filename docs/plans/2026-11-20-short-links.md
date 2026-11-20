# Short links in task notes

Fixes #25. Branch: `feat/short-links`. Base: `origin/main` @ 576f550. Small plan, follows #24.

## Why

A product or doc link is often longer than the notes around it and wraps over two or three lines.

## Decisions

1. **A link shows as its site's name**: the host without `www.` (`amazon.com`, `bestbuy.com`). The full
   address is the link's tooltip and what opens. The notes themselves are unchanged.
2. If an address can't be read as a URL, it shows as written.

## Files

`ui/src/lib/links.ts` (`label`), `ui/src/lib/links.test.ts`, `ui/src/components/notes-text.tsx`.

## Verification

`npm test`, `npm run build`, and the web interface with a long Best Buy link.

## Execution notes

- Plan vs built: both decisions MATCH.
- Verified: `npm test` (407, two new), `npm run build`, and the web interface on a scratch tasks file: notes
  with the full Best Buy and Amazon addresses show `bestbuy.com` and `amazon.com` on one line.
