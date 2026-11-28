# Use the note formatting tools with a finger

## Outcome

Tap Lists, change a list level, and keep writing on an iPhone or iPad.
The editor should retain its selection and the touch toolbar should stay usable.

## Evidence

On a release preview with synthetic tasks and a nested numbered note, WebKit
received touch and pointer events on Lists in both phone orientations. It never
sent the click that opens the menu. A mouse click on the same button opened it.

## Work and checks

- Let touch generate its normal click. Use mouse-down to preserve the selection.
- Exercise the real menu and its commands through touch, including Done.
- Verify focus, native-sized layouts, editor unit tests, typechecking and build.
