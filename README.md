# SKYTRACE

An aerial reconnaissance mystery. Fly a small aircraft over a miniature landscape, scan the ground with radar, mark what does not add up, leave sensor packages where the night matters, and connect the evidence on an intelligence map.

**Play it:** https://scottyfncodes.github.io/SKYTRACE/

The plane gets you there. The sensors show you what you missed. Your deductions reveal what it means.

## RECON → EXECUTE → ESCAPE

Every mission is played in the same three phases, whatever its story. The player always knows which one they are in: the objective on the HUD carries the phase and three dots (`02 EXECUTE ●●○`), each phase has its colour (RECON ice blue, EXECUTE amber, ESCAPE red), and a short card with a sound sting announces each one.

| Phase | The question | Mission 01 |
| --- | --- | --- |
| **01 RECON** | What is happening? | Fly the rings into Sector 7, then find the truck at Mission Control, on a clock |
| **02 EXECUTE** | What do I do about it? | Lined up on the truck: fly through the one ring over it and the tracker drops |
| **03 ESCAPE** | What went wrong? Get out. | The truck bolts for the river, the sector turns red, the weather closes in: timed rings home |

Text gives the immediate objective; the world tells the rest (the truck pulls over for the run and runs after the drop, its lamps come on, the sector boundary turns from amber to red, the haze rolls in). Each mission's story is data (`story` in its `MissionDef`: a hook, one verb per phase, a title and one line per phase), and so are its EXECUTE and ESCAPE profiles, so new mission types reuse the same rhythm. The one-line **case file** on the title card and the debrief is the campaign: see below.

## The case file is the campaign

The five lines of the case file are five operations. Same world, same Mission Control puzzle, same three phases: each page pushes the rhythm a little further, and the phases answer each other.

| Page | The line | EXECUTE | ESCAPE | Board |
| --- | --- | --- | --- | --- |
| 01 | A supply truck went dark in Sector 7. | Drop the tracker. Confirmed on evidence, the truck pulls over; marked on a hunch, it keeps rolling | As Mission Control built it | 90 s |
| 02 | The tracker stopped at the river. A barge was waiting. | Tag it rolling: the ring moves with the truck | Tighter clocks | 80 s |
| 03 | The tower forecast was wrong. Every time. On purpose? | One pass, 40 seconds: the ring closes on you | Haze | 70 s · the tower lies twice |
| 04 | The barge answers on a military band. | A 22 m skim to read its radio. Nothing is dropped | RADAR CONTACT from the first ring | 70 s · the tower lies twice |
| 05 | Someone flew this route before you. Their log ends in Sector 7. | Rolling, 35 seconds, 30 m | Everything at once | 60 s · the tower lies twice |

A clean operation on the newest page (target found, pass made, home safe) turns the next one; the last page turned closes the case with one more line. Every page turned stays open: the title card shows them as chips, and each keeps its own best grade and best board score. Replaying an earlier page never moves the story.

**The phases answer each other** (`operation/consequence.ts`, pure and tested):

- RECON → EXECUTE: the board's rank sizes the ring (ACE gets the whole hoop, SCRAMBLE two thirds of it). A target identified on evidence holds still for the run; one marked on a hunch is still rolling when you line up. The EXECUTE card says which.
- EXECUTE → ESCAPE: a pass made is the plan Mission Control built. A pass missed was seen: RADAR CONTACT from the first ring home and a shade less to see by. No target at all: they know you are here anyway.
- Mission Control → ESCAPE: the seconds left on the board's clock when the plan was locked set how fast the first ring home closes (1.5× the usual clock with a full clock to spare, 0.55× with none).
- Outbound → ESCAPE (as before): spotted on the way in, the radar has you from the first ring.

**The pass is the moment** (`Game.onDrop`, `tickReaction`), in three beats: the stamp, the payload falls, the sound dips, the instruments step back and the view widens a touch; a second later the truck's lamps come on and it bolts, the sector boundary turns from amber to red in a wave, a low alarm under everything, the camera shudders; then the first ring home irises in dead ahead, the HUD goes red and the clock starts. Wheels down at base gets the same care: a HOME stamp and a settling cadence before the debrief.

**EXECUTE is data.** A mission's `execute` profile is where the ring stands (`agl`, `r`, `run`), whether the target holds still (`halt`: always, only once confirmed, never), whether the pass is on a clock (`window`), whether something leaves the aircraft (`drops`), and what the stamps say. Its `escape` profile is the clock pace, forced contact, a visibility cap and the world's one-line reaction. A drop, a skim, a photo pass and a pickup are one ring with different numbers and words; firefighting (find the fire, drop water, escape the weather), rescue (find them, drop supplies, get out), demolition (find the structure, one low pass, get out before it goes) and delivery are entries in `mission/operations.ts` with their own words, numbers and cast.

## The operation

Under the three phases, every mission is a reconnaissance operation in these stages:

**PREFLIGHT → OUTBOUND → RECON → EXECUTE → RETURN → DEBRIEF**

1. **Preflight.** The briefing puts the objective first (primary, secondaries, intel, target area, weather, expected conditions, window, constraints, threats). Then plan the job:
   - **Aircraft:** KESTREL (single seat, fast, quiet, short legs, fragile in weather), HERON (two crew, long range, weather-tolerant, louder), ALBATROSS (full crew, four bays; unlocked by experience).
   - **Crew:** a copilot flies the recon orbit for you, tighter than the autopilot. A sensor operator identifies faster or takes better photographs. A navigator puts storm cells on the scope from take-off.
   - **Equipment:** search radar, optical camera, thermal imager, SIGINT (unlocked). Each answers a different question. A checklist shows whether the plan can do the primary objective.
2. **Outbound (you fly).** A route of eight rings: the take-off flies the first, then climb north around a storm cell, cross the high ground and drop under the ridge radar into Sector 7. The next ring glows amber, the two after it show the way. Through a ring: GATE CLEARED. Wide of it: MISSED, and the route moves on. Storm cells are deadly: inside one the airframe is pounded and struck by lightning, the aircraft flies worse as damage builds, and stay too long and it breaks up (AIRCRAFT LOST). Climbing over the sector above your stealth ceiling gets you spotted. The last ring puts you ON STATION and Mission Control takes over.
3. **Recon (Mission Control).** A small strategy game on a board, and the bridge between the two flights. The autopilot (or your copilot) orbits; a clock runs in **real seconds** (90 on the first page, down to 60 on the last) before the front arrives, and it never stops: thinking costs time too. The board is two steps with one tap each.
   - **Step 1 · FIND THE TRUCK.** The map shows what the radar already knows: six vehicles, moving or parked, five of them look-alikes that each break the brief on one point (parked; three small 4x4s; two tankers running together; a tractor off road; a quarry tipper that is still talking; a lorry on the wrong side of the sector line). Tap a vehicle: its card shows the five clues it fits, fails or has not been checked against, and the looks you can take: **LOOK · OPTICAL** (size, count, road), **LOOK · THERMAL** (size, count, engine heat), a **DRONE** (everything about it, radio included, ×2). **SIGINT** on the step bar hears every radio at once. Each look takes its seconds off the clock while it plays. **MARK AS THE TRUCK** ends the step (a wrong call costs eight seconds and points). Can't find it? *WAY OUT ›* moves on without a target.
   - **Step 2 · WAY OUT.** The vehicles dim and the **three ways home** (NORTH RIDGE, CENTRE LINE, RIVER VALLEY) light up, each with two unscouted spots marked **?**. Every operation deals two storm cells, a low cloud deck, a radar site, a supply cache and one clear stretch across those six spots. Tap a route to fly it; tap a **?** on it to scout it with a **DRONE** or the **SCOUTS** (×1, a ground report: weather only). **SHADOW** the marked truck from the step bar to find where it is going (a barge). The panel shows the live **exit forecast**. **LOCK THE PLAN** fixes it; when the clock reaches zero the board locks itself.
   - **Information is partial and sometimes wrong.** The tower's forecast misplaces a storm (two, on later pages): finding out says *TOWER WAS WRONG*.
   - **Score:** OBJECTIVE, INTELLIGENCE, EFFICIENCY (the seconds left when you locked), RISK, BONUS, LOSSES → a total and a rank: **ACE / SOLID / ROUGH / SCRAMBLE**.
   - **The clock follows you out.** What was left on it when you locked sets how fast the first ring home closes: lock with time to spare and the first ring waits; lock as the front arrives and it is already shutting. The ESCAPE card says which.
   - **Score → Exit Profile:** the rank sets the tier (**OPTIMAL / STANDARD / DEGRADED / SCRAMBLE**: visibility, fuel, a shortcut, whether opportunities are open), and what you *found on your chosen route* builds its rings. A storm you found is routed around; one you missed sits on the rings. A radar site you found picks you up late; one you missed has you on the clock from the first ring. A cache you found (or the barge, if you shadowed the truck) becomes a bonus **photo-pass ring**, on a good exit only. A SCRAMBLE exit breaks low under radar lock with the front on your tail. The exit briefing reads it all out before you take the controls.
4. **Execute (you fly).** With the truck marked, the controls come back lined up on it: the truck pulls over, a beam and a ground reticle mark it, and one big ring stands low over it. Fly through: the tracker parachutes down (*PAYLOAD AWAY*). Wide of it: *DROP MISSED*. Either way the world reacts and the escape begins. No truck marked: straight to the escape.
5. **Escape (you fly again).** The controls come back wings-level with the first ring dead ahead of the nose, on screen at once, on the route Mission Control generated: its weather, cloud deck, storms, fuel and traffic are the ones your board produced. Every ring home is on a clock: it starts shrinking the moment you hit the one before it (the first one as soon as you have the controls) and closes if you are too slow. Under RADAR CONTACT the closing rings turn red and the heartbeat quickens. Bonus rings (ice blue, cued *PHOTO PASS*) are optional: fly through for the reward, pass them by at no cost. The last ring lines you up on the runway.
6. **Debrief.** One tick or cross per phase (RECON, EXECUTE, ESCAPE), the case file line, and a recon report: the Mission Control score and rank with your personal best (and a hint at what a better board would have found), primary, secondaries, identification, evidence quality, opportunities taken, flight discipline, fuel, damage, a grade, credits and XP, unlocks, and the intelligence the recon established.

Progression (credits, XP, unlocks, best grade, last loadout) is saved in the browser, separately from the open case.

| Mission Control | Touch | Mouse / keyboard |
| --- | --- | --- |
| Step 1: look at a vehicle | tap it on the map | click |
| Look at it, or mark it | LOOK / MARK buttons on its card; SIGINT on the step bar | same |
| Step 2: choose the way home | tap a route line or NORTH / CENTRE / RIVER | same |
| Scout a spot on it | tap the ?, then DRONE or SCOUTS on its card | same |
| Shadow the marked truck | SHADOW on the step bar | same |
| Lock the plan | LOCK THE PLAN | Enter |
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
| `src/operation/operation.ts` | Stage machine: preflight, outbound, recon, execute, return, debrief (pure, tested) |
| `src/operation/phases.ts` | RECON → EXECUTE → ESCAPE: which phase a stage is, the HUD dots, the story copy shape (pure, tested) |
| `src/operation/story.ts` | The case file: one page per operation, turned by a clean one; replay never moves it (pure, tested) |
| `src/operation/consequence.ts` | The phases answer each other: rank sizes the ring, evidence halts the target, a miss means contact (pure, tested) |
| `src/mission/operations.ts` | The five operations, one per page of the case file: EXECUTE and ESCAPE profiles, board minutes, how often the tower lies |
| `src/operation/score.ts`, `career.ts` | Recon report, grade, rewards; progression and unlocks (pure, tested) |
| `src/ui/preflight.ts` | Briefing and loadout screen |
| `src/mission/missionDef.ts` | What a mission declares: briefing, operations area, recon window, outbound and return legs |
| `src/mission/crew.ts` | Crew stations (pilot / operator), entry rules, forced hand-back, hand-over report (pure, tested) |
| `src/flight/autopilot.ts` | Orbit autopilot that drives the unchanged flight model while the player operates (pure, tested) |
| `src/control/board.ts` | Mission Control rules: assets (data table), what each reveals, the tower forecast, marking, the real-time clock, scoring and rank (pure, tested) |
| `src/control/exit.ts` | Score → Exit Profile: tier, then the return leg generated from the chosen corridor and what was discovered on it (pure, tested) |
| `src/mission/mission01Control.ts` | Mission 01's board: the three corridors, their rings and unscouted spots, the cell mix, limited assets |
| `src/ui/missionBoard.ts` | The board in two steps: map, step bar, target card with live telephoto viewfinder, route plan with live exit forecast, LOCK and the result sequence |
| `src/mission/mission.ts` | Mission 01 recon state read by the report (returns, verdicts, evidence, intelligence); also the original real-time sensor model (pure, tested) |
| `src/mission/vehicles.ts` | Route-following vehicles (pure, tested); `missionScene.ts` renders sector and vehicles |
| `src/game/Game.ts` | Orchestration: mission and case sorties, modes, actions, world markers |

Automated checks live in `tests/`. A Playwright playthrough script (desktop + iPhone viewports) was used for QA and the screenshots in `docs/screenshots/`.
