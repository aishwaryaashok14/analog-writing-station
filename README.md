# Fuzukue

A quiet analog writing desk by [@aishashok14](https://twitter.com/aishashok14).

Fuzukue is Japanese for “writing desk.” Fill a fountain pen, choose an ink, and let your thoughts find the page. Click the name for a note about the experience.

## At the desk

- Click the pen to begin. Prepare it by clicking or dragging each part, or skip the ritual.
- Type to write. Backspace crosses words out; the paper keeps its history.
- Hear a real fountain pen on paper, with optional rain.
- Drag the pen to its cap, drag the cap over the pen, or click the cap to put it away. The parts follow a damped spring, align, seat, and settle into the tray. A missed drop returns them to their starting positions. Escape cancels a drag.
- Pick the pen up again to continue with the same letter and ink.
- Handle the desk. The cup, coaster, ink box, cloth, seal and pad can all be dragged; hold something off-centre and it swings round to trail your hand. Tea sloshes. Carry the seal onto the page to stamp exactly there.
- Lift a lower corner of the page and it folds over along the crease. Pull it far enough and the sheet is set aside for a fresh one.
- Set-aside sheets go to a pile. Click one to bring it back up and read it; drag one to move it.
- Crumple a sheet you do not like (the current one from the controls, an old one from the reader). The ball can be rolled and thrown. Click it to open it again, creases and all. Crumpled pages are left out of copy and save until reopened.
- On a phone, the desk is seen from further back until you start writing. Then the view leans in: the sheet fills the width, the handwriting is larger, and the line being written stays above the keyboard. The **desk** button on the tape steps back out.
- Stamp, copy, or save your letter. Saved PNGs carry **Fuzukue · by @aishashok14** and the Twitter profile URL beneath every sheet. The credit on the website is a clickable link; PNG images contain visible text only.

Letters stay in the current browser session. Save or copy them before closing or refreshing the page.

## Run locally

No dependencies are required. From this directory:

```sh
python3 -m http.server 8765
```

Open http://localhost:8765.

```sh
npm run check
npm test
npm run build
```

## Deploy on Vercel

Import this GitHub repository in Vercel and name the project **analog-station**. Use framework **Other**. The included `vercel.json` sets `npm run build` and the `dist` output directory. No environment variables are needed.

## Sound

The fountain-pen recording is CC0 by hanasmusic. See [sound credits](sounds/CREDITS.md).
