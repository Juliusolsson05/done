# The iPhone app feels like an iPhone app

Owner, 21 Nov 2026: "the mobile app feels like a shitty android app tho and not on the quality level of being a iphone app ... try making it in to a good iphone app with the iphone UI design principles so people feel like it is super nice and polished."

## Outcome

On a phone (below 768 px), done is drawn the way iOS draws its own apps. The Mac app and the web app in a window do not change.

## Seen before (the web layout at iPhone size, 21 Nov)

- A round floating + in the middle of the tab bar (Material design).
- A hamburger "Menu" that slid in a drawer.
- Small web-sized rows with no separators.
- A title with the date beside it.
- Tapping a task opened an inline web form with raw `yyyy-mm-dd` date fields and Save/Cancel buttons.

## Design

| Before | After |
|---|---|
| Tab bar with a floating + | Translucent iOS tab bar: Today, Inbox, Upcoming, Lists. A red badge for overdue tasks. Tapping the current tab scrolls to the top. |
| + button | "⊕ New Task" at the bottom left, as in Reminders. |
| Drawer | A Lists screen (`view.kind = 'lists'`): four cards, then My Lists and More as grouped lists. |
| Title | Navigation bar with a large title. It shrinks into a blurred bar with a small centred title once scrolled under. The bar is portalled out of the page, so the push animation does not move it. |
| Opening a screen from Lists | It pushes in from the right, with "‹ Lists" in the bar. A swipe from the left edge goes back. Tabs switch instantly. |
| Project actions | Rename and Delete sit behind ⋯ in the bar, as an iOS action sheet. |
| Rows | 17 pt text, hairline separators starting at the text, a pressed-row grey. Swipe right completes and swipe left deletes, with a tick at the point where letting go acts. |
| Task form | A details sheet from the bottom: grabber (pull down to close), Cancel / Details / Done, grouped rows. Date and Starts open iOS's date picker; Priority and List open iOS's picker wheels; Delete Task sits in its own group. |
| Quick add | The same box, with iOS buttons (Cancel, Add) and a deeper dim. |
| Touch | No long-press callout or text selection outside fields and notes. Inputs never set below 16 px (Safari zooms). `maximum-scale=1`. |
| Feedback | Haptics through `tauri-plugin-haptics` (phones only), tied to the same moments as the sounds: complete is medium, the last task or a focus block is success, delete is rigid, error is error. |

- Type: iOS text styles added to the theme once (`text-body` 17, `subhead` 15, `footnote` 13, `caption` 12, `title` 22, `large-title` 34, `tab` 10). `cn` is told about them (`lib/utils.ts`); without that it treated them as colours and dropped them.

## Rulings

- Ruling: kept light only, as the app is by choice. Cost if wrong: dark mode later is a token change.
- Ruling: checked in a browser at 393×852 and on the owner's iPhone. No simulator: it makes this Mac unusable (owner, 21 Nov).

## Verification

- typecheck, 463 UI tests.
- Each screen looked at at 393×852: Today, Lists, a project, the ⋯ sheet, task details, quick add, and the scrolled bar.
- Not verified here:
  - haptics and the swipes (touch only);
  - the native pickers;
  - the safe areas.
  These need the device build, installed on the owner's iPhone.
