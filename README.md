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

The current AI uses the OpenAI Responses API from the laptop bridge. Camera frames are not yet fed to the reasoning model; the current camera field is telemetry metadata. Vision processing is the next layer.

## Safety

AI decisions are advisory and constrained by the local function allowlist. Low battery, communication loss and immediate obstacle hazards trigger local instinct actions before an AI decision is accepted. Physical emergency-stop hardware should still remain independent of software.
