
"use strict";

// AIR CANVAS AI - ULTRA PRO
// Made by Apoorv Singhal

const $ = id => document.getElementById(id);
const video = $("video");
const board = $("board");
const ctx = board.getContext("2d", {willReadFrequently:true});
const marks = $("cameraMarks").getContext("2d");
const W = board.width, H = board.height;

let stream = null, hands = null;
let running = false, starting = false;
let lastFrame = -1;
let color = "#00cfe8", brush = 6, eraser = 65;
let autoShape = true, dark = false;
let stroke = null, history = [], future = [];
let gesture = "", gestureSince = 0;
let menuOpen = false, menuPage = "main";
let hoverAction = "", hoverSince = 0;

const palette = [
  ["Cyan","#00cfe8"],["Pink","#ff4f9a"],
  ["Purple","#a78bfa"],["Yellow","#facc15"],
  ["Green","#43e69a"],["White","#ffffff"],
  ["Black","#111827"],["Rainbow","rainbow"],
  ["Neon","neon"]
];

function status(s) {
  $("status").textContent = s;
}
function mode(s) {
  $("mode").textContent = s;
  $("gesture").textContent = "Gesture: " + s;
}
function labels() {
  $("brushValue").textContent = brush;
  $("eraserValue").textContent = eraser;
  $("brushLabel").textContent = color + " · " + brush + "px";
}
function snapshot() {
  history.push(ctx.getImageData(0,0,W,H));
  if(history.length > 10) history.shift();
  future = [];
}
function finish() {
  if(!stroke) return;
  const p = stroke.points;
  if(stroke.kind === "draw" && autoShape && p.length > 8) {
    const a = p[0], b = p[p.length-1];
    const length = Math.hypot(b.x-a.x,b.y-a.y);
    if(length > 55) {
      let deviation = 0;
      for(const q of p) {
        deviation = Math.max(deviation,
          Math.abs((b.y-a.y)*q.x-(b.x-a.x)*q.y+
          b.x*a.y-b.y*a.x)/length);
      }
      if(deviation < Math.max(13,length*.085)) {
        ctx.putImageData(stroke.before,0,0);
        ctx.save();
        ctx.strokeStyle = stroke.color === "rainbow"
          ? "#22d3ee" : stroke.color === "neon"
          ? "#57f9ff" : stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x,a.y);
        ctx.lineTo(b.x,b.y);
        ctx.stroke();
        ctx.restore();
        status("Auto straightened line");
      }
    }
  }
  stroke = null;
}
function draw(x,y,erase) {
  const kind = erase ? "erase" : "draw";
  if(!stroke || stroke.kind !== kind) {
    finish();
    snapshot();
    stroke = {
      kind, color, size:brush,
      before:ctx.getImageData(0,0,W,H),
      points:[{x,y}]
    };
    return;
  }
  const last = stroke.points.at(-1);
  if(Math.hypot(x-last.x,y-last.y)>125) {
    finish();
    return;
  }
  x = last.x*.3+x*.7;
  y = last.y*.3+y*.7;
  ctx.save();
  ctx.lineCap="round";
  ctx.lineJoin="round";
  if(erase) {
    ctx.globalCompositeOperation="destination-out";
    ctx.lineWidth=eraser;
  } else {
    ctx.lineWidth=brush;
    ctx.strokeStyle=color==="rainbow"
      ? `hsl(${performance.now()/16%360} 100% 55%)`
      :color==="neon"?"#57f9ff":color;
    if(color==="neon") {
      ctx.shadowColor="#00eaff";
      ctx.shadowBlur=16;
    }
  }
  ctx.beginPath();
  ctx.moveTo(last.x,last.y);
  ctx.lineTo(x,y);
  ctx.stroke();
  ctx.restore();
  stroke.points.push({x,y});
}
function undo() {
  finish();
  if(!history.length)return;
  future.push(ctx.getImageData(0,0,W,H));
  ctx.putImageData(history.pop(),0,0);
}
function redo() {
  finish();
  if(!future.length)return;
  history.push(ctx.getImageData(0,0,W,H));
  ctx.putImageData(future.pop(),0,0);
}
function clearBoard() {
  finish();snapshot();ctx.clearRect(0,0,W,H);
}
function imageData() {
  const c=document.createElement("canvas");
  c.width=W;c.height=H;
  const g=c.getContext("2d");
  g.fillStyle=dark?"#101727":"white";
  g.fillRect(0,0,W,H);
  g.drawImage(board,0,0);
  return c.toDataURL("image/png");
}
function savePNG() {
  finish();
  const a=document.createElement("a");
  a.download="AirCanvas-Apoorv.png";
  a.href=imageData();
  a.click();
  status("PNG download requested");
}
function saveGallery() {
  finish();
  try {
    const old=JSON.parse(
      localStorage.getItem("aircanvas-gallery")||"[]"
    );
    const c=document.createElement("canvas");
    c.width=480;c.height=320;
    const g=c.getContext("2d");
    g.fillStyle=dark?"#101727":"white";
    g.fillRect(0,0,480,320);
    g.drawImage(board,0,0,480,320);
    old.unshift({
      id:Date.now(),
      date:new Date().toLocaleString(),
      image:c.toDataURL("image/jpeg",.75)
    });
    localStorage.setItem(
      "aircanvas-gallery",
      JSON.stringify(old.slice(0,8))
    );
    status("Saved to Gallery");
  } catch(e) {
    status("Gallery storage unavailable. Use PNG.");
  }
}

// TOUCHLESS MENU
const menuItems = {
  main:[
    ["Colors","colors"],
    ["Brush Size","brush"],
    ["Eraser Size","eraser"],
    ["Auto Straight","auto"],
    ["Undo","undo"],["Redo","redo"],
    ["Save PNG","save"],
    ["Save Gallery","gallery"],
    ["Clear","clear"],
    ["Background","background"],
    ["Close","close"]
  ],
  colors:palette.map(p=>[p[0],"color:"+p[1]])
    .concat([["Back","back"]]),
  brush:[2,4,6,9,12,16,22,32]
    .map(n=>[n+"px","brush:"+n])
    .concat([["Back","back"]]),
  eraser:[10,20,35,50,65,80,100,120]
    .map(n=>[n+"px","eraser:"+n])
    .concat([["Back","back"]]),
  background:[
    ["White","bg:white"],
    ["Dark","bg:dark"],
    ["Back","back"]
  ]
};
function renderMenu() {
  const grid=$("menuGrid");
  grid.innerHTML="";
  $("menuTitle").textContent=
    menuPage==="main"?"AIR CONTROL PANEL":
    menuPage.toUpperCase();
  for(const [name,action] of menuItems[menuPage]) {
    const b=document.createElement("button");
    b.className="menu-item";
    b.dataset.action=action;
    b.textContent=name;
    const progress=document.createElement("span");
    progress.className="progress";
    b.appendChild(progress);
    b.onclick=()=>selectTool(action);
    grid.appendChild(b);
  }
  hoverAction="";
}
function openMenu() {
  finish();
  menuOpen=true;
  menuPage="main";
  $("menu").classList.add("open");
  renderMenu();
  status("Point and hold on a tool");
}
function closeMenu() {
  menuOpen=false;
  $("menu").classList.remove("open");
  hoverAction="";
}
function selectTool(action) {
  if(action==="close"){closeMenu();return;}
  if(action==="back"){
    menuPage="main";renderMenu();return;
  }
  if(menuItems[action]){
    menuPage=action;renderMenu();return;
  }
  if(action==="undo")undo();
  if(action==="redo")redo();
  if(action==="clear")clearBoard();
  if(action==="save")savePNG();
  if(action==="gallery")saveGallery();
  if(action==="auto"){
    autoShape=!autoShape;
    $("autoShape").checked=autoShape;
  }
  if(action.startsWith("color:"))
    color=action.slice(6);
  if(action.startsWith("brush:")){
    brush=Number(action.slice(6));
    $("brushSize").value=brush;
  }
  if(action.startsWith("eraser:")){
    eraser=Number(action.slice(7));
    $("eraserSize").value=eraser;
  }
  if(action.startsWith("bg:")){
    dark=action.slice(3)==="dark";
    $("background").value=dark?"dark":"white";
    $("boardWrap").classList.toggle("dark",dark);
  }
  labels();
  if(menuPage!=="main"){
    menuPage="main";renderMenu();
  }
}
function hoverMenu(x,y) {
  const rect=$("boardWrap").getBoundingClientRect();
  const element=document.elementFromPoint(
    rect.left+x/W*rect.width,
    rect.top+y/H*rect.height
  );
  const tile=element?.closest(".menu-item");
  const action=tile?.dataset.action||"";
  if(!action){hoverAction="";return;}
  if(action!==hoverAction){
    hoverAction=action;
    hoverSince=performance.now();
  }
  const elapsed=performance.now()-hoverSince;
  const bar=tile.querySelector(".progress");
  if(bar)bar.style.width=Math.min(100,elapsed/10)+"%";
  if(elapsed>=1000)selectTool(action);
}

// HAND GESTURES
function up(h,tip,pip) {
  return h[tip].y<h[pip].y-.035;
}
function recognize(h) {
  const i=up(h,8,6);
  const m=up(h,12,10);
  const r=up(h,16,14);
  const p=up(h,20,18);
  if(i&&m&&r&&p)return "PALM";
  if(i&&m&&r&&!p)return "ERASE";
  if(i&&m&&!r&&!p)return "PAUSE";
  if(i&&!m&&!r&&!p)return "DRAW";
  if(!i&&!m&&!r&&!p)return "FIST";
  return "PAUSE";
}
function results(data) {
  marks.clearRect(0,0,640,480);
  const h=data.multiHandLandmarks?.[0];
  if(!h){
    finish();mode("NO HAND");
    $("cursor").style.display="none";
    gesture="";
    return;
  }
  const x=(1-h[8].x)*W;
  const y=h[8].y*H;
  const g=recognize(h);
  const now=performance.now();
  if(g!==gesture){
    finish();
    gesture=g;
    gestureSince=now;
  }
  const stable=now-gestureSince;
  marks.fillStyle="#00ff99";
  marks.beginPath();
  marks.arc((1-h[8].x)*640,h[8].y*480,9,0,Math.PI*2);
  marks.fill();
  const dot=$("cursor");
  dot.style.display="block";
  dot.style.left=x/W*100+"%";
  dot.style.top=y/H*100+"%";
  const size=g==="ERASE"
    ?Math.max(18,eraser/W*$("boardWrap").clientWidth)
    :18;
  dot.style.width=size+"px";
  dot.style.height=size+"px";
  if(g==="PALM"&&stable>700&&!menuOpen)
    openMenu();
  if(menuOpen){
    mode("MENU");
    if(g==="FIST"&&stable>700){
      closeMenu();return;
    }
    if(g==="DRAW"&&stable>150)
      hoverMenu(x,y);
    else hoverAction="";
    return;
  }
  mode(g);
  if(stable<130)return;
  if(g==="DRAW")draw(x,y,false);
  else if(g==="ERASE")draw(x,y,true);
  else finish();
}

// CAMERA AND AI
function loadScript(url) {
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=url;
    s.onload=resolve;
    s.onerror=()=>reject(new Error("CDN unavailable"));
    document.head.appendChild(s);
  });
}
async function loadAI() {
  if(window.Hands)return window.Hands;
  for(const url of [
    "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js",
    "https://unpkg.com/@mediapipe/hands@0.4/hands.js"
  ]){
    try {
      await loadScript(url);
      if(window.Hands)return window.Hands;
    }catch(e){console.warn(e);}
  }
  throw new Error("MediaPipe failed to load");
}
async function loop() {
  if(!running)return;
  try {
    if(video.readyState>=2&&video.currentTime!==lastFrame){
      lastFrame=video.currentTime;
      await hands.send({image:video});
    }
  }catch(e){
    status("Tracking error: "+e.message);
    running=false;
    $("start").disabled=false;
    $("start").textContent="Retry Camera";
    return;
  }
  requestAnimationFrame(loop);
}
$("start").onclick=async()=>{
  if(running||starting)return;
  starting=true;
  $("start").disabled=true;
  try {
    status("Starting camera...");
    stream=await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:"user",
        width:{ideal:640},
        height:{ideal:480}
      },
      audio:false
    });
    video.srcObject=stream;
    await video.play();
    status("Camera working! Loading AI...");
    const Hands=await loadAI();
    hands=new Hands({
      locateFile:file=>
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/"+file
    });
    hands.setOptions({
      maxNumHands:1,
      modelComplexity:0,
      minDetectionConfidence:.55,
      minTrackingConfidence:.5
    });
    hands.onResults(results);
    running=true;
    lastFrame=-1;
    status("AI Ready! Show your hand.");
    $("start").textContent="Camera Running";
    requestAnimationFrame(loop);
  }catch(e){
    status("ERROR: "+e.message);
    stream?.getTracks().forEach(t=>t.stop());
    stream=null;
    $("start").disabled=false;
    $("start").textContent="Retry Camera";
  }finally{
    starting=false;
  }
};
$("stop").onclick=()=>{
  running=false;
  finish();
  stream?.getTracks().forEach(t=>t.stop());
  stream=null;
  video.srcObject=null;
  hands?.close?.();
  hands=null;
  $("start").disabled=false;
  $("start").textContent="Start Camera";
  mode("OFFLINE");
  status("Camera stopped");
};

// BACKUP BUTTONS
$("undo").onclick=undo;
$("redo").onclick=redo;
$("clear").onclick=clearBoard;
$("save").onclick=savePNG;
$("gallerySave").onclick=saveGallery;
$("openMenu").onclick=()=>{
  menuOpen?closeMenu():openMenu();
};
$("brushSize").oninput=e=>{
  brush=Number(e.target.value);labels();
};
$("eraserSize").oninput=e=>{
  eraser=Number(e.target.value);labels();
};
$("autoShape").onchange=e=>{
  autoShape=e.target.checked;
};
$("background").onchange=e=>{
  dark=e.target.value==="dark";
  $("boardWrap").classList.toggle("dark",dark);
};
window.addEventListener("pagehide",()=>{
  stream?.getTracks().forEach(t=>t.stop());
});
labels();
status("Ready. Press Start Camera.");

