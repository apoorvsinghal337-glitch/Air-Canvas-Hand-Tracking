
"use strict";
// Air Canvas AI V4 - Made by Apoorv Singhal
const $=id=>document.getElementById(id);
const video=$("video"), board=$("board"), ctx=board.getContext("2d",{willReadFrequently:true}), marks=$("cameraMarks").getContext("2d");
const W=board.width,H=board.height;
let stream=null,hands=null,running=false,starting=false,lastVideoTime=-1;
let brushColor="#00cfe8",brushSize=6,eraserSize=65,autoShape=true,darkBoard=false;
let stroke=null,undoStack=[],redoStack=[],menuOpen=false,menuPage="main",hoverAction="",hoverSince=0;
let gestureHistory=[],stableGesture="PAUSE",candidateGesture="PAUSE",candidateSince=0,lastSeen=0,smoothed=null,frameCount=0,fpsStart=performance.now();
const palette=[["Cyan","#00cfe8"],["Pink","#ff4f9a"],["Purple","#a78bfa"],["Yellow","#facc15"],["Green","#43e69a"],["White","#ffffff"],["Black","#111827"],["Rainbow","rainbow"],["Neon","neon"]];

function status(s){$("status").textContent=s}
function mode(s){$("mode").textContent=s;$("gesture").textContent="Gesture: "+s}
function labels(){$("brushValue").textContent=brushSize;$("eraserValue").textContent=eraserSize;$("brushLabel").textContent=brushColor+" · "+brushSize+"px"}
function snapshot(){undoStack.push(ctx.getImageData(0,0,W,H));if(undoStack.length>12)undoStack.shift();redoStack=[]}
function styleStroke(c,kind,size){
 c.lineWidth=size;c.lineCap="round";c.lineJoin="round";
 if(kind==="erase")c.globalCompositeOperation="destination-out";
 else {
  c.strokeStyle=brushColor==="rainbow"?`hsl(${performance.now()/18%360} 100% 55%)`:brushColor==="neon"?"#57f9ff":brushColor;
  if(brushColor==="neon"){c.shadowColor="#00eaff";c.shadowBlur=12}
 }
}
function pathLength(p){
 let n=0;
 for(let i=1;i<p.length;i++)n+=Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y);
 return n;
}
function detectShape(p){
 if(p.length<8)return null;
 const a=p[0],b=p[p.length-1],direct=Math.hypot(b.x-a.x,b.y-a.y),travel=pathLength(p);
 if(travel<55)return null;
 const xs=p.map(v=>v.x),ys=p.map(v=>v.y);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const bw=maxX-minX,bh=maxY-minY;
 if(direct>45&&travel/direct<1.48){
  let err=0;
  for(const q of p)err+=Math.abs((b.y-a.y)*q.x-(b.x-a.x)*q.y+b.x*a.y-b.y*a.x)/direct;
  err/=p.length;
  if(err<Math.max(14,direct*.085))return {type:"line",a,b};
 }
 if(bw<40||bh<40||direct>Math.max(bw,bh)*.4||travel<Math.max(bw,bh)*2)return null;
 const cx=(minX+maxX)/2,cy=(minY+maxY)/2,rx=bw/2,ry=bh/2;
 const radial=p.map(q=>Math.hypot((q.x-cx)/rx,(q.y-cy)/ry));
 const avg=radial.reduce((s,v)=>s+v,0)/radial.length;
 const spread=Math.sqrt(radial.reduce((s,v)=>s+(v-avg)**2,0)/radial.length);
 if(spread<.23&&Math.abs(travel-(Math.PI*3*(rx+ry)-Math.PI*Math.sqrt((3*rx+ry)*(rx+3*ry))))/travel<.4)
  return {type:"ellipse",cx,cy,rx,ry};
 const tolerance=Math.max(11,Math.min(bw,bh)*.14);
 const near=p.filter(q=>Math.min(Math.abs(q.x-minX),Math.abs(q.x-maxX),Math.abs(q.y-minY),Math.abs(q.y-maxY))<tolerance).length/p.length;
 if(near>.78&&travel>1.8*(bw+bh))return {type:"rectangle",minX,minY,bw,bh};
 return null;
}
function finish(){
 if(!stroke)return;
 if(stroke.kind==="draw"&&autoShape&&stroke.points.length>=8){
  const shape=detectShape(stroke.points);
  if(shape){
   ctx.putImageData(stroke.before,0,0);
   ctx.save();
   styleStroke(ctx,"draw",stroke.size);
   ctx.beginPath();
   if(shape.type==="line"){ctx.moveTo(shape.a.x,shape.a.y);ctx.lineTo(shape.b.x,shape.b.y)}
   if(shape.type==="ellipse")ctx.ellipse(shape.cx,shape.cy,shape.rx,shape.ry,0,0,Math.PI*2);
   if(shape.type==="rectangle")ctx.rect(shape.minX,shape.minY,shape.bw,shape.bh);
   ctx.stroke();ctx.restore();
   status("Auto corrected: "+shape.type);
  }
 }
 stroke=null;smoothed=null;
}
function drawAt(x,y,erase){
 const kind=erase?"erase":"draw";
 if(!stroke||stroke.kind!==kind){
  finish();snapshot();
  stroke={kind,before:ctx.getImageData(0,0,W,H),points:[{x,y}],size:brushSize};
  smoothed={x,y};return;
 }
 const prev=smoothed||stroke.points.at(-1);
 const distance=Math.hypot(x-prev.x,y-prev.y);
 if(distance>W*.16){finish();return}
 const alpha=distance>18?.68:.32;
 const nx=prev.x+(x-prev.x)*alpha,ny=prev.y+(y-prev.y)*alpha;
 ctx.save();styleStroke(ctx,kind,erase?eraserSize:brushSize);
 ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(nx,ny);ctx.stroke();ctx.restore();
 smoothed={x:nx,y:ny};stroke.points.push({x:nx,y:ny});
}
function undo(){
 finish();if(!undoStack.length)return;
 redoStack.push(ctx.getImageData(0,0,W,H));
 ctx.putImageData(undoStack.pop(),0,0);
}
function redo(){
 finish();if(!redoStack.length)return;
 undoStack.push(ctx.getImageData(0,0,W,H));
 ctx.putImageData(redoStack.pop(),0,0);
}
function clearBoard(){finish();snapshot();ctx.clearRect(0,0,W,H)}
function exportCanvas(){
 const c=document.createElement("canvas");c.width=W;c.height=H;
 const g=c.getContext("2d");
 g.fillStyle=darkBoard?"#101727":"white";
 g.fillRect(0,0,W,H);g.drawImage(board,0,0);
 return c;
}
function savePNG(){
 finish();
 const a=document.createElement("a");
 a.href=exportCanvas().toDataURL("image/png");
 a.download="AirCanvas-Apoorv.png";
 document.body.appendChild(a);a.click();a.remove();
 status("PNG download requested");
}
function saveGallery(){
 finish();
 try{
  const c=document.createElement("canvas");c.width=480;c.height=320;
  c.getContext("2d").drawImage(exportCanvas(),0,0,480,320);
  const g=JSON.parse(localStorage.getItem("aircanvas-gallery")||"[]");
  g.unshift({id:Date.now(),date:new Date().toLocaleString(),image:c.toDataURL("image/jpeg",.72)});
  localStorage.setItem("aircanvas-gallery",JSON.stringify(g.slice(0,8)));
  status("Saved to Gallery");
 }catch(e){status("Gallery storage full; use Save PNG")}
}
const menuItems={
 main:[["Colors","colors"],["Brush Size","brush"],["Eraser Size","eraser"],["Auto Shape","auto"],["Undo","undo"],["Redo","redo"],["Save PNG","save"],["Save Gallery","gallery"],["Clear","clear"],["Background","background"],["Close","close"]],
 colors:palette.map(p=>[p[0],"color:"+p[1]]).concat([["Back","back"]]),
 brush:[2,4,6,9,12,16,22,32].map(n=>[n+"px","brush:"+n]).concat([["Back","back"]]),
 eraser:[10,20,35,50,65,80,100,120].map(n=>[n+"px","eraser:"+n]).concat([["Back","back"]]),
 background:[["White","bg:white"],["Dark","bg:dark"],["Back","back"]]
};
function renderMenu(){
 const grid=$("menuGrid");grid.innerHTML="";
 $("menuTitle").textContent=menuPage==="main"?"AIR CONTROL PANEL":menuPage.toUpperCase();
 for(const [name,action] of menuItems[menuPage]){
  const b=document.createElement("button");b.className="menu-item";b.dataset.action=action;b.textContent=name;
  const p=document.createElement("span");p.className="progress";b.appendChild(p);
  b.onclick=()=>selectTool(action);grid.appendChild(b);
 }
 hoverAction="";
}
function openMenu(){
 finish();menuOpen=true;menuPage="main";
 $("menu").classList.add("open");renderMenu();
 status("Point with index finger and hold 1 second");
}
function closeMenu(){
 menuOpen=false;$("menu").classList.remove("open");hoverAction="";finish();
}
function selectTool(action){
 if(action==="close"){closeMenu();return}
 if(action==="back"){menuPage="main";renderMenu();return}
 if(menuItems[action]){menuPage=action;renderMenu();return}
 if(action==="undo")undo();
 if(action==="redo")redo();
 if(action==="clear")clearBoard();
 if(action==="save")savePNG();
 if(action==="gallery")saveGallery();
 if(action==="auto"){
  autoShape=!autoShape;$("autoShape").checked=autoShape;
  status("Auto Shape: "+(autoShape?"ON":"OFF"));
 }
 if(action.startsWith("color:"))brushColor=action.slice(6);
 if(action.startsWith("brush:")){
  brushSize=Number(action.slice(6));$("brushSize").value=brushSize;
 }
 if(action.startsWith("eraser:")){
  eraserSize=Number(action.slice(7));$("eraserSize").value=eraserSize;
 }
 if(action.startsWith("bg:")){
  darkBoard=action.slice(3)==="dark";
  $("background").value=darkBoard?"dark":"white";
  $("boardWrap").classList.toggle("dark",darkBoard);
 }
 labels();
 if(menuPage!=="main"){menuPage="main";renderMenu()}
}
function hoverMenu(x,y){
 const rect=$("boardWrap").getBoundingClientRect();
 const el=document.elementFromPoint(rect.left+x/W*rect.width,rect.top+y/H*rect.height);
 const tile=el?.closest(".menu-item"),action=tile?.dataset.action||"";
 document.querySelectorAll(".menu-item").forEach(b=>{
  b.classList.toggle("hover",b===tile);
  if(b!==tile)b.querySelector(".progress").style.width="0";
 });
 if(!action){hoverAction="";return}
 if(action!==hoverAction){hoverAction=action;hoverSince=performance.now()}
 const elapsed=performance.now()-hoverSince;
 tile.querySelector(".progress").style.width=Math.min(100,elapsed/10)+"%";
 if(elapsed>=1000)selectTool(action);
}
function fingerUp(h,tip,pip,mcp){
 const t=h[tip],p=h[pip],base=h[mcp];
 return Math.hypot(t.x-base.x,t.y-base.y)>Math.hypot(p.x-base.x,p.y-base.y)*1.18;
}
function classify(h){
 const i=fingerUp(h,8,6,5),m=fingerUp(h,12,10,9);
 const r=fingerUp(h,16,14,13),p=fingerUp(h,20,18,17);
 if(i&&m&&r&&p)return "PALM";
 if(i&&m&&r&&!p)return "ERASE";
 if(i&&m&&!r&&!p)return "PAUSE";
 if(i&&!m&&!r&&!p)return "DRAW";
 if(!i&&!m&&!r&&!p)return "FIST";
 return "PAUSE";
}
function results(data){
 const now=performance.now();
 marks.clearRect(0,0,640,480);
 const h=data.multiHandLandmarks?.[0];
 if(!h){
  $("cursor").style.display="none";
  if(now-lastSeen>360){
   finish();gestureHistory=[];
   stableGesture="NO HAND";mode("NO HAND");
  }
  return;
 }
 lastSeen=now;
 const raw=classify(h);
 gestureHistory.push(raw);
 if(gestureHistory.length>5)gestureHistory.shift();
 const counts={};
 for(const g of gestureHistory)counts[g]=(counts[g]||0)+1;
 const voted=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
 if(voted!==candidateGesture){
  candidateGesture=voted;candidateSince=now;
 }
 if(voted!==stableGesture&&now-candidateSince>170){
  finish();stableGesture=voted;
 }
 const x=(1-h[8].x)*W,y=h[8].y*H;
 marks.beginPath();
 marks.arc((1-h[8].x)*640,h[8].y*480,9,0,Math.PI*2);
 marks.fillStyle="#00ff99";marks.fill();
 const dot=$("cursor");
 dot.style.display="block";
 dot.style.left=x/W*100+"%";
 dot.style.top=y/H*100+"%";
 const size=stableGesture==="ERASE"
  ?Math.max(20,eraserSize/W*$("boardWrap").clientWidth):20;
 dot.style.width=size+"px";
 dot.style.height=size+"px";
 dot.style.background=stableGesture==="ERASE"?"#ff668855":"#23efb780";
 if(stableGesture==="PALM"&&!menuOpen&&now-candidateSince>700)openMenu();
 if(menuOpen){
  mode("MENU");
  if(stableGesture==="FIST"&&now-candidateSince>700){
   closeMenu();return;
  }
  if(stableGesture==="DRAW")hoverMenu(x,y);
  else hoverAction="";
  return;
 }
 mode(stableGesture);
 if(stableGesture==="DRAW")drawAt(x,y,false);
 else if(stableGesture==="ERASE")drawAt(x,y,true);
 else finish();
 frameCount++;
 if(now-fpsStart>1100){
  $("fps").textContent="Tracking FPS: "+Math.round(frameCount*1000/(now-fpsStart));
  fpsStart=now;frameCount=0;
 }
}
function loadScript(url){
 return new Promise((resolve,reject)=>{
  const s=document.createElement("script");
  s.src=url;s.onload=resolve;
  s.onerror=()=>reject(new Error("CDN unavailable"));
  document.head.appendChild(s);
 });
}
async function loadAI(){
 if(window.Hands)return window.Hands;
 for(const url of [
  "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js",
  "https://unpkg.com/@mediapipe/hands@0.4/hands.js"
 ]){
  try{
   await loadScript(url);
   if(window.Hands)return window.Hands;
  }catch(e){console.warn(e)}
 }
 throw Error("MediaPipe could not load. Check internet.");
}
async function loop(){
 if(!running)return;
 try{
  if(video.readyState>=2&&video.currentTime!==lastVideoTime){
   lastVideoTime=video.currentTime;
   await hands.send({image:video});
  }
 }catch(e){
  running=false;
  status("Tracking error: "+e.message);
  $("start").disabled=false;
  $("start").textContent="Retry Camera";
  return;
 }
 if(running)requestAnimationFrame(loop);
}
$("start").onclick=async()=>{
 if(running||starting)return;
 starting=true;$("start").disabled=true;
 try{
  status("Starting camera...");
  stream=await navigator.mediaDevices.getUserMedia({
   video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},
   audio:false
  });
  video.srcObject=stream;
  await video.play();
  status("Camera working! Loading AI...");
  const Hands=await loadAI();
  hands=new Hands({
   locateFile:file=>"https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/"+file
  });
  hands.setOptions({
   maxNumHands:1,modelComplexity:0,
   minDetectionConfidence:.52,minTrackingConfidence:.48
  });
  hands.onResults(results);
  running=true;lastVideoTime=-1;
  status("AI ready! Point your index finger.");
  $("start").textContent="Camera Running";
  requestAnimationFrame(loop);
 }catch(e){
  status("ERROR: "+e.message);
  stream?.getTracks().forEach(t=>t.stop());
  stream=null;
  $("start").disabled=false;
  $("start").textContent="Retry Camera";
 }finally{starting=false}
};
$("stop").onclick=()=>{
 running=false;finish();
 stream?.getTracks().forEach(t=>t.stop());
 stream=null;video.srcObject=null;
 hands?.close?.();hands=null;
 $("start").disabled=false;
 $("start").textContent="Start Camera";
 mode("OFFLINE");status("Camera stopped");
};
$("undo").onclick=undo;
$("redo").onclick=redo;
$("clear").onclick=clearBoard;
$("save").onclick=savePNG;
$("gallerySave").onclick=saveGallery;
$("openMenu").onclick=()=>menuOpen?closeMenu():openMenu();
$("brushSize").oninput=e=>{brushSize=+e.target.value;labels()};
$("eraserSize").oninput=e=>{eraserSize=+e.target.value;labels()};
$("autoShape").onchange=e=>autoShape=e.target.checked;
$("background").onchange=e=>{
 darkBoard=e.target.value==="dark";
 $("boardWrap").classList.toggle("dark",darkBoard);
};
window.addEventListener("pagehide",()=>
 stream?.getTracks().forEach(t=>t.stop())
);
labels();
status("Ready. Press Start Camera.");

             
