(function shameOverlayMain() {
  const HOST_ID = "r3-shame-overlay-host";
  const STORAGE_KEY = "shameOverlay";
  const MAX_AGE_MS = 120000;

  function slugFromPathname() {
    const m = /^\/problems\/([^/]+)/.exec(window.location.pathname);
    return m ? decodeURIComponent(m[1]) : "";
  }

  /** Map message length to a 5–10 s countdown (short lines ~5s, long ~10s). */
  function countdownSecondsForMessage(text) {
    const len = String(text).length;
    const minLen = 24;
    const maxLen = 140;
    const t = Math.min(1, Math.max(0, (len - minLen) / (maxLen - minLen)));
    const sec = Math.round(5 + t * 5);
    return Math.min(10, Math.max(5, sec));
  }

  function teardown(host, onKey) {
    if (typeof onKey === "function") {
      document.removeEventListener("keydown", onKey, true);
    }
    chrome.storage.local.remove(STORAGE_KEY);
    host?.remove();
  }

  /**
   * @param {unknown} payload
   * @returns {boolean} true if overlay was mounted
   */
  function mountIfValid(payload) {
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const p = /** @type {{ slug?: string; text?: string; ts?: number }} */ (payload);
    if (typeof p.slug !== "string" || typeof p.text !== "string") {
      return false;
    }

    const now = Date.now();
    const ts = typeof p.ts === "number" ? p.ts : 0;
    if (now - ts > MAX_AGE_MS) {
      chrome.storage.local.remove(STORAGE_KEY);
      return false;
    }

    const pageSlug = slugFromPathname();
    if (!pageSlug || pageSlug !== p.slug) {
      return false;
    }

    if (document.getElementById(HOST_ID)) {
      return false;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-r3-shame", "1");
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: ui-monospace, Menlo, Consolas, monospace;
        }
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          background: rgba(13, 17, 23, 0.88);
          backdrop-filter: blur(10px);
          cursor: pointer;
        }
        .panel-wrap {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(12px, 4vw, 48px);
          pointer-events: none;
        }
        .panel {
          pointer-events: auto;
          box-sizing: border-box;
          width: min(94vw, 980px);
          max-height: min(84vh, 760px);
          overflow: auto;
          padding: clamp(32px, 6vw, 72px) clamp(28px, 5vw, 56px);
          border-radius: 14px;
          border: 1px solid #30363d;
          background: linear-gradient(165deg, #1c2330 0%, #161b22 52%, #0d1117 100%);
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.04),
            0 32px 80px rgba(0, 0, 0, 0.65);
          cursor: default;
        }
        .brand {
          color: #7ee787;
          font-size: clamp(14px, 1.8vw, 18px);
          letter-spacing: 0.04em;
          margin-bottom: clamp(20px, 3vw, 36px);
        }
        .msg {
          color: #e6edf3;
          font-size: clamp(1.35rem, 4.2vw, 2.85rem);
          line-height: 1.28;
          font-style: italic;
          text-align: center;
          margin: 0;
          font-weight: 500;
          text-wrap: balance;
        }
        .footer {
          margin-top: clamp(28px, 4vw, 48px);
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 12px 24px;
        }
        .count {
          color: #8b949e;
          font-size: clamp(13px, 1.6vw, 16px);
          cursor: pointer;
          user-select: none;
        }
        .count:hover {
          color: #e6edf3;
        }
        .hint {
          color: #6e7681;
          font-size: clamp(11px, 1.3vw, 13px);
        }
      </style>
      <div class="backdrop" aria-hidden="true"></div>
      <div class="panel-wrap" role="dialog" aria-modal="true" aria-labelledby="r3-shame-msg">
        <div class="panel">
          <div class="brand">&gt;_ r3dir3ct</div>
          <p class="msg" id="r3-shame-msg"></p>
          <div class="footer">
            <span class="count" id="r3-shame-skip" tabindex="0" role="button"></span>
            <span class="hint">click to escape</span>
          </div>
        </div>
      </div>
    `;

    const msgEl = shadow.getElementById("r3-shame-msg");
    const skipEl = shadow.getElementById("r3-shame-skip");
    const backdropEl = shadow.querySelector(".backdrop");
    const panelEl = shadow.querySelector(".panel");

    if (msgEl) {
      msgEl.textContent = p.text;
    }

    let done = false;
    let intervalId = 0;
    let seconds = countdownSecondsForMessage(p.text);

    function tick() {
      if (skipEl) {
        skipEl.textContent = `→ continue in ${seconds}s`;
      }
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    }

    function finish() {
      if (done) {
        return;
      }
      done = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      teardown(host, onKeyDown);
    }

    document.addEventListener("keydown", onKeyDown, true);

    backdropEl?.addEventListener("click", () => finish());
    panelEl?.addEventListener("click", () => finish());
    skipEl?.addEventListener("click", (e) => {
      e.stopPropagation();
      finish();
    });
    skipEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        finish();
      }
    });

    tick();
    intervalId = window.setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        window.clearInterval(intervalId);
        intervalId = 0;
        finish();
        return;
      }
      tick();
    }, 1000);

    return true;
  }

  function tryMountFromStorage() {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      if (chrome.runtime.lastError) {
        return;
      }
      const payload = data[STORAGE_KEY];
      mountIfValid(payload);
    });
  }

  tryMountFromStorage();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) {
      return;
    }
    const nv = changes[STORAGE_KEY].newValue;
    if (!nv) {
      return;
    }
    mountIfValid(nv);
  });
})();
