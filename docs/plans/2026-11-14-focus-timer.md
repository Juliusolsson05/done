# Focus timer with a menu bar countdown

Issue: #3

## What it is

A countdown on one task, started from the list, with the time left shown in the Mac menu bar.

## Decisions

- **The window owns the session; the menu bar only displays it.** The interface keeps the session (task, end time or time left) and hands those times to the app whenever they change. The app counts down from them by itself, because a hidden window's own timers are slowed or stopped.
- **Timestamps, never tick counting.** A running session is its end time; a paused one is what is left. That stays right through sleep and reloads.
- **The session is kept in the browser's storage, not in the tasks file.** It is a few minutes of state for one window, and losing it costs nothing.
- **Closing the window hides it.** A countdown in the menu bar has to outlive its window; Cmd+Q quits.
- **The menu bar rings.** The app plays the sound and brings the window forward at zero, so it happens even when the window is hidden.

### Reminders (added after the first try)

- **A reminder is a label and an interval** ("Stand up and stretch", every 30 minutes). The list is managed where a session is set up and kept in the browser's storage apart from the session, so it outlives it. Label required, 1 to 600 whole minutes.
- **A reminder is a pause that says why.** When the time focused crosses a multiple of its interval the session pauses, the Focus view shows the label in place of the countdown, and it holds until Continue (or Space, Enter, or the menu bar's Pause). The break costs no focus time. A session takes the list as it was when it started.
- **Which intervals have been said is remembered** (`fired`, as "id:nth"), not tested for at the exact moment. A late look at the clock says a missed one once; pausing and resuming cannot say one twice. Two due together come one after the other.
- **The end wins.** A reminder is never due at zero. "10 more minutes" marks the intervals reached so far as said, so one that fell on the end does not appear the moment the extra minutes start.
- **A session knows its total length.** Time focused is the total minus what is left, which already survives pause, reload and sleep; only "more minutes" adds to the total, so the time focused carries on instead of starting over.
- **The window decides that a reminder is due; the menu bar only wakes it.** The hand-off carries the time of the next reminder. When it passes, the app says `reminder` to the window, as it says `ended`, because a hidden window's timers are slowed or stopped. The window's logic then decides.
- **The menu bar rings for a reminder too.** During one the session is handed off as paused and `reminding`. The app's clock then plays the same sound as at zero every 3 seconds, up to 20 times, and brings the window forward once. No new command was needed.

## Steps

1. App: the menu bar item, its clock, its menu, hide on close (done on the earlier preview branch; carried over).
2. Interface: timer logic as a tested module; the Focus view; entry points from the goal and the right-click menu; the countdown in the sidebar.
3. Check in the real app: countdown in the menu bar, pause and stop from it, the end of a session.
4. Lighter type in the Focus view (medium weight, like the owner's earlier timer) and reminders: tested logic, the list in setup, the reminder in the Focus view, the hand-off to the menu bar.
5. Check in the real app: a reminder with the window hidden (sound, repeat, window brought forward), Continue from the menu bar.

## Not in this version

A planned sequence of work blocks, time recorded per task, editing reminders during a session, a sound in the browser version.
