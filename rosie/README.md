# Rosie Component Library

This folder contains pre-built Rosie components for Three.js games. Use them when they fit the request.

## Read Before Using

Use the `read` tool to load a component's source code before importing it.

Example workflow:
```javascript
read(file_path="/rosie/controls/rosieControls.js")
import { PlayerController } from './rosie/controls/rosieControls.js';
```

## Available Components

### rosieControls.js (3D Games - Three.js)

**Path:** `/rosie/controls/rosieControls.js`
**Exports:** `PlayerController`, `ThirdPersonCameraController`, `FirstPersonCameraController`

**What it does:**
- WASD movement with camera-relative direction
- Jumping, gravity, and ground detection
- Third-person orbit camera or first-person pointer-lock camera
- Automatic mobile controls through `rosieMobileControls.js`

Mobile controls render at `z-index: 50`, so place menus and overlays above that layer.
Set `jumpForce: 0` for games without jumping; this omits the mobile Jump button.

**Use for:** 3D platformers, exploration games, and action games.
**Avoid for:** racing, top-down, board, puzzle, or custom-control games where a purpose-built controller is simpler.

Quick example:
```javascript
const controller = new PlayerController(playerMesh, {
  moveSpeed: 10,
  jumpForce: 15,
  groundLevel: 0
});

const cameraController = new ThirdPersonCameraController(
  camera,
  playerMesh,
  renderer.domElement,
  { distance: 7, height: 3 }
);

const rotation = cameraController.update();
controller.update(deltaTime, rotation);
```

### rosieMobileControls.js (Internal)

**Path:** `/rosie/controls/rosieMobileControls.js`
**Note:** Imported by `rosieControls.js`; you usually do not import it directly.

## Usage Rules

- Read source with `read` before using a component.
- Import from `./rosie/controls/...`.
- Use `rosieControls.js` only for Three.js projects where the built-in movement/camera contract fits.
