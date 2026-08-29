# Brand assets

Drop the Memento artwork here, then run `npm run icons`.

| File | What it is | Used for |
| --- | --- | --- |
| `icon.svg` *(preferred)* or `icon.png` | The square app icon — the violet rounded tile with the white mark | Every PWA icon, the favicon, the Apple touch icon, and the header logo |
| `wordmark.svg` *(optional)* | The horizontal "◉ memento" lockup | Not wired up yet; the header composes the mark and the word itself |

`icon.png` should be at least 512×512 and square. `npm run icons` regenerates
everything in `client/public` from it, including the maskable variants Android
crops to a circle.

Until a file is present the build uses a placeholder tile in the brand violet,
so nothing breaks — but the real mark will not appear.
