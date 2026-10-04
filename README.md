# SKYTRACE

An aerial reconnaissance mystery. Fly a small aircraft over a miniature landscape, scan the ground with radar, mark what does not add up, leave sensor packages where the night matters, and connect the evidence on an intelligence map.

**Play it:** https://scottyfncodes.github.io/SKYTRACE/

The plane gets you there. The sensors show you what you missed. Your deductions reveal what it means.

## The loop

FLY → OBSERVE → SCAN → INVESTIGATE → IDENTIFY → MARK → RETURN → CONNECT THE DOTS

- **Fly** the Varrow Basin from the airfield in the south-west. Fuel limits each sortie.
- **Scan** with the ground radar (`SCAN` / Space). Low and slow gives a narrow footprint with high resolution; high gives a wide footprint with poor resolution. Concealed sites only resolve on a low pass.
- **Observe** sites visually by flying close. Some are only visible from very low altitude.
- **Mark** a contact (`MARK` / M) when the contact card appears. Only marked evidence counts toward an assessment.
- **Drop** a sensor package (`DROP` / E). It lands under a parachute, listens to anything within 150 m, and reports after each night.
- **Return** to base by flying low over the airfield (or `LAND` when near it). A night passes, sensors report, and the intelligence map opens.
- **Connect the dots** in the intelligence workspace: contacts, confirmed facts vs. tentative interpretation, open questions, connections, leads, and finally an assessment.

## Controls

| Action | Touch (iPhone) | Keyboard |
| --- | --- | --- |
| Bank / climb / descend | Drag on the left half of the screen | Arrows or WASD |
| Throttle | Slider on the right edge | Shift / Ctrl (or Q / Z) |
| Ground radar | SCAN | Space |
| Mark contact | MARK | M |
| Drop sensor | DROP | E |
| Intelligence map | MAP | Tab or I |
| Land (near base) | LAND | R |
| Pause | II | Esc or P |

Progress is saved in the browser automatically.

## Development

```
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # production build into dist/
npm run check      # typecheck + test + build
```

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Architecture

Plain TypeScript + Vite + Three.js, no backend.

| Module | Role |
| --- | --- |
| `src/world/worldData.ts` | Handcrafted layout: base, roads, river, forests, flats, vehicle route |
| `src/world/terrain.ts` | Heightfield, forest mask (pure functions, tested) |
| `src/world/scene.ts`, `props.ts`, `truck.ts` | Three.js rendering of the diorama and the scripted vehicle |
| `src/flight/aircraft.ts` | Arcade flight model (pure, tested); `camera.ts` chase camera; `aircraftMesh.ts` |
| `src/sensors/radar.ts` | Footprint, resolution, detection and resolution rules (pure, tested) |
| `src/sensors/equipment.ts`, `packageMesh.ts` | Sensor packages: registration, preliminary downloads, night reports |
| `src/intel/scenario.ts` | The case: contacts, texts, links, leads, hypotheses, unlocks |
| `src/intel/state.ts` | Persistent investigation state, events, leads, assessment, coverage |
| `src/ui/hud.ts` | Flight instruments and the phosphor radar scope |
| `src/ui/intelMap.ts` | Paper intelligence map and dossier panel |
| `src/game/Game.ts` | Orchestration: sorties, modes, actions, world markers |

Automated checks live in `tests/`. A Playwright playthrough script (desktop + iPhone viewports) was used for QA and the screenshots in `docs/screenshots/`.
