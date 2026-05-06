const CARET_OVERLAY_W = 8;

/** @type {Set<() => void>} */
const syncAllCaretsFns = new Set();

/**
 * Copy font and box metrics from an input onto a measuring element.
 * @param {HTMLInputElement} fromEl
 * @param {HTMLElement} toEl
 */
function copyTextMetrics(fromEl, toEl) {
  const cs = getComputedStyle(fromEl);
  const s = toEl.style;
  s.fontFamily = cs.fontFamily;
  s.fontSize = cs.fontSize;
  s.fontWeight = cs.fontWeight;
  s.fontStyle = cs.fontStyle;
  s.fontVariant = cs.fontVariant;
  s.letterSpacing = cs.letterSpacing;
  s.lineHeight = cs.lineHeight;
  s.boxSizing = cs.boxSizing;
  s.textTransform = cs.textTransform;
  s.wordSpacing = cs.wordSpacing;
  s.paddingLeft = cs.paddingLeft;
  s.paddingRight = cs.paddingRight;
  s.paddingTop = cs.paddingTop;
  s.paddingBottom = cs.paddingBottom;
  s.borderLeftWidth = cs.borderLeftWidth;
  s.borderLeftStyle = cs.borderLeftStyle;
  s.borderLeftColor = cs.borderLeftColor;
}

/**
 * X offset of the caret inside the input’s content area (same box as `clientWidth`), in px.
 * @param {HTMLInputElement} input
 * @param {number} caretIndex
 */
function measureCaretLeft(input, caretIndex) {
  const value = input.value;
  const i = Math.max(0, Math.min(value.length, caretIndex));
  const w = input.clientWidth;
  if (w <= 0) {
    return 0;
  }

  const div = document.createElement("div");
  div.setAttribute("aria-hidden", "true");
  Object.assign(div.style, {
    visibility: "hidden",
    position: "absolute",
    left: "0",
    top: "0",
    whiteSpace: "pre",
    overflow: "hidden",
    pointerEvents: "none",
    width: `${w}px`
  });
  copyTextMetrics(input, div);

  div.append(document.createTextNode(value.slice(0, i)));
  const probe = document.createElement("span");
  probe.textContent = value.slice(i, i + 1) || "\u200b";
  div.append(probe);

  document.body.appendChild(div);
  const left = probe.offsetLeft;
  document.body.removeChild(div);
  return left;
}

/**
 * Hide native caret and drive a block overlay that follows the insertion point.
 * @param {HTMLInputElement} input
 * @param {HTMLElement} caretEl
 * @returns {() => void} detach
 */
export function attachFollowingCaret(input, caretEl) {
  const wrap = input.parentElement;
  if (!wrap?.classList.contains("input-with-caret")) {
    return () => {};
  }

  let rafId = 0;

  const sync = () => {
    if (document.activeElement !== input) {
      caretEl.classList.add("fake-caret--away");
      return;
    }

    caretEl.classList.remove("fake-caret--away");

    const pos =
      input.selectionDirection === "backward"
        ? input.selectionEnd ?? 0
        : input.selectionStart ?? 0;

    const measured = measureCaretLeft(input, pos);
    const left = measured - (input.scrollLeft || 0);
    const max = Math.max(0, input.clientWidth - CARET_OVERLAY_W);
    const clamped = Math.min(Math.max(0, left), max);
    caretEl.style.left = `${clamped}px`;
  };

  const schedule = () => {
    if (rafId) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      sync();
    });
  };

  const onSelectionChange = () => {
    if (document.activeElement === input) {
      schedule();
    }
  };

  for (const ev of ["input", "click", "keyup", "keydown", "focus", "scroll"]) {
    input.addEventListener(ev, schedule);
  }
  input.addEventListener("blur", sync);
  document.addEventListener("selectionchange", onSelectionChange);

  let ro;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(schedule);
    ro.observe(wrap);
  }

  syncAllCaretsFns.add(sync);
  schedule();

  return () => {
    syncAllCaretsFns.delete(sync);
    for (const ev of ["input", "click", "keyup", "keydown", "focus", "scroll"]) {
      input.removeEventListener(ev, schedule);
    }
    input.removeEventListener("blur", sync);
    document.removeEventListener("selectionchange", onSelectionChange);
    ro?.disconnect();
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };
}

export function syncAllFollowingCarets() {
  requestAnimationFrame(() => {
    for (const fn of syncAllCaretsFns) {
      fn();
    }
  });
}
