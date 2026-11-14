# Dates typed in plain words

Issue: #7

## What it is

While a task is typed in the add box, a date written in words ("tomorrow", "next friday", "in 3 days", "5 jan", "24/12") is recognised as it is written and highlighted in the field. Adding the task takes the phrase out of the title and makes it the due date. Backspace directly after a recognised phrase dismisses it instead of deleting a letter, so the words stay as text.

## What was already there

`ui/src/lib/quick-add.ts` already read a typed line word by word: `today`, `tod`, `tomorrow`, `tmr`, the seven weekday names and `mon tue tues wed thu thur thurs fri`, plus `p1` to `p4` and `#project`. It dropped an "on" or "by" in front of the date, took the first date word and showed the result as chips under the field. Nothing was highlighted and nothing could be dismissed.

## Decisions

- **One reader, extended.** `parseQuickAdd` and `readLine` stay the way in. The date part moved to `ui/src/lib/date-phrases.ts` because a phrase can now be several words; priority and project are read as before from what is left.
- **A table of patterns, no library.** Each entry is a regular expression and a function from the match and today to a day. Days stay `YYYY-MM-DD` text and today is a parameter everywhere.
- **Whole words only.** A phrase starts at the start of the line or after a space or an opening bracket, and ends at the end of the line, a space, or punctuation that is itself followed by one of those. So "today," is a date and "monday.com", "todayish" and "v1.2" are not.
- **The last phrase in the line is the date,** as in Todoist. This changes the old behaviour, where the first date word won, and one old test with it.
- **What is highlighted is what is removed.** An "on", "by" or "due" directly before the phrase belongs to it: "pay rent by friday" highlights "by friday" and leaves "pay rent".
- **No guessing at meaning.** "friday night lights" is due Friday. Backspace is the answer to that.
- **A bare weekday is the next such day strictly after today:** "monday" typed on a Monday is next week's. `this friday` counts today. `next friday` is the Friday of the following week (weeks start on Monday), not the nearest one.
- **A month and day without a year that has passed means next year.** Today itself has not passed. "feb 29" is the next 29 February there is. A bare "5th" or "the 21st" is the next such day of a month, today included; "31st" skips months without one.
- **Numbers are day first** (the owner is Swedish): "24/12", "24/12/2026", "24.12.26". Both parts must make a real date. A date written with its year is taken as written, even in the past. With dots and no year both parts need two digits ("24.12", "05.01"), so "1.5 kg" and "v1.2" are never dates. ISO "2026-12-24" is read as written.
- **Impossible days are not dates:** "feb 30", "31 april", "31/4" stay as text.
- **Months and years are added by the calendar,** and a day the month does not have becomes its last one: a month after 31 January is the last day of February.
- **`weekend` is Saturday** (on a Sunday it is today, since the weekend is on). `next weekend` is the Saturday of next week. `end of week` is Friday, today included. `next week` is its Monday, `next month` its 1st.
- **`sat`, `sun` and `tom` alone are still not dates.** The reader left them out on purpose as ordinary words and a name, with a test ("sat down with Tom in the sun"). `sat` and `sun` are read after "on", "by", "due", "this" or "next", where they can only be days. `tom` is never read; `tmr` and `tmrw` are.
- **`yesterday` is not a due date** and stays as text. So does a bare month ("march to the store") and a bare number.
- **Backspace dismisses.** With no selection and the caret exactly at the end of the recognised phrase, Backspace is swallowed and that phrase, at that place, is remembered as dismissed. The next phrase to its left, if any, becomes the date. A dismissal is dropped as soon as an edit touches its words and moves along when text is typed before it. Escape still closes the box and does nothing else.
- **A dismissed phrase sets no date,** so the view's day applies again (Today gives today).
- **A typed date wins over the view's day,** as before. A task added as today's goal with "tomorrow" in it is still the goal and due tomorrow, as before.
- **A line that is only a date is not added.** The title would be empty, the button stays off and the hint says "Add a title", as it already did. To get a task called "tomorrow", press Backspace after it.
- **The highlight is a mirror behind the field.** The field stays the shadcn `Input`. Behind it a layer shows the same text in the same type with the phrase on a soft `primary` tint, and follows the field's sideways scroll.
- **The date is said in words in the chip that was already there:** "Today", "Tomorrow", otherwise weekday and date ("Fri 20 Nov"), with the year when it is not this one.
- **The task editor is left alone.** Its title was never read for dates.

## Still ambiguous

- "3/4 cup" is 3 April and "1/2 lemon" is 1 February: a fraction and a day-first date look the same.
- "24.12 kr" and "10.12" (a price, a time written with a dot) are dates when both parts happen to fit.
- "5th avenue", "friday night lights", "may 5 people" contain real dates.
- "1.2.26" could be a version.

Backspace covers all of these.

## Steps

1. This plan.
2. `date-phrases.ts` with its table of cases, failing first.
3. `quick-add.ts` reads the date through it; title clean-up, dismissal and precedence tests.
4. The mirror, the Backspace key and the chip in `quick-add.tsx`.
5. Check in WebKit; typecheck, tests, build.

## Not in this version

- Times of day ("at 3pm", "tonight at 8").
- Repeating dates ("every monday").
- Other languages.
- "later this week", "overmorrow", "+3d".
- Recognition in the task editor.
