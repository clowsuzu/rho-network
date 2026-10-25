# Rho Network

Your Obsidian vault as a living 3D star system. Each top folder becomes an orbit, its notes the planets, and the links between notes the faint lines across the sky. It turns slowly, it reacts as you write, and now and then a star goes off.

![Rho Network: a vault of 1,500 notes as a star system](images/hero.png)

## What you get

- **A star system of your vault.** A globe in the middle, one tilted orbit per top folder, a planet per note. Notes you open often shine brighter and show their names.
- **Asteroid belts** for the crowded outer parts of big vaults, drawn on the graphics card (WebGL2) where there is one, so a vault of tens of thousands of notes stays smooth.
- **Link lines** between linked notes. The note under the mouse and the open one always show theirs.
- **Drill in.** Click an orbit's name to fly into it; breadcrumbs, the Back button or Backspace take you out again.
- **Group by** folders, tags or link clusters, or let Auto pick. Press G on the map to switch.
- **The note box.** Click a planet to read its note in a glass panel over the map. Turn on EDIT to write in it.
- **Search.** Press `/`, type, Enter flies you to the note.
- **Time-lapse.** Press T and watch your vault grow, note by note, in the order you made them.
- **Look mode.** Press O and everything but the sky goes away.
- **Widgets** in a side column: recent edits, activity, open tasks, inbox, on this day, most opened, vault stats, orphans and broken links, or any note, folder or tag you pin there.
- **The sky.** Supernovas now and then, and a black hole that keeps the graveyard of notes you deleted (click it to see them).
- **Themes:** Deep space, Dusk, Ember and Paper (the light one). **Planet colours:** Sand, Black & white, Halloween and Classic.

![Close up on the globe](images/close.png)

## Controls

| | |
|---|---|
| Scroll | Zoom |
| Drag | Spin the system |
| Double-click | Back to the start view |
| Click a planet | Open its note in the note box |
| `/` | Search |
| G | Next grouping |
| O | Look mode |
| T | Time-lapse |
| Backspace | Out of an orbit |
| Esc | Close / stop |

Open it from the globe icon in the ribbon or the command palette ("Rho Network: Open").

## Settings

Settings > Rho Network, or the gear on the map itself: theme, planet colours, darkness, ring spacing and tilt, star density, glow, link lines, planet size, spin, quality, supernovas, the black hole, the second belt, grouping, and folders to leave off the map. Every slider has a reset.

## Install

Until it's in the community directory:

- **BRAT:** install the BRAT plugin, then "Add beta plugin" with this repository's address.
- **By hand:** from the latest release, download `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/rho-network/`, then switch Rho Network on in Settings > Community plugins.

Desktop only.

## Privacy

Rho Network makes no network requests and has no telemetry. It reads your vault and Obsidian's link cache. It keeps a little state of its own (the note box's size, how often notes are opened, the sky's stars) in local storage, and a spare copy of its settings in your vault's config folder so an update that replaces the plugin folder doesn't lose them. It writes to a note only when you type in the note box with EDIT on.

## Licence

MIT, see [LICENSE](LICENSE).
