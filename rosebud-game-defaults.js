/*
 * Preserve browser input events for game handlers while suppressing native
 * browser actions that do not belong on a game surface.
 */

(() => {
  const browserContextMenuSelector = [
    "input",
    "textarea",
    "select",
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    "[data-allow-browser-context-menu]",
  ].join(", ");

  document.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest(browserContextMenuSelector)
      ) {
        return;
      }

      event.preventDefault();
    },
    { capture: true },
  );

  document.addEventListener(
    "dragstart",
    (event) => {
      event.preventDefault();
    },
    { capture: true },
  );
})();
