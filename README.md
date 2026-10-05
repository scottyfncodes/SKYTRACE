# SKYTRACE

An aerial reconnaissance mystery. Fly a small aircraft over a miniature landscape, scan the ground with radar, mark what does not add up, leave sensor packages where the night matters, and connect the evidence on an intelligence map.

**Play it:** https://scottyfncodes.github.io/SKYTRACE/

The plane gets you there. The sensors show you what you missed. Your deductions reveal what it means.

## The operation

Every mission is a reconnaissance operation in five stages:

**PREFLIGHT → OUTBOUND → RECON → RETURN → DEBRIEF**

1. **Preflight.** The briefing puts the objective first (primary, secondaries, intel, target area, weather, expected conditions, window, constraints, threats). Then plan the job:
   - **Aircraft:** KESTREL (single seat, fast, quiet, short legs, fragile in weather), HERON (two crew, long range, weather-tolerant, louder), ALBATROSS (full crew, four bays; unlocked by experience).
   - **Crew:** a copilot flies the recon orbit for you, tighter than the autopilot. A sensor operator identifies faster or takes better photographs. A navigator puts storm cells on the scope from take-off.
   - **Equipment:** search radar, optical camera, thermal imager, SIGINT (unlocked). Each answers a different question. A checklist shows whether the plan can do the primary objective.
2. **Outbound (you fly).** A route of eight rings: the take-off flies the first, then climb north around a storm cell, cross the high ground and drop under the ridge radar into Sector 7. The next ring glows amber, the two after it show the way. Through a ring: GATE CLEARED. Wide of it: MISSED, and the route moves on. Storm cells are deadly: inside one the airframe is pounded and struck by lightning, the aircraft flies worse as damage builds, and stay too long and it breaks up (AIRCRAFT LOST). Climbing over the sector above your stealth ceiling gets you spotted. The last ring puts you ON STATION and Mission Control takes over.
3. **Recon (Mission Control).** Every operation is a fresh puzzle: the truck's letter is shuffled and three of four look-alikes are out there (a parked lorry, our own scout patrol, a lorry outside the sector, a lorry cutting across the fields), each breaking the brief on a different clue. The console guides you: FIND → PICK → LOOK → MATCH → MARK, with a clue card that ticks the brief against what your sensors can tell; what your loadout cannot check stays a question mark (no OPTICAL: you can't tell who is on a road). The autopilot or your copilot flies an orbit. You run the sensors, against a weather-front clock: haze builds and slows the optical camera. Objectives change as you discover things: locate the truck, photograph it, then *objective updated* (track it to its stop), then a barge is revealed (photograph the transfer). Extract any time once the primary is done.
4. **Return (you fly again).** The controls come back with a ring already ahead of you. The front has arrived (a cloud deck at 300 m, a new storm cell, haze), and the route home is a lower, tighter slalom. Leaving the sector raises RADAR CONTACT: every ring is now on a clock and shrinks as it runs, closing if you are too slow. If you were spotted on the way in, the clock starts at the first ring. The last ring lines you up on the runway.
5. **Debrief.** A recon report: primary, secondaries, identification, evidence quality, flight discipline, fuel, damage, a grade, credits and XP, unlocks, and the intelligence the recon established.

Progression (credits, XP, unlocks, best grade, last loadout) is saved in the browser, separately from the open case.

| Mission Control | Touch | Keyboard |
| --- | --- | --- |
| Sensors | RADAR / OPTICAL / THERMAL / SIGINT tabs | 1–4 |
| Select a return | tap it (list or display) | A–E |
| Move the orbit | tap the radar display | — |
| Mark as the truck | MARK AS THE TRUCK | M |
| Photograph | TAKE PHOTO | P |
| Extract | EXTRACT · FLY HOME | X |
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
| `src/operation/catalog.ts` | Aircraft, crew and equipment definitions |
| `src/operation/loadout.ts` | Loadout validation and the capabilities a plan gives you (pure, tested) |
| `src/operation/gates.ts` | Ring routes (plane-crossing, misses, RADAR CONTACT clock) and weather hazards for the flying legs (pure, tested) |
| `src/operation/operation.ts` | Stage machine: preflight, outbound, recon, return, debrief (pure, tested) |
| `src/operation/score.ts`, `career.ts` | Recon report, grade, rewards; progression and unlocks (pure, tested) |
| `src/ui/preflight.ts` | Briefing and loadout screen |
| `src/mission/missionDef.ts` | What a mission declares: briefing, operations area, recon window, outbound and return legs |
| `src/mission/crew.ts` | Crew stations (pilot / operator), entry rules, forced hand-back, hand-over report (pure, tested) |
| `src/flight/autopilot.ts` | Orbit autopilot that drives the unchanged flight model while the player operates (pure, tested) |
| `src/ui/opsConsole.ts` | Mission Control console: radar display, camera feed frame, returns, mark, take controls |
| `src/mission/mission.ts` | Mission 01 recon rules: objective chain, sensors, photographs, dynamic objectives (pure, tested) |
| `src/mission/vehicles.ts` | Route-following vehicles (pure, tested); `missionScene.ts` renders sector and vehicles |
| `src/game/Game.ts` | Orchestration: mission and case sorties, modes, actions, world markers |

Automated checks live in `tests/`. A Playwright playthrough script (desktop + iPhone viewports) was used for QA and the screenshots in `docs/screenshots/`.
