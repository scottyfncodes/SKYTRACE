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
3. **Recon (Mission Control).** A small strategy game on a board, and the bridge between the two flights. The autopilot (or your copilot) orbits; you have **12 minutes** before the front arrives. The map shows what the radar already knows (four vehicles, moving or parked) and **three ways home** (NORTH RIDGE, CENTRE LINE, RIVER VALLEY), each with two unscouted spots marked **?**. Every operation deals two storm cells, a low cloud deck, a radar site, a supply cache and one clear stretch across those six spots.
   - **Assets cost minutes**, some are limited, and each answers a different question: **OPTICAL** (size, count, road), **THERMAL** (size, count, engine heat), **SIGINT** (every radio and every radar site at once), **DRONE ×2** (the whole truth about one spot or one vehicle), **SCOUTS ×1** (a ground report: weather only, so it can tell you a spot is not a storm without saying what it is). Tap an asset and then a target, drag it onto the map, or use the buttons on a selected card.
   - **Information is partial and sometimes wrong.** The tower's forecast always gets one storm in the wrong place: finding out says *TOWER WAS WRONG*.
   - **Decide:** MARK the truck (a wrong call costs a minute and points), SHADOW it to find where it is going (a barge), and pick a route home. The panel shows the live **exit forecast** for the plan as it stands. Your plan is fixed when you press **EXECUTE MISSION**.
   - **Score:** OBJECTIVE, INTELLIGENCE, EFFICIENCY, RISK, BONUS, LOSSES → a total and a rank: **ACE / SOLID / ROUGH / SCRAMBLE**. If the clock runs out, the board executes itself.
   - **Score → Exit Profile:** the rank sets the tier (**OPTIMAL / STANDARD / DEGRADED / SCRAMBLE**: visibility, fuel, a shortcut, whether opportunities are open), and what you *found on your chosen route* builds its rings. A storm you found is routed around; one you missed sits on the rings. A radar site you found picks you up late; one you missed has you on the clock from the first ring. A cache you found (or the barge, if you shadowed the truck) becomes a bonus **photo-pass ring**, on a good exit only. A SCRAMBLE exit breaks low under radar lock with the front on your tail. The exit briefing reads it all out before you take the controls.
4. **Return (you fly again).** The controls come back wings-level with the first ring dead ahead of the nose, on screen at once, on the route Mission Control generated: its weather, cloud deck, storms, fuel and traffic are the ones your board produced. Every ring home is on a clock: it starts shrinking the moment you hit the one before it (the first one as soon as you have the controls) and closes if you are too slow. Under RADAR CONTACT the closing rings turn red and the heartbeat quickens. Bonus rings (ice blue, cued *PHOTO PASS*) are optional: fly through for the reward, pass them by at no cost. The last ring lines you up on the runway.
5. **Debrief.** A recon report: the Mission Control score and rank with your personal best (and a hint at what a better board would have found), primary, secondaries, identification, evidence quality, opportunities taken, flight discipline, fuel, damage, a grade, credits and XP, unlocks, and the intelligence the recon established.

Progression (credits, XP, unlocks, best grade, last loadout) is saved in the browser, separately from the open case.

| Mission Control | Touch | Mouse / keyboard |
| --- | --- | --- |
| Look at a vehicle or a route spot | tap it on the map | click |
| Use an asset | drag it onto a target, or tap it then the target | same |
| Mark the truck / shadow it | buttons on the vehicle's card | same |
| Choose the way home | tap a route line or NORTH / CENTRE / RIVER | same |
| Execute | EXECUTE MISSION | Enter |
| Take the controls after the briefing | TAKE CONTROLS | Enter |

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
| `src/control/board.ts` | Mission Control rules: assets (data table), what each reveals, the tower forecast, marking, the clock, scoring and rank (pure, tested) |
| `src/control/exit.ts` | Score → Exit Profile: tier, then the return leg generated from the chosen corridor and what was discovered on it (pure, tested) |
| `src/mission/mission01Control.ts` | Mission 01's board: the three corridors, their rings and unscouted spots, the cell mix, limited assets |
| `src/ui/missionBoard.ts` | The board: map, asset tray (tap or drag), target card with live telephoto viewfinder, route plan with live exit forecast, EXECUTE and the result sequence |
| `src/mission/mission.ts` | Mission 01 recon state read by the report (returns, verdicts, evidence, intelligence); also the original real-time sensor model (pure, tested) |
| `src/mission/vehicles.ts` | Route-following vehicles (pure, tested); `missionScene.ts` renders sector and vehicles |
| `src/game/Game.ts` | Orchestration: mission and case sorties, modes, actions, world markers |

Automated checks live in `tests/`. A Playwright playthrough script (desktop + iPhone viewports) was used for QA and the screenshots in `docs/screenshots/`.
