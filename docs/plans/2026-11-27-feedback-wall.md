# A feedback wall for friends using done

Branch `feat/feedback-wall` from `5b4662b`. Issue #85.

## Outcome

A friend opens the landing page, sees what done is, and can send one bug report or suggestion.
The report lives on the hosted service, where another browser can see it according to the wall's visibility.
The form asks for a category and a message.

## Design

- Reuse the existing hosted server, account system and Postgres. Feedback has its own table.
- Give the page its own HTML so the initial visit never boots the task app or requests personal notes.
- Serve the page at /feedback, and at the root for hi.thedone.app. Preserve the app at the existing root.
- Use the canonical app host for sign-in and posting, where its host-only cookie already works.
- Pending the owner's visibility preference, keep the landing public and require a signed-in account to view user reports or post. Do not publish personal identity in the feed.
- Store plain text. Show category, message and date, newest first.
- Design for phone and desktop. Show loading, empty, signed-out, posting, posted and retry states.
- Keep DNS and production deployment in the separate infrastructure repository.

## Verification

Test authenticated posting, actual cross-account visibility, invalid input and signed-out behavior against a throwaway Postgres database.
Visit the local landing page, submit in a browser, reload and inspect the saved entry.
Confirm the usual app root still serves the task app.
