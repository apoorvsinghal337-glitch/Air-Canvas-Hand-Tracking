
"use strict";

/* AIR CANVAS AI V5
   Made by Apoorv Singhal
   Camera + Separate Whiteboard
   Touchless Drawing & Tools
*/

const $ = id => document.getElementById(id);

const video = $("video");
const board = $("board");
const wrap = $("boardWrap");
const statusEl = $("status");

const ctx = board.getContext("2d", {
  willReadFrequently: true
});

const W = board.width;
const H = board.height;

const cameraCanvas = $("cameraMarks");
const cam = cameraCanvas
  ? cameraCanvas.getContext("2d")
  : null;

let stream = null;
let hands = null;
let running = false;
let starting = false;
let lastVideoTime = -1;

let color = "#00cfe8";
let brushSize = 6;
let eraserSize = 65;
let autoShape = true;
let darkBoard = false;

let stroke = null;
let undoStack = [];
let redoStack = [];

let rawGesture = "NONE";
let gesture = "NONE";
let gestureSince = 0;
let candidateSince = 0;

let lastHandTime = 0;
let cursorX = 0;
let cursorY = 0;
let cursorReady = false;

let menuOpen = false;
let menuLocked = false;
let lastMenuClose = 0;
let palmReady = false;
let menuIndex = 0;
let menuItems = [];
let lastSwipeX = null;
let lastSwipeTime = 0;
let selectedSince = 0;
let fistSince = 0;

let fpsFrames = 0;
let fpsStart = performance.now();

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

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function status(text) {
  if (statusEl) statusEl.textContent = text;
}

function mode(text) {
  setText("mode", text);
  setText("gesture", "Gesture: " + text);
}

function labels() {
  setText("brushValue", brushSize);
  setText("eraserValue", eraserSize);
  setText("brushLabel", color + " · " + brushSize + "px");
}

function snapshot() {
  undoStack.push(ctx.getImageData(0, 0, W, H));
  if (undoStack.length > 12) undoStack.shift();
  redoStack = [];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function detectShape(points) {
  if (points.length < 8) return null;

  const a = points[0];
  const b = points[points.length - 1];
  const direct = distance(a, b);
  const travel = pathLength(points);

  if (travel < 45) return null;

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  // AUTO STRAIGHT LINE
  if (direct > 45 && travel / direct < 1.65) {
    let deviation = 0;

    for (const p of points) {
      deviation += Math.abs(
        (b.y - a.y) * p.x -
        (b.x - a.x) * p.y +
        b.x * a.y -
        b.y * a.x
      ) / direct;
    }

    deviation /= points.length;

    if (deviation < Math.max(18, direct * 0.12)) {
      return { type: "line", a, b };
    }
  }

  if (width < 35 || height < 35) return null;

  const closed = direct < Math.max(width, height) * 0.38;

  if (!closed) return null;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = width / 2;
  const ry = height / 2;

  // AUTO CIRCLE / ELLIPSE
  const radii = points.map(p =>
    Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
  );

  const mean = radii.reduce((a, b) => a + b, 0)
    / radii.length;

  const variation = Math.sqrt(
    radii.reduce((s, r) => s + (r - mean) ** 2, 0)
    / radii.length
  );

  if (variation < 0.25) {
    return { type: "ellipse", cx, cy, rx, ry };
  }

  // AUTO RECTANGLE
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

  if (nearEdges > 0.78) {
    return {
      type: "rectangle",
      x: minX,
      y: minY,
      width,
      height
    };
  }

  return null;
}

function applyBrush(erase, size, selectedColor) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;

  if (erase) {
    ctx.globalCompositeOperation = "destination-out";
    return;
  }

  if (selectedColor === "rainbow") {
    ctx.strokeStyle =
      `hsl(${performance.now() / 18 % 360} 100% 55%)`;
  } else if (selectedColor === "neon") {
    ctx.strokeStyle = "#57f9ff";
    ctx.shadowColor = "#00eaff";
    ctx.shadowBlur = 12;
  } else {
    ctx.strokeStyle = selectedColor;
  }
}

function finishStroke() {
  if (!stroke) return;

  if (
    stroke.type === "draw" &&
    autoShape &&
    stroke.points.length >= 8
  ) {
    const shape = detectShape(stroke.points);

    if (shape) {
      ctx.putImageData(stroke.before, 0, 0);

      ctx.save();
      applyBrush(false, stroke.size, stroke.color);
      ctx.beginPath();

      if (shape.type === "line") {
        ctx.moveTo(shape.a.x, shape.a.y);
        ctx.lineTo(shape.b.x, shape.b.y);
      }

      if (shape.type === "ellipse") {
        ctx.ellipse(
          shape.cx, shape.cy,
          shape.rx, shape.ry,
          0, 0, Math.PI * 2
        );
      }

      if (shape.type === "rectangle") {
        ctx.rect(
          shape.x, shape.y,
          shape.width, shape.height
        );
      }

      ctx.stroke();
      ctx.restore();

      status("Auto corrected: " + shape.type);
    }
  }

  stroke = null;
}

function drawAt(x, y, erase) {
  const type = erase ? "erase" : "draw";

  if (!stroke || stroke.type !== type) {
    finishStroke();
    snapshot();

    stroke = {
      type,
      color,
      size: brushSize,
      before: ctx.getImageData(0, 0, W, H),
      points: [{ x, y }]
    };
    return;
  }

  const previous = stroke.points.at(-1);
  const gap = distance(previous, { x, y });

  if (gap > W * 0.16) {
    finishStroke();
    return;
  }

  const alpha = gap > 18 ? 0.68 : 0.38;

  const nx = previous.x + (x - previous.x) * alpha;
  const ny = previous.y + (y - previous.y) * alpha;

  ctx.save();
  applyBrush(
    erase,
    erase ? eraserSize : brushSize,
    stroke.color
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
  if (!undoStack.length) return;

  redoStack.push(ctx.getImageData(0, 0, W, H));
  ctx.putImageData(undoStack.pop(), 0, 0);
}

function redo() {
  finishStroke();
  if (!redoStack.length) return;

  undoStack.push(ctx.getImageData(0, 0, W, H));
  ctx.putImageData(redoStack.pop(), 0, 0);
}

function clearBoard() {
  finishStroke();
  snapshot();
  ctx.clearRect(0, 0, W, H);
}

function exportCanvas() {
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;

  const c = out.getContext("2d");
  c.fillStyle = darkBoard ? "#101727" : "#ffffff";
  c.fillRect(0, 0, W, H);
  c.drawImage(board, 0, 0);

  return out;
}

function savePNG() {
  finishStroke();

  const a = document.createElement("a");
  a.href = exportCanvas().toDataURL("image/png");
  a.download = "AirCanvas-Apoorv.png";

  document.body.appendChild(a);
  a.click();
  a.remove();

  status("PNG download requested");
}

function saveGallery() {
  finishStroke();

  try {
    const image = document.createElement("canvas");
    image.width = 480;
    image.height = 320;

    image.getContext("2d").drawImage(
      exportCanvas(), 0, 0, 480, 320
    );

    const gallery = JSON.parse(
      localStorage.getItem("aircanvas-gallery") || "[]"
    );

    gallery.unshift({
      id: Date.now(),
      date: new Date().toLocaleString(),
      image: image.toDataURL("image/jpeg", 0.75)
    });

    localStorage.setItem(
      "aircanvas-gallery",
      JSON.stringify(gallery.slice(0, 8))
    );

    status("Saved to Gallery");
  } catch (error) {
    status("Gallery unavailable. Use Save PNG.");
  }
}

// TOUCHLESS CONTROL PANEL

function getMenuItems() {
  if (menuPage === "colors") {
    return colors.map(c => ({
      label: c[0],
      action: "color:" + c[1]
    })).concat([{ label: "Back", action: "back" }]);
  }

  if (menuPage === "brush") {
    return [2, 4, 6, 9, 12, 16, 22, 32]
      .map(n => ({
        label: n + "px",
        action: "brush:" + n
      }))
      .concat([{ label: "Back", action: "back" }]);
  }

  if (menuPage === "eraser") {
    return [10, 20, 35, 50, 65, 80, 100, 120]
      .map(n => ({
        label: n + "px",
        action: "eraser:" + n
      }))
      .concat([{ label: "Back", action: "back" }]);
  }

  return [
    { label: "Colors", action: "colors" },
    { label: "Brush Size", action: "brush" },
    { label: "Eraser Size", action: "eraser" },
    { label: "Auto Shape", action: "auto" },
    { label: "Undo", action: "undo" },
    { label: "Redo", action: "redo" },
    { label: "Save PNG", action: "save" },
    { label: "Save Gallery", action: "gallery" },
    { label: "Clear Board", action: "clear" },
    { label: "Background", action: "background" },
    { label: "Close Menu", action: "close" }
  ];
}

function renderMenu() {
  const grid = $("menuGrid");
  if (!grid) return;

  grid.innerHTML = "";
  menuItems = getMenuItems();
  menuIndex = 0;

  setText(
    "menuTitle",
    menuPage === "main"
      ? "AIR CONTROL PANEL"
      : menuPage.toUpperCase()
  );

  menuItems.forEach((item, i) => {
    const button = document.createElement("button");
    button.className = "menu-item";
    button.textContent = item.label;
    button.type = "button";
    button.onclick = () => selectTool(item.action);

    if (i === menuIndex) button.classList.add("hover");
    grid.appendChild(button);
  });
}

function highlightMenu() {
  document.querySelectorAll(".menu-item").forEach(
    (button, i) => {
      button.classList.toggle("hover", i === menuIndex);
      button.style.borderColor =
        i === menuIndex ? "#22d3ee" : "#334155";
      button.style.background =
        i === menuIndex ? "#164e63" : "#17243a";
    }
  );
}

function openMenu() {
  if (menuOpen || menuLocked) return;

  finishStroke();
  menuOpen = true;
  menuPage = "main";
  palmReady = false;
  lastSwipeX = null;
  selectedSince = 0;

  $("menu")?.classList.add("open");
  renderMenu();
  highlightMenu();

  status("Swipe to navigate. Pinch to select.");
}

function closeMenu() {
  menuOpen = false;
  menuLocked = true;
  lastMenuClose = performance.now();
  palmReady = false;
  lastSwipeX = null;
  selectedSince = 0;

  $("menu")?.classList.remove("open");
  finishStroke();
  status("Menu closed. Drawing ready.");
}

function selectTool(action) {
  if (action === "close") {
    closeMenu();
    return;
  }

  if (action === "back") {
    menuPage = "main";
    renderMenu();
    highlightMenu();
    return;
  }

  if (["colors", "brush", "eraser"].includes(action)) {
    menuPage = action;
    renderMenu();
    highlightMenu();
    return;
  }

  if (action === "undo") undo();
  if (action === "redo") redo();
  if (action === "clear") clearBoard();
  if (action === "save") savePNG();
  if (action === "gallery") saveGallery();

  if (action === "auto") {
    autoShape = !autoShape;
    if ($("autoShape")) $("autoShape").checked = autoShape;
  }

  if (action.startsWith("color:")) {
    color = action.slice(6);
  }

  if (action.startsWith("brush:")) {
    brushSize = Number(action.slice(6));
    if ($("brushSize")) $("brushSize").value = brushSize;
  }

  if (action.startsWith("eraser:")) {
    eraserSize = Number(action.slice(7));
    if ($("eraserSize")) $("eraserSize").value = eraserSize;
  }

  if (action === "background") {
    darkBoard = !darkBoard;
    wrap?.classList.toggle("dark", darkBoard);
    if ($("background")) {
      $("background").value = darkBoard ? "dark" : "white";
    }
  }

  labels();

  if (menuPage !== "main") {
    menuPage = "main";
    renderMenu();
    highlightMenu();
  }

  status("Tool selected: " + action);
}

// HAND GESTURES

function fingerUp(h, tip, pip, base) {
  return distance(h[tip], h[base]) >
    distance(h[pip], h[base]) * 1.18;
}

function classify(h) {
  const i = fingerUp(h, 8, 6, 5);
  const m = fingerUp(h, 12, 10, 9);
  const r = fingerUp(h, 16, 14, 13);
  const p = fingerUp(h, 20, 18, 17);

  if (i && m && r && p) return "PALM";
  if (i && m && r && !p) return "ERASE";
  if (i && m && !r && !p) return "PAUSE";
  if (i && !m && !r && !p) return "DRAW";
  if (!i && !m && !r && !p) return "FIST";

  return "PAUSE";
}

function updateCursor(x, y, erase) {
  const cursor = $("cursor");
  if (!cursor || !wrap) return;

  cursor.style.display = "block";
  cursor.style.position = "absolute";
  cursor.style.left = (x / W * 100) + "%";
  cursor.style.top = (y / H * 100) + "%";
  cursor.style.transform = "translate(-50%, -50%)";
  cursor.style.pointerEvents = "none";
  cursor.style.zIndex = "20";

  const size = erase
    ? Math.max(20, eraserSize / W * wrap.clientWidth)
    : 20;

  cursor.style.width = size + "px";
  cursor.style.height = size + "px";
  cursor.style.borderRadius = "50%";
  cursor.style.border = erase
    ? "2px solid #ff477e"
    : "2px solid #00ff99";
  cursor.style.background = erase
    ? "#ff477e44"
    : "#00ff9955";
}

function handleMenuGesture(h, g, now) {
  if (g === "FIST") {
    if (!fistSince) fistSince = now;

    if (now - fistSince >= 800) {
      closeMenu();
      fistSince = 0;
    }
    return;
  }

  fistSince = 0;

  const x = 1 - h[8].x;

  if (g === "DRAW") {
    if (lastSwipeX !== null) {
      const delta = x - lastSwipeX;

      if (
        Math.abs(delta) > 0.14 &&
        now - lastSwipeTime > 550
      ) {
        menuIndex = (
          menuIndex +
          (delta > 0 ? 1 : -1) +
          menuItems.length
        ) % menuItems.length;

        highlightMenu();
        lastSwipeTime = now;
        lastSwipeX = x;
      }
    } else {
      lastSwipeX = x;
    }
  } else {
    lastSwipeX = null;
  }

  // Thumb + index pinch confirms selection
  const pinch = distance(h[4], h[8]) <
    distance(h[5], h[9]) * 0.45;

  if (pinch) {
    if (!selectedSince) selectedSince = now;

    if (now - selectedSince > 450) {
      const item = menuItems[menuIndex];
      selectedSince = now + 1000;

      if (item) selectTool(item.action);
    }
  } else {
    selectedSince = 0;
  }
}

function onResults(result) {
  const now = performance.now();

  if (cam) {
    cam.clearRect(
      0, 0,
      cameraCanvas.width,
      cameraCanvas.height
    );
  }

  const hand = result.multiHandLandmarks?.[0];

  if (!hand) {
    if (now - lastHandTime > 350) {
      finishStroke();
      gesture = "NO HAND";
      mode("NO HAND");
      if ($("cursor")) $("cursor").style.display = "none";
      cursorReady = false;
      palmReady = false;
    }
    return;
  }

  lastHandTime = now;
  rawGesture = classify(hand);

  if (rawGesture !== gesture) {
    if (rawGesture !== window._candidate) {
      window._candidate = rawGesture;
      candidateSince = now;
    }

    if (now - candidateSince > 180) {
      finishStroke();
      gesture = rawGesture;
      gestureSince = now;
    }
  } else {
    window._candidate = rawGesture;
    candidateSince = now;
  }

  const rawX = (1 - hand[8].x) * W;
  const rawY = hand[8].y * H;

  if (!cursorReady) {
    cursorX = rawX;
    cursorY = rawY;
    cursorReady = true;
  } else {
    cursorX += (rawX - cursorX) * 0.58;
    cursorY += (rawY - cursorY) * 0.58;
  }

  updateCursor(
    cursorX,
    cursorY,
    gesture === "ERASE"
  );

  if (cam) {
    cam.beginPath();
    cam.arc(
      (1 - hand[8].x) * cameraCanvas.width,
      hand[8].y * cameraCanvas.height,
      8, 0, Math.PI * 2
    );
    cam.fillStyle = "#00ff99";
    cam.fill();
  }

  if (menuOpen) {
    mode("MENU");
    handleMenuGesture(hand, gesture, now);
    return;
  }

  // Prevent menu reopening for 2 seconds
  if (menuLocked && now - lastMenuClose > 2000) {
    menuLocked = false;
  }

  if (gesture === "PALM") {
    finishStroke();

    if (!menuLocked && !palmReady) {
      palmReady = true;
      gestureSince = now;
    }

    if (
      !menuLocked &&
      palmReady &&
      now - gestureSince > 1500
    ) {
      openMenu();
    }

    mode("MENU HOLD");
    return;
  }

  palmReady = false;

  if (gesture === "DRAW") {
    mode("DRAW");
    drawAt(cursorX, cursorY, false);
  } else if (gesture === "ERASE") {
    mode("ERASE");
    drawAt(cursorX, cursorY, true);
  } else {
    finishStroke();
    mode("PAUSE");
  }

  fpsFrames++;

  if (now - fpsStart > 1100) {
    setText(
      "fps",
      "Tracking FPS: " +
      Math.round(fpsFrames * 1000 / (now - fpsStart))
    );

    fpsStart = now;
    fpsFrames = 0;
  }
}

// CAMERA + MEDIAPIPE

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("CDN unavailable"));
    document.head.appendChild(s);
  });
}

async function loadAI() {
  if (window.Hands) return window.Hands;

  const sources = [
    "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js",
    "https://unpkg.com/@mediapipe/hands@0.4/hands.js"
  ];

  for (const url of sources) {
    try {
      await loadScript(url);
      if (window.Hands) return window.Hands;
    } catch (e) {
      console.warn(e);
    }
  }

  throw new Error("MediaPipe loading failed");
}

async function loop() {
  if (!running) return;

  try {
    if (
      video.readyState >= 2 &&
      video.currentTime !== lastVideoTime
    ) {
      lastVideoTime = video.currentTime;
      await hands.send({ image: video });
    }
  } catch (e) {
    running = false;
    status("Tracking Error: " + e.message);

    if ($("start")) {
      $("start").disabled = false;
      $("start").textContent = "Retry Camera";
    }
    return;
  }

  if (running) requestAnimationFrame(loop);
}

$("start").onclick = async () => {
  if (running || starting) return;

  starting = true;
  $("start").disabled = true;

  try {
    status("Starting camera...");

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    status("Camera working! Loading AI...");

    const Hands = await loadAI();

    hands = new Hands({
      locateFile: file =>
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/" +
        file
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.5
    });

    hands.onResults(onResults);

    running = true;
    lastVideoTime = -1;

    status("AI Ready! Show your hand.");
    $("start").textContent = "Camera Running";

    requestAnimationFrame(loop);
  } catch (e) {
    status("ERROR: " + e.message);

    stream?.getTracks().forEach(t => t.stop());
    stream = null;

    $("start").disabled = false;
    $("start").textContent = "Retry Camera";
  } finally {
    starting = false;
  }
};

$("stop").onclick = () => {
  running = false;
  finishStroke();

  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;

  hands?.close?.();
  hands = null;

  $("start").disabled = false;
  $("start").textContent = "Start Camera";

  mode("OFFLINE");
  status("Camera stopped");
};

// BACKUP BUTTON CONTROLS

if ($("undo")) $("undo").onclick = undo;
if ($("redo")) $("redo").onclick = redo;
if ($("clear")) $("clear").onclick = clearBoard;
if ($("save")) $("save").onclick = savePNG;

if ($("gallerySave")) {
  $("gallerySave").onclick = saveGallery;
}

if ($("openMenu")) {
  $("openMenu").onclick = () =>
    menuOpen ? closeMenu() : openMenu();
}

if ($("brushSize")) {
  $("brushSize").oninput = e => {
    brushSize = Number(e.target.value);
    labels();
  };
}

if ($("eraserSize")) {
  $("eraserSize").oninput = e => {
    eraserSize = Number(e.target.value);
    labels();
  };
}

if ($("autoShape")) {
  $("autoShape").onchange = e => {
    autoShape = e.target.checked;
  };
}

if ($("background")) {
  $("background").onchange = e => {
    darkBoard = e.target.value === "dark";
    wrap?.classList.toggle("dark", darkBoard);
  };
}

window.addEventListener("pagehide", () => {
  stream?.getTracks().forEach(t => t.stop());
});

labels();
status("Ready. Press Start Camera.");

