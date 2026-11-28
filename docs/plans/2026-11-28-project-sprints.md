# Project sprints

Turn any existing project into a sprint from the project page. The sprint can have a deadline, and completing it hides the project in the sidebar and in the phone's Lists screen. Each menu can show completed sprints so they can be reopened. Tasks, notes, search and direct links stay accessible when a sprint is complete.

Use the existing project change and sync path. A project may include sprint settings `{ enabled, deadline, completed }` in its existing wire representation. Missing settings from an older client leave saved settings intact. Turning sprint mode off explicitly resets its deadline and completion. Deadlines are local calendar days with no time of day and never complete a sprint automatically.

The local demo uses a fresh SQLite file with a regular project, an active sprint, a completed sprint, and a few tasks. Verify conversion, deadline edits, completion, reveal, reopening, refresh and direct links at desktop and phone sizes. Run targeted project persistence and sync checks, then the normal repo tests before release.
