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
 * Render 7 rows × 24 cols (hours as columns — row = dayOfWeek).
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} grid from getHeatmapData
 */
export function renderHeatmap(canvas, grid) {
  const CELL = 10;
  const GAP = 1;
  const COLS = 24;
  const ROWS = 7;
  const w = COLS * (CELL + GAP) + GAP;
  const h = ROWS * (CELL + GAP) + GAP;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "transparent";
  ctx.clearRect(0, 0, w, h);

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
        ctx.fillStyle = "transparent";
      }
      ctx.fillRect(x, y, CELL, CELL);
    }
  }

  canvas._heatmapMeta = { grid, max };

  canvas.onmousemove = (e) => {
    const meta = canvas._heatmapMeta;
    if (!meta) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hour = Math.floor((mx - GAP) / (CELL + GAP));
    const dow = Math.floor((my - GAP) / (CELL + GAP));
    if (hour < 0 || hour >= COLS || dow < 0 || dow >= ROWS) {
      canvas.title = "";
      return;
    }
    const n = meta.grid[dow]?.[hour] ?? 0;
    const day = DAY_NAMES[dow] || "day";
    const clock = formatHour12(hour);
    canvas.title = `${clock} ${day} — ${n} attempt${n === 1 ? "" : "s"}`;
  };

  canvas.onmouseleave = () => {
    canvas.title = "";
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
