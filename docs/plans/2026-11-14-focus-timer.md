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

## Steps

1. App: the menu bar item, its clock, its menu, hide on close (done on the earlier preview branch; carried over).
2. Interface: timer logic as a tested module; the Focus view; entry points from the goal and the right-click menu; the countdown in the sidebar.
3. Check in the real app: countdown in the menu bar, pause and stop from it, the end of a session.

## Not in this version

Recurring reminders, a planned sequence of work blocks, time recorded per task.
