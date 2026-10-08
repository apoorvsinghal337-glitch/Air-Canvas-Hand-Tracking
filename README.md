# Air Canvas AI — Ultra Pro Edition

Made by Apoorv Singhal.

Static multi-page GitHub Pages website with cinematic intro, small live hand-camera preview, separate large whiteboard, touchless hand gesture tools, PNG download and browser-local gallery.

## Upload to GitHub Pages

Upload the **contents** of this folder (not the enclosing folder) to the root of your GitHub repository. Keep `css/` and `js/` directories intact. Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## Pages

- `index.html`: 4.8-second approved realistic-hand intro (embedded image), auto-opens `home.html`.
- `home.html`: dashboard.
- `studio.html`: camera + whiteboard + gesture guide.
- `gallery.html`: saved art in localStorage.

## Gestures

- One index finger: draw (or point and dwell ~1 second in menu).
- Index + middle: pause/end stroke.
- Index + middle + ring: erase (adjustable 10–120 px).
- Five fingers/open palm: hold ~0.7 seconds to open tools menu.
- Fist: pause; hold to close menu.

Use good lighting and keep your hand visible. Camera permission requires an initial tap. For the touchless menu, hold one finger over a tile for 1 second. Touchscreen buttons are optional fallbacks.

## Technical notes

- Uses MediaPipe Hands 0.4 from CDN, so **internet is required** and CDN/network errors remain possible.
- Works best on current Chrome over HTTPS (GitHub Pages). No 100% compatibility guarantee across devices.
- Auto correction attempts straight lines and rough closed circles/ellipses/rectangles; detection is heuristic and may occasionally misclassify strokes.
- The gallery stores up to 8 compressed thumbnails locally; Save PNG exports full-resolution art.
- Gallery is browser-specific and may be lost if browser storage is cleared.
