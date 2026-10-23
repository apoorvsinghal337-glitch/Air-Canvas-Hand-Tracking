
/*
 AIR CANVAS AI V7
 Made by Apoorv Singhal
 Part 1 of 3
*/

(() => {
"use strict";

const $ = id => document.getElementById(id);

const video = $("video");
const board = $("board");
const wrap = $("boardWrap");

if (!video || !board || !wrap) {
  alert("Air Canvas: Required HTML elements missing");
  return;
}

const ctx = board.getContext("2d", {
  willReadFrequently: true
});

const W = board.width;
const H = board.height;

const cameraCanvas = $("cameraMarks");
const cam = cameraCanvas
  ? cameraCanvas.getContext("2d")
  : null;

const state = {
  stream: null,
  hands: null,
  running: false,
  starting: false,
  frame: -1,

  gesture: "NONE",
  candidate: "NONE",
  candidateAt: 0,
  lastSeen: 0,
  point: null,

  stroke: null,
  undo: [],
  redo: [],

  color: "#00cfe8",
  brush: 6,
  eraser: 65,
  auto: true,
  dark: false,

  menu: false,
  page: "main",
  hoverKey: null,
  hoverAt: 0,
  pinchAt: 0,
  pinchConsumed: false,
  fistAt: 0,
  palmAt: 0,
  lastClosed: performance.now(),
  menuBusyUntil: 0,

  fpsAt: performance.now(),
  fpsFrames: 0
};

const colors = [
  ["Cyan", "#00cfe8"],
  ["Pink", "#ff4f9a"],
  ["Purple", "#a78bfa"],
  ["Yellow", "#facc15"],
  ["Green", "#43e69a"],
  ["White", "#ffffff"],
  ["Black", "#111827"],
  ["Rainbow", "rainbow"],
  ["Neon", "neon"]
];

const put = (id, value) => {
  if ($(id)) $(id).textContent = String(value);
};

const status = text => put("status", text);

const mode = text => {
  put("mode", text);
  put("gesture", "Gesture: " + text);
};

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function labels() {
  put("brushValue", state.brush);
  put("eraserValue", state.eraser);
  put(
    "brushLabel",
    state.color + " · " + state.brush + "px"
  );
}

function snapshot() {
  state.undo.push(ctx.getImageData(0, 0, W, H));

  if (state.undo.length > 10) {
    state.undo.shift();
  }

  state.redo = [];
}

function brushStyle(erase, color, size) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;

  if (erase) {
    ctx.globalCompositeOperation = "destination-out";
    return;
  }

  if (color === "rainbow") {
    ctx.strokeStyle =
      `hsl(${performance.now() / 16 % 360} 100% 50%)`;
  } else if (color === "neon") {
    ctx.strokeStyle = "#57f9ff";
    ctx.shadowColor = "#00eaff";
    ctx.shadowBlur = 12;
  } else {
    ctx.strokeStyle = color;
  }
}

function detectShape(points) {
  if (points.length < 7) return null;

  const first = points[0];
  const last = points[points.length - 1];

  const direct = distance(first, last);

  let travel = 0;

  for (let i = 1; i < points.length; i++) {
    travel += distance(
      points[i - 1],
      points[i]
    );
  }

  if (travel < 48) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Automatic straight-line correction
  if (direct > 42 && travel / direct < 1.9) {
    let error = 0;

    for (const p of points) {
      error += Math.abs(
        (last.y - first.y) * p.x -
        (last.x - first.x) * p.y +
        last.x * first.y -
        last.y * first.x
      ) / direct;
    }

    error /= points.length;

    if (error < Math.max(17, direct * 0.13)) {
      return {
        type: "line",
        a: first,
        b: last
      };
    }
  }

  if (width < 38 || height < 38) return null;

  if (direct > Math.max(width, height) * 0.38) {
    return null;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = width / 2;
  const ry = height / 2;

  // Circle / ellipse recognition
  const radii = points.map(p =>
    Math.hypot(
      (p.x - cx) / rx,
      (p.y - cy) / ry
    )
  );

  const mean =
    radii.reduce((sum, value) => sum + value, 0)
    / radii.length;

  const variation = Math.sqrt(
    radii.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    ) / radii.length
  );

  if (variation < 0.27) {
    return {
      type: "ellipse",
      cx, cy, rx, ry
    };
  }

  // Rectangle recognition
  const tolerance = Math.max(
    12,
    Math.min(width, height) * 0.15
  );

  const nearEdges = points.filter(p =>
    Math.min(
      Math.abs(p.x - minX),
      Math.abs(p.x - maxX),
      Math.abs(p.y - minY),
      Math.abs(p.y - maxY)
    ) < tolerance
  ).length / points.length;

  if (nearEdges > 0.77) {
    return {
      type: "rectangle",
      x: minX,
      y: minY,
      w: width,
      h: height
    };
  }

  return null;
}

function finishStroke() {
  const stroke = state.stroke;

  if (!stroke) return;

  if (!stroke.erase && state.auto) {
    const shape = detectShape(stroke.points);

    if (shape) {
      ctx.putImageData(stroke.before, 0, 0);

      ctx.save();

      brushStyle(
        false,
        stroke.color,
        stroke.size
      );

      ctx.beginPath();

      if (shape.type === "line") {
        ctx.moveTo(shape.a.x, shape.a.y);
        ctx.lineTo(shape.b.x, shape.b.y);
      } else if (shape.type === "ellipse") {
        ctx.ellipse(
          shape.cx,
          shape.cy,
          shape.rx,
          shape.ry,
          0,
          0,
          Math.PI * 2
        );
      } else if (shape.type === "rectangle") {
        ctx.rect(
          shape.x,
          shape.y,
          shape.w,
          shape.h
        );
      }

      ctx.stroke();
      ctx.restore();

      status("Auto corrected: " + shape.type);
    }
  }

  state.stroke = null;
}

function draw(x, y, erase) {
  let stroke = state.stroke;

  if (!stroke || stroke.erase !== erase) {
    finishStroke();
    snapshot();

    stroke = {
      erase,
      color: state.color,
      size: state.brush,
      points: [{ x, y }],
      before: ctx.getImageData(0, 0, W, H)
    };

    state.stroke = stroke;
    return;
  }

  const previous =
    stroke.points[stroke.points.length - 1];

  const gap = distance(previous, { x, y });

  if (gap > W * 0.18) {
    finishStroke();
    return;
  }

  const alpha = gap > 20 ? 0.7 : 0.38;

  const nx =
    previous.x + (x - previous.x) * alpha;

  const ny =
    previous.y + (y - previous.y) * alpha;

  ctx.save();

  brushStyle(
    erase,
    stroke.color,
    erase ? state.eraser : stroke.size
  );

  ctx.beginPath();
  ctx.moveTo(previous.x, previous.y);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  ctx.restore();

  stroke.points.push({ x: nx, y: ny });
}

function undo() {
  finishStroke();

  if (!state.undo.length) return;

  state.redo.push(
    ctx.getImageData(0, 0, W, H)
  );

  ctx.putImageData(state.undo.pop(), 0, 0);
}

function redo() {
  finishStroke();

  if (!state.redo.length) return;

  state.undo.push(
    ctx.getImageData(0, 0, W, H)
  );

  ctx.putImageData(state.redo.pop(), 0, 0);
}

function clearBoard() {
  finishStroke();
  snapshot();
  ctx.clearRect(0, 0, W, H);
}

function exportCanvas() {
  const canvas = document.createElement("canvas");

  canvas.width = W;
  canvas.height = H;

  const g = canvas.getContext("2d");

  g.fillStyle = state.dark
    ? "#101727"
    : "#ffffff";

  g.fillRect(0, 0, W, H);
  g.drawImage(board, 0, 0);

  return canvas;
}

function savePNG() {
  finishStroke();

  const link = document.createElement("a");

  link.download = "AirCanvas-Apoorv.png";
  link.href = exportCanvas().toDataURL("image/png");

  document.body.appendChild(link);
  link.click();
  link.remove();

  status("PNG download requested");
}

function saveGallery() {
  finishStroke();

  try {
    const canvas = document.createElement("canvas");

    canvas.width = 480;
    canvas.height = 320;

    canvas.getContext("2d").drawImage(
      exportCanvas(),
      0, 0, 480, 320
    );

    const gallery = JSON.parse(
      localStorage.getItem("aircanvas-gallery") || "[]"
    );

    gallery.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      image: canvas.toDataURL("image/jpeg", 0.72)
    });

    localStorage.setItem(
      "aircanvas-gallery",
      JSON.stringify(gallery.slice(0, 8))
    );

    status("Saved to Gallery");
  } catch (error) {
    status("Gallery unavailable. Use Save PNG.");
  }

// ============================================
// PART 2 OF 3
// TOUCHLESS AIR CONTROL PANEL
// ============================================

function getMenuItems() {
  const back = [["Back", "back"]];

  if (state.page === "colors") {
    return [
      ...colors.map(c => [c[0], "color:" + c[1]]),
      ...back
    ];
  }

  if (state.page === "brush") {
    return [
      ...[2, 4, 6, 9, 12, 16, 22, 32].map(
        n => [n + "px", "brush:" + n]
      ),
      ...back
    ];
  }

  if (state.page === "eraser") {
    return [
      ...[10, 20, 35, 50, 65, 80, 100, 120].map(
        n => [n + "px", "eraser:" + n]
      ),
      ...back
    ];
  }

  return [
    ["Colors", "colors"],
    ["Brush Size", "brush"],
    ["Eraser Size", "eraser"],
    ["Auto Shape", "auto"],
    ["Undo", "undo"],
    ["Redo", "redo"],
    ["Save PNG", "save"],
    ["Save Gallery", "gallery"],
    ["Clear Board", "clear"],
    ["Background", "background"],
    ["Close Menu", "close"]
  ];
}

function renderMenu() {
  const grid = $("menuGrid");

  if (!grid) return;

  grid.innerHTML = "";

  put(
    "menuTitle",
    state.page === "main"
      ? "AIR CONTROL PANEL"
      : state.page.toUpperCase()
  );

  for (const [label, action] of getMenuItems()) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "menu-item";
    button.dataset.action = action;
    button.textContent = label;

    button.style.position = "relative";
    button.style.minHeight = "48px";

    const progress = document.createElement("span");

    progress.className = "progress";

    progress.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 0;
      height: 4px;
      background: #22d3ee;
      pointer-events: none;
    `;

    button.appendChild(progress);

    button.addEventListener("click", () => {
      selectTool(action);
    });

    grid.appendChild(button);
  }

  state.hoverKey = null;
  state.hoverAt = 0;
}

function openMenu() {
  const now = performance.now();

  if (state.menu) return;

  // Prevent accidental reopening
  if (now - state.lastClosed < 2000) return;

  finishStroke();

  state.menu = true;
  state.page = "main";
  state.palmAt = 0;
  state.pinchAt = 0;
  state.pinchConsumed = false;

  const menu = $("menu");

  if (menu) {
    menu.classList.add("open");
    menu.style.display = "block";
    menu.style.pointerEvents = "auto";
  }

  renderMenu();

  status(
    "Point to a tool. Hold 0.8s or pinch 0.3s."
  );
}

function closeMenu() {
  state.menu = false;
  state.lastClosed = performance.now();

  state.fistAt = 0;
  state.palmAt = 0;
  state.hoverKey = null;
  state.hoverAt = 0;
  state.pinchAt = 0;
  state.pinchConsumed = false;

  const menu = $("menu");

  if (menu) {
    menu.classList.remove("open");
    menu.style.display = "none";
  }

  finishStroke();

  status("Menu closed. Drawing ready.");
}

function selectTool(action) {
  const now = performance.now();

  // Stop duplicate selections
  state.menuBusyUntil = now + 650;

  state.hoverKey = null;
  state.hoverAt = 0;
  state.pinchConsumed = true;

  if (action === "close") {
    closeMenu();
    return;
  }

  if (action === "back") {
    state.page = "main";
    renderMenu();
    return;
  }

  if (["colors", "brush", "eraser"].includes(action)) {
    state.page = action;
    renderMenu();
    return;
  }

  if (action === "undo") undo();
  if (action === "redo") redo();
  if (action === "clear") clearBoard();
  if (action === "save") savePNG();
  if (action === "gallery") saveGallery();

  if (action === "auto") {
    state.auto = !state.auto;

    if ($("autoShape")) {
      $("autoShape").checked = state.auto;
    }
  }

  if (action === "background") {
    state.dark = !state.dark;

    wrap.classList.toggle("dark", state.dark);

    if ($("background")) {
      $("background").value =
        state.dark ? "dark" : "white";
    }
  }

  if (action.startsWith("color:")) {
    state.color = action.slice(6);
  }

  if (action.startsWith("brush:")) {
    state.brush = Number(action.slice(6));

    if ($("brushSize")) {
      $("brushSize").value = state.brush;
    }
  }

  if (action.startsWith("eraser:")) {
    state.eraser = Number(action.slice(7));

    if ($("eraserSize")) {
      $("eraserSize").value = state.eraser;
    }
  }

  labels();

  status("Selected: " + action);

  // Return to main menu after selection
  if (state.page !== "main") {
    state.page = "main";
    renderMenu();
  }
}

// ============================================
// FINGER DETECTION
// ============================================

function fingerUp(hand, tip, pip, base) {
  const tipDistance = distance(
    hand[tip],
    hand[base]
  );

  const pipDistance = distance(
    hand[pip],
    hand[base]
  );

  return tipDistance > pipDistance * 1.10;
}

function classifyGesture(hand) {
  const index = fingerUp(hand, 8, 6, 5);
  const middle = fingerUp(hand, 12, 10, 9);
  const ring = fingerUp(hand, 16, 14, 13);
  const pinky = fingerUp(hand, 20, 18, 17);

  if (index && middle && ring && pinky) {
    return "PALM";
  }

  if (index && middle && ring && !pinky) {
    return "ERASE";
  }

  if (index && middle && !ring && !pinky) {
    return "PAUSE";
  }

  if (index && !middle && !ring && !pinky) {
    return "DRAW";
  }

  if (!index && !middle && !ring && !pinky) {
    return "FIST";
  }

  return "PAUSE";
}

// ============================================
// LIVE WHITEBOARD FINGER CURSOR
// ============================================

function updateCursor(x, y, erase) {
  const cursor = $("cursor");

  if (!cursor) return;

  const rect = wrap.getBoundingClientRect();

  cursor.style.position = "absolute";
  cursor.style.display = "block";
  cursor.style.pointerEvents = "none";
  cursor.style.zIndex = "30";

  cursor.style.transform =
    "translate(-50%, -50%)";

  cursor.style.left =
    (x / W * 100) + "%";

  cursor.style.top =
    (y / H * 100) + "%";

  const size = erase
    ? Math.max(
        20,
        state.eraser / W * rect.width
      )
    : 20;

  cursor.style.width = size + "px";
  cursor.style.height = size + "px";
  cursor.style.borderRadius = "50%";

  cursor.style.border = erase
    ? "2px solid #fb7185"
    : "2px solid #16a34a";

  cursor.style.background = erase
    ? "#fb718544"
    : "#22c55e44";
}

// ============================================
// MENU FINGER POSITION MAPPING
// ============================================

function getMenuTarget(x, y) {
  const grid = $("menuGrid");
  const menu = $("menu");

  if (!grid || !menu) return null;

  const rect = menu.getBoundingClientRect();

  // Map finger position to entire menu overlay
  const screenX =
    rect.left + (x / W) * rect.width;

  const screenY =
    rect.top + (y / H) * rect.height;

  const element = document.elementFromPoint(
    screenX,
    screenY
  );

  let button = element?.closest(".menu-item");

  if (button && grid.contains(button)) {
    return button;
  }

  // Fallback for small mobile screens
  let nearest = null;
  let nearestDistance = Infinity;

  const buttons = grid.querySelectorAll(
    ".menu-item"
  );

  for (const b of buttons) {
    const r = b.getBoundingClientRect();

    const centerX = r.left + r.width / 2;
    const centerY = r.top + r.height / 2;

    const d = Math.hypot(
      screenX - centerX,
      screenY - centerY
    );

    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = b;
    }
  }

  if (nearestDistance < 100) {
    return nearest;
  }

  return null;
}

// ============================================
// PINCH + HOVER SELECTION
// ============================================

function handleMenuSelection(
  hand,
  x,
  y,
  now
) {
  // Fist for 0.85 seconds closes menu
  if (state.gesture === "FIST") {
    if (!state.fistAt) {
      state.fistAt = now;
    }

    if (now - state.fistAt >= 850) {
      closeMenu();
    }

    return;
  }

  state.fistAt = 0;

  if (now < state.menuBusyUntil) {
    return;
  }

  const target = getMenuTarget(x, y);

  const key = target
    ? target.dataset.action
    : null;

  const buttons = $("menuGrid")
    ?.querySelectorAll(".menu-item") || [];

  for (const button of buttons) {
    const active = button === target;

    button.classList.toggle(
      "hover",
      active
    );

    button.style.borderColor = active
      ? "#22d3ee"
      : "";

    const bar = button.querySelector(
      ".progress"
    );

    if (!active && bar) {
      bar.style.width = "0";
    }
  }

  if (key !== state.hoverKey) {
    state.hoverKey = key;
    state.hoverAt = now;
    state.pinchAt = 0;
    state.pinchConsumed = false;
  }

  if (!key) return;

  const progress = target.querySelector(
    ".progress"
  );

  if (progress) {
    const percent = clamp(
      (now - state.hoverAt) / 800 * 100,
      0,
      100
    );

    progress.style.width = percent + "%";
  }

  // Pinch: thumb tip + index tip
  const pinch = distance(
    hand[4],
    hand[8]
  ) < distance(
    hand[5],
    hand[9]
  ) * 0.48;

  if (pinch) {
    if (!state.pinchAt) {
      state.pinchAt = now;
    }

    // Confirm after 0.3 seconds
    if (
      !state.pinchConsumed &&
      now - state.pinchAt >= 300
    ) {
      selectTool(key);
      return;
    }
  } else {
    state.pinchAt = 0;
    state.pinchConsumed = false;
  }

  // Alternative: hold finger for 0.8 seconds
  if (now - state.hoverAt >= 800) {
    selectTool(key);
  }
}

// ============================================
// PART 3 OF 3
// CAMERA + AI HAND TRACKING
// Made by Apoorv Singhal
// ============================================

// Process every detected hand frame
function onHandResults(result) {
  const now = performance.now();

  // Clear previous camera tracking markers
  if (cam && cameraCanvas) {
    cam.clearRect(
      0,
      0,
      cameraCanvas.width,
      cameraCanvas.height
    );
  }

  const hand = result.multiHandLandmarks?.[0];

  // When hand is temporarily lost
  if (!hand) {
    if (now - state.lastSeen > 420) {
      finishStroke();

      state.point = null;
      state.gesture = "NONE";
      state.candidate = "NONE";
      state.palmAt = 0;
      state.fistAt = 0;
      state.pinchAt = 0;

      mode("NO HAND");

      const cursor = $("cursor");

      if (cursor) {
        cursor.style.display = "none";
      }
    }

    return;
  }

  state.lastSeen = now;

  // Detect finger gesture
  const detectedGesture = classifyGesture(hand);

  // Stabilize gesture recognition
  if (detectedGesture !== state.candidate) {
    state.candidate = detectedGesture;
    state.candidateAt = now;
  }

  if (
    detectedGesture !== state.gesture &&
    now - state.candidateAt >= 160
  ) {
    finishStroke();

    state.gesture = detectedGesture;
    state.palmAt = 0;
    state.fistAt = 0;
  }

  // Mirror camera coordinates to whiteboard
  const rawX = clamp(
    (1 - hand[8].x) * W,
    0,
    W
  );

  const rawY = clamp(
    hand[8].y * H,
    0,
    H
  );

  // Adaptive finger smoothing
  if (!state.point) {
    state.point = {
      x: rawX,
      y: rawY
    };
  } else {
    const gap = distance(
      state.point,
      { x: rawX, y: rawY }
    );

    const alpha = gap > 22 ? 0.72 : 0.43;

    state.point.x +=
      (rawX - state.point.x) * alpha;

    state.point.y +=
      (rawY - state.point.y) * alpha;
  }

  // Live cursor on separate whiteboard
  updateCursor(
    state.point.x,
    state.point.y,
    state.gesture === "ERASE"
  );

  // Green tracking marker in camera preview
  if (cam && cameraCanvas) {
    cam.beginPath();

    cam.arc(
      (1 - hand[8].x) * cameraCanvas.width,
      hand[8].y * cameraCanvas.height,
      8,
      0,
      Math.PI * 2
    );

    cam.fillStyle = "#22c55e";
    cam.fill();
  }

  // MENU MODE
  // Prevent drawing while menu is open
  if (state.menu) {
    mode("MENU");

    handleMenuSelection(
      hand,
      state.point.x,
      state.point.y,
      now
    );

    return;
  }

  // OPEN MENU
  // Five fingers held for 1.5 seconds
  if (state.gesture === "PALM") {
    finishStroke();

    const cooldownFinished =
      now - state.lastClosed >= 2000;

    if (cooldownFinished) {
      if (!state.palmAt) {
        state.palmAt = now;
      }

      if (now - state.palmAt >= 1500) {
        openMenu();
      }
    }

    mode("MENU HOLD");
    return;
  }

  state.palmAt = 0;

  // DRAW WITH INDEX FINGER
  if (state.gesture === "DRAW") {
    mode("DRAW");

    draw(
      state.point.x,
      state.point.y,
      false
    );
  }

  // ERASE WITH THREE FINGERS
  else if (state.gesture === "ERASE") {
    mode("ERASE");

    draw(
      state.point.x,
      state.point.y,
      true
    );
  }

  // PAUSE WITH TWO FINGERS OR FIST
  else {
    finishStroke();
    mode("PAUSE");
  }

  // Tracking FPS indicator
  state.fpsFrames++;

  if (now - state.fpsAt > 1200) {
    const fps = Math.round(
      state.fpsFrames * 1000 /
      (now - state.fpsAt)
    );

    put(
      "fps",
      "Tracking FPS: " + fps
    );

    state.fpsFrames = 0;
    state.fpsAt = now;
  }
}

// ============================================
// LOAD MEDIAPIPE AI LIBRARY
// ============================================

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = url;

    script.onload = () => resolve();

    script.onerror = () => {
      reject(
        new Error("Unable to load: " + url)
      );
    };

    document.head.appendChild(script);
  });
}

async function loadAI() {
  if (window.Hands) {
    return window.Hands;
  }

  const sources = [
    "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js",
    "https://unpkg.com/@mediapipe/hands@0.4/hands.js"
  ];

  for (const url of sources) {
    try {
      await loadScript(url);

      if (window.Hands) {
        return window.Hands;
      }
    } catch (error) {
      console.warn(
        "MediaPipe CDN failed:",
        error
      );
    }
  }

  throw new Error(
    "MediaPipe could not load. Check internet connection."
  );
}

// ============================================
// CAMERA TRACKING LOOP
// ============================================

async function trackingLoop() {
  if (!state.running) return;

  try {
    if (
      video.readyState >= 2 &&
      video.currentTime !== state.frame
    ) {
      state.frame = video.currentTime;

      await state.hands.send({
        image: video
      });
    }
  } catch (error) {
    state.running = false;

    status(
      "Tracking Error: " + error.message
    );

    const startButton = $("start");

    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = "Retry Camera";
    }

    return;
  }

  if (state.running) {
    requestAnimationFrame(trackingLoop);
  }
}

// ============================================
// START CAMERA
// ============================================

async function startCamera() {
  if (state.running || state.starting) {
    return;
  }

  state.starting = true;

  const startButton = $("start");

  if (startButton) {
    startButton.disabled = true;
  }

  try {
    status("Starting camera...");

    state.stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

    video.srcObject = state.stream;

    await video.play();

    status(
      "Camera working. Loading AI..."
    );

    const Hands = await loadAI();

    state.hands = new Hands({
      locateFile: file =>
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/" +
        file
    });

    state.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.45
    });

    state.hands.onResults(
      onHandResults
    );

    state.running = true;
    state.frame = -1;

    // Reset gesture state
    state.gesture = "NONE";
    state.candidate = "NONE";
    state.point = null;
    state.palmAt = 0;
    state.fistAt = 0;

    // Prevent immediate menu opening
    state.lastClosed = performance.now();

    status(
      "AI Ready! Show your hand."
    );

    if (startButton) {
      startButton.textContent =
        "Camera Running";
    }

    requestAnimationFrame(
      trackingLoop
    );

  } catch (error) {
    status(
      "ERROR: " + error.message
    );

    state.stream?.getTracks()
      .forEach(track => track.stop());

    state.stream = null;

    if (startButton) {
      startButton.disabled = false;
      startButton.textContent =
        "Retry Camera";
    }

  } finally {
    state.starting = false;
  }
}

// ============================================
// STOP CAMERA
// ============================================

function stopCamera() {
  state.running = false;

  finishStroke();

  state.stream?.getTracks()
    .forEach(track => track.stop());

  state.stream = null;
  video.srcObject = null;

  try {
    state.hands?.close?.();
  } catch (error) {
    console.warn(error);
  }

  state.hands = null;

  const startButton = $("start");

  if (startButton) {
    startButton.disabled = false;
    startButton.textContent =
      "Start Camera";
  }

  mode("OFFLINE");
  status("Camera stopped");
}

// ============================================
// BUTTON EVENT LISTENERS
// ============================================

if ($("start")) {
  $("start").addEventListener(
    "click",
    startCamera
  );
}

if ($("stop")) {
  $("stop").addEventListener(
    "click",
    stopCamera
  );
}

const buttonActions = [
  ["undo", undo],
  ["redo", redo],
  ["clear", clearBoard],
  ["save", savePNG],
  ["gallerySave", saveGallery]
];

for (const [id, action] of buttonActions) {
  const button = $(id);

  if (button) {
    button.addEventListener(
      "click",
      action
    );
  }
}

// Manual backup menu button
if ($("openMenu")) {
  $("openMenu").addEventListener(
    "click",
    () => {
      if (state.menu) {
        closeMenu();
      } else {
        // Allow manual opening
        state.lastClosed = 0;
        openMenu();
      }
    }
  );
}

// Brush size slider
if ($("brushSize")) {
  $("brushSize").addEventListener(
    "input",
    event => {
      state.brush =
        Number(event.target.value);

      labels();
    }
  );
}

// Eraser size slider
if ($("eraserSize")) {
  $("eraserSize").addEventListener(
    "input",
    event => {
      state.eraser =
        Number(event.target.value);

      labels();
    }
  );
}

// Auto-shape checkbox
if ($("autoShape")) {
  $("autoShape").addEventListener(
    "change",
    event => {
      state.auto =
        event.target.checked;
    }
  );
}

// Background selector
if ($("background")) {
  $("background").addEventListener(
    "change",
    event => {
      state.dark =
        event.target.value === "dark";

      wrap.classList.toggle(
        "dark",
        state.dark
      );
    }
  );
}

// ============================================
// CLEANUP WHEN PAGE CLOSES
// ============================================

window.addEventListener(
  "pagehide",
  () => {
    state.running = false;

    state.stream?.getTracks()
      .forEach(track => track.stop());
  }
);

// ============================================
// INITIALIZE AIR CANVAS V7
// ============================================

wrap.style.position = "relative";

const menuElement = $("menu");

if (menuElement) {
  menuElement.style.display = "none";
  menuElement.style.zIndex = "40";
}

// Emergency close button
if (menuElement) {
  const closeButton =
    document.createElement("button");

  closeButton.type = "button";
  closeButton.textContent = "✕ Close Menu";

  closeButton.style.cssText = `
    position: sticky;
    top: 0;
    z-index: 100;
    display: block;
    margin: 0 0 12px auto;
    padding: 10px 16px;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 10px;
    font-weight: bold;
  `;

  closeButton.addEventListener(
    "click",
    closeMenu
  );

  menuElement.prepend(closeButton);
}

labels();

status(
  "Air Canvas AI V7 Ready. Press Start Camera."
);

// ============================================
// END OF AIR CANVAS AI V7
// ============================================

})();



