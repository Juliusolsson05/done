# Privacy and support for iPhone and iPad

Issue #89. Base 4f6189c.

## Outcome

Anyone can reach the privacy policy and support contact from the landing page, mobile Settings and App Store listing.

## Evidence and design

The landing page already links to /privacy. The policy describes Google sign-in but the app also supports Apple and offline local use. Signed-in account deletion removes server data while the native device keeps local data. The hosted support route must work without signing in; use the same configured operator contact as the privacy page.
Apple's App Review Guideline 5.1.1(i) calls for an accessible privacy link within the app. Show the links in Settings independently of account state. Keep self-hosted app builds pointing to their configured host.

## Checks

Exercise the actual hosted privacy and support routes without an account. Check the footer and mobile Settings text in the production UI build. Keep signed-in data out of these public pages. The App Store privacy questionnaire remains separate from the policy text.
