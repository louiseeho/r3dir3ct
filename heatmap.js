const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatHour12(hour) {
  const h24 = Math.max(0, Math.min(23, hour));
  const pm = h24 >= 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const suffix = pm ? "pm" : "am";
  return `${h12}${suffix}`;
}

/**
 * @param {HTMLElement | null | undefined} el
 */
function hideHeatmapTooltip(el) {
  if (!el) {
    return;
  }
  el.classList.remove("heatmap-tooltip-visible");
  delete el.dataset.hmHit;
  el.innerHTML = "";
}

/**
 * @param {HTMLElement} el
 * @param {string} clock
 * @param {string} day
 * @param {number} n
 */
function showHeatmapTooltip(el, clock, day, n) {
  el.innerHTML =
    `<div class="heatmap-tooltip-title">${clock} · ${day}</div>` +
    `<div class="heatmap-tooltip-sub">` +
    `<span class="val">${n}</span> redirect attempt${n === 1 ? "" : "s"} in this slot` +
    `</div>`;

  el.classList.add("heatmap-tooltip-visible");
}

/**
 * @param {HTMLElement} el
 * @param {number} clientX
 * @param {number} clientY
 */
function placeHeatmapTooltip(el, clientX, clientY) {
  const parent = el.offsetParent instanceof HTMLElement ? el.offsetParent : document.documentElement;
  const pr = parent.getBoundingClientRect();
  const offset = 14;
  const margin = 10;
  const scrollLeft = parent instanceof HTMLElement ? parent.scrollLeft : 0;
  const scrollTop = parent instanceof HTMLElement ? parent.scrollTop : 0;

  let x = Math.round(clientX - pr.left + scrollLeft + offset);
  let y = Math.round(clientY - pr.top + scrollTop + offset);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;

    const maxW = parent instanceof HTMLElement ? parent.clientWidth : window.innerWidth;
    const maxH = parent instanceof HTMLElement ? parent.clientHeight : window.innerHeight;
    if (nx + r.width > maxW - margin) {
      nx = maxW - r.width - margin;
    }
    if (ny + r.height > maxH - margin) {
      ny = maxH - r.height - margin;
    }
    nx = Math.max(margin, nx);
    ny = Math.max(margin, ny);
    el.style.left = `${Math.round(nx)}px`;
    el.style.top = `${Math.round(ny)}px`;
  });
}

/**
 * Render 7 rows × 24 cols (hours as columns — row = dayOfWeek).
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} grid from getHeatmapData
 * @param {HTMLElement | null} [tooltipEl] custom hover tooltip (instant vs native title delay)
 */
export function renderHeatmap(canvas, grid, tooltipEl) {
  const CELL = 13;
  const GAP = 1;
  const COLS = 24;
  const ROWS = 7;
  const w = COLS * (CELL + GAP) + GAP;
  const h = ROWS * (CELL + GAP) + GAP;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const gridLine = "#30363d";
  const emptyCell = "#0d1117";

  ctx.fillStyle = gridLine;
  ctx.fillRect(0, 0, w, h);

  let max = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      max = Math.max(max, grid[r]?.[c] ?? 0);
    }
  }

  for (let dow = 0; dow < ROWS; dow++) {
    for (let hour = 0; hour < COLS; hour++) {
      const n = grid[dow]?.[hour] ?? 0;
      const alpha = max > 0 ? n / max : 0;
      const x = GAP + hour * (CELL + GAP);
      const y = GAP + dow * (CELL + GAP);
      if (alpha > 0) {
        ctx.fillStyle = `rgba(126, 231, 135, ${alpha})`;
      } else {
        ctx.fillStyle = emptyCell;
      }
      ctx.fillRect(x, y, CELL, CELL);
    }
  }

  canvas._heatmapMeta = { grid, max };

  canvas.removeAttribute("title");

  canvas.onmousemove = (e) => {
    const meta = canvas._heatmapMeta;
    if (!meta) {
      hideHeatmapTooltip(tooltipEl);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      hideHeatmapTooltip(tooltipEl);
      return;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const hour = Math.floor((mx - GAP) / (CELL + GAP));
    const dow = Math.floor((my - GAP) / (CELL + GAP));

    if (!tooltipEl) {
      return;
    }

    if (hour < 0 || hour >= COLS || dow < 0 || dow >= ROWS) {
      hideHeatmapTooltip(tooltipEl);
      return;
    }
    const n = meta.grid[dow]?.[hour] ?? 0;
    const day = DAY_NAMES[dow] || "day";
    const clock = formatHour12(hour);

    const hitKey = `${dow}:${hour}`;
    if (tooltipEl.dataset.hmHit !== hitKey) {
      tooltipEl.dataset.hmHit = hitKey;
      showHeatmapTooltip(tooltipEl, clock, day, n);
    }
    placeHeatmapTooltip(tooltipEl, e.clientX, e.clientY);
  };

  canvas.onmouseleave = () => {
    hideHeatmapTooltip(tooltipEl);
  };
}

/**
 * @param {number[][]} grid
 */
export function formatPeakLine(grid) {
  let max = 0;
  let dow = 2;
  let hour = 14;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = grid[d]?.[h] ?? 0;
      if (v > max) {
        max = v;
        dow = d;
        hour = h;
      }
    }
  }
  const dayName = DAY_NAMES[dow];
  const t = formatHour12(hour);
  return max > 0 ? `peak: ${dayName} ${t} (${max} attempt${max === 1 ? "" : "s"})` : `peak: —`;
}
