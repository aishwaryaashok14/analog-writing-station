# Fuzukue

A quiet analog writing desk by [@aishashok14](https://twitter.com/aishashok14).

Fuzukue is Japanese for “writing desk.” Fill a fountain pen, choose an ink, and let your thoughts find the page. Click the name for a note about the experience.

## At the desk

- Click the pen to begin. Prepare it by clicking or dragging each part, or skip the ritual.
- Type to write. Backspace crosses words out; the paper keeps its history.
- Hear a real fountain pen on paper, with optional rain.
- Drag the pen to its cap, drag the cap over the pen, or click the cap to put it away. The parts follow a damped spring, align, seat, and settle into the tray. A missed drop returns them to their starting positions. Escape cancels a drag.
- Pick the pen up again to continue with the same letter and ink.
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
