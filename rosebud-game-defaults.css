/*
 * Game text should not behave like webpage content, while editable and
 * intentionally copyable controls retain native browser behavior.
 */

:where(html) {
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

:where(
  input,
  textarea,
  [contenteditable]:not([contenteditable="false"]),
  [role="textbox"],
  [data-allow-text-selection],
  [data-allow-text-selection] *
) {
  -webkit-user-select: text;
  user-select: text;
}

