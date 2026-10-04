# SKYTRACE

An aerial reconnaissance mystery. Fly a small aircraft over a miniature landscape, scan the ground with radar, mark what does not add up, leave sensor packages where the night matters, and connect the evidence on an intelligence map.

**Play it:** https://scottyfncodes.github.io/SKYTRACE/

The plane gets you there. The sensors show you what you missed. Your deductions reveal what it means.

## Two jobs inside one aircraft

SKYTRACE alternates between two deliberately separate modes:

- **PILOT** — you fly: heading, altitude, throttle, terrain, fuel, landing. The flight HUD says `PILOT · YOU ARE FLYING`.
- **OPERATOR (Mission Control)** — the autopilot flies an orbit (the real flight model, driven by `src/flight/autopilot.ts`) and you never touch the stick. You run the recon systems: sensors, target selection, marking, re-tasking the orbit.

The grammar every mission is built on:

FLY TO TARGET → MISSION CONTROL → OPERATE → OBJECTIVE → **YOU HAVE CONTROL** → FLY HOME → LAND → DEBRIEF

Mission Control opens only inside the mission's operations area while there is recon work to do (`O` / Enter, or the `MISSION CONTROL` button). `TAKE CONTROLS` hands the aircraft back at any time; Mission Control also hands it back by itself when the recon work is done or at bingo fuel. The hand-back is a gameplay event: time has passed, the aircraft is wherever the orbit left it, and conditions may have changed (Mission 01: haze). A hand-over report lists warnings first, then the return heading and fuel.

## Mission 01: Find the Truck

- **Objective:** locate the missing supply truck inside Sector 7. **Intel:** large, moving, on a road, in Sector 7.
- **Pilot:** fly to Sector 7 (outlined in amber), open Mission Control.
- **Operator:** the **radar** finds vehicles and shows whether they move, but cannot say what they are; tap the display to move the orbit. The **camera** shows what a selected return is (size, count, road); the orbit follows it. Each decoy fails the intel on exactly one point. **Mark** the one you believe is the truck (a wrong mark counts a false positive; the mission continues). Then track the truck to its stop and hold the camera on it.
- **Pilot again:** Mission Control hands back; fly home through the haze and land.
- **Debrief:** objective, identification, destination, false positives, time, time in Mission Control, fuel, recon findings and what each return really was.

| Mission Control | Touch | Keyboard |
| --- | --- | --- |
| Radar / camera | RADAR / CAMERA tabs | 1 / 2 |
| Select a return | tap it (list or display) | A–D |
| Move the orbit | tap the radar display | — |
| Mark as the truck | MARK AS THE TRUCK | M |
| Take controls | TAKE CONTROLS | O or Enter |

The original open-ended investigation is still available from the title screen as **Open case · Varrow Basin**.

## The open case loop

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

Vertical stick direction can be switched between **Standard** (stick up / ↑ climbs) and **Inverted** (stick up / ↑ dives) under *Flight controls* in the pause menu. It applies to touch and keyboard, never to throttle, and is remembered across reloads and new cases.

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
| `src/mission/mission01.ts` | Mission 01 content: sector, vehicle returns, destination, briefing text |
| `src/mission/missionDef.ts` | What a mission declares: operations area, orbit height, hand-back conditions |
| `src/mission/crew.ts` | Crew stations (pilot / operator), entry rules, forced hand-back, hand-over report (pure, tested) |
| `src/flight/autopilot.ts` | Orbit autopilot that drives the unchanged flight model while the player operates (pure, tested) |
| `src/ui/opsConsole.ts` | Mission Control console: radar display, camera feed frame, returns, mark, take controls |
| `src/mission/mission.ts` | Mission rules: objective state machine, identification, debrief (pure, tested) |
| `src/mission/vehicles.ts` | Route-following vehicles (pure, tested); `missionScene.ts` renders sector and vehicles |
| `src/game/Game.ts` | Orchestration: mission and case sorties, modes, actions, world markers |

Automated checks live in `tests/`. A Playwright playthrough script (desktop + iPhone viewports) was used for QA and the screenshots in `docs/screenshots/`.
