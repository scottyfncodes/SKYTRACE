/**
 * The Varrow Basin case: a compact, interconnected investigation.
 * All narrative content lives here. Mechanics only read it.
 */
export type ContactKind = 'structure' | 'vehicle' | 'tracks' | 'signal' | 'installation' | 'landmark' | 'settlement';

export interface LinkDef {
  to: string;
  label: string; // "fresh tracks lead to"
  /** Stage the source contact must have reached. */
  needs: 'observed' | 'detected' | 'resolved' | 'sensor';
}

export interface ContactDef {
  id: string;
  name: string;
  kind: ContactKind;
  x: number;
  z: number;
  /** Is this location printed on the supplied map? */
  onMap: boolean;
  mapLabel?: string;
  /** How easy a visual identification is: clear = from normal altitude, low = needs a low pass, none = cannot be seen. */
  visible: 'clear' | 'low' | 'none';
  /** Radar return strength 0..1. */
  signature: number;
  /** 0..1 — concealment reduces scan quality; high values need low passes. */
  concealment: number;
  mobile?: boolean;
  /** Radar alone cannot resolve this: an interpretation needs sensor data. */
  texts: {
    observed: string;
    detected: string;
    resolved: string;
    sensor?: string;
    sensorPrelim?: string;
  };
  facts: { observed?: string[]; resolved?: string[]; sensor?: string[] };
  questions: string[];
  leads: { detected?: string; observed?: string; resolved?: string };
  links: LinkDef[];
}

export const CONTACTS: readonly ContactDef[] = [
  {
    id: 'quarry',
    name: 'Harrow Quarry',
    kind: 'installation',
    x: 720,
    z: 380,
    onMap: true,
    mapLabel: 'Quarry (disused)',
    visible: 'clear',
    signature: 0.9,
    concealment: 0.05,
    texts: {
      observed: 'Abandoned quarry. A rusted crusher tower, two empty sheds, a yard of pale spoil. Nothing moves.',
      detected: 'Strong hard returns from the quarry yard. Several metallic contacts parked beside the sheds.',
      resolved:
        'The yard is not empty. Two vehicles are parked under the shed roofs and compacted wheel ruts run out of the yard to the north-west, onto a road the map marks as disused.',
    },
    facts: {
      observed: ['Quarry buildings intact but derelict in appearance'],
      resolved: ['Vehicles parked under cover at the quarry', 'Fresh ruts leave the yard to the north-west'],
    },
    questions: ['Who is parking vehicles at a disused quarry?', 'Where do the ruts go?'],
    leads: {
      observed: 'The quarry looks dead from altitude. Scan it: hard returns will show what the eye cannot.',
      resolved: 'Ruts leave the quarry to the north-west. Follow the old haul road with the radar active.',
    },
    links: [{ to: 'haulroad', label: 'ruts lead onto', needs: 'resolved' }],
  },
  {
    id: 'haulroad',
    name: 'Old haul road',
    kind: 'tracks',
    x: 470,
    z: 80,
    onMap: true,
    mapLabel: 'Haul road (disused)',
    visible: 'none',
    signature: 0.55,
    concealment: 0.25,
    texts: {
      observed: '',
      detected: 'Linear return crossing open ground: compacted tracks, recent. The map says this road has been closed for years.',
      resolved:
        'Heavy tyre tracks, repeated and recent, running from the quarry into the eastern edge of Keld Forest. The tracks do not stop at the tree line.',
    },
    facts: {
      resolved: ['The disused haul road carries recent heavy traffic', 'The tracks continue under the Keld Forest canopy'],
    },
    questions: ['What is driving a closed road?', 'What is under the trees where the tracks end?'],
    leads: {
      detected: 'A linear return crosses open ground at the haul road. Make a lower pass to resolve it.',
      resolved: 'The tracks vanish into Keld Forest. Scan the forest low and slow: canopy hides a lot from altitude.',
    },
    links: [{ to: 'clearing', label: 'tracks continue to', needs: 'resolved' }],
  },
  {
    id: 'clearing',
    name: 'Keld Forest shed',
    kind: 'structure',
    x: 240,
    z: -170,
    onMap: false,
    visible: 'low',
    signature: 0.8,
    concealment: 0.75,
    texts: {
      observed: 'A long steel-roofed shed in a cut clearing, invisible from altitude. There is no structure here on the supplied map.',
      detected: 'Rectangular hard return under the canopy. A building-sized object where the map shows unbroken forest.',
      resolved:
        'A forty-metre shed with a steel roof, hidden by a ring of uncut trees. Ruts on its north side. It is not on the map and nobody filed a permit for it.',
      sensor:
        'Sensor log: two vehicle arrivals in the night (02:10, 03:40). Engines idle beside the shed for six minutes each time, then depart on a southerly bearing toward the river.',
      sensorPrelim: 'Preliminary: intermittent engine noise and door movement at the shed.',
    },
    facts: {
      observed: ['An unmapped shed stands in a clearing in Keld Forest'],
      resolved: ['The shed is deliberately hidden by uncut trees', 'Vehicle ruts lead to and from the shed'],
      sensor: ['Vehicles call at the shed at night and leave toward the river'],
    },
    questions: ['Why hide a shed in a forest?', 'What happens here after dark?'],
    leads: {
      detected: 'Something building-sized is under the canopy at Keld Forest. Fly low over it: the radar needs a close pass to resolve it.',
      resolved: 'The shed only comes alive at night. Deploy a sensor package within range of it and let it listen.',
    },
    links: [
      { to: 'dock', label: 'night departures head to', needs: 'sensor' },
      { to: 'truck', label: 'vehicle calls at', needs: 'sensor' },
    ],
  },
  {
    id: 'tower',
    name: 'Varrow Ridge relay',
    kind: 'signal',
    x: -120,
    z: -640,
    onMap: true,
    mapLabel: 'Weather relay',
    visible: 'clear',
    signature: 0.7,
    concealment: 0.1,
    texts: {
      observed: 'A steel lattice tower on the ridge crest with an aviation light. The map lists it as a weather relay. It looks like one.',
      detected: 'Narrowband bursts from the ridge. A weather relay transmits on a schedule; these bursts are irregular.',
      resolved:
        'The bursts are not weather data. They occur only while the vehicle contact is moving in the open, and stop when it is under cover. The relay is a dispatcher.',
    },
    facts: {
      observed: ['Relay tower on the ridge, listed as a weather relay'],
      resolved: ['The tower transmits in irregular bursts', 'Bursts coincide with vehicle movement'],
    },
    questions: ['Why would a weather relay transmit irregularly?', 'Who is listening?'],
    leads: {
      observed: 'The ridge relay looks ordinary. Put the radar on it: the signal picture is not the visual picture.',
      detected: 'Irregular bursts from the ridge relay. Resolve them with a low pass over the tower.',
    },
    links: [{ to: 'truck', label: 'bursts coincide with', needs: 'resolved' }],
  },
  {
    id: 'truck',
    name: 'Unmarked flatbed',
    kind: 'vehicle',
    x: 720,
    z: 360,
    onMap: false,
    visible: 'low',
    signature: 0.65,
    concealment: 0.2,
    mobile: true,
    texts: {
      observed: 'A flatbed truck, tarpaulin over the load, no plates or markings.',
      detected: 'Moving contact on the eastern roads. It appears, holds a steady speed, and vanishes.',
      resolved:
        'The vehicle runs a fixed circuit: it emerges from the mine portal, drives to the quarry, takes the closed haul road into the forest, and later appears at the river landing. It disappears from radar wherever there is cover.',
    },
    facts: {
      observed: ['Unmarked flatbed with a covered load'],
      resolved: ['The vehicle runs a repeating circuit between the mine, the forest and the river'],
    },
    questions: ['Where does the vehicle go when it vanishes?', 'What is under the tarpaulin?'],
    leads: {
      detected: 'A moving contact comes and goes on the eastern roads. Track it with the radar: where does it hide?',
      observed: 'The flatbed carries a covered load. Follow it along its route to learn where it goes.',
    },
    links: [{ to: 'mine', label: 'circuit begins at', needs: 'resolved' }],
  },
  {
    id: 'mine',
    name: 'Blackwater adit',
    kind: 'installation',
    x: 680,
    z: -420,
    onMap: true,
    mapLabel: 'Mine (abandoned)',
    visible: 'clear',
    signature: 0.6,
    concealment: 0.3,
    texts: {
      observed: 'A timber mine portal at the foot of the ridge, boarded over. Weeds on the spoil heap. Abandoned, as the map says.',
      detected: 'Warm return from the portal. A boarded mine should be cold. There is airflow moving out of the adit.',
      resolved:
        'The adit is ventilated and warm. A generator signature sits just inside the portal, and the ground return shows the boards are a facade over a working entrance.',
      sensor:
        'Sensor log: the generator runs from 22:00 to 05:00. Ground vibration consistent with machinery below. A vehicle leaves the portal at 01:40 and returns at 04:50.',
      sensorPrelim: 'Preliminary: steady machinery vibration from inside the adit.',
    },
    facts: {
      observed: ['Mine portal boarded, apparently abandoned'],
      resolved: ['The adit is warm and ventilated', 'A generator runs inside the portal'],
      sensor: ['Machinery runs underground at night', 'A vehicle departs and returns through the portal at night'],
    },
    questions: ['Why is an abandoned mine warm?', 'What is being worked underground?'],
    leads: {
      observed: 'The adit looks abandoned. The assignment named it for a reason: scan it.',
      detected: 'The mine portal is warm. Resolve it with a low pass along the ridge foot.',
      resolved: 'Something runs inside the adit. A sensor package near the portal would record when, and for how long.',
    },
    links: [{ to: 'tower', label: 'nights coordinated by', needs: 'sensor' }],
  },
  {
    id: 'dock',
    name: 'Sallow river landing',
    kind: 'installation',
    x: 520,
    z: 505,
    onMap: true,
    mapLabel: 'Landing stage',
    visible: 'clear',
    signature: 0.75,
    concealment: 0.15,
    texts: {
      observed: 'A timber landing stage on the north bank. Crates under tarpaulin, a flat-bottomed barge moored tight under the overhang.',
      detected: 'Stacked metallic returns at the landing and a long hull against the bank. More cargo than a fishing stage needs.',
      resolved:
        'Crates are staged at the landing and loaded onto the barge at night. The barge is sized for the river and nothing else: whatever it carries leaves the basin by water.',
      sensor: 'Sensor log: loading noise from 03:50. The barge departs downstream at 04:15 and is not back by dawn.',
      sensorPrelim: 'Preliminary: hull movement and metallic contact at the landing.',
    },
    facts: {
      observed: ['Crates and a barge at the river landing'],
      resolved: ['Cargo moves from the landing onto a river barge'],
      sensor: ['The barge leaves downstream before dawn'],
    },
    questions: ['What is in the crates?', 'Where does the barge go?'],
    leads: {
      observed: 'The landing holds more cargo than a river stage should. Scan it.',
      resolved: 'The barge works at night. A sensor near the landing would tell you when it sails.',
    },
    links: [{ to: 'truck', label: 'cargo delivered by', needs: 'sensor' }],
  },
  {
    id: 'village',
    name: 'Ashby hamlet',
    kind: 'settlement',
    x: -350,
    z: 650,
    onMap: true,
    mapLabel: 'Ashby',
    visible: 'clear',
    signature: 0.5,
    concealment: 0.05,
    texts: {
      observed: 'Seven houses and a chapel along the road. Washing on a line. A chimney smoking.',
      detected: 'Ordinary returns from the hamlet: roofs, a tractor, a water tank.',
      resolved: 'Nothing unusual. The hamlet keeps daylight hours and its vehicles stay on the main road.',
    },
    facts: { resolved: ['Ashby hamlet shows no unusual activity'] },
    questions: ['Have the residents noticed anything?'],
    leads: {},
    links: [],
  },
  {
    id: 'stones',
    name: 'Moor stone ring',
    kind: 'landmark',
    x: -600,
    z: 150,
    onMap: true,
    mapLabel: 'Stone ring',
    visible: 'clear',
    signature: 0.4,
    concealment: 0,
    texts: {
      observed: 'A ring of standing stones on the open moor. Very old. Sheep paths between them.',
      detected: 'A ring of dense returns on the moor, evenly spaced.',
      resolved: 'Ancient standing stones. Nothing modern within two hundred metres of them.',
    },
    facts: { resolved: ['The stone ring is unrelated to the case'] },
    questions: [],
    leads: {},
    links: [],
  },
];

export const CONTACT_BY_ID: Readonly<Record<string, ContactDef>> = Object.fromEntries(CONTACTS.map((c) => [c.id, c]));

export const BRIEFING = {
  title: 'ASSIGNMENT: VARROW BASIN',
  lines: [
    'A county surveyor reported lights and engine noise at night in the Varrow Basin, a valley with one hamlet, a disused quarry and a mine that closed years ago.',
    'The supplied map is three years old. Treat it as a hypothesis, not a fact.',
    'Fly the basin. Scan what looks ordinary. Mark what does not add up. Leave sensors where the night matters.',
    'Report when the evidence supports an interpretation.',
  ],
  firstLead: 'Begin with the two sites named in the assignment: the quarry (J-8) and the mine (J-4). The relay on the ridge (F-3) is a convenient landmark.',
};

export interface Hypothesis {
  id: string;
  title: string;
  text: string;
  /** Evidence items: contact id + minimum stage. */
  evidence: { id: string; stage: 'observed' | 'detected' | 'resolved' | 'sensor'; text: string }[];
  correct: boolean;
  feedback: string;
}

export const HYPOTHESES: readonly Hypothesis[] = [
  {
    id: 'extraction',
    title: 'Covert extraction and river export',
    text: 'The "abandoned" Blackwater adit is being worked at night. Material is trucked by an unmarked vehicle along the closed haul road to a hidden shed in Keld Forest, then on to the river landing, where a barge carries it out of the basin. The ridge relay coordinates the runs.',
    correct: true,
    feedback: 'Assessment accepted. The chain holds from the adit to the river. Recommend ground follow-up at the landing and the forest shed.',
    evidence: [
      { id: 'mine', stage: 'resolved', text: 'Mine is warm and ventilated' },
      { id: 'quarry', stage: 'resolved', text: 'Fresh ruts leave the quarry' },
      { id: 'haulroad', stage: 'resolved', text: 'Closed haul road carries traffic' },
      { id: 'clearing', stage: 'resolved', text: 'Unmapped shed hidden in the forest' },
      { id: 'clearing', stage: 'sensor', text: 'Night departures from the shed toward the river' },
      { id: 'truck', stage: 'resolved', text: 'Vehicle circuit mine - forest - river' },
      { id: 'dock', stage: 'resolved', text: 'Cargo loaded onto a river barge' },
      { id: 'tower', stage: 'resolved', text: 'Relay bursts coincide with vehicle movement' },
    ],
  },
  {
    id: 'quarry',
    title: 'Unlicensed quarrying',
    text: 'Someone is taking stone from Harrow Quarry without a licence and moving it by road. The mine, the forest and the relay are unrelated.',
    correct: false,
    feedback: 'Assessment returned. The quarry yard is a staging point, not the source: the ruts lead away from it toward the forest, and the mine is warm. Look again at where the vehicle goes.',
    evidence: [
      { id: 'quarry', stage: 'resolved', text: 'Vehicles and ruts at the quarry' },
      { id: 'truck', stage: 'detected', text: 'Vehicle movement on the eastern roads' },
    ],
  },
  {
    id: 'nothing',
    title: 'No unusual activity',
    text: 'The lights were the hamlet, the engine noise was farm traffic, and the relay is a weather relay. Recommend no further action.',
    correct: false,
    feedback: 'Assessment returned. There is an unmapped structure in Keld Forest and a closed road with fresh tracks. Something is happening here.',
    evidence: [
      { id: 'village', stage: 'resolved', text: 'Hamlet shows nothing unusual' },
      { id: 'tower', stage: 'observed', text: 'Relay looks like a weather relay' },
    ],
  },
];

export interface UnlockDef {
  id: string;
  name: string;
  text: string;
}
export const UNLOCKS: readonly UnlockDef[] = [
  {
    id: 'resolution',
    name: 'Sensor resolution upgrade',
    text: 'Three contacts logged. The radar now resolves finer detail: wider footprint and faster confidence.',
  },
  {
    id: 'signal',
    name: 'Signal analyser',
    text: 'First sensor data received. The HUD now shows a bearing to the strongest active transmission.',
  },
  {
    id: 'endurance',
    name: 'Extended sortie fit',
    text: 'Five contacts resolved. The aircraft now carries two sensor packages and forty percent more fuel.',
  },
];
