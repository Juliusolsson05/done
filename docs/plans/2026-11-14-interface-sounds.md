# Quiet, satisfying sounds across the app

Issue: #4

## What it is

Short, soft sounds for what the user does: finishing a task above all, and quieter ones for adding, reopening, deleting, undoing, dropping, confirming and a failed save. One switch in Settings turns them off. Nothing else about the app changes.

Nobody has listened to it yet. Every number below (pitch, length, gain) was chosen by reasoning, not by ear, and is expected to be tuned once someone hears it.

## Decisions

- **Synthesized with the Web Audio API.** No audio files, no sound library, no new dependency: nothing to license or ship, the whole layer is a few hundred bytes, and the pitch can respond to what the user is doing (the momentum below).
- **One key.** Every note comes from the C major pentatonic scale (C D E G A). Any two of its notes are consonant, so sounds heard one after another belong together and a chime can be moved up the scale without ever landing on a sour interval.
- **Finishing a task is the reward; the rest is support.** The chime is two rising notes (G5 to C6, a fourth that lands on the key note). The other sounds are single short notes or small slides, at roughly half its level.
- **Momentum.** Each completion within 4 seconds of the last moves the chime one scale step up, at most 4 steps; a longer pause starts again from the bottom. The cap keeps the top note at A6 (1760 Hz) so it never becomes shrill.
- **A fuller reward** (a four-note rising arpeggio, under half a second) for today's goal, and for the last open task while in the Today view. Both are cheap to detect from the data already in `App.tsx`.
- **Limits, held by tests.** Ordinary sounds are at most 250 ms and the fuller reward at most 500 ms; every frequency is between 200 Hz (below that a laptop speaker only thumps) and 3600 Hz; one note peaks at no more than 0.2 and a whole sound at no more than 0.6 before a master gain of 0.5. Each note fades in over 8 ms so it cannot click and decays exponentially like a struck object.
- **Sounds as data, one small player.** `ui/src/lib/sounds.ts` describes each sound as a list of notes and has a pure function that picks the notes and advances the momentum, taking the time as a parameter. A thin player turns notes into oscillators on one shared `AudioContext`, created on first use (always a user action) and resumed if WebKit has suspended it. A missing or blocked `AudioContext` does nothing.
- **Played from the user's action, not from data.** Call sites say `play('complete')` in their handlers. A background refresh or another window's change goes through the store and never reaches a `play`.
- **The chime plays when the check is pressed,** not 280 ms later when the row has faded and the task is marked done. `App` therefore offers `completeSound(id)` for the rows and `complete(id, heard)` so it is not played twice.
- **View switches are silent.** They are navigation, not an accomplishment, and happen too often. Hover, typing, scrolling and the drag itself are silent too.
- **`prefers-reduced-motion` does not mute.** It is a setting about motion. No animation is added.
- **The setting** is a shadcn Switch in Settings, on by default, kept in `localStorage` under `done-sounds`. Turning it on plays the confirm tick as a sample.

## The sounds

| Sound | When | Notes |
| --- | --- | --- |
| `complete` | a task is finished, by its check, the menu or dropping its card in Done | two rising notes, moved up by the momentum |
| `completeBig` | today's goal, or the last open task in Today | rising arpeggio G5 C6 E6 G6 |
| `add` | a task or project is added | short upward slide C5 to G5 |
| `reopen` | a finished task is reopened, by its check, the menu or dragging its card out of Done | two falling notes C6 to G5 |
| `delete` | a task or project is deleted | downward slide A4 to E4 |
| `undo` | Undo in the message | upward slide E4 to A4 |
| `drop` | a card or timeline bar is set down somewhere new (set down where it was: nothing) | short triangle tick G4 to E4 |
| `confirm` | goal set or cleared, an edit saved, a change from the menu (date, priority, project, in progress, colour), a date clicked on the timeline, a project renamed, sounds switched on | one very short C6 |
| `error` | a save was lost | one soft E4 |

## Steps

1. This plan.
2. `ui/src/lib/sounds.ts` with its tests.
3. The Switch in Settings.
4. `play(...)` at each call site.
5. Check in a headless browser what each action schedules; typecheck, tests, build.

## Checked

- In headless WebKit (Playwright), against a throwaway database, with `AudioContext` wrapped to record every oscillator: each action above schedules exactly the notes in the table; six quick completions climb four steps and then hold; a 4.3 second pause starts again from the bottom; the goal and the last task in Today get the arpeggio; nothing is scheduled during a drag, on a view switch, on hover or typing, on a background refresh that brings in another client's tasks, or with the switch off; the switch survives a reload; one context is made, it reaches `running`, and all 69 oscillators ended and were disconnected.
- Not checked: how any of it sounds, and the desktop app itself (only the web page was run).

## Not in this version

- A volume control.
- Sounds for the focus timer: it lives on another branch and its ring comes from the desktop shell.
- Sounds on view switches, hover, typing, scrolling, text size or Copy.
- Tuning by ear. That needs a person.
