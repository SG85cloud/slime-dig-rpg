/**
 * Mobile Controls - Handles all mobile-specific input and UI
 * Works by simulating keyboard/mouse events to integrate with existing desktop controls
 */

/**
 * Utility functions for mobile detection and UI management
 */
const MobileUtils = {
  isMobile() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  },

  createMobileUI(showJump) {
    // Create container for all mobile controls
    const container = document.createElement('div');
    container.id = 'mobile-game-controls';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 50;
      font-family: Arial, sans-serif;
    `;

    // Virtual Joystick
    const joystickContainer = document.createElement('div');
    joystickContainer.id = 'virtual-joystick';
    joystickContainer.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 20px;
      width: 120px;
      height: 120px;
      background: rgba(255, 255, 255, 0.2);
      border: 2px solid rgba(255, 255, 255, 0.5);
      border-radius: 50%;
      pointer-events: auto;
      touch-action: none;
    `;

    const joystickKnob = document.createElement('div');
    joystickKnob.id = 'virtual-joystick-knob';
    joystickKnob.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.8);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      transition: all 0.1s ease;
    `;

    joystickContainer.appendChild(joystickKnob);

    // Jump Button
    const jumpButton = document.createElement('div');
    jumpButton.id = 'jump-button';
    jumpButton.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 80px;
      height: 80px;
      background: rgba(255, 255, 255, 0.2);
      border: 2px solid rgba(255, 255, 255, 0.5);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 14px;
      font-weight: bold;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
    `;
    jumpButton.textContent = 'JUMP';

    container.appendChild(joystickContainer);
    if (showJump) {
      container.appendChild(jumpButton);
    }

    return {
      container,
      joystickContainer,
      joystickKnob,
      jumpButton: showJump ? jumpButton : null
    };
  },

  removeMobileUI() {
    const existing = document.getElementById('mobile-game-controls');
    if (existing) {
      existing.remove();
    }
  }
};

/**
 * VirtualJoystick - Handles virtual joystick input for mobile
 */
class VirtualJoystick {
  constructor(container, knob, onInputChange) {
    this.container = container;
    this.knob = knob;
    this.onInputChange = onInputChange;
    this.touchId = null;
    this.maxDistance = 40; // Maximum distance from center
    this.currentPos = { x: 0, y: 0 }; // Current position (-1 to 1)

    this.setupEvents();
  }

  applyDelta(deltaX, deltaY) {
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance > this.maxDistance) {
      const scale = this.maxDistance / distance;
      deltaX *= scale;
      deltaY *= scale;
    }

    this.knob.style.transform = `translate(${deltaX - 20}px, ${deltaY - 20}px)`;
    this.currentPos.x = deltaX / this.maxDistance;
    this.currentPos.y = deltaY / this.maxDistance;
    this.onInputChange({ x: this.currentPos.x, y: -this.currentPos.y });
  }

  moveFromClient(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    this.applyDelta(clientX - centerX, clientY - centerY);
  }

  reset() {
    this.touchId = null;
    this.knob.style.transform = 'translate(-20px, -20px)';
    this.currentPos = { x: 0, y: 0 };
    this.container.style.background = 'rgba(255, 255, 255, 0.2)';
    this.onInputChange({ x: 0, y: 0 });
  }

  setupEvents() {
    this.onTouchStart = (e) => {
      if (this.touchId !== null) return;
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;
      this.container.style.background = 'rgba(255, 255, 255, 0.3)';
      this.moveFromClient(touch.clientX, touch.clientY);
      e.preventDefault();
    };

    this.onTouchMove = (e) => {
      if (this.touchId === null) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier === this.touchId) {
          this.moveFromClient(touch.clientX, touch.clientY);
          e.preventDefault();
          return;
        }
      }
    };

    this.onTouchEnd = (e) => {
      if (this.touchId === null) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier === this.touchId) {
          this.reset();
          return;
        }
      }
    };

    this.onMouseDown = (e) => {
      if (this.touchId !== null) return;
      this.touchId = 'mouse';
      this.container.style.background = 'rgba(255, 255, 255, 0.3)';
      this.moveFromClient(e.clientX, e.clientY);
      e.preventDefault();
    };

    this.onMouseMove = (e) => {
      if (this.touchId !== 'mouse') return;
      this.moveFromClient(e.clientX, e.clientY);
    };

    this.onMouseUp = () => {
      if (this.touchId !== 'mouse') return;
      this.reset();
    };

    this.container.addEventListener('touchstart', this.onTouchStart, { passive: false });
    document.addEventListener('touchmove', this.onTouchMove, { passive: false });
    document.addEventListener('touchend', this.onTouchEnd);
    document.addEventListener('touchcancel', this.onTouchEnd);
    this.container.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  destroy() {
    this.container.removeEventListener('touchstart', this.onTouchStart);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onTouchEnd);
    document.removeEventListener('touchcancel', this.onTouchEnd);
    this.container.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }
}

/**
 * MobileControls - Handles mobile player movement controls only
 */
class MobileControls {
  constructor(controller) {
    this.controller = controller;
    this.isMobile = MobileUtils.isMobile();
    this.mobileUI = null;
    this.virtualJoystick = null;
    this.currentInput = { x: 0, y: 0 };

    // Controls are created on the first gameplay update so initial menus stay unobstructed.
  }

  activate() {
    if (!this.isMobile || this.mobileUI) return;
    this.setupPlayerControls();
  }

  setupPlayerControls() {
    // Create mobile UI
    this.mobileUI = MobileUtils.createMobileUI(this.controller.jumpForce > 0);
    document.body.appendChild(this.mobileUI.container);

    // Setup virtual joystick
    this.virtualJoystick = new VirtualJoystick(
      this.mobileUI.joystickContainer,
      this.mobileUI.joystickKnob,
      (input) => this.handleJoystickInput(input)
    );

    // Setup jump button
    if (this.mobileUI.jumpButton) {
      this.setupJumpButton();
    }
  }

  setupJumpButton() {
    const handleJumpStart = (e) => {
      e.preventDefault();
      this.controller.keys['Space'] = true;
      this.mobileUI.jumpButton.style.background = 'rgba(255, 255, 255, 0.4)';
    };

    const handleJumpEnd = (e) => {
      e.preventDefault();
      this.controller.keys['Space'] = false;
      this.mobileUI.jumpButton.style.background = 'rgba(255, 255, 255, 0.2)';
    };

    this.mobileUI.jumpButton.addEventListener('touchstart', handleJumpStart);
    this.mobileUI.jumpButton.addEventListener('touchend', handleJumpEnd);
    this.mobileUI.jumpButton.addEventListener('mousedown', handleJumpStart);
    this.mobileUI.jumpButton.addEventListener('mouseup', handleJumpEnd);
  }

  handleJoystickInput(input) {
    this.currentInput = input;

    // Clear all movement keys first
    this.controller.keys['KeyW'] = false;
    this.controller.keys['KeyS'] = false;
    this.controller.keys['KeyA'] = false;
    this.controller.keys['KeyD'] = false;

    // Set keys based on joystick input (with deadzone)
    const deadzone = 0.1;

    if (Math.abs(input.y) > deadzone) {
      if (input.y > 0) {
        this.controller.keys['KeyW'] = true; // Forward
      } else {
        this.controller.keys['KeyS'] = true; // Backward
      }
    }

    if (Math.abs(input.x) > deadzone) {
      if (input.x > 0) {
        this.controller.keys['KeyD'] = true; // Right
      } else {
        this.controller.keys['KeyA'] = true; // Left
      }
    }
  }

  destroy() {
    if (!this.isMobile) return;

    if (this.virtualJoystick) {
      this.virtualJoystick.destroy();
      this.virtualJoystick = null;
    }

    // Remove the mobile UI
    MobileUtils.removeMobileUI();
  }
}

export { MobileControls };