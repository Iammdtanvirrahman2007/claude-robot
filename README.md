# Claude Robot

A laptop-brain robot control platform for Rover/Wheeled, Spider, Bird and other robots.

## AI Brain

The local bridge now includes an AI decision layer with:

- hard safety instincts that run before the AI
- pre-built robot function selection
- selectable personality profiles
- persistent laptop-local memory in `.robot-memory/`
- periodic autonomous decisions
- a manual **Decide Now** action
- server-side API-key handling

The AI never receives raw GPIO or unrestricted shell control. It can only select functions already exposed by the connected robot's API.

### Setup

1. Install dependencies:
```bash
npm install
```

2. Set the API key on the laptop running the bridge. Do **not** put it in React/Vite code:
```bash
export OPENAI_API_KEY="your-key"
export ROBOT_AI_MODEL="gpt-6-luna"
```

3. Start the bridge:
```bash
npm run bridge
```

4. Start the UI separately:
```bash
npm run dev
```

5. Switch the app to **LOCAL BRIDGE**, connect a robot, choose a personality, then use **AI BRAIN → Start AI**.

The current AI uses the OpenAI Responses API from the laptop bridge. Camera frames can now be captured from the browser and sent to the bridge Vision layer. The Vision layer returns structured scene/object/path data, which is attached to robot telemetry and becomes available to the reasoning brain. Set `ROBOT_VISION_MODEL` to change the vision model.

## Firestore cloud loop

Cloud mode uses the shared robot ID `VESP32-01` and the same Firestore paths on both projects:

- `robots/VESP32-01`: robot identity, online status, protocol version, and hardware capabilities.
- `robots/VESP32-01/control/current`: sequenced commands with a short TTL.
- `robots/VESP32-01/state/current`: pose, sensors, actuators, world/map data, hardware description, and command acknowledgement.

The Virtual ESP32 publishes its hardware description at startup and includes it in state updates. Claude Robot publishes the matching capability description when connecting, validates outgoing commands against its supported controls, and subscribes to state/acknowledgements. The simulator rejects unsupported or expired commands and stops motors when its command watchdog expires.

### Security boundary

The Firestore rules validate command shape, allowed command names, value range, protocol, TTL, and increasing sequence numbers. Because this public browser app currently uses Firebase Anonymous Authentication, those rules do **not** establish a trusted operator identity. Use this path for the virtual simulator only. Before connecting physical hardware, move command writes behind a trusted authenticated backend (or equivalent server-side authorization), restrict telemetry writes to the device/backend, and keep a physical emergency stop independent of software.

## Safety

AI decisions are advisory and constrained by the local function allowlist. Low battery, communication loss and immediate obstacle hazards trigger local instinct actions before an AI decision is accepted. Physical emergency-stop hardware should still remain independent of software.
