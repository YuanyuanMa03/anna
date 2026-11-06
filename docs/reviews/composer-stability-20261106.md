# Stable composer during conversation

The composer used wrapping flex rows. Task and speech controls appeared and disappeared, and changing voice-status text changed the available width. This could add or remove a row and move the text input vertically.

The composer now has two fixed-height grid rows: input and controls. Stop buttons retain their layout space while hidden, disabled and hidden from accessibility. Voice status sits above the composer without affecting layout. Mode descriptions are available through the existing button titles; the compact controls fit the supported minimum desktop width.

Focused verification: `tests/voice-talk.mjs` samples the textarea rectangle on every animation frame through synthetic microphone input, fake recognition, a scripted agent reply and synthesis. Its top and height must vary by less than one pixel. This passed. This is synthetic UI validation, not microphone hardware acceptance.

Existing uncommitted body/gaze changes are separate and preserved.

Validation completed: `pnpm build`, `pnpm test:scripted`, the focused geometry flow and `pnpm preflight` passed (997 passed, 19 skipped). The generated approval screenshot was inspected: input and controls occupy two stable rows. Reviewed the diff for hidden-button keyboard/accessibility behavior and supported minimum-width fit. No changes to model requests or permission handling.
