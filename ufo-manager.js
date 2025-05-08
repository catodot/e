class UFOManager {
  constructor(audioManager, options = {}) {
    this.audioManager = audioManager;

    this.config = {
      timing: {
        minTimePercentage: 0.45,
        maxTimePercentage: 0.66,
        intervalBetweenUFOs: {
          min: 90000, // 90 sec
          max: 120000,
        },
        elonToUFODelay: 14000, // 14 seconds
      },
      ufoSize: {
        min: 30,
        max: 480,
        current: 20,
      },
      animation: {
        duration: {
          min: 5000,
          max: 7000,
        },
        wobble: {
          frequency: { min: 5, max: 15 },
          amplitude: { min: 5, max: 15 },
        },
        rotation: {
          min: 45,
          max: 135,
        },
      },
      elon: {
        frameDuration: 300,
        displayDuration: 1000,
        fadeOutDuration: 9000,
        maxAppearances: 3,
      },
    };

    this.elements = {
      ufo: null,
      elon: null,
      elonContainer: null,
    };

    this.state = {
      isAnimating: false,
      autoSpawnEnabled: true,
      debugMode: false,
      firstUFOAppearanceTime: null,
      elonAppearanceCount: 0,
    };

    this.scoreReductionInterval = null;
    this.scoreReductionRate = 1; // Points to reduce per interval
    this.scoreReductionDelay = 100; // Milliseconds between each reduction (twice per second)

    this.timers = {
      animation: null,
      elonAnimation: null,
    };

    this.handleKeyboardEvent = this.handleKeyboardEvent.bind(this);
    this.elonHitboxManager = null;
    this.glowOutline = new GlowOutline();

  
  }

  init(gameEngine) {
    if (!this.elements.ufo) {
      this.createUfoElement();
    }

    this.gameEngine = gameEngine;

    if (this.state.autoSpawnEnabled) {
      const totalGameTime = this.gameEngine.config.GAME_DURATION * 1000;

      const minAppearanceTime = totalGameTime * this.config.timing.minTimePercentage;
      const maxAppearanceTime = totalGameTime * this.config.timing.maxTimePercentage;

      this.scheduleFirstUFO(minAppearanceTime, maxAppearanceTime);
    }

    return this;
  }

  scheduleFirstUFO(minTime, maxTime) {
    const randomDelay = minTime + Math.random() * (maxTime - minTime);

    this.timers.animation = setTimeout(() => {
      if (this._isGamePlayable()) {
        this.flyUfo();
      } else {
        this.scheduleNextUfo();
      }
    }, randomDelay);
  }

  scheduleNextUfo() {
    if (!this.state.autoSpawnEnabled || this._isGameOver()) {
      // Clear any existing timer to be safe
      if (this.timers.animation) {
        clearTimeout(this.timers.animation);
        this.timers.animation = null;
      }
      return;
    }

    if (!this._isGamePlayable()) {
      this.timers.animation = setTimeout(() => this.scheduleNextUfo(), 5000);
      return;
    }

    const { min, max } = this.config.timing.intervalBetweenUFOs;
    const interval = Math.floor(Math.random() * (max - min)) + min;

    this.timers.animation = setTimeout(() => {
      if (this.state.autoSpawnEnabled) {
        this.flyUfo();
      }
    }, interval);
  }

  _isGamePlayable() {
    return this.gameEngine && this.gameEngine.systems.state.isPlaying && !this.gameEngine.systems.state.isPaused && !this._isGameOver();
  }

  _isGameOver() {
    return (
      document.body.classList.contains("game-over") ||
      (this.gameEngine &&
        (this.gameEngine.systems.state.gameEnding ||
          this.gameEngine.systems.state.gameOver || // Add this check
          !this.gameEngine.systems.state.isPlaying))
    );
  }

  // Existing methods from previous implementation...
  // Element creation methods
  createUfoElement() {
    this.elements.ufo = document.createElement("img");
    this.elements.ufo.src = "images/ufo.png";
    this.elements.ufo.id = "flying-ufo";
    this.elements.ufo.alt = "UFO";
    this.elements.ufo.style.position = "absolute";
    this.elements.ufo.style.width = `${this.config.ufoSize.min}px`;
    this.elements.ufo.style.height = "auto";
    this.elements.ufo.style.zIndex = "9";
    this.elements.ufo.style.opacity = "0";
    this.elements.ufo.style.transition = "opacity 0.5s ease";
    this.elements.ufo.style.pointerEvents = "none";

    this.elements.ufo.setAttribute("aria-hidden", "true"); // Hide UFO from screen readers

    const gameScreen = document.getElementById("game-screen");
    gameScreen.appendChild(this.elements.ufo);

    // console.log("UFO element created");
  }
  handleKeyboardEvent(event) {
    // Check if 'e' key is pressed
    if (event.key.toLowerCase() === "e") {
      // Prevent default action
      event.preventDefault();

      // Only show Elon if not already animating
      if (!this.state.isAnimating) {
        this.showElonMusk(true);
      }
    }
  }

  createElonHitbox() {
    this.removeElonHitbox();

    const elonSprite = this.elements.elon;
    const elonWrapper = this.elements.elonContainer;
    const mapBackground = document.getElementById("map-background");
    const gameContainer = document.getElementById("game-container");

    if (!elonSprite || !elonWrapper || !mapBackground || !gameContainer) {
      console.error("Required elements not found for Elon hitbox");
      return;
    }

    this.elonHitbox = document.createElement("div");
    this.elonHitbox.id = "elon-hitbox";
    this.elonHitbox.style.position = "absolute";
    this.elonHitbox.style.zIndex = "1000";
    this.elonHitbox.style.pointerEvents = "all";
    this.elonHitbox.style.cursor = "pointer";

    const computedSprite = window.getComputedStyle(elonSprite);
    const computedWrapper = window.getComputedStyle(elonWrapper);

    const spriteWidth = parseFloat(computedSprite.width);
    const spriteHeight = parseFloat(computedSprite.height);
    const wrapperLeft = parseFloat(computedWrapper.left);
    const wrapperTop = parseFloat(computedWrapper.top);
    const spriteLeft = parseFloat(computedSprite.left);
    const spriteTop = parseFloat(computedSprite.top);

    this.elonHitbox.style.width = `${spriteWidth}px`;
    this.elonHitbox.style.height = `${spriteHeight}px`;
    this.elonHitbox.style.left = `${wrapperLeft + spriteLeft}px`;
    this.elonHitbox.style.top = `${wrapperTop + spriteTop}px`;

    this.elonHitbox.addEventListener("click", (e) => {
      e.stopPropagation();

      // Add 30 points for hitting Elon
      if (this.gameEngine && this.gameEngine.systems.state) {
        let scoreElement = document.getElementById("score");
        scoreElement.classList.add("score-bounce");
        setTimeout(() => {
          scoreElement.classList.remove("score-bounce");
        }, 500);

        // if (this.elements.hud.score) {

        //   this.elements.hud.score.classList.add('score-bounce');
        //   setTimeout(() => {
        //     scoreElement.classList.remove('score-bounce');
        //   }, 500);
        // }

        this.gameEngine.systems.state.score += 1;
        // Update HUD
        this.gameEngine.systems.ui.updateHUD(this.gameEngine.systems.state);
        // Announce for screen readers
        this.gameEngine.systems.ui.announceForScreenReaders(`Elon blocked! +30 points. Total score: ${this.gameEngine.systems.state.score}`);
      }

      // Play sound
      if (this.audioManager) {
        if (typeof this.audioManager.resumeAudioContext === "function") {
          // this.audioManager.resumeAudioContext().then(() => {
          this.audioManager.playRandom("defense", "slap", null, 0.8);
          // });
        } else {
          // this.audioManager.playRandom("defense", "slap", null, 0.8);
        }
      }

      this.cleanupElonMusk();
    });

    gameContainer.appendChild(this.elonHitbox);
  }
  removeElonHitbox() {
    if (this.elonHitbox && this.elonHitbox.parentElement) {
      this.elonHitbox.parentElement.removeChild(this.elonHitbox);
      this.elonHitbox = null;
    }
  }

// Modify the animateElonAppearance method
animateElonAppearance() {
  setTimeout(() => {
    if (this.elements.elon) {
      // Explicitly set transform origin to bottom center
      this.elements.elon.style.transformOrigin = "bottom center";

      // Start from bottom, scaled down, and slightly pushed up
      this.elements.elon.style.transform = "scale(0) translateY(100%)";
      this.elements.elon.style.opacity = "0";
      
      // Make sure underglow starts hidden
      if (this.elements.elonUnderglow) {
        this.elements.elonUnderglow.style.opacity = "0";
        this.elements.elonUnderglow.style.transition = "opacity 0.8s ease";
      }

      // Short timeout to ensure initial state is set
      requestAnimationFrame(() => {
        // Grow up with a bouncy effect
        this.elements.elon.style.transition = "all 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)";
        this.elements.elon.style.transform = "scale(1) translateY(0)";
        this.elements.elon.style.opacity = "1";
        
        // Delay the underglow appearance slightly after Elon
        setTimeout(() => {
          if (this.elements.elonUnderglow) {
            this.elements.elonUnderglow.style.opacity = "1";
          }
        }, 300); // 300ms delay for the underglow to appear after Elon
      });
    }
  }, 100);
}

  finishUfoAnimation() {
    this.elements.ufo.style.opacity = "0";

    this.stopScoreReduction();

    // Initiate Elon tumbling downward animation
    if (this.elements.elon) {
      this.fadeOutElonElement();

      // Only remove Elon after the fadeout completes
      setTimeout(() => {
        this.cleanupElonElements({ withTumble: false }); // Use options object for clarity
      }, this.config.elon.fadeOutDuration + 100);
    }
    this.removeGrayscaleEffect();

    this.state.isAnimating = false;
    this.scheduleNextUfo();
  }

  getViewportDimensions() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  getUfoFlightPositions(viewport) {
    // Random starting position (off-screen)
    const startSide = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
    let start = this.getPositionFromSide(startSide, viewport);

    // Random ending position (off-screen)
    // Don't exit on the same side as entry for more interesting paths
    const endSide = (startSide + 1 + Math.floor(Math.random() * 2)) % 4;
    let end = this.getPositionFromSide(endSide, viewport);

    return { start, end };
  }

  getPositionFromSide(side, viewport) {
    const ufoSize = this.config.ufoSize.min;

    switch (side) {
      case 0: // top
        return {
          x: Math.random() * viewport.width,
          y: -ufoSize,
        };
      case 1: // right
        return {
          x: viewport.width + ufoSize,
          y: Math.random() * viewport.height,
        };
      case 2: // bottom
        return {
          x: Math.random() * viewport.width,
          y: viewport.height + ufoSize,
        };
      case 3: // left
        return {
          x: -ufoSize,
          y: Math.random() * viewport.height,
        };
    }
  }

  generateControlPoints(viewport) {
    const numControlPoints = Math.floor(Math.random() * 3) + 2;
    const controlPoints = [];
    const margin = 100;

    for (let i = 0; i < numControlPoints; i++) {
      const cpX = Math.random() * (viewport.width + 2 * margin) - margin;
      const cpY = Math.random() * (viewport.height + 2 * margin) - margin;
      controlPoints.push({ x: cpX, y: cpY });
    }

    return controlPoints;
  }

  // Bezier curve calculation
  getBezierPoint(t, start, end, controlPoints) {
    const points = [start, ...controlPoints, end];

    while (points.length > 1) {
      const newPoints = [];
      for (let i = 0; i < points.length - 1; i++) {
        newPoints.push({
          x: (1 - t) * points[i].x + t * points[i + 1].x,
          y: (1 - t) * points[i].y + t * points[i + 1].y,
        });
      }
      points.length = 0;
      points.push(...newPoints);
    }

    return points[0];
  }

  // Utility methods
  isGameHidden() {
    const gameScreen = document.getElementById("game-screen");
    return gameScreen && gameScreen.classList.contains("hidden");
  }

  setDebugMode(enabled) {
    this.state.debugMode = enabled;
  }

  cleanupElonMusk() {
    this.removeGrayscaleEffect();
    this.stopScoreReduction();

    // Cleanup Elon elements with tumble
    this.cleanupElonElements({ withTumble: true });

    // Remove Elon hitbox
    this.removeElonHitbox();
  }

  flyUfo() {
    if (this.state.isAnimating || this._isGameOver()) return;
    this.state.isAnimating = true;

    if (this.isGameHidden()) {
      this.state.isAnimating = false;
      this.scheduleNextUfo();
      return;
    }

    if (!this.state.firstUFOAppearanceTime) {
      this.state.firstUFOAppearanceTime = Date.now();
    }

    // Add short delay between Elon and scheduling UFO
    const scheduleUFO = () => {
      setTimeout(() => {
        this.startUfoAnimation();
      }, this.config.elon.displayDuration);
    };

    // Show Elon first
    this.showElonMusk();

    // Wait a short moment before even scheduling the UFO
    setTimeout(() => {
      scheduleUFO();
    }, 10000); // Small delay to ensure clear separation
  }

  startUfoAnimation() {
    if (this._isGameOver()) {
      this.state.isAnimating = false;
      this.scheduleNextUfo();
      return;
    }

    if (this.audioManager) {
      this.audioManager.play("ui", "aliens", 0.8);

      // Resume audio context first for mobile Safari
      if (typeof this.audioManager.resumeAudioContext === "function") {
        // this.audioManager.resumeAudioContext().then(() => {
        // this.audioManager.play("ui", "aliens", 0.8);
        // });
      } else {
        // Fallback if resumeAudioContext doesn't exist
        // this.audioManager.play("ui", "aliens", 0.8);
      }
    }
    // Get viewport dimensions and flight positions
    const viewport = this.getViewportDimensions();
    const { start, end } = this.getUfoFlightPositions(viewport);
    const controlPoints = this.generateControlPoints(viewport);

    // Reset UFO size
    this.config.ufoSize.current = this.config.ufoSize.min;
    this.elements.ufo.style.width = `${this.config.ufoSize.current}px`;

    // Position the UFO at the starting point
    this.elements.ufo.style.left = `${start.x}px`;
    this.elements.ufo.style.top = `${start.y}px`;
    this.elements.ufo.style.opacity = "1";

    // Animation settings
    const animation = {
      rotateClockwise: Math.random() > 0.5,
      maxRotation: this.config.animation.rotation.min + Math.random() * (this.config.animation.rotation.max - this.config.animation.rotation.min),
      duration: this.config.animation.duration.min + Math.random() * (this.config.animation.duration.max - this.config.animation.duration.min),
      wobble: {
        frequency:
          this.config.animation.wobble.frequency.min +
          Math.random() * (this.config.animation.wobble.frequency.max - this.config.animation.wobble.frequency.min),
        amplitude:
          this.config.animation.wobble.amplitude.min +
          Math.random() * (this.config.animation.wobble.amplitude.max - this.config.animation.wobble.amplitude.min),
      },
    };

    const startTime = performance.now();

    const animateUfo = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / animation.duration, 1);

      if (progress < 1) {
        this.updateUfoPosition(progress, start, end, controlPoints, animation);
        requestAnimationFrame(animateUfo);
      } else {
        // this.finishUfoAnimation();
      }
    };

    requestAnimationFrame(animateUfo);
  }

  updateUfoPosition(progress, start, end, controlPoints, animation) {
    // Calculate position using bezier curve with control points
    const position = this.getBezierPoint(progress, start, end, controlPoints);

    // Add wobble
    position.y += Math.sin(progress * animation.wobble.frequency) * animation.wobble.amplitude;

    // Calculate size - grows in middle, shrinks at ends
    const sizeFactor = 4 * progress * (1 - progress); // parabolic curve peaking at 0.5
    const sizeRange = this.config.ufoSize.max - this.config.ufoSize.min;
    this.config.ufoSize.current = this.config.ufoSize.min + sizeFactor * sizeRange;

    // Set position and size
    this.elements.ufo.style.left = `${position.x}px`;
    this.elements.ufo.style.top = `${position.y}px`;
    this.elements.ufo.style.width = `${this.config.ufoSize.current}px`;

    // Apply rotation with wobble
    const rotationAmount = progress * animation.maxRotation;
    const rotation = animation.rotateClockwise ? rotationAmount : -rotationAmount;
    const rotationWobble = Math.sin(progress * animation.wobble.frequency * 1.5) * 5;
    this.elements.ufo.style.transform = `rotate(${rotation + rotationWobble}deg)`;
  }

  fadeOutElonElement() {
    if (this.elements.elon) {
      // Change transform origin to center
      this.elements.elon.style.transformOrigin = "center center";
  
      // Faster opacity fade, slower falling motion
      this.elements.elon.style.transition = "opacity 0.8s ease, transform 2.5s cubic-bezier(0.4, 0.1, 0.2, 1)";
      
      // Make sure underglow fades out with Elon
      if (this.elements.elonUnderglow) {
        this.elements.elonUnderglow.style.transition = "opacity 0.8s ease";
        this.elements.elonUnderglow.style.opacity = "0";
      }
  
      // Short timeout to ensure the new properties are applied
      setTimeout(() => {
        this.elements.elon.style.transform = "scale(0) translate(0px, 300px) rotate(-360deg)";
        this.elements.elon.style.opacity = "0";
      }, 10);
    }
  }

  startGrayscaleEffect() {
    const mapBackground = document.getElementById("map-background");
    if (!mapBackground) return;

    // Reset any existing animation
    mapBackground.style.transition = "none";
    mapBackground.style.filter = "grayscale(0%)";

    // Force reflow
    void mapBackground.offsetWidth;

    // Add smooth transition
    mapBackground.style.transition = "filter 3s ease-in";

    // Start increasing grayscale
    requestAnimationFrame(() => {
      mapBackground.style.filter = "grayscale(100%)";
    });
  }

  removeGrayscaleEffect() {
    const mapBackground = document.getElementById("map-background");
    if (!mapBackground) return;

    // Quick transition back to normal
    mapBackground.style.transition = "filter 0.5s ease-out";
    mapBackground.style.filter = "grayscale(0%)";

    // Clean up after transition
    setTimeout(() => {
      mapBackground.style.transition = "";
      mapBackground.style.filter = "";
    }, 300);
  }

  startScoreReduction() {
    // Clear any existing interval first
    if (this.scoreReductionInterval) {
      clearInterval(this.scoreReductionInterval);
    }

    // Start a new score reduction interval
    this.scoreReductionInterval = setInterval(() => {
      // Only reduce score if the game is active and Elon is visible
      if (
        this.gameEngine &&
        this.gameEngine.systems.state.isPlaying &&
        !this.gameEngine.systems.state.isPaused &&
        !this.gameEngine.systems.state.gameEnding &&
        this.elements.elon
      ) {
        // Reduce the score
        this.gameEngine.systems.state.score = Math.max(0, this.gameEngine.systems.state.score - this.scoreReductionRate);

        // Update the HUD to show the new score
        this.gameEngine.systems.ui.updateHUD(this.gameEngine.systems.state);
      }
    }, this.scoreReductionDelay);
  }

  // Add this method to stop the score reduction
  stopScoreReduction() {
    if (this.scoreReductionInterval) {
      clearInterval(this.scoreReductionInterval);
      this.scoreReductionInterval = null;
    }
  }

  showElonMusk(autoCleanup = false) {
    // console.log("showElonMusk called - attempting to show Elon Musk");


    // Check if we've reached the maximum number of appearances or game is over

    if (this.state.elonAppearanceCount >= this.config.elon.maxAppearances || this._isGameOver()) {
      return;
    }

    if (this.isGameHidden()) {
      // console.log("Game screen is hidden, not showing Elon");
      return;
    }

    this.state.elonAppearanceCount++;

    // Clean up any existing Elon elements and hitboxes
    if (document.getElementById("elon-wrapper")) {
      this.cleanupElonElements({ immediate: true });
    }

    // Destroy previous hitbox if it exists
    if (this.elonHitboxManager) {
      this.elonHitboxManager.destroy();
      this.elonHitboxManager = null;
    }

    if (!this.createElonElement()) {
      return;
    }

    this.startScoreReduction();

    // Play appearance sound
    // if (window.audioManager) {
    //   window.audioManager.play("ui", "musk");
    // }

    if (this.audioManager) {
      // Resume audio context first for mobile Safari
      if (typeof this.audioManager.resumeAudioContext === "function") {
        // this.audioManager.resumeAudioContext().then(() => {
        this.audioManager.playIfContextReady("ui", "musk", 0.8);
        // });
      } else {
        // Fallback if resumeAudioContext doesn't exist
        this.audioManager.play("ui", "musk", 0.8);
      }
    }
    // Create hitbox for Elon
    this.createElonHitbox();

    this.animateElonAppearance();
    this.startElonSpriteAnimation();
  this.elements.elonUnderglow.style.opacity = "1";

    this.startGrayscaleEffect();

    // Add auto cleanup option for standalone test
    if (autoCleanup) {
      setTimeout(() => {
        this.cleanupElonMusk();
      }, this.config.elon.displayDuration + 5000); // Add 5 seconds to display duration
    }

    // console.log("Started Elon animation with pop-up effect and continuous looping");
  }


  // createElonElement() {
  //   const mapBackground = document.getElementById("map-background");
  //   const gameContainer = document.getElementById("game-container");
  
  //   if (!mapBackground || !gameContainer) {
  //     console.error("Required elements not found for Elon positioning");
  //     return false;
  //   }
  
  //   const mapRect = mapBackground.getBoundingClientRect();
  //   const containerRect = gameContainer.getBoundingClientRect();
  
  //   // Create a regular wrapper without glow
  //   const wrapper = document.createElement("div");
  //   wrapper.id = "elon-wrapper";
  //   wrapper.style.position = "absolute";
  //   wrapper.style.left = `${mapRect.left - containerRect.left}px`;
  //   wrapper.style.top = `${mapRect.top - containerRect.top}px`;
  //   wrapper.style.width = `${mapRect.width}px`;
  //   wrapper.style.height = `${mapRect.height}px`;
  //   wrapper.style.zIndex = "8";
  //   wrapper.style.pointerEvents = "none";
  
  //   gameContainer.appendChild(wrapper);
  
  //   // Create a container element for Elon
  //   this.elements.elon = document.createElement("div");
  //   this.elements.elon.id = "elon-sprite";
  
  //   const spriteSize = Math.round(mapRect.width * 0.2);
  //   this.elements.elon.style.width = `${spriteSize}px`;
  //   this.elements.elon.style.height = `${spriteSize}px`;
  //   this.elements.elon.style.position = "absolute";
  
  //   // Fixed pixel value positioning
  //   const leftPos = Math.round(mapRect.width * 0.15);
  //   const topPos = Math.round(mapRect.height * 0.05);
  
  //   this.elements.elon.style.left = `${leftPos}px`;
  //   this.elements.elon.style.top = `${topPos}px`;
  //   this.elements.elon.style.opacity = "0";
  //   this.elements.elon.style.transformOrigin = "bottom center";
  //   this.elements.elon.style.transform = "scale(0.2)";
  //   this.elements.elon.style.transition = "opacity 0.8s ease, transform 0.8s cubic-bezier(0.18, 1.25, 0.4, 1.1)";
  
  //   // Create two separate image elements for the frames
  //   this.elements.elonFrame0 = document.createElement("div");
  //   this.elements.elonFrame0.id = "elon-frame-0";
  //   this.elements.elonFrame0.style.width = "100%";
  //   this.elements.elonFrame0.style.height = "100%";
  //   this.elements.elonFrame0.style.backgroundImage = 'url("images/musk.png")';
  //   this.elements.elonFrame0.style.backgroundSize = "200% 100%";
  //   this.elements.elonFrame0.style.backgroundPosition = "0% 0%";
  //   this.elements.elonFrame0.style.backgroundRepeat = "no-repeat";
  //   this.elements.elonFrame0.style.position = "absolute";
  //   this.elements.elonFrame0.style.top = "0";
  //   this.elements.elonFrame0.style.left = "0";
  
  //   this.elements.elonFrame1 = document.createElement("div");
  //   this.elements.elonFrame1.id = "elon-frame-1";
  //   this.elements.elonFrame1.style.width = "100%";
  //   this.elements.elonFrame1.style.height = "100%";
  //   this.elements.elonFrame1.style.backgroundImage = 'url("images/musk.png")';
  //   this.elements.elonFrame1.style.backgroundSize = "200% 100%";
  //   this.elements.elonFrame1.style.backgroundPosition = "100% 0%";
  //   this.elements.elonFrame1.style.backgroundRepeat = "no-repeat";
  //   this.elements.elonFrame1.style.position = "absolute";
  //   this.elements.elonFrame1.style.top = "0";
  //   this.elements.elonFrame1.style.left = "0";
  //   this.elements.elonFrame1.style.display = "none";
  
  //   // Add both frames to the container
  //   this.elements.elon.appendChild(this.elements.elonFrame0);
  //   this.elements.elon.appendChild(this.elements.elonFrame1);
  
  //   // Create a dedicated glow element specifically for Elon
  //   const glowElement = document.createElement("div");
  //   glowElement.id = "elon-glow-effect";
  //   glowElement.style.position = "absolute";
  //   glowElement.style.top = `${topPos}px`;
  //   glowElement.style.left = `${leftPos}px`;
  //   glowElement.style.width = `${spriteSize}px`;
  //   glowElement.style.height = `${spriteSize}px`;
  //   glowElement.style.borderRadius = "50%";
  //   glowElement.style.zIndex = "7"; // Lower than Elon (8) but still visible
  //   glowElement.style.pointerEvents = "none";
  //   glowElement.style.animation = "elonGlowPulse 2s infinite ease-in-out";
  
  //   // Add the glow animation style if it doesn't exist yet
  //   if (!document.getElementById("elon-glow-style")) {
  //     const styleElement = document.createElement("style");
  //     styleElement.id = "elon-glow-style";
  //     styleElement.textContent = `
  //       @keyframes elonGlowPulse {
  //         0% { box-shadow: 0 0 15px 8px rgba(255, 69, 0, 0.7); }
  //         50% { box-shadow: 0 0 25px 15px rgba(255, 69, 0, 0.9); }
  //         100% { box-shadow: 0 0 15px 8px rgba(255, 69, 0, 0.7); }
  //       }
  //     `;
  //     document.head.appendChild(styleElement);
  //   }
  
  //   // Add the glow element to the wrapper before Elon
  //   wrapper.appendChild(glowElement);
    
  //   // Then add Elon on top of the glow
  //   wrapper.appendChild(this.elements.elon);
  //   this.elements.elonContainer = wrapper;
  //   this.elements.elonGlow = glowElement; // Store for later reference
  
  //   // Store original position for reference
  //   this.elonOriginalPosition = {
  //     left: leftPos,
  //     top: topPos,
  //   };
  
  //   return true;
  // }

  createElonElement() {
    const mapBackground = document.getElementById("map-background");
    const gameContainer = document.getElementById("game-container");
    
    if (!mapBackground || !gameContainer) {
      console.error("Required elements not found for Elon positioning");
      return false;
    }
    
   // Calculate positioning
  const mapRect = mapBackground.getBoundingClientRect();
  const containerRect = gameContainer.getBoundingClientRect();
  
  // Determine if mobile
  const isMobile = window.DeviceUtils && window.DeviceUtils.isMobileDevice;
  console.log("is movile " + isMobile);
  
  // Use different positions based on device type
  const leftPos = isMobile 
    ? Math.round(mapRect.width * 0.02)  // Mobile position
    : Math.round(mapRect.width * 0.07); // Desktop position
    
  const topPos = isMobile 
    ? Math.round(mapRect.height * 0.02)  // Mobile position
    : Math.round(mapRect.height * 0.07); // Desktop position
  
  // Calculate sprite size (keeping the same proportional sizing)
  const mobileSizeMultiplier = isMobile ? 1.3 : 1; // 30% larger on mobile
  const spriteSize = Math.round(mapRect.width * 0.2 * mobileSizeMultiplier);
  const spotlightSize = spriteSize * 1.5;
  
    
    
    // Set CSS variables that the stylesheet can use
    document.documentElement.style.setProperty('--elon-sprite-size', `${spriteSize}px`);
    document.documentElement.style.setProperty('--elon-left-pos', `${leftPos}px`);
    document.documentElement.style.setProperty('--elon-top-pos', `${topPos}px`);
    document.documentElement.style.setProperty('--elon-spotlight-size', `${spotlightSize}px`);
    document.documentElement.style.setProperty('--elon-spotlight-left', `${leftPos + (spriteSize - spotlightSize)/2}px`);
    document.documentElement.style.setProperty('--elon-spotlight-top', `${topPos + (spriteSize - spotlightSize)/2}px`);
    
    // Create the wrapper with CSS classes
    const wrapper = document.createElement("div");
    wrapper.id = "elon-wrapper";
    wrapper.style.left = `${mapRect.left - containerRect.left}px`;
    wrapper.style.top = `${mapRect.top - containerRect.top}px`;
    wrapper.style.width = `${mapRect.width}px`;
    wrapper.style.height = `${mapRect.height}px`;
    
    // Create glow outline
    // const glowOutline = new GlowOutline();
    // const outlineElement = glowOutline.create({
    //   parentId: "elon",
    //   color: "#FF4500",
    //   diffused: true,
    //   glowOpacity: 0.1
    // });
    // outlineElement.id = "elon-protestors-outline";
    // wrapper.appendChild(outlineElement);
    
    // Create underglow element
    const underglow = document.createElement("div");
    underglow.id = "elon-underglow";
    
    // Create Elon sprite and frames
    this.elements.elon = document.createElement("div");
    this.elements.elon.id = "elon-sprite";
    
    this.elements.elonFrame0 = document.createElement("div");
    this.elements.elonFrame0.id = "elon-frame-0";
    
    this.elements.elonFrame1 = document.createElement("div");
    this.elements.elonFrame1.id = "elon-frame-1";
    
    // Add frames to sprite
    this.elements.elon.appendChild(this.elements.elonFrame0);
    this.elements.elon.appendChild(this.elements.elonFrame1);
    
    // Assemble all elements
    wrapper.appendChild(underglow);
    wrapper.appendChild(this.elements.elon);
    gameContainer.appendChild(wrapper);
    
    // Store references
    this.elements.elonContainer = wrapper;
    this.elements.elonUnderglow = underglow;
    
    return true;
  }

  startElonSpriteAnimation() {
    if (!this.elements.elon) {
      return;
    }
  
    // Create animation for Elon with frame toggling
    const frameDuration =
      window.DeviceUtils && window.DeviceUtils.isMobileDevice ? this.config.elon.frameDuration * 1.5 : this.config.elon.frameDuration;
  
    // Use a real DOM element instead of a dummy object
    let currentFrame = 0;
    const animationId = window.animationManager.createSpriteAnimation({
      element: this.elements.elon, // Use the actual Elon element instead of { style: {} }
      frameCount: 2,
      frameDuration: frameDuration,
      loop: true,
      id: "elon-animation",
      customUpdater: () => {
        if (!this.elements.elon) {
          window.animationManager.stopSpriteAnimation(animationId);
          return;
        }
  
        // Toggle frame
        currentFrame = currentFrame === 0 ? 1 : 0;
  
        // Show current frame, hide the other
        if (currentFrame === 0) {
          this.elements.elonFrame0.style.display = "block";
          this.elements.elonFrame1.style.display = "none";
        } else {
          this.elements.elonFrame0.style.display = "none";
          this.elements.elonFrame1.style.display = "block";
        }
      },
    });
  
    // Store animation ID for cleanup
    this.elonAnimationId = animationId;
  }

  stopElonAnimation() {
    if (this.elonAnimationId) {
      window.animationManager.stopSpriteAnimation(this.elonAnimationId);
      this.elonAnimationId = null;
    }
  }

  cleanupElonElements(options = {}) {
    // console.log("Cleaning up Elon elements");

    // Stop animations first
    this.stopElonAnimation();
  
    // Make sure underglow fades out immediately
    if (this.elements.elonUnderglow) {
      this.elements.elonUnderglow.style.transition = "opacity 0.3s ease";
      this.elements.elonUnderglow.style.opacity = "0";
    }

    // Apply cartoony disappear animation
    if (options.withTumble && this.elements.elon) {
      // Use spring physics for a bouncy effect
      this.elements.elon.style.transition = `transform 1.2s cubic-bezier(.17,.67,.4,1.8)`;

      // Initial "squish up" before the jump
      setTimeout(() => {
        this.elements.elon.style.transform = `scale(1.2, 0.8) translateY(10px)`;
      }, 10);

      // Then big bounce up and rotate
      setTimeout(() => {
        this.elements.elon.style.transform = `scale(0.8) translate(120px, -300px) rotate(30deg)`;
        // Only start fading after the bounce starts
        this.elements.elon.style.transition = `transform 1s cubic-bezier(.17,.67,.4,1.8), opacity 0.3s ease`;
        this.elements.elon.style.opacity = "0.9";
      }, 150);

      // Final disappear with spin
      setTimeout(() => {
        this.elements.elon.style.transform = `scale(0.2) translate(350px, -500px) rotate(720deg)`;
        this.elements.elon.style.opacity = "0";
      }, 400);

      // console.log("Elon bouncing away with cartoon physics");
    }

    // Remove elements after delay
    const removeDelay = options.withTumble ? 1500 : 0;

    setTimeout(() => {
      try {
        // Remove wrapper if it exists
        if (this.elements.elonContainer && this.elements.elonContainer.parentNode) {
          this.elements.elonContainer.parentNode.removeChild(this.elements.elonContainer);
          // console.log("Removed Elon wrapper from DOM");
        }

        // Clear element references
        this.elements.elon = null;
        this.elements.elonContainer = null;
        this.elements.elonFrame0 = null;
        this.elements.elonFrame1 = null;
        this.elonOriginalPosition = null;

        // Find and remove orphaned elements
        const elementsToCleanup = ["elon-sprite", "elon-wrapper", "simple-elon", "elon-frame-0", "elon-frame-1"];
        elementsToCleanup.forEach((id) => {
          const elements = document.querySelectorAll(`#${id}`);
          if (elements.length > 0) {
            elements.forEach((el) => {
              if (el && el.parentNode) {
                el.parentNode.removeChild(el);
                // console.log(`Removed orphaned element #${id}`);
              }
            });
          }
        });

        // Find and remove any other elements with elon in the ID
        const possibleOrphanContainers = document.querySelectorAll('[id*="elon"]');
        if (possibleOrphanContainers.length > 0) {
          possibleOrphanContainers.forEach((el) => {
            if (el.id !== "elon-wrapper" && el.id !== "elon-sprite" && el.id !== "simple-elon") {
              if (el.parentNode) {
                el.parentNode.removeChild(el);
                // console.log(`Removed additional element with ID ${el.id}`);
              }
            }
          });
        }
      } catch (e) {
        console.error("Error during Elon cleanup:", e);
      }
    }, removeDelay);
  }

  pause() {
    this.state.autoSpawnEnabled = false;
  }

  resume() {
    this.state.autoSpawnEnabled = true;
  }

  reset() {
    if (this.timers.animation) {
      clearTimeout(this.timers.animation);
      this.timers.animation = null;
    }

    this.stopScoreReduction();

    if (this.timers.elonAnimation) {
      clearInterval(this.timers.elonAnimation);
      this.timers.elonAnimation = null;
    }

    this.state = {
      isAnimating: false,
      autoSpawnEnabled: true,
      debugMode: false,
      firstUFOAppearanceTime: null,
      elonAppearanceCount: 0, // Reset the counter
    };

    this.cleanupElonElements({ immediate: true });
    // this.cleanupOrphanedElements();

    if (this.elements.ufo) {
      this.elements.ufo.style.opacity = "0";
    }

    this.removeGrayscaleEffect();

    if (this.audioManager) {
      // this.audioManager.stop("ui", "aliens");
      // this.audioManager.stop("ui", "musk");
    }
  }

  destroy() {
    this.state.autoSpawnEnabled = false;
    this.removeGrayscaleEffect();
    this.stopScoreReduction();

    if (this.timers.animation) {
      clearTimeout(this.timers.animation);
      this.timers.animation = null;
    }

    if (this.timers.elonAnimation) {
      clearInterval(this.timers.elonAnimation);
      this.timers.elonAnimation = null;
    }

    if (this.elements.ufo) {
      this.elements.ufo.style.opacity = "0";
    }

    this.cleanupElonElements({ immediate: true });
    this.state.autoSpawnEnabled = false;
    this.state.isAnimating = false;
  }
}
