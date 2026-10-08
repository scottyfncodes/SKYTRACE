# SKYTRACE · Search & Rescue

Someone needs help. Figure out what they need, choose the right rescue vehicle, fly there, perform the rescue yourself, and bring them home.

**Play it:** https://scottyfncodes.github.io/SKYTRACE/

The flying is the heart. The rescue hoist is the hook. Pre-Flight gives the flying a purpose.

| | |
| --- | --- |
| ![Title](docs/screenshots/title.png) | ![Pre-Flight](docs/screenshots/preflight.png) |
| ![The hoist](docs/screenshots/hoist.png) | ![Debrief](docs/screenshots/debrief.png) |

## The loop

**EMERGENCY CALL → PRE-FLIGHT → LAUNCH → FLY → FIND THEM → HOVER & HOIST → FLY THEM HOME → DEBRIEF**

1. **Rescue calls.** The opening screen lists the calls waiting. The first one is open; finishing a rescue opens the next, and new tools with it.
2. **Pre-Flight.** What happened, where, to how many people, in what conditions, and what you send. One screen, readable in a few seconds:
   - **Situation:** one line, a place, and four condition chips (terrain and elevation, wind, people, visibility), plus a map with the base, the search area and the hospital.
   - **Response:** pick an aircraft, one crew member and the equipment. The call's recommended plan is preselected and marked ★ BEST FIT. Pre-Flight says plainly when a plan cannot do the job ("Take the rescue basket: there is nowhere to land") and warns when it will be hard ("Room for 2: 3 people means 2 trips").
   - **LAUNCH MISSION.**
3. **Lift off.** The rotors spin up on the pad and the helicopter lifts itself clear. Then it is yours.
4. **Search.** You know roughly where they are: a blue search area. Get close and they signal (a red flare, or smoke from a campfire). Get closer and you spot them: **SPOTTED!** An orange pin marks them from then on.
5. **The rescue.** Fly over them, slow down, press **HOVER & HOIST**. The camera drops down beside the ledge. The stick now moves the helicopter forward, back and sideways; the lever becomes the winch: slide the basket down. The wind keeps pushing you (the hoist scope shows which way). Land the basket inside the ring and a survivor walks over and climbs in. Lift it too soon and they step back. Reel them in: **SECURED!** Go again for the next one.
6. **Bring them home.** Follow the green beacon to Varrow Hospital and settle onto the H. They walk to the ambulance. If the cabin was full, lift off and go back for the rest.
7. **Debrief.** Who came home, how long it took, how the extraction went, and up to three stars: rescued everyone, under par time, and no bumps (never dropping someone in the basket back onto the ground).

Run out of fuel and the mission fails (TRY AGAIN relaunches it with the same plan).

## Rescues

| Call | Situation | What makes it hard | Opens |
| --- | --- | --- | --- |
| 🏔️ **Mountain Rescue** | Two climbers stranded on the north ridge of Mount Kell | A narrow ledge, a moderate north-westerly | Lost Hiker · Beacon Receiver · Spotter |
| 🌲 **Lost Hiker** | A hiker missing in Keld Forest; one phone ping | A big search area, haze, a clearing ringed by trees | Storm on the Summit · Heavy Rescue Helicopter · Thermal Camera |
| ⛈️ **Storm on the Summit** | Three climbers caught near the summit | Strong gusts, low cloud, three people (two trips in the light helicopter) | |

Capsized Boat, Forest Fire, Flood Rescue, Injured Skier and Distress Beacon are defined as data and wait for their vehicles and kit (the Rescue Boat, the Search Aircraft, the water bucket, the rescue swimmer).

## The fleet

Tools, not stat sheets: each one has an obvious job.

| | Strengths | |
| --- | --- | --- |
| 🚁 **Rescue Helicopter** | Hovers · Rescue hoist · Nimble · seats 2 | From the start |
| 🚁 **Heavy Rescue Helicopter** | Carries 4 · Steady in wind (half the drift) · 3 equipment slots · slower | After Lost Hiker |
| ✈️ Search Aircraft | Fast · Long range · Finds beacons | Coming |
| 🚤 Rescue Boat | Water rescue · Tows boats · Carries 6 | Coming |

**Crew** (one seat): the Winch Operator steadies the basket (half the swing), the Paramedic gets people into the basket twice as fast, the Spotter sees people from much further away.

**Equipment:** the Rescue Basket (the hoist: required for every rescue so far), the Beacon Receiver (the arrow points at the survivor's phone while you search), the Thermal Camera (spots people from twice as far, even in cloud).

## Controls

| | Touch (iPhone) | Keyboard |
| --- | --- | --- |
| Steer (bank) and climb / descend | Drag on the steering side | Arrows / WASD |
| Speed (bottom: hover) | Lever on the other side | Shift / Q faster, Ctrl / Z slower |
| Hover & hoist / fly on | The orange button over the people | Space, Enter or H |
| In a hover: hold position | Drag (up is always forward) | Arrows / WASD |
| In a hover: the winch | The lever is the basket: slide it down to lower, up to reel in | Ctrl / Z lower, Shift / Q reel in |
| Pause | II | Esc / P |

In the pause menu: **Climb** (stick up or stick down climbs), **Steer with** (left or right thumb; the lever, minimap and buttons move to the other side), sound, and the radio voice (the device's speech voice reads the radio; subtitles are always on). Preferences and progress are saved in the browser.

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

Plain TypeScript + Vite + Three.js, no backend. The rules are pure, data-driven and tested; the game wires them to the scene and the screens.

| Module | Role |
| --- | --- |
| `src/flight/aircraft.ts` | The arcade flight model (pure, tested). Unchanged for aeroplanes; a `climbRate` in the profile flies it as a helicopter with the same stick and lever |
| `src/flight/camera.ts` | Chase camera; drops down beside the people in the hoist view |
| `src/flight/helicopterMesh.ts` | The Rescue and Heavy Rescue helicopters: spinning rotors, lights, the hoist arm and its winch point |
| `src/rescue/catalog.ts` | Vehicles, crew and equipment as data, with the capabilities each grants |
| `src/rescue/missions.ts` | Rescue calls as data: situation, conditions, site, search area, signal, requirements, recommended plan, radio, unlocks |
| `src/rescue/loadout.ts` | The Pre-Flight plan: choices, checks (blocking and warnings), and the `Plan` it gives the flight (pure, tested) |
| `src/rescue/run.ts` | One rescue as a state machine: takeoff → search → rescue → return → complete or failed; objectives; when you can hoist and land (pure, tested) |
| `src/rescue/hoist.ts` | The basket on its cable (a pendulum under the winch, pushed by the wind, dragged when taut) and the survivors walking to it and climbing in (pure, tested) |
| `src/rescue/hover.ts` | Station-keeping in the hover: stick moves, altitude holds, the wind pushes (pure, tested) |
| `src/rescue/wind.ts` | Wind with gusts, deterministic in time (pure, tested) |
| `src/rescue/progress.ts` | Completed rescues, stars, best times, last plan; unlocks derived from `unlockedBy` (pure, tested) |
| `src/rescue/debrief.ts` | Three lines and up to three stars (pure, tested) |
| `src/game/RescueGame.ts` | Orchestration: screens, launch, flight, hover and hoist, landing, debrief, radio and sound cues |
| `src/ui/` | Title (rescue calls), Pre-Flight, HUD (objective, nav arrow, people, fuel, radio, lever / winch, minimap and hoist scope), valley map |
| `src/world/` | The valley (terrain with Mount Kell and its ledges, forests, farmland, village), the helipads, hospital and ambulance, the people, the basket, signals and markers |
| `src/core/` | Input (touch stick, lever, keyboard), settings, the synthesised soundscape (rotor, winch, chimes), the radio |

**Adding a rescue** of an existing kind is a new entry in `MISSIONS`. **A new vehicle** is an entry in `VEHICLES` (and a mesh if it flies something new). **New equipment** is an entry in `EQUIPMENT` with the capability it grants; a new capability (water, fire) needs the mechanic it unlocks.

Automated checks live in `tests/`. A Playwright bot flew the Mountain Rescue end to end through the real keyboard controls at iPhone landscape and portrait sizes for QA.
