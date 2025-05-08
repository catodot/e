// Event handling utility
function setupEventHandlers(element, handlers) {
  if (!element) return false;

  // Remove existing handlers with clone technique
  const newElement = element.cloneNode(true);
  if (element.parentNode) {
    element.parentNode.replaceChild(newElement, element);
  }

  // Add new handlers
  Object.entries(handlers).forEach(([event, handler]) => {
    newElement.addEventListener(event, handler);
  });

  return newElement;
}

/**
 * Game Engine - Core module that coordinates all game systems
 */
class GameEngine {
  constructor(config = {}) {
    // Configuration with defaults
    this.config = {
      DEBUG_MODE: config.debug || false,
      GAME_DURATION: 168, // 2min 48sec in seconds
      AUTO_RESTART_DELAY: 10000,
      INITIAL_GRAB_DELAY: 4000,
      COUNTRIES: ["canada", "mexico", "greenland"],
    };

    this.END_STATES = {
      TRUMP_VICTORY: "trump_victory",
      RESISTANCE_WIN: "resistance_win",
      TRUMP_DESTROYED: "trump_destroyed",
    };

    this.endGameSequences = {
      trump_victory: {
        trumpAnimation: "victory",
        audioSequence: ["beenVeryNiceToYou", "lose"],
        message: "TRUMP TOOK ALL THE COUNTRIES!",
        playerWon: false,
      },
      resistance_win: {
        trumpAnimation: "slapped",
        audioSequence: ["fourYears", "win"],
        message: "elections cancelled, forever",
        playerWon: true,
      },
      trump_destroyed: {
        trumpAnimation: "slapped",
        audioSequence: ["beenVeryNiceToYou", "win"],
        message: "VICTORY! TRUMP IS PEA-SIZED!",
        playerWon: true,
      },
    };

    // Override with provided config
    Object.assign(this.config, config);

    // Core systems
    this.systems = {
      state: new GameState(this.config),
      ui: new UIManager(),
      input: new InputManager(),
      audio: null,
      animation: null,
      freedom: null,
      collision: null,
    };

    // Resource tracking for cleanup
    this.resources = {
      timeouts: [],
      intervals: [],
      animationFrames: [],
    };

    // Bind critical methods
    this._bindMethods();
  }
  /**
   * Initialize game systems
   * @private
   */
  _initializeGameSystems() {
    // Initialize global logger
    if (!window.logger) {
      window.logger = {
        debug: (category, message) => this.config.DEBUG_MODE && console.debug(`[${category}]`, message),
        info: (category, message) => console.info(`[${category}]`, message),
        warn: (category, message) => console.warn(`[${category}]`, message),
        error: (category, message) => console.error(`[${category}]`, message),
        trace: (category, message) => this.config.DEBUG_MODE && console.trace(`[${category}]`, message),
      };
    }

    // Create AudioManager once and make it available everywhere
    if (!this.systems.audio && typeof AudioManager === "function") {
      // Use existing instance if available, otherwise create new one
      this.systems.audio = window.audioManager || new AudioManager();

      // Update global reference (for backward compatibility)
      window.audioManager = this.systems.audio;
    }

    // Initialize device utils if needed
    if (!window.DeviceUtils) {
      window.DeviceUtils = {
        isMobileDevice: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
        isTouchDevice: "ontouchstart" in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0,
        viewportWidth: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
        viewportHeight: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
      };

      window.addEventListener("resize", () => {
        window.DeviceUtils.viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        window.DeviceUtils.viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      });
    }

    // Initialize UI and input systems
    this.systems.ui.init(document);
    this.systems.input.init(document, {
      onStartKey: this.startGame,
    });

    // Initialize remaining input handlers
    this.systems.input.addHandlers({
      onSpaceKey: this.stopGrab,
      onPauseKey: this.togglePause,
    });

    // Initialize animation system
    if (typeof AnimationManager === "function" && !this.systems.animation) {
      this.systems.animation = window.animationManager || new AnimationManager();
      this.systems.animation.setDebugMode(this.config.DEBUG_MODE);
      this.systems.animation.init();
      window.animationManager = this.systems.animation;
    }

    // Set up additional managers
    this._setupAdditionalManagers();

    // Register global access point
    window.gameEngine = this;
    window.gameManager = this;
  }

  init() {
    // Initialize all systems first
    this._initializeGameSystems();

    // Connect systems
    this._connectSystems();

    if (this.config.DEBUG_MODE) {
      this._initDebug();
    }

    // Register global access point
    window.gameEngine = this;
    window.gameManager = this; // For backward compatibility

    // Add visibility change handler
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // Only pause if the game is active and not already paused
        if (this.systems.state.isPlaying && !this.systems.state.isPaused) {
          // Set a flag to indicate this was auto-paused due to visibility change
          this.systems.state.autopaused = true;
          
          // If a grab is in progress, force-complete it
          if (this.systems.state.currentTarget) {
            console.log("Tab change detected during grab - forcing grab completion");
            this.grabSuccess(this.systems.state.currentTarget);
          }
          
          // Use the existing pause functionality
          this.togglePause();
          
          // Also pause audio to prevent sound playing in background tab
          if (this.systems.audio) {
            this.systems.audio.pauseAll();
          }
        }
      } else {
        // Resume only if game was auto-paused by visibility change
        if (this.systems.state.isPlaying && this.systems.state.isPaused && this.systems.state.autopaused) {
          // Remove auto-pause flag
          this.systems.state.autopaused = false;
          
          // Resume the game
          this.togglePause();
        }
      }
    });

    return this;
  }

  _prepareAudio() {
    // Make sure we have an audio system
    if (!this.systems.audio) {
      console.error("[Engine] AudioManager not initialized. Make sure _initializeGameSystems() is called first.");
      return;
    }

    // Unlock audio for mobile
    this.systems.audio.unlock().then((unlocked) => {
      // Start background music with a delay
      this.createTrackedTimeout(() => {
        if (this.systems.audio) {
          this.systems.audio.startBackgroundMusic();
        }
      }, 1000);
    });
  }

  startGame() {
    // console.log("[Engine] Starting new game");

    // Unlock audio system - MUST be called in response to user interaction
    this._prepareAudio();

    if (this.systems.audio) {
      // Ensure audio context is ready, then play start sound with proper error handling
      this.systems.audio
        .resumeAudioContext()
        .then(() => {
          try {
            this.systems.audio.play("ui", "gameStart");
          } catch (error) {
            console.warn("[Engine] Failed to play game start sound:", error);
            // Try direct play as fallback for critical game feedback
            this.systems.audio.playDirect("gameStart.mp3", 0.8);
          }
        })
        .catch((e) => {
          console.warn("[Engine] Failed to resume audio context at game start:", e);
        });
    }

    // Show game screen and setup UI
    this.systems.ui.showGameScreen();
    this.systems.ui.positionElements();

    const mapBackground = document.getElementById("map-background");
if (mapBackground) {
  mapBackground.addEventListener("click", this.handleGlobeClick);
}

    // Start game loop
    this._startGameLoop();

    // Start speed progression
    if (window.speedManager) {
      window.speedManager.startSpeedProgression();
    }

    // Schedule first grab after delay
    this.createTrackedTimeout(() => {
      this.initiateGrab();
    }, this.config.INITIAL_GRAB_DELAY);
  }

  _createShards(type, count = 12) {
    const container = document.createElement("div");
    container.className = `${type}-shards`;

    for (let i = 0; i < count; i++) {
      const shard = document.createElement("div");
      shard.className = `${type}-shard`;

      // Calculate random trajectory
      const angle = (i / count) * 360 + (Math.random() * 30 - 15);
      const distance = 100 + Math.random() * 50;
      const flyX = `${Math.cos((angle * Math.PI) / 180) * distance}vw`;
      const flyY = `${Math.sin((angle * Math.PI) / 180) * distance}vh`;
      const rotation = Math.random() * 720 - 360;

      shard.style.setProperty("--flyX", flyX);
      shard.style.setProperty("--flyY", flyY);
      shard.style.setProperty("--rotation", `${rotation}deg`);

      // Random size and initial position
      const size = 20 + Math.random() * 40;
      shard.style.width = `${size}px`;
      shard.style.height = `${size}px`;
      shard.style.left = "50%";
      shard.style.top = "50%";

      container.appendChild(shard);
    }

    document.body.appendChild(container);
    return container;
  }

  /**
   * Create overlay with end game message
   * @private
   * @param {string} message - End game message to display
   * @returns {HTMLElement} The created overlay element
   */
  _createEndOverlay(message) {
    const overlay = document.createElement("div");
    overlay.className = "end-game-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    // overlay.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    overlay.style.display = "flex";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";
    overlay.style.zIndex = "9999";
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 1s ease-in-out";

    const messageElement = document.createElement("div");
    messageElement.className = "end-game-message";
    messageElement.innerHTML = message.replace(/\n/g, "<br>");
    // messageElement.style.color = "white";
    // messageElement.style.fontSize = "clamp(14px, 5vmin, 42px)";
    // messageElement.style.fontWeight = "bold";
    messageElement.style.textAlign = "center";
    // messageElement.style.textShadow = "2px 2px 4px rgba(0, 0, 0, 0.9)";

    overlay.appendChild(messageElement);
    document.body.appendChild(overlay);

    // Fade in after a short delay
    setTimeout(() => {
      overlay.style.opacity = "1";
    }, 3500);

    return overlay;
  }

  triggerGameEnd(endState, endReason = "unspecified") {
    // Guard against multiple calls
    if (this.systems.state.gameEnding) {
      console.warn(`[EndGame] Game ending already in progress, ignoring call with endState: ${endState}`);
      return false;
    }

    const trumpHandVisual = document.getElementById("trump-hand-visual");
    if (trumpHandVisual) {
      trumpHandVisual.style.opacity = "0";
      // trumpHandVisual.style.display = "none";
    }

    this._cleanupAllFlags();

    // Set flags to prevent multiple calls
    this.systems.state.gameEnding = true;
    this.systems.state.endReason = endReason;
    this.systems.state.isPlaying = false;

    if (window.speedManager) {
      window.speedManager.stopSpeedProgression();
    }

    // Validate and get end sequence
    if (!this.endGameSequences[endState]) {
      console.error(`[EndGame] Invalid end state: ${endState}`);
      endState = this.END_STATES.TRUMP_VICTORY; // Default to trump victory
    }
    const sequence = this.endGameSequences[endState];
    try {
      // Stop gameplay systems
      // this._stopGameSystems();
      if (window.UFOManager) {
        window.UFOManager.state.autoSpawnEnabled = false;
        window.UFOManager.destroy();
      }

      // Stop freedom manager to prevent protestors from appearing
      if (this.systems.freedom) {
        // Ensure all protestors are removed
        // this.systems.freedom.cleanupAllProtestors();
        this.systems.freedom.pause(); // Use pause instead of destroy
      }

      // Stop game loop
      this._stopGameLoop();

      // Clean up resources
      this._cleanupResources();

      // 1. Play Trump's animation - with error handling
      if (this.systems.animation) {
        try {
          // Check if the animation state exists
          if (this.systems.animation.animations && this.systems.animation.animations[sequence.trumpAnimation]) {
            this.systems.animation.changeState(sequence.trumpAnimation);
          } else {
            console.warn(`Animation state "${sequence.trumpAnimation}" not found, using fallback`);
            // Use a fallback animation that definitely exists
            this.systems.animation.changeState("idle");
          }
        } catch (e) {
          console.error("Error changing animation state:", e);
        }
      }

      // 2. Create flash effect and overlay
      const overlay = this._createEndOverlay(sequence.message);

      // 3. Play ending sounds - using dedicated method

      // 4. After animation delay, start world shrink but keep overlay visible
      setTimeout(() => {
        this._playEndGameSounds(sequence);
        this.systems.audio.fullReset();
        // Show world shrink animation with overlay still visible
        this.systems.ui.showWorldShrinkAnimation(() => {
          // Now that world shrink is complete, fade out overlay and show game over screen
          if (overlay) {
            overlay.style.transition = "opacity 0.8s ease-out";
            overlay.style.opacity = "0";

            // Wait for fade out, then remove overlay and show game over screen
            setTimeout(() => {
              if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
              }
              this._showFullGameOverScreen(sequence.playerWon);
            }, 800);
          } else {
            // If overlay is gone somehow, just show game over screen
            this._showFullGameOverScreen(sequence.playerWon);
          }
        }, 3000);
      }, 2500);

      return true;
    } catch (error) {
      // Reset ending state if something goes wrong
      console.error("Fatal error in triggerGameEnd:", error);
      this.systems.state.gameEnding = false;
      return false;
    }
  }

  _playEndGameSounds(sequence) {
    if (!this.systems.audio) {
      return;
    }

    this.systems.audio.stopAllExceptBackgroundMusic();

    if (this.systems.audio.backgroundMusic) {
      this.systems.audio.fadeTo(this.systems.audio.backgroundMusic, 0, 1000, () => {
        this.systems.audio.stopBackgroundMusic();
      });
    }

    try {
      // Simple, direct sound playing
      // finddme
      if (sequence.audioSequence && sequence.audioSequence.length) {
        sequence.audioSequence.forEach((sound, index) => {
          setTimeout(() => {
            const category = ["beenVeryNiceToYou", "fourYears"].includes(sound) ? "trump" : "ui";
            this.systems.audio.play(category, sound, 0.8);
          }, index * 800); // Stagger sounds slightly
        });
      }
      // this.systems.audio.play("ui", "speedup", 0.6);
    } catch (error) {
      console.error("[EndGame] Error playing end game sounds:", error);
    }
  }

  /**
   * End the game and show results
   * @param {boolean} playerWon - Whether player won
   * @param {Object} [options] - Optional configuration for game over
   */
  // endGame(playerWon, options = {}) {
  //   if (options.showWorldShrinkAnimation) {
  //     // Transition with world shrink animation
  //     this.systems.ui.showWorldShrinkAnimation(() => {
  //       this._showFullGameOverScreen(playerWon);
  //     }, options.animationDuration || 4000);
  //   } else {
  //     // Directly show full game over screen
  //     this._showFullGameOverScreen(playerWon);
  //   }
  // }

  /**
   * Restart the game
   */
  restartGame() {
    // console.log("[Engine] Restarting game");

    // FIRST: Hide UI elements that should be hidden during restart
    const gameOverScreen = document.getElementById("game-over-screen");
    if (gameOverScreen) {
      gameOverScreen.classList.add("hidden");
      gameOverScreen.style.display = "none"; // Keep this to ensure it's hidden
    }

    this._cleanupAllFlags();

    const gameContainer = document.getElementById("game-container");
    if (gameContainer) {
      gameContainer.style.transform = "scale(1)";
      gameContainer.style.opacity = "1";
      gameContainer.style.display = "block";
    }

    // Force re-setup of hitbox handlers
    this.systems.input._setupHitboxHandlers();

    // Stop the game loop and clean up resources
    this._stopGameLoop();
    this._cleanupResources();
    this._resetSystems();

    // Reset all managers
    if (window.speedManager) window.speedManager.reset();
    if (window.trumpHandEffects) window.trumpHandEffects.reset();
    if (window.UFOManager) window.UFOManager.reset();
    if (window.handHitboxManager) window.handHitboxManager.reset();

    if (window.freedomManager) window.freedomManager.reset();

    if (window.protestorHitboxManager) window.protestorHitboxManager.cleanupAll();

    // Reset audio with proper context management
    if (this.systems.audio) {
      this.systems.audio.fullReset();
    }

    // Reset game state
    this.systems.state.reset();

    // Reset UI elements
    this.systems.ui.resetAllElements();

    // Show game screen with slight delay to ensure DOM updates
    setTimeout(() => {
      const gameScreen = document.getElementById("game-screen");
      // if (gameScreen) {
      //   gameScreen.classList.remove("hidden");
      //   gameScreen.style.display = "block";
      // }

      // Start fresh game
      this.startGame();

      // Announce restart for screen readers
      if (this.systems.ui?.announceForScreenReaders) {
        this.systems.ui.announceForScreenReaders("Game restarted! Get ready to block!");
      }
    }, 200);

    this.systems.state.gameEnding = false;
    this.systems.state.endReason = null;
  }

  _showFullGameOverScreen(playerWon) {
    // Show game over screen
    this.systems.ui.showGameOverScreen(playerWon, this.systems.state);

    // Show voice recorder after a short delay
    setTimeout(() => {
      if (typeof openVoiceRecordingInterface === "function") {
        openVoiceRecordingInterface();
      } else {
        // Fallback: Try to show the modal directly
        const recorderModal = document.getElementById("voice-recorder-modal");
        if (recorderModal) {
          recorderModal.classList.remove("hidden");
          recorderModal.style.display = "flex";
          recorderModal.style.opacity = "1";
          recorderModal.style.visibility = "visible";

          // Initialize voice recorder if needed
          if (!window.voiceRecorder) {
            window.voiceRecorder = new VoiceRecorder();
            window.voiceRecorder.init();
          }
        }
      }
    }, 500);

    // Schedule auto-restart
    if (this.config.AUTO_RESTART_DELAY > 0) {
      this._scheduleAutoRestart();
    }
  }

  initiateGrab() {
    console.log("grabbing");

    // Skip if game isn't actively playing
    if (!this.systems.state.isPlaying || this.systems.state.isPaused) {
      return;
    }

    if (this._checkGameOverCondition()) {
      this.triggerGameEnd(this.END_STATES.TRUMP_VICTORY, "all_countries_claimed");
      return;
    }

    // Select target country
    const targetCountry = this._selectTargetCountry();
    if (!targetCountry) {
      // Use tracked timeout for retry
      this.createTrackedTimeout(() => {
        this.initiateGrab();
      }, 500);
      return;
    }

    // Select animation for target
    const animationInfo = this._selectAnimationForCountry(targetCountry);

    // Set up grab sequence
    this._prepareGrabSequence(targetCountry, animationInfo);

    // Play audio warnings - using direct system.audio reference
    if (this.systems.audio) {
      // Ensure audio context is resumed first
      this.systems.audio
        .resumeAudioContext()
        .then(() => {
          try {
            // Use the proper method that includes timing adjustments
            this.systems.audio.playGrabWarning();

            // Start the grab attempt sound
            this.systems.audio.playGrabAttempt(targetCountry);
          } catch (error) {
            console.warn("[Engine] Error playing grab audio:", error);
            // Try direct play as fallback for critical game feedback
            // this.systems.audio.playDirect("grabWarning.mp3", 0.8);
            // this.systems.audio.playDirect("trumpGrabbing1.mp3", 0.8);
          }
        })
        .catch((e) => {
          console.warn("[Engine] Failed to resume audio context:", e);
          // Still try to play a direct sound as last resort
          try {
            // this.systems.audio.playDirect("grabWarning.mp3", 0.8);
          } catch (err) {
            // Silent fail
          }
        });
    }
    // Announce for screen readers
    this.systems.ui.announceForScreenReaders(`Trump is trying to grab ${targetCountry}! Smack his hand!`);

    // Start animation sequence
    this._startGrabAnimation(targetCountry, animationInfo.animationName);

    // Failsafe to complete grab if not blocked
    // this.createTrackedTimeout(() => {
    //   console.log("force complete block");

    //   if (this.systems.state.currentTarget === targetCountry) {
    //     this.grabSuccess(targetCountry);
    //   }
    // }, 8000);
  }

  stopGrab(event) {
    const targetCountry = this.systems.state.currentTarget;
    if (!targetCountry) return;

    // Determine specific grab region early
    const smackRegion = this._determineSmackRegion(targetCountry);

    // Handle audio effects
    this._playBlockSound(smackRegion);

    // Stop and reset animation
    this._handleAnimationStop();

    // Reset target to prevent double-handling
    this._resetGrabTarget();

    // Apply visual block effects
    this._applyBlockVisualEffects(targetCountry);

    // Update game state
    this._updateScoreAfterBlock();

    // Play block animation sequence
    this._playBlockAnimationSequence(smackRegion);

    // Accessibility and UI cleanup
    this._handlePostBlockUIUpdates(targetCountry);
  }

  // Play block sound with error handling
  _playBlockSound(smackRegion) {
    if (!this.systems.audio) return;

    try {
      this.systems.audio
        .resumeAudioContext()
        .then(() => {
          try {
            this.systems.audio.playSuccessfulBlock(smackRegion);
          } catch (error) {
            console.warn("[Engine] Error playing block sound:", error);
            // Fall back to direct slap sound if needed
            this.systems.audio.playDirect("slap1.mp3", 0.8);
          }
        })
        .catch((error) => {
          console.warn("[Engine] Failed to resume audio context:", error);
        });
    } catch (error) {
      console.warn("[Engine] Audio system error:", error);
    }
  }

  // Handle animation stopping
  _handleAnimationStop() {
    if (!this.systems.animation) return;

    try {
      this.systems.animation.stop();
      this.systems.animation.changeState("idle");
    } catch (e) {
      console.warn("[Engine] Error stopping animation:", e);
    }
  }

  // Apply visual block effects
  _applyBlockVisualEffects(targetCountry) {
    // Prioritize systems reference
    if (this.systems.effects) {
      this.systems.effects.applyHitEffect();
      this.systems.effects.highlightTargetCountry(targetCountry, false);
      this.systems.effects.setNotGrabbingState();
      return;
    }

    // Fall back to global reference
    if (window.trumpHandEffects) {
      console.warn("Falling back to global trumpHandEffects");
      window.trumpHandEffects.applyHitEffect();
      window.trumpHandEffects.highlightTargetCountry(targetCountry, false);
      return;
    }

    // Absolute last resort
    console.warn("No visual effects system available");
  }

  // Handle post-block UI updates
  _handlePostBlockUIUpdates(targetCountry) {
    // Screen reader announcement
    if (this.systems.ui?.announceForScreenReaders) {
      this.systems.ui.announceForScreenReaders(`Great job! You blocked Trump's grab on ${targetCountry}!`);
    }

    // Hide hand hitbox if manager exists
    if (window.handHitboxManager) {
      window.handHitboxManager.hideHandHitbox();
    }
  }

  grabSuccess(country) {
    console.log(`[Game] Grab success for ${country}`);
    
    // Reset consecutive hits
    this.systems.state.consecutiveHits = 0;
    
    // Apply visual effect if available
    if (window.trumpHandEffects) {
      window.trumpHandEffects.applyGrabSuccessEffect(country);
    }
  
    // Determine the actual country to update (handle Canada special case)
    const isCanada = country === "eastCanada" || country === "westCanada";
    const targetCountry = isCanada ? "canada" : country;
    
    // Get current state for the country
    const state = this.systems.state;
    const countryState = state.countries[targetCountry];
    
    if (!countryState) {
      console.error(`[Game] Country state not found for ${targetCountry}`);
      return;
    }
    
    // Update claims with bounds checking
    const newClaims = Math.min(countryState.claims + 1, countryState.maxClaims);
    countryState.claims = newClaims;
    
    console.log(`[Game] Updated claims for ${targetCountry}: ${countryState.claims}/${countryState.maxClaims}`);
  
    // Update UI
    this.systems.ui.updateFlagOverlay(targetCountry, countryState.claims);
    
    // Play appropriate audio
    if (isCanada) {
      this._handleCanadaGrab(country);
    } else {
      this._handleStandardCountryGrab(country);
    }
  
    // Check if this is the game-winning grab
    const isGameOver = this._checkGameOverCondition();
    if (isGameOver) {
      console.log("[Game] Game over condition met in grabSuccess");
      this.triggerGameEnd(this.END_STATES.TRUMP_VICTORY, "all_countries_claimed");
      return;
    }
  
    // Continue game progression if game isn't over
    this._proceedWithGameProgression();
  }
  
  
  // grabSuccess(country) {
  //   console.log("iii grabsucess!");
  //   console.log(`iii FULL COUNTRY STATE BEFORE GRAB:`, JSON.stringify(this.systems.state.countries, null, 2));
  //   console.log(`iii country being grabbed: ${country}`);
    
  //   // Reset consecutive hits
  //   this.systems.state.consecutiveHits = 0;
  //   window.trumpHandEffects.applyGrabSuccessEffect(country);
  
  //   // Check if this is the game-winning grab
  //   const isGameOver = this._checkGameOverCondition();
  
  //   if (isGameOver) {
  //     console.log("game is over grabSuccess");
  //     this.triggerGameEnd(this.END_STATES.TRUMP_VICTORY, "all_countries_claimed");
  //     return; // Important! Don't continue execution
  //   }
  
  //   // Handle country grab (visual updates)
  //   this._updateCountryClaims(country);
  
  //   console.log(`iii FULL COUNTRY STATE AFTER GRAB:`, JSON.stringify(this.systems.state.countries, null, 2));
  
  //   // Handle game progression
  //   this._proceedWithGameProgression();
  // }
  
  _updateCountryClaims(country) {
    console.log("iii updating country claims!");
  
    const state = this.systems.state;
    const isCanada = country === "eastCanada" || country === "westCanada";
    const targetCountry = isCanada ? "canada" : country;
  
    console.log(`iii target country: ${targetCountry}`);
    console.log(`iii current claims: ${state.countries[targetCountry].claims}`);
    console.log(`iii max claims: ${state.countries[targetCountry].maxClaims}`);
  
    state.countries[targetCountry].claims = Math.min(
      state.countries[targetCountry].claims + 1, 
      state.countries[targetCountry].maxClaims
    );
  
    console.log(`iii claims after increment: ${state.countries[targetCountry].claims}`);
  
    this.systems.ui.updateFlagOverlay(isCanada ? "canada" : country, state.countries[targetCountry].claims);
  
    try {
      if (country === "eastCanada" || country === "westCanada") {
        this._handleCanadaGrab(country);
      } else {
        this._handleStandardCountryGrab(country);
      }
    } catch (error) {
      console.warn("[Engine] Error handling grab success:", error);
    }
  }
  _proceedWithGameProgression() {
    if (this.systems.animation) {
      this.systems.animation.changeState("victory", () => {
        // Continue game loop
        this.initiateGrab();
      });
    } else {
      // Fallback if no animation manager
      this.createTrackedTimeout(() => this.initiateGrab(), 1000);
    }
  }

  /**
   * Toggle game pause state
   */
  togglePause() {
    const state = this.systems.state;
    state.isPaused = !state.isPaused;

    // Update UI
    this.systems.ui.updatePauseButton(state.isPaused);

    if (state.isPaused) {
      this._pauseGame();
    } else {
      this._resumeGame();
    }
  }

  /**
   * Create a tracked timeout that will be properly cleaned up on game end
   * @param {Function} callback - Function to call when timeout completes
   * @param {number} delay - Delay in milliseconds
   * @returns {number} - Timeout ID
   */
  createTrackedTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
      // Remove from tracked timeouts first
      const index = this.resources.timeouts.indexOf(timeoutId);
      if (index !== -1) this.resources.timeouts.splice(index, 1);

      // Then execute callback
      callback();
    }, delay);

    // Track this timeout
    this.resources.timeouts.push(timeoutId);
    return timeoutId;
  }

  /**
   * Create a tracked interval that will be properly cleaned up on game end
   * @param {Function} callback - Function to call on each interval
   * @param {number} delay - Interval delay in milliseconds
   * @returns {number} - Interval ID
   */
  createTrackedInterval(callback, delay) {
    const intervalId = setInterval(callback, delay);
    this.resources.intervals.push(intervalId);
    return intervalId;
  }

  // PRIVATE METHODS

  /**
   * Bind class methods to maintain 'this' context
   * @private
   */
  _bindMethods() {
    // Grab/block mechanics
    this.initiateGrab = this.initiateGrab.bind(this);
    this.stopGrab = this.stopGrab.bind(this);
    this.grabSuccess = this.grabSuccess.bind(this);
    this.handleGlobeClick = this.handleGlobeClick.bind(this);


    // Game flow control
    this.togglePause = this.togglePause.bind(this);
    this.startGame = this.startGame.bind(this);
    // this.endGame = this.endGame.bind(this);
    this.restartGame = this.restartGame.bind(this);

    // Resource management
    this.createTrackedTimeout = this.createTrackedTimeout.bind(this);
    this.createTrackedInterval = this.createTrackedInterval.bind(this);

    // Game loop
    this._updateGameFrame = this._updateGameFrame.bind(this);
  }
  _setupAdditionalManagers() {
    // Get the audio manager reference
    const audioManager = this.systems.audio;

    if (typeof HandHitboxManager === "function") {
      if (!window.handHitboxManager) {
        try {
          window.handHitboxManager = new HandHitboxManager(this.systems.audio);
        } catch (error) {
          console.error("Error creating HandHitboxManager:", error);
        }
      }
      this.systems.collision = window.handHitboxManager;
    }

    // Trump hand effects controller
    if (typeof TrumpHandEffectsController === "function" && this.systems.state) {
      if (!window.trumpHandEffects) {
        window.trumpHandEffects = new TrumpHandEffectsController(this.systems.state, audioManager);
      }
      this.systems.effects = window.trumpHandEffects;
    }

    // Protestor hitbox manager
    if (typeof ProtestorHitboxManager === "function") {
      if (!window.protestorHitboxManager) {
        window.protestorHitboxManager = new ProtestorHitboxManager(false, audioManager);
      }
      this.systems.protestorHitbox = window.protestorHitboxManager;
    }

    if (typeof FreedomManager === "function") {
      if (!window.freedomManager) {
        try {
          window.freedomManager = new FreedomManager(
            this.systems.state,
            this.systems.ui.elements,
            this.systems.audio,
            {}, // Default config
            this, // Pass the game engine instance
            this.systems.animation,

          );
        } catch (error) {
          console.error("aaa Error creating FreedomManager:", error);
        }
      }
      this.systems.freedom = window.freedomManager;
    }

    if (typeof UFOManager === "function") {
      // console.log("Setting up UFO Manager");

      if (!window.UFOManager) {
        window.UFOManager = new UFOManager(this.systems.audio);
        window.UFOManager.init(this); // Pass the game engine
      }
      this.systems.ufo = window.UFOManager;
    }

    // Speed manager
    if (typeof GameSpeedManager === "function") {
      if (!window.speedManager) {
        window.speedManager = new GameSpeedManager(this.systems.state, this.systems.animation, audioManager);
        window.speedManager.init();
      }
      this.systems.speed = window.speedManager;
    }
  }

  /**
   * Connect systems together
   * @private
   */
  _connectSystems() {
    // Connect UI to state for updates
    this.systems.ui.connectState(this.systems.state);

    // Connect input to game elements
    this.systems.input.connectUI(this.systems.ui);

    this.systems.state.setGameEngine(this);

  }

  /**
   * Initialize debug features
   * @private
   */
  _initDebug() {
    if (typeof DebugManager === "function") {
      // Create a UI elements reference object using the system.ui elements
      const debugElements = this.systems && this.systems.ui ? this.systems.ui.elements : {};

      const debugManager = new DebugManager(
        debugElements, // Pass existing UI elements or empty object
        this.systems.state,
        this.systems.animation
      );

      window.debugManager = debugManager;
      debugManager.init();

      // Connect audio to debug
      if (this.systems.audio) {
        debugManager.audioManager = this.systems.audio;

        // Add a global test function for console debugging
        window.testAudio = function (category, name) {
          return debugManager.audioManager?.play(category, name) || "AudioManager not available";
        };
      }
    }
  }

  /**
   * Start the game loop
   * @private
   */
  _startGameLoop() {
    // Set playing state
    this.systems.state.isPlaying = true;

    // Reset timing data
    this.systems.state.lastFrameTime = performance.now();

    // Start countdown timer
    this.systems.state.countdownTimer = this.createTrackedInterval(this._updateCountdown.bind(this), 1000);

    // Start animation loop
    this._requestAnimationFrame();
  }

  /**
   * Stop the game loop
   * @private
   */
  _stopGameLoop() {
    // Cancel animation frame if it exists
    if (this.systems.state.currentAnimationFrame) {
      cancelAnimationFrame(this.systems.state.currentAnimationFrame);
      this.systems.state.currentAnimationFrame = null;
    }

    // Clear countdown timer
    if (this.systems.state.countdownTimer) {
      clearInterval(this.systems.state.countdownTimer);
      this.systems.state.countdownTimer = null;
    }
  }


  /**
 * Adds event listeners with proper tracking for cleanup
 * @param {HTMLElement} element - Element to attach events to
 * @param {Object} eventMap - Map of event types to handler functions
 * @param {boolean} useCapture - Whether to use capture phase
 */
_addTrackedEventListeners(element, eventMap, useCapture = false) {
  if (!element) return;
  
  // Initialize tracking array if it doesn't exist
  if (!this.resources.eventListeners) {
    this.resources.eventListeners = [];
  }
  
  // Add each event listener and track it
  Object.entries(eventMap).forEach(([eventType, handler]) => {
    element.addEventListener(eventType, handler, useCapture);
    
    // Store reference for cleanup
    this.resources.eventListeners.push({
      element,
      eventType,
      handler,
      useCapture
    });
  });
}

/**
 * Removes all tracked event listeners
 */
_removeTrackedEventListeners() {
  if (!this.resources.eventListeners) return;
  
  this.resources.eventListeners.forEach(({ element, eventType, handler, useCapture }) => {
    if (element) {
      element.removeEventListener(eventType, handler, useCapture);
    }
  });
  
  this.resources.eventListeners = [];
}


  /**
   * Clean up all tracked resources
   * @private
   */
  _cleanupResources() {
    // Clear all timeouts
    this.resources.timeouts.forEach((id) => clearTimeout(id));
    this.resources.timeouts = [];
  
    // Clear all intervals
    this.resources.intervals.forEach((id) => clearInterval(id));
    this.resources.intervals = [];
  
    // Cancel all animation frames
    this.resources.animationFrames.forEach((id) => cancelAnimationFrame(id));
    this.resources.animationFrames = [];
    
    // Remove all tracked event listeners
    this._removeTrackedEventListeners();
  }

  /**
   * Reset all game systems
   * @private
   */
  _resetSystems() {
    // console.log("[Engine] Resetting all systems");

    // Reset game state
    this.systems.state.reset();

    // Reset audio
    // if (this.systems.audio) {
    //   this.systems.audio.stopAll();
    //   this.systems.audio.reset();
    // }

    // In restartGame()findddme

    // Reset animation
    if (this.systems.animation) {
      this.systems.animation.stop();
      this.systems.animation.isPaused = false;
      this.systems.animation.changeState("idle");
    }

    // Reset freedom manager
    if (this.systems.freedom) {
      this.systems.freedom.reset();
    }

    // Reset collision detection
    if (this.systems.collision && typeof this.systems.collision.reset === "function") {
      this.systems.collision.reset();
    }

    // Reset other managers if they exist
    if (window.protestorHitboxManager) {
      window.protestorHitboxManager.cleanupAll();
    }

    if (window.speedManager) {
      window.speedManager.reset();
      window.speedManager.startSpeedProgression();
    }
  }

  /**
   * Request a new animation frame
   * @private
   */
  // worried about this
  _requestAnimationFrame() {
    this.systems.state.currentAnimationFrame = requestAnimationFrame(this._updateGameFrame);
    this.resources.animationFrames.push(this.systems.state.currentAnimationFrame);
  }

  /**
   * Update the game on each animation frame
   * @param {number} timestamp - Current timestamp
   * @private
   */
  _updateGameFrame(timestamp) {
    // Check if game is currently playing
    // if (!this.systems.state.isPlaying) {
    //   // Ensure grab sounds stop when game isn't playing
    //   if (this.systems.audio) {
    //     this.systems.audio.stopGrabSound();
    //   }
    //   return;
    // }

    // Calculate delta time in milliseconds
    const deltaTime = timestamp - (this.systems.state.lastFrameTime || timestamp);
    this.systems.state.lastFrameTime = timestamp;

    // Update freedom system if available
    if (this.systems.freedom) {
      this.systems.freedom.update(deltaTime);
    }

    // Continue animation loop
    this._requestAnimationFrame();
  }

  handleGlobeClick(event) {
    // Ignore if we're clicking on a hitbox or during game ending
    if (event.target.classList.contains('hitbox') || 
        this.systems.state.gameEnding || 
        !this.systems.state.isPlaying) {
      return;
    }
    
    // Get the game container
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer) return;
    
    // Apply light shake effect
    gameContainer.classList.add("light-screen-shake");
    
    // Remove the class after animation completes
    setTimeout(() => {
      gameContainer.classList.remove("light-screen-shake");
    }, 400);
    
    // Play a subtle click sound if available
    if (this.systems.audio) {
      this.systems.audio.playIfContextReady("ui", "worldClick", 0.3);
    }
  }
  

  _updateCountdown() {
    // Skip if game is paused
    if (this.systems.state.isPaused) return;

    // Log time for debugging
    const oldTime = this.systems.state.timeRemaining;

    // Decrement time
    this.systems.state.timeRemaining--;

    // Log significant time points
    if (oldTime % 10 === 0 || this.systems.state.timeRemaining <= 5) {
    }

    // Update UI
    this.systems.ui.updateProgressBar(this.systems.state.timeRemaining, this.config.GAME_DURATION);
    this.systems.ui.updateHUD(this.systems.state);

    // Announce time at key intervals
    if (this.systems.state.timeRemaining <= 30 && this.systems.state.timeRemaining % 10 === 0) {
      this.systems.ui.announceForScreenReaders(`Warning: ${this.systems.state.timeRemaining} seconds remaining`);
    }

    // Enhanced check for time-based win condition
    if (this.systems.state.timeRemaining <= 0) {
      this.triggerGameEnd(this.END_STATES.RESISTANCE_WIN, "timer_expired");
    }
  }

  _pauseGame() {
    console.log("[Engine] Pausing game");

    // Stop countdown timer
    clearInterval(this.systems.state.countdownTimer);
    this.systems.state.countdownTimer = null;

    // Pause animations
    if (this.systems.animation) {
      this.systems.animation.pause();
    }

    // Pause freedom manager animations
    if (this.systems.freedom) {
      this.systems.freedom.pause();
    }

    // Show pause overlay
    this.systems.ui.createPauseOverlay();

    if (this.systems.audio) {
      try {
        // Make sure audio context is active before pausing
        this.systems.audio
          .resumeAudioContext()
          .then(() => {
            try {
              this.systems.audio.pauseAll();
            } catch (e) {
              console.warn("[Engine] Error in pauseAll:", e);
            }
          })
          .catch((e) => {
            console.warn("[Engine] Failed to resume audio context for pause:", e);
            // Try to pause anyway
            try {
              this.systems.audio.pauseAll();
            } catch (err) {
              // Silent fail
            }
          });
      } catch (error) {
        console.warn("[Engine] Error pausing audio:", error);
      }
    }

    this.systems.ui.announceForScreenReaders("Game paused");
  }

  _resumeGame() {
    // Remove pause overlay
    this.systems.ui.removePauseOverlay();

    // Resume timers
    this.systems.state.countdownTimer = this.createTrackedInterval(this._updateCountdown.bind(this), 1000);

    // Resume animations
    if (this.systems.animation) {
      this.systems.animation.resume();
    }

    // Resume freedom manager animations
    if (this.systems.freedom) {
      this.systems.freedom.resume();
    }

    // Restart grab sequence
    this.initiateGrab();

    if (this.systems.audio) {
      // First resume audio context
      this.systems.audio
        .resumeAudioContext()
        .then(() => {
          try {
            this.systems.audio.resumeAll();
          } catch (error) {
            console.warn("[Engine] Error resuming audio:", error);
          }
        })
        .catch((e) => {
          console.warn("[Engine] Failed to resume audio context:", e);
        });
    }

    this.systems.ui.announceForScreenReaders("Game resumed");
  }

  /**
   * Select a target country for grabbing
   * @private
   * @returns {string|null} The selected country name or null if none available
   */
  _selectTargetCountry() {
    const state = this.systems.state;
    const availableCountries = Object.keys(state.countries).filter((country) => {
      return state.countries[country].claims < state.countries[country].maxClaims;
    });

    if (availableCountries.length === 0) {
      return null;
    }

    return availableCountries[Math.floor(Math.random() * availableCountries.length)];
  }

  /**
   * Select an animation for the target country
   * @private
   * @param {string} targetCountry - The target country
   * @returns {Object} Animation info
   */
  _selectAnimationForCountry(targetCountry) {
    // Get current size from FreedomManager
    const currentSize = window.freedomManager?.getTrumpSize()?.size || "normal";

    const possibleAnimations = this.systems.state.countryAnimations[targetCountry];
    let animationName = possibleAnimations[Math.floor(Math.random() * possibleAnimations.length)];

    // If not in normal size, try to find a size-specific variant
    if (currentSize !== "normal") {
      const sizedAnimationVariant = `${animationName}${currentSize.charAt(0).toUpperCase() + currentSize.slice(1)}`;

      console.log("[GRAB DEBUG] Checking sized animation variant:", {
        baseAnimation: animationName,
        sizedVariant: sizedAnimationVariant,
      });

      // Check if the sized variant exists in animations
      if (window.animationManager.animations[sizedAnimationVariant]) {
        animationName = sizedAnimationVariant;
      } else {
        console.warn("[GRAB DEBUG] No sized variant found, using base animation");
      }
    }

    return {
      animationName,
      isEastCanada: animationName.includes("grabEastCanada"),
      isWestCanada: animationName.includes("grabWestCanada"),
    };
  }

  /**
   * Prepare the grab sequence
   * @private
   * @param {string} targetCountry - The target country
   * @param {Object} animationInfo - Animation information
   */
  _prepareGrabSequence(targetCountry, animationInfo) {
    // Load country-specific sounds when targeting a country
    if (this.systems.audio && typeof this.systems.audio.loadCountrySounds === "function") {
      // this.systems.audio.loadCountrySounds(targetCountry);
    }

    // Set state flags
    this.systems.state.currentTarget = targetCountry;
    this.systems.state.isEastCanadaGrab = animationInfo.isEastCanada;
    this.systems.state.isWestCanadaGrab = animationInfo.isWestCanada;

    // Check if this is the first block
    const isBeforeFirstBlock = this.systems.state.stats.successfulBlocks === 0;

    if (window.trumpHandEffects) {
      window.trumpHandEffects.makeHittable(isBeforeFirstBlock);
      window.trumpHandEffects.highlightTargetCountry(targetCountry, true);
      window.trumpHandEffects.setGrabbingState();

      // Explicitly check for prompt
      window.trumpHandEffects.updatePromptVisibility();
    } else {
    }
  }

  /**
   * Start the grab animation
   * @private
   * @param {string} targetCountry - The target country
   * @param {string} animationName - The animation name
   */
  _startGrabAnimation(targetCountry, animationName) {
    if (!this.systems.animation) return;

    // Start the animation with completion callback
    this.systems.animation.changeState(animationName, () => {
      try {
        // This runs when grab completes without being blocked
        if (this.systems.state.currentTarget === targetCountry && this.systems.state.isPlaying && !this.systems.state.isPaused) {
          // Handle successful grab
          this.grabSuccess(targetCountry);
        } else if (this.systems.state.isPlaying && !this.systems.state.isPaused) {
          // Grab was interrupted or blocked - start next cycle
          this.initiateGrab();
        }

        // Clean up visual elements
        this.systems.ui.cleanupGrabVisuals();
      } catch (error) {
        console.error("[Engine] Error in grab animation callback:", error);
        // Ensure we don't get stuck - reset state and continue
        this._resetGrabTarget();
        if (this.systems.state.isPlaying && !this.systems.state.isPaused) {
          this.initiateGrab();
        }
      }
    });
  }

  /**
   * Determine the specific region being smacked
   * @private
   * @param {string} targetCountry - The target country
   * @returns {string} The specific region
   */
  _determineSmackRegion(targetCountry) {
    if (targetCountry === "canada") {
      if (this.systems.state.isEastCanadaGrab) {
        return "eastCanada";
      } else if (this.systems.state.isWestCanadaGrab) {
        return "westCanada";
      }
    }
    return targetCountry;
  }

  /**
   * Reset the grab target
   * @private
   */
  _resetGrabTarget() {
    this.systems.state.currentTarget = null;
    this.systems.state.isEastCanadaGrab = false;
    this.systems.state.isWestCanadaGrab = false;
  }

  /**
   * Update score after a successful block
   * @private
   */
  _updateScoreAfterBlock() {
    const state = this.systems.state;

    // Check if this is the FIRST successful block
    if (state.stats.successfulBlocks === 0 && window.handHitboxManager) {
      window.handHitboxManager.handleSuccessfulHit();
    }

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

    // Increase score
    state.score += 10;

    // Track consecutive hits and stats
    state.consecutiveHits++;
    state.stats.successfulBlocks++;

    // Update HUD
    this.systems.ui.updateHUD(state);

    // Announce for screen readers
    this.systems.ui.announceForScreenReaders(`Hand blocked! +10 points. Total score: ${state.score}`);
  }

  /**
   * Play the block animation sequence
   * @private
   * @param {string} smackRegion - The region being smacked
   */
  _playBlockAnimationSequence(smackRegion) {
    // Set a flag to prevent multiple animation sequences
    if (this.systems.state.isPlayingAnimationSequence) return;
    this.systems.state.isPlayingAnimationSequence = true;

    const finishSequence = () => {
      this.systems.state.isPlayingAnimationSequence = false;
      this.initiateGrab();
    };

    // Use smack manager directly from global if available
    if (this.systems.animation) {
      // Attempt to play smack animation if animation system exists
      this.systems.animation.playSmackAnimation(smackRegion, () => {
        // After smack completes, play slapped animation
        this.systems.animation.changeState("slapped", finishSequence);
      });
    } else {
      // Last resort fallback
      this.createTrackedTimeout(finishSequence, 1000);
    }
  }

  _handleCanadaGrab(eastOeWest) {
    const state = this.systems.state;

    // Increment claim on the shared Canada entity
    state.countries.canada.claims = Math.min(state.countries.canada.claims + 1, state.countries.canada.maxClaims);

    // Get current claim count
    const claimCount = state.countries.canada.claims;

    if (this.systems.audio) {
      // this.systems.audio.resumeAudioContext().then(() => {
      //   try {
      if (claimCount < state.countries.canada.maxClaims) {
        console.log("iii grabbed canada");
        
        this.systems.audio.playSuccessfulGrab("canada");
      } else {
        console.log("iii fully annexed canada");

        this.systems.audio.playCountryFullyAnnexedCry("canada");
      }
      //   } catch (error) {
      //     console.warn("[Engine] Error playing grab success sound:", error);
      //     // Fall back to direct sound
      //     // this.systems.audio.playDirect("partialAnnex1.mp3", 0.8);
      //   }
      // });
    }

    // Update flag overlay
    this.systems.ui.updateFlagOverlay("canada", claimCount);

    // Announce for screen readers
    this.systems.ui.announceForScreenReaders(`Trump has claimed part of Canada! ${claimCount} out of 3 parts taken.`);
  }
  _handleStandardCountryGrab(country) {
    console.log("iii handling a standard country grab");
  
    const state = this.systems.state;
    const claimCount = state.countries[country].claims;
    const isFullAnnexation = claimCount >= state.countries[country].maxClaims;
  
    console.log("iii claimcount is", claimCount);
  
    if (isFullAnnexation) {
      console.log("iii fully annexed");
      this.systems.audio.playCountryFullyAnnexedCry(country);
    } else {
      console.log("iii partially annexed");
      this.systems.audio.playSuccessfulGrab(country);
    }
  
    // Update flag overlay
    this.systems.ui.updateFlagOverlay(country, claimCount);
  
    // Announce for screen readers
    this.systems.ui.announceForScreenReaders(`Trump has claimed part of ${country}! ${claimCount} out of 3 parts taken.`);
  }

  _checkGameOverCondition() {
    const state = this.systems.state;

    // Count annexed countries
    const countriesToCheck = this.config.COUNTRIES;
    const claimedCountries = countriesToCheck.filter((country) => state.countries[country].claims >= state.countries[country].maxClaims);

    // Update music intensity
    // if (this.systems.audio) {
    //   this.systems.audio.updateMusicIntensity(claimedCountries.length);
    // }

    // Game over if all countries are claimed
    const isGameOver = claimedCountries.length >= countriesToCheck.length;

    if (isGameOver) {
      // Only announce - DON'T end the game here
      this.systems.ui.announceForScreenReaders("All countries have fallen to Trump! Game over!");
    }

    return isGameOver;
  }
  /**
   * Schedule auto-restart after game over
   * @private
   */
  _scheduleAutoRestart() {
    this.createTrackedTimeout(() => {
      const recorderModal = document.getElementById("voice-recorder-modal");
      const thankYouModal = document.getElementById("thank-you-message");

      // Check if modals are hidden and no interaction occurred
      const canAutoRestart =
        (!recorderModal || recorderModal.classList.contains("hidden")) &&
        (!thankYouModal || thankYouModal.classList.contains("hidden")) &&
        (!window.voiceRecorder || window.voiceRecorder.userInteracted !== true);

      if (canAutoRestart) {
        // document.getElementById("restart-button").style.visibility = "block"
        // this.restartGame();
      }
    }, this.config.AUTO_RESTART_DELAY);
  }

  _cleanupAllFlags() {
    // Remove flag elements from DOM
    document.querySelectorAll(".trump-flag-animation").forEach((flag) => {
      if (flag.parentNode) {
        flag.parentNode.removeChild(flag);
      }
    });

    // Clear flag references in state
    if (this.systems.state && this.systems.state.countries) {
      Object.keys(this.systems.state.countries).forEach((countryId) => {
        if (this.systems.state.countries[countryId]) {
          this.systems.state.countries[countryId].flags = [];
        }
      });
    }

    // Call animator's cleanup if it exists
    if (window.animationManager && typeof window.animationManager.removeAllFlags === "function") {
      window.animationManager.removeAllFlags();
    }
  }


}

// window.GameEngine = GameEngine;

/**
 * Game State - Manages all game data and state
 */
class GameState {
  constructor(config) {
    this.config = config;
    this.gameEngine = null; // Initialize as null

    this.reset();
  }


  setGameEngine(gameEngine) {
    this.gameEngine = gameEngine;
  }
  /**
   * Reset state to initial values
   */
  reset() {
    // Core state flags
    this.isPlaying = false;
    this.isPaused = false;
    this.isPlayingAnimationSequence = false;

    // Game progress
    this.score = 0;
    this.timeRemaining = this.config.GAME_DURATION;
    this.gameSpeedMultiplier = 1.0;
    this.countdownTimer = null;
    this.currentTarget = null;
    this.consecutiveHits = 0;

    // Grab state
    this.isEastCanadaGrab = false;
    this.isWestCanadaGrab = false;

    // Animation state
    this.currentAnimationFrame = null;
    this.lastFrameTime = 0;

    // Map state
    this.mapScale = 1.0;
    this.mapOffsetX = 0;
    this.mapOffsetY = 0;

    // Statistics
    this.stats = {
      successfulBlocks: 0,
      countriesDefended: 0,
    };

    // Reset countries
    this.countries = this._createInitialCountryState();

    // Set up animation targets
    this.countryAnimations = {
      canada: ["grabEastCanada", "grabWestCanada"],
      mexico: ["grabMexico"],
      greenland: ["grabGreenland"],
    };
  }

  /**
   * Create initial country state
   * @private
   * @returns {Object} Initial country state
   */
  _createInitialCountryState() {
    const countries = {};

    if (this.config.COUNTRIES) {
      this.config.COUNTRIES.forEach((country) => {
        countries[country] = {
          claims: 0,
          maxClaims: 3, // Default max claims
          flagPositions: this._getFlagPositionsForCountry(country), // Get flag positions
          flags: [] // Initialize the flags array

        };
      });
    }

    return countries;
  }

  _getFlagPositionsForCountry(country) {
    // Define flag positions for each country
    // These should be tuned for your map
    const positions = {
      canada: [
        { x: 650, y: 1100, scale: 0.7 }, // Western Canada
        { x: 950, y: 1300, scale: 0.7 }, // Central Canada
        { x: 1300, y: 1400, scale: 0.7 }, // Eastern Canada
      ],
      westCanada: [
        { x: 650, y: 1100, scale: 0.7 }, // Western Canada
        { x: 680, y: 1200, scale: 0.7 }, // Western Canada
        { x: 690, y: 1250, scale: 0.7 }, // Western Canada
      ],
      eastCanada: [
        { x: 1400, y: 1300, scale: 0.7 }, // Eastern Canada
        { x: 950, y: 1300, scale: 0.7 }, // Central Canada
        { x: 1300, y: 1400, scale: 0.7 }, // Eastern Canada
      ],
      mexico: [
        { x: 1350, y: 2670, scale: 0.7 },
        { x: 1110, y: 2590, scale: 0.7 },
        { x: 1400, y: 2650, scale: 0.7 },
      ],
      greenland: [
        { x: 2000, y: 400, scale: 0.7 },
        { x: 2200, y: 600, scale: 0.7 },
        { x: 2400, y: 800, scale: 0.7 },
      ],
    };

    return positions[country] || [];
  }
}

// window.GameState = GameState;

/**
 * UI Manager - Handles all DOM interactions and visual updates
 */
class UIManager {
  constructor() {
    this.elements = {
      screens: {},
      buttons: {},
      hud: {},
      game: {},
      countries: {},
      trump: null,
    };

    this.state = null;
    this.announcer = null;
  }

  /**
   * Initialize the UI manager
   * @param {Document} document - Document object
   */
  init(document) {
    // Get element references
    this._collectElementReferences(document);

    // Create screen reader announcer
    this._createScreenReaderAnnouncer(document);

    // Set up responsive handlers
    this._setupResponsiveHandlers();

    // Add accessibility attributes
    this._addAccessibilityAttributes();

    // Create the announcer for this instance
    this.announceForScreenReaders = this.announceForScreenReaders.bind(this);
  }

  /**
   * Connect to game state
   * @param {GameState} state - Game state reference
   */
  connectState(state) {
    this.state = state;
  }

  /**
   * Show the game screen
   */
  showGameScreen() {
    // Resume audio context for mobile compatibility
    if (this.audio) {
      this.audio.resumeAudioContext();
    } else if (window.audioManager) {
      window.audioManager.resumeAudioContext();
    }
    // Hide intro screen, show game screen
    this.elements.screens.intro.classList.add("hidden");
    this.elements.screens.game.classList.remove("hidden");

    // Create intro animations
    this._animateGameIntro();
  }

  _applyScreenShake(element, intensity = 5, duration = 5000) {
    if (!element) return;

    let startTime = null;
    const shake = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      if (elapsed < duration) {
        // Calculate decreasing intensity
        const currentIntensity = intensity * (1 - elapsed / duration);

        // Random offset
        const offsetX = (Math.random() - 0.5) * currentIntensity;
        const offsetY = (Math.random() - 0.5) * currentIntensity;

        // Apply transform
        element.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

        // Continue shaking
        requestAnimationFrame(shake);
      } else {
        // Reset transform when done
        element.style.transform = "";
      }
    };

    requestAnimationFrame(shake);
  }

  _addMapInteractionHandlers() {
    const mapBackground = this.elements.game.map;
    if (!mapBackground) return;

    mapBackground.addEventListener("click", () => {
      const gameContainer = this.elements.game.container;
      if (gameContainer) {
        gameContainer.classList.add("screen-shake");

        // Remove the shake class after animation completes
        setTimeout(() => {
          gameContainer.classList.remove("screen-shake");
        }, 700);
      }
    });
  }

  /**
   * Show a brief game over scene before the full screen
   * @param {boolean} playerWon - Whether player won
   * @param {Function} callback - Callback to show full game over screen
   * @param {number} duration - Duration to show brief scene
   */
  showBriefGameOverScene(playerWon, callback, duration = 1500) {
    // Create or get brief game over overlay
    let briefOverlay = document.getElementById("brief-game-over-overlay");
    if (!briefOverlay) {
      briefOverlay = document.createElement("div");
      briefOverlay.id = "brief-game-over-overlay";
      briefOverlay.className = "brief-game-over-overlay";
      briefOverlay.innerHTML = `
          <div class="brief-game-over-content">
              <h2>${playerWon ? "VICTORY DENIED!" : "COUNTRIES CLAIMED!"}</h2>
          </div>
      `;
      document.body.appendChild(briefOverlay);
    }

    // Show overlay
    briefOverlay.classList.add("active");

    // Hide game screen
    this.elements.screens.game.classList.add("hidden");

    // Schedule transition to full game over screen
    setTimeout(() => {
      // Remove brief overlay
      briefOverlay.classList.remove("active");
      if (briefOverlay.parentNode) {
        briefOverlay.parentNode.removeChild(briefOverlay);
      }

      // Call callback to show full game over screen
      callback();
    }, duration);
  }

  /**
   * Ensure audio is ready to play
   * @returns {Promise} Promise that resolves when audio is ready
   */
  ensureAudioReady() {
    // First try this.audio (from setupManagerAudio)
    if (this.audio && typeof this.audio.resumeAudioContext === "function") {
      return this.audio.resumeAudioContext();
    }
    // Then try global audio manager
    else if (window.audioManager && typeof window.audioManager.resumeAudioContext === "function") {
      return window.audioManager.resumeAudioContext();
    }
    // Fallback - return resolved promise
    return Promise.resolve();
  }

  /**
   * Show game over screen
   * @param {boolean} playerWon - Whether player won
   * @param {GameState} state - Current game state
   */
  showGameOverScreen(playerWon, state) {
    // Ensure audio is properly set up for game over screen
    if (this.audio) {
      this.audio
        .resumeAudioContext()
        .then(() => {
          try {
            // Play game over sound if available
            // this.audio.play("ui", "gameOver", 0.8);
          } catch (error) {
            console.warn("[UI] Error playing game over sound:", error);
            // Try direct play as fallback
            try {
              this.audio.playDirect("gameOver.mp3", 0.8);
            } catch (e) {
              // Silent fail on fallback
            }
          }
        })
        .catch((e) => {
          console.warn("[UI] Failed to resume audio context for game over:", e);
        });
    } else if (window.audioManager) {
      window.audioManager
        .resumeAudioContext()
        .then(() => {
          try {
            // window.audioManager.play("ui", "gameOver", 0.8);
          } catch (error) {
            console.warn("[UI] Error playing game over sound with global audio:", error);
          }
        })
        .catch((e) => {
          console.warn("[UI] Failed to resume global audio context for game over:", e);
        });
    }
    // Hide game screen, show game over screen
    this.elements.screens.game.classList.add("hidden");
    if (this.elements.screens.gameOver) {
      this.elements.screens.gameOver.classList.remove("hidden");
      this.elements.screens.gameOver.style.display = ""; // Clear inline display style
    }
    // Calculate time statistics
    const totalGameTime = state.config.GAME_DURATION;
    const timeSurvived = totalGameTime - state.timeRemaining;
    const timeDisplay = this._formatTimeSurvived(timeSurvived, totalGameTime);

    // Update game over animation
    this._updateGameOverAnimation(playerWon);

    // Update game over stats
    this._updateGameOverStats(timeDisplay, playerWon, state);

    // Announce result for screen readers
    const announcement = playerWon
      ? "Victory! You successfully defended the neighboring countries!"
      : "Game over. The neighboring countries have been claimed by Trump.";
    this.announceForScreenReaders(announcement);

    // Initialize share buttons if function exists
    if (typeof initializeShareButtonsOnGameOver === "function") {
      initializeShareButtonsOnGameOver();
    }

    // Set up restart button
    const restartButton = document.getElementById("restart-button");
    if (restartButton) {
      // Remove any existing listeners with cloning trick
      const newButton = restartButton.cloneNode(true);
      restartButton.parentNode.replaceChild(newButton, restartButton);

      // Add fresh click handler
      newButton.addEventListener("click", (e) => {
        e.preventDefault();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("record")) {
          // If we're in recording mode, just reload the main page
          window.location.href = window.location.pathname;
        }
        // console.log("Restart button clicked directly from game over screen");
        if (window.gameEngine) {
          window.gameEngine.restartGame();
        } else {
          this.restartGame();
        }
      });
    }
  }

  positionElements() {
    // Ensure map is loaded before positioning
    const mapElement = document.getElementById("map-background");
    if (!mapElement || !this.state) return;

    // Get fresh map dimensions
    const mapRect = mapElement.getBoundingClientRect();

    // Update state with map properties
    this.state.mapScale = mapRect.width / mapElement.naturalWidth;
    this.state.mapOffsetX = mapRect.left;
    this.state.mapOffsetY = mapRect.top;

    this.positionCountryFlags();

    // Set CSS custom properties on :root for consistent positioning
    document.documentElement.style.setProperty("--map-width", `${mapRect.width}px`);
    document.documentElement.style.setProperty("--map-height", `${mapRect.height}px`);
    document.documentElement.style.setProperty("--map-top", `${mapRect.top}px`);
    document.documentElement.style.setProperty("--map-left", `${mapRect.left}px`);

    // Position child elements using CSS variables instead of direct JS calculations
    this.positionCountryFlagOverlays();
    this.positionTrumpCharacter();
  }

  positionCountryFlags() {
    if (!this.state || !window.animationManager) return;

    // For each country, reposition its flags
    Object.keys(this.state.countries).forEach((countryId) => {
      const country = this.state.countries[countryId];

      if (country.flags && country.flags.length > 0) {
        const mapElement = document.getElementById("map-background");
        if (!mapElement) return;

        const mapScale = mapElement.clientWidth / mapElement.naturalWidth;
        const mapRect = mapElement.getBoundingClientRect();
        const gameContainer = document.getElementById("game-container");
        if (!gameContainer) return;

        const containerRect = gameContainer.getBoundingClientRect();

        // Update each flag position
        country.flags.forEach((flagInfo, index) => {
          if (flagInfo && flagInfo.element && country.flagPositions[index]) {
            const position = country.flagPositions[index];
            const scaledX = position.x * mapScale + (mapRect.left - containerRect.left);
            const scaledY = position.y * mapScale + (mapRect.top - containerRect.top);

            flagInfo.element.style.left = `${scaledX}px`;
            flagInfo.element.style.top = `${scaledY}px`;
            flagInfo.element.style.width = `${60 * position.scale * mapScale}px`;
            flagInfo.element.style.height = `${40 * position.scale * mapScale}px`;
          }
        });
      }
    });
  }

  showWorldShrinkAnimation(onCompleteCallback, duration = 3000) {
    const gameContainer = this.elements.game.container;
    if (!gameContainer) {
      if (onCompleteCallback) onCompleteCallback();
      return;
    }

    // Prepare game container for animation
    gameContainer.style.transformOrigin = "center center";
    gameContainer.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity ${duration}ms ease-out, rotate ${duration}ms linear`;

    // Start animation (short timeout ensures transition applies)
    setTimeout(() => {
      gameContainer.style.transform = "scale(0.1) rotate(360deg)"; // Two full rotations (360 * 2)
      gameContainer.style.opacity = "0";

      // Execute callback after animation
      setTimeout(() => {
        gameContainer.style.display = "none";
        if (onCompleteCallback) onCompleteCallback();
      }, duration);
    }, 50);
  }
  positionCountryFlagOverlays() {
    const countryFlags = Object.keys(this.elements.countries);

    countryFlags.forEach((country) => {
      const flagOverlay = this.elements.countries[country];
      if (!flagOverlay) return;

      // Add positioning class
      flagOverlay.classList.add("positioned-flag-overlay");

      // Add accessibility attributes
      flagOverlay.setAttribute("role", "img");
      flagOverlay.setAttribute("aria-label", `${country.charAt(0).toUpperCase() + country.slice(1)} flag overlay`);

      // Use CSS variables instead of direct positioning
      flagOverlay.style.position = "absolute";
      flagOverlay.style.top = "var(--map-top)";
      flagOverlay.style.left = "var(--map-left)";
      flagOverlay.style.width = "var(--map-width)";
      flagOverlay.style.height = "var(--map-height)";
    });
  }

  positionTrumpCharacter() {
    if (!this.elements.trump) return;

    const trumpContainer = this.elements.trump.container;
    const trumpSprite = this.elements.trump.sprite;

    if (!trumpContainer || !trumpSprite) return;

    // Use CSS variables for consistent positioning
    trumpContainer.style.position = "absolute";
    trumpContainer.style.top = "var(--map-top)";
    trumpContainer.style.left = "var(--map-left)";
    trumpContainer.style.width = "var(--map-width)";
    trumpContainer.style.height = "var(--map-height)";

    // Configure sprite appearance
    trumpSprite.style.width = "100%";
    trumpSprite.style.height = "100%";
    trumpSprite.style.backgroundSize = "auto 100%";
    trumpSprite.style.position = "absolute";
    trumpSprite.style.top = "0";
  }

  /**
   * Update the game HUD
   * @param {GameState} state - Game state
   */
  updateHUD(state) {
    if (this.elements.hud.score) {
      this.elements.hud.score.textContent = state.score;
    }
  }

  /**
   * Update the progress bar
   * @param {number} timeRemaining - Remaining time
   * @param {number} totalTime - Total game time
   */
  updateProgressBar(timeRemaining, totalTime) {
    const progressPercentage = ((totalTime - timeRemaining) / totalTime) * 100;

    const progressBar = document.getElementById("term-progress-bar");
    if (progressBar) {
      progressBar.style.width = `${progressPercentage}%`;

      // Update ARIA attributes for accessibility
      const progressContainer = document.getElementById("term-progress-container");
      if (progressContainer) {
        progressContainer.setAttribute("aria-valuenow", timeRemaining);
      }
    }

    // Update label text based on progress
    const progressLabel = document.getElementById("term-progress-label");
    if (progressLabel) {
      const yearsRemaining = Math.ceil((timeRemaining / totalTime) * 1461);
      progressLabel.textContent = `${yearsRemaining} ${yearsRemaining === 1 ? "YEAR" : "DAYS TO GO"}`;
    }
  }

  /**
   * Update pause button appearance and accessibility
   * @param {boolean} isPaused - Whether game is paused
   */
  updatePauseButton(isPaused) {
    const pauseButton = document.getElementById("pause-button");
    if (!pauseButton) return;

    pauseButton.setAttribute("aria-pressed", isPaused ? "true" : "false");
    pauseButton.setAttribute("aria-label", isPaused ? "Resume game" : "Pause game");

    const icon = pauseButton.querySelector(".icon");
    if (icon) {
      icon.textContent = isPaused ? "▶️" : "⏸️";
    }
  }

  createPauseOverlay() {
    const pauseOverlay = document.createElement("div");
    pauseOverlay.id = "pause-overlay";
    pauseOverlay.innerHTML = '<div class="pause-overlay-message">Game Paused</div>';
    const gameContainer = document.getElementById("game-container");
    if (gameContainer) {
      gameContainer.appendChild(pauseOverlay);
    }
  }

  /**
   * Remove pause overlay
   */
  removePauseOverlay() {
    const pauseOverlay = document.getElementById("pause-overlay");
    if (pauseOverlay) {
      pauseOverlay.remove();
    }
  }

  /**
   * Clean up grab visuals
   */
  cleanupGrabVisuals() {
    const visual = document.getElementById("trump-hand-visual");
    const hitbox = document.getElementById("trump-hand-hitbox");

    // Remove first-time help
    const helpText = document.getElementById("first-block-help-text");
    if (helpText) helpText.remove();

    const pulseStyle = document.getElementById("first-block-pulse");
    if (pulseStyle) pulseStyle.remove();

    // Clean up visual elements
    if (visual) {
      visual.classList.remove("hittable", "first-block-help");
      visual.style.display = "none";
      visual.style.opacity = "0";
    }

    if (hitbox) {
      hitbox.classList.remove("hittable", "first-block-help");
    }

    // Remove target highlights
    document.querySelectorAll(".target-area.highlighted").forEach((el) => {
      el.classList.remove("highlighted");
    });
  }

  applyBlockVisualEffects(targetCountry) {
    const visual = document.getElementById("trump-hand-visual");
    const hitbox = document.getElementById("trump-hand-hitbox");

    if (window.trumpHandEffects) {
    } else if (visual) {
    }
  }

  /**
   * Update a country's flag overlay based on claim count
   * @param {string} country - Country to update
   * @param {number} claimCount - Number of claims
   */
  updateFlagOverlay(country, claimCount) {
    const flagOverlay = document.getElementById(`${country}-flag-overlay`);
    if (!flagOverlay) return;

    // Remove previous opacity classes
    flagOverlay.classList.remove("opacity-33", "opacity-66", "opacity-100");

    // Add appropriate opacity class based on claim count
    if (claimCount === 1) {
      flagOverlay.classList.add("opacity-33");
    } else if (claimCount === 2) {
      flagOverlay.classList.add("opacity-66");
    } else if (claimCount === 3) {
      flagOverlay.classList.add("opacity-100");
    }
  }

  /**
   * Add cartoon hit effect when player successfully blocks
   */
  applyCartoonyHitEffect() {
    const visual = document.getElementById("trump-hand-visual");
    if (!visual) return;

    // Set position if needed
    const currentPosition = window.getComputedStyle(visual).position;
    if (currentPosition === "static") {
      visual.style.position = "absolute";
    }

    // Ensure full opacity for animation
    visual.style.opacity = "1";

    // Add screen shake
    const gameContainer = document.getElementById("game-container") || document.body;
    gameContainer.classList.add("screen-shake");

    // Force layout recalculation
    void visual.offsetWidth;

    // Remove shake class after animation
    setTimeout(() => {
      gameContainer.classList.remove("screen-shake");
    }, 700);
  }

  /**
   * Announce message for screen readers
   * @param {string} message - Message to announce
   */
  announceForScreenReaders(message) {
    const announcer = document.getElementById("game-announcements");
    if (announcer) {
      announcer.textContent = message;
    }
  }

  resetAllElements() {
    // Reset all country flag overlays
    Object.keys(this.elements.countries).forEach((country) => {
      const flag = this.elements.countries[country];
      if (flag) {
        flag.classList.remove("opacity-33", "opacity-66", "opacity-100", "resistance-possible", "targeting-pulse");
        flag.style.opacity = "";
        flag.style.transform = "";
        flag.style.transition = "";
      }
    });

    this._cleanupFlags();

    const existingIntroWrapper = document.querySelector(".world-intro-animation");
    if (existingIntroWrapper && existingIntroWrapper.parentNode) {
      existingIntroWrapper.parentNode.removeChild(existingIntroWrapper);
    }

    if (this.elements.game.map) {
      // Reset and make visible for restart
      this.elements.game.map.style.transition = "";
      this.elements.game.map.style.opacity = "1"; // Change from "0" to "1"
    }

    // Clear any residual visual effects
    document.querySelectorAll(".screen-shake, .grab-screen-shake").forEach((el) => {
      el.classList.remove("screen-shake", "grab-screen-shake");
    });

    // Clear the game announcer
    const announcer = document.getElementById("game-announcements");
    if (announcer) {
      announcer.textContent = "";
    }

    // Clean up any lingering notification elements
    document.querySelectorAll(".speed-notification, .freedom-flash, .freedom-text, .freedom-confetti, .freedom-firework").forEach((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });

    // Force update all element positions
    this.positionElements();
  }

  /**
   * Collect references to DOM elements
   * @private
   * @param {Document} document - Document object
   */
  _collectElementReferences(document) {
    // Screen elements
    this.elements.screens = {
      intro: document.getElementById("intro-screen"),
      game: document.getElementById("game-screen"),
      gameOver: document.getElementById("game-over-screen"),
    };

    // Button elements
    this.elements.buttons = {
      start: document.getElementById("start-button"),
      restart: document.getElementById("restart-button"),
    };

    // HUD elements
    this.elements.hud = {
      time: document.getElementById("time-value"),
      score: document.getElementById("score-value"),
      finalScore: document.getElementById("final-score"),
      result: document.getElementById("game-result"),
      message: document.getElementById("game-message"),
      stats: {
        blocks: document.getElementById("blocks-stat"),
        defended: document.getElementById("defended-stat"),
        time: document.getElementById("time-stat"),
      },
    };

    // Game container elements
    this.elements.game = {
      container: document.getElementById("game-container"),
      map: document.getElementById("map-background"),
    };

    // Country elements
    this.elements.countries = {
      usa: document.getElementById("usa-flag-overlay"),
      canada: document.getElementById("canada-flag-overlay"),
      mexico: document.getElementById("mexico-flag-overlay"),
      greenland: document.getElementById("greenland-flag-overlay"),
    };

    // Trump elements
    this.elements.trump = this._createTrumpReferences(document);
  }

  /**
   * Create references to Trump-related elements
   * @private
   * @param {Document} document - Document object
   * @returns {Object} Trump element references
   */
  _createTrumpReferences(document) {
    return {
      container: document.getElementById("trump-sprite-container"),
      sprite: document.getElementById("trump-sprite"),
      hand: document.getElementById("trump-hand-hitbox"),
    };
  }

  /**
   * Create screen reader announcer element
   * @private
   * @param {Document} document - Document object
   */
  _createScreenReaderAnnouncer(document) {
    if (!document.getElementById("game-announcements")) {
      const announcer = document.createElement("div");
      announcer.id = "game-announcements";
      announcer.className = "sr-only";
      announcer.setAttribute("aria-live", "assertive");
      announcer.setAttribute("role", "log");
      document.body.appendChild(announcer);
    }
  }

  _setupResponsiveHandlers() {
    // Window resize handler with debounce for performance
    let resizeTimeout;
    window.addEventListener("resize", () => {
      // Clear previous timeout to debounce the resize event
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      // Set a timeout to avoid excessive repositioning during resize
      resizeTimeout = setTimeout(() => {
        if (this.state && this.state.isPlaying) {
          // First update CSS variables with new map dimensions
          this._updateMapDimensions();

          // Then reposition all elements
          this.positionElements();
        }

        // Reposition flag overlays even if game isn't playing (e.g., on intro screen)
        this.positionCountryFlagOverlays();

        // Reposition protestor hitboxes if the manager exists
        if (window.protestorHitboxManager) {
          window.protestorHitboxManager.repositionAllHitboxes();
        }

        // // Reposition hand hitbox if the manager exists
        // if (window.handHitboxManager) {
        //   window.handHitboxManager.updateHitboxPosition();
        // }

        // Log resize for debugging
        console.log("Window resized, elements repositioned");
      }, 150); // 150ms debounce time
    });

    // Orientation change handler for mobile
    window.addEventListener("orientationchange", () => {
      // Orientation changes need a slightly longer delay
      setTimeout(() => {
        // Update CSS variables with new map dimensions
        this._updateMapDimensions();

        // Reposition all elements
        this.positionElements();

        // Reposition protestor hitboxes
        if (window.protestorHitboxManager) {
          window.protestorHitboxManager.repositionAllHitboxes();
        }

        // Log orientation change for debugging
        console.log("Orientation changed, elements repositioned");
      }, 300);
    });

    // Add visibility change handler for audio
    // document.addEventListener("visibilitychange", () => {
    //   if (document.hidden) {
    //     // Pause audio when page is hidden
    //     if (this.audio) {
    //       this.audio.pauseAll();
    //     } else if (window.audioManager) {
    //       window.audioManager.pauseAll();
    //     }
    //   } else {
    //     // Resume audio context when page becomes visible again
    //     if (this.audio) {
    //       // Resume audio context first to ensure mobile compatibility
    //       this.audio.resumeAudioContext().then(() => {
    //         // Only resume playback if game is playing and not paused
    //         if (this.state && this.state.isPlaying && !this.state.isPaused) {
    //           this.audio.resumeAll();
    //         }
    //       });
    //     } else if (window.audioManager) {
    //       window.audioManager.resumeAudioContext().then(() => {
    //         if (this.state && this.state.isPlaying && !this.state.isPaused) {
    //           window.audioManager.resumeAll();
    //         }
    //       });
    //     }
    //   }
    // });
  }

  // Add new helper method to update map dimensions CSS variables
  _updateMapDimensions() {
    const mapElement = document.getElementById("map-background");
    if (!mapElement) return;

    // Get fresh map dimensions
    const mapRect = mapElement.getBoundingClientRect();

    // Update state with map properties if state exists
    if (this.state) {
      this.state.mapScale = mapRect.width / mapElement.naturalWidth;
      this.state.mapOffsetX = mapRect.left;
      this.state.mapOffsetY = mapRect.top;
    }

    // Set CSS custom properties on :root for consistent positioning
    document.documentElement.style.setProperty("--map-width", `${mapRect.width}px`);
    document.documentElement.style.setProperty("--map-height", `${mapRect.height}px`);
    document.documentElement.style.setProperty("--map-top", `${mapRect.top}px`);
    document.documentElement.style.setProperty("--map-left", `${mapRect.left}px`);
  }

  /**
   * Add accessibility attributes to game elements
   * @private
   */
  _addAccessibilityAttributes() {
    // Add screen attributes
    if (this.elements.screens.intro) {
      this.elements.screens.intro.setAttribute("aria-label", "Game introduction screen");
    }

    if (this.elements.screens.game) {
      this.elements.screens.game.setAttribute("aria-label", "Game play area");
    }

    if (this.elements.screens.gameOver) {
      this.elements.screens.gameOver.setAttribute("aria-label", "Game over results");
    }

    // Add Trump-related attributes
    if (this.elements.trump.container) {
      this.elements.trump.container.setAttribute("role", "img");
      this.elements.trump.container.setAttribute("aria-label", "Trump character");
    }

    if (this.elements.trump.sprite) {
      this.elements.trump.sprite.setAttribute("aria-hidden", "true");
    }

    if (this.elements.trump.hand) {
      this.elements.trump.hand.setAttribute("role", "button");
      this.elements.trump.hand.setAttribute("aria-label", "Block Trump's grabbing hand");
    }
  }

  /**
   * Format the time survived for display
   * @private
   * @param {number} timeSurvived - Time survived in seconds
   * @param {number} totalGameTime - Total game time in seconds
   * @returns {string} Formatted time string
   */
  _formatTimeSurvived(timeSurvived, totalGameTime) {
    // Calculate years and months based on 4-year term
    const totalYears = 4;
    const yearsSurvived = Math.floor((timeSurvived / totalGameTime) * totalYears);
    const monthsSurvived = Math.floor(((timeSurvived / totalGameTime) * totalYears * 12) % 12);

    // Create grammatically correct time display
    let timeDisplay = "";

    if (yearsSurvived > 0) {
      timeDisplay += `${yearsSurvived} ${yearsSurvived === 1 ? "year" : "years"}`;

      if (monthsSurvived > 0) {
        timeDisplay += ` and ${monthsSurvived} ${monthsSurvived === 1 ? "month" : "months"}`;
      }
    } else {
      timeDisplay = `${monthsSurvived} ${monthsSurvived === 1 ? "month" : "months"}`;
    }

    return timeDisplay;
  }

  /**
   * Update game over animation
   * @private
   * @param {boolean} playerWon - Whether player won
   */
  _updateGameOverAnimation(playerWon) {
    const trumpAnimation = document.getElementById("trump-game-over-animation");
    if (!trumpAnimation) return;

    // Remove existing animation classes
    trumpAnimation.classList.remove("trump-victory-animation", "trump-slapped-animation");

    // Add appropriate animation class
    trumpAnimation.classList.add(playerWon ? "trump-slapped-animation" : "trump-victory-animation");
  }

  /**
   * Update game over stats display
   * @private
   * @param {string} timeDisplay - Formatted time survived
   * @param {boolean} playerWon - Whether player won
   * @param {GameState} state - Game state
   */
  _updateGameOverStats(timeDisplay, playerWon, state) {
    // Update score
    if (this.elements.hud.finalScore) {
      this.elements.hud.finalScore.textContent = state.score;
    }

    // Format blocks text
    const blocks = state.stats.successfulBlocks;
    const blocksText = `${blocks} ${blocks === 1 ? "attack" : "attacks"}`;

    // Update stats text
    if (this.elements.hud.stats.blocks) {
      const statsTextElement = document.querySelector(".stats-text.game-over-stat-value");
      if (statsTextElement) {
        statsTextElement.innerHTML = `YOU BLOCKED <span id="blocks-stat">${blocksText}</span> AND SURVIVED <span id="time-stat">${timeDisplay}</span>`;
      } else {
        // Fallback if element structure is different
        this.elements.hud.stats.blocks.textContent = blocksText;
        if (this.elements.hud.stats.time) {
          this.elements.hud.stats.time.textContent = timeDisplay;
        }
      }
    }

    // Update result and message
    if (this.elements.hud.result) {
      this.elements.hud.result.textContent = playerWon ? "Victory!" : "Game Over";
    }

    if (this.elements.hud.message) {
      this.elements.hud.message.innerHTML = playerWon
        ? "You successfully defended the neighboring countries from annexation! Together we will prevail."
        : "The neighboring countries have been claimed.<br><br>Alone we fail. Together we'd be unstoppable.";
    }
  }

  _animateGameIntro() {
    // Get Trump elements
    const trumpContainer = document.getElementById("trump-sprite-container");

    // Hide Trump elements initially
    if (trumpContainer) {
      trumpContainer.style.visibility = "hidden";
    }

    // Create animation styles if not present
    if (!document.getElementById("game-intro-animations")) {
      const style = document.createElement("style");
      style.id = "game-intro-animations";
      style.textContent = `
        @keyframes world-grow {
          0% { transform: scale(0.2); opacity: 0.2; }
          40% { transform: scale(0.9); opacity: 0.5; }
          80% { transform: scale(1.02); opacity: 0.9; }
          100% { transform: scale(1); opacity: 1; }
        }
        .world-intro-animation {
          animation: world-grow 3s ease-out forwards;  /* Reduced from 4s to 3s */
          transform-origin: center center;
          position: relative;
        }
        
        @keyframes trump-entrance {
          0% { transform: translateY(100%) scale(0.5); opacity: 0; }
          40% { transform: translateY(10%) scale(0.9); opacity: 0.8; }
          70% { transform: translateY(0) scale(1.05); opacity: 1; }
          85% { transform: translateY(0) scale(0.95); opacity: 1; }
          100% { transform: translateY(0) scale(1.0); opacity: 1; }
        }
        .trump-entrance-animation {
          animation: trump-entrance 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) forwards;  /* Reduced from 2.5s to 1.5s */
          transform-origin: center bottom;
        }
      `;
      document.head.appendChild(style);
    }

    // Create globe animation wrapper
    const wrapper = document.createElement("div");
    wrapper.style.position = "absolute";
    wrapper.style.top = "0";
    wrapper.style.left = "0";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "center";
    wrapper.style.alignItems = "center";
    wrapper.style.pointerEvents = "none";
    wrapper.classList.add("world-intro-animation");

    // Create animated map
    const animatedMap = document.createElement("div");
    animatedMap.style.width = "100%";
    animatedMap.style.height = "100%";

    if (this.elements.game.map) {
      animatedMap.style.backgroundImage = `url(${this.elements.game.map.src})`;
    }

    animatedMap.style.backgroundSize = "contain";
    animatedMap.style.backgroundPosition = "center";
    animatedMap.style.backgroundRepeat = "no-repeat";

    wrapper.appendChild(animatedMap);
    this.elements.screens.game.appendChild(wrapper);

    // Hide the actual map during animation
    if (this.elements.game.map) {
      this.elements.game.map.style.opacity = "0";
    }

    // Schedule animation steps with overlap for smoother transition
    setTimeout(() => {
      // Ensure audio is ready for potential sounds during animation
      this.ensureAudioReady().then(() => {
        // Show Trump container but keep opacity at 0
        if (trumpContainer) {
          trumpContainer.style.visibility = "visible";
          trumpContainer.classList.add("trump-entrance-animation");
        }
      });

      // Start fading out the globe with a delay
      setTimeout(() => {
        // Fade out globe animation gradually
        if (wrapper) {
          wrapper.style.transition = "opacity 0.8s ease-out";
          wrapper.style.opacity = "0";

          // Remove only after transition completes
          setTimeout(() => {
            if (wrapper && wrapper.parentNode) {
              wrapper.parentNode.removeChild(wrapper);
            }
          }, 800);
        }

        // Show map gradually
        if (this.elements.game.map) {
          this.elements.game.map.style.transition = "opacity 0.8s ease-in";
          this.elements.game.map.style.opacity = "1";
        }
      }, 700); // Reduced from 1000 to 800
    }, 800); // Reduced from 3000 to 2000

    // Complete Trump entrance
    setTimeout(() => {
      if (trumpContainer) {
        trumpContainer.classList.remove("trump-entrance-animation");
      }

      // Show all Trump elements
      this._setTrumpVisibility(true);

      // Set idle animation
      if (window.animationManager) {
        window.animationManager.changeState("idle");
      }
    }, 3400); // Reduced from 5500 to 3500
  }

  /**
   * Set Trump elements visibility
   * @private
   * @param {boolean} isVisible - Whether elements should be visible
   */
  _setTrumpVisibility(isVisible) {
    const trumpContainer = document.getElementById("trump-sprite-container");
    const trumpHandVisual = document.getElementById("trump-hand-visual");
    const trumpHandHitbox = document.getElementById("trump-hand-hitbox");

    const visibility = isVisible ? "visible" : "hidden";
    const pointerEvents = isVisible ? "auto" : "none";

    if (trumpContainer) trumpContainer.style.visibility = visibility;
    if (trumpHandVisual) trumpHandVisual.style.visibility = visibility;
    if (trumpHandHitbox) {
      trumpHandHitbox.style.visibility = visibility;
      trumpHandHitbox.style.pointerEvents = pointerEvents;
    }
  }

  _cleanupFlags() {
    // Remove flag elements from DOM
    document.querySelectorAll(".trump-flag-animation").forEach((flag) => {
      if (flag.parentNode) {
        flag.parentNode.removeChild(flag);
      }
    });

    // Clear flag references in state
    if (this.state && this.state.countries) {
      Object.keys(this.state.countries).forEach((countryId) => {
        if (this.state.countries[countryId]) {
          this.state.countries[countryId].flags = [];
        }
      });
    }

    // Call animator's cleanup if it exists
    if (window.animationManager && typeof window.animationManager.removeAllFlags === "function") {
      window.animationManager.removeAllFlags();
    }
  }
}

window.UIManager = UIManager;

/**
 * Input Manager - Handles all user input
 */
class InputManager {
  constructor() {
    this.handlers = {
      onSpaceKey: null,
      onPauseKey: null,
      onStartKey: null,
    };

    this.ui = null;
    this.document = null;
  }

  /**
   * Initialize input manager
   * @param {Document} document - Document object
   * @param {Object} handlers - Event handlers
   */
  init(document, handlers) {
    this.document = document;
    this.handlers = handlers;

    this._setupKeyboardHandlers();
    this._setupButtonHandlers();
    this._setupHitboxHandlers();
  }

  /**
   * Add additional handlers after initial setup
   * @param {Object} handlers - Event handlers to add
   */
  addHandlers(handlers) {
    // Add these handlers to existing ones
    this.handlers = { ...this.handlers, ...handlers };

    // Re-setup keyboard handlers
    this._setupKeyboardHandlers();

    // Re-setup hitbox handlers
    this._setupHitboxHandlers();
  }

  /**
   * Connect to UI manager
   * @param {UIManager} ui - UI manager reference
   */
  connectUI(ui) {
    this.ui = ui;
  }

  // PRIVATE METHODS

  /**
   * Set up keyboard handlers
   * @private
   */
  _setupKeyboardHandlers() {
    // Remove any existing keyboard listeners first
    if (this._keyboardHandler) {
      this.document.removeEventListener("keydown", this._keyboardHandler);
    }

    // Create a new handler function that we can reference later for removal
    this._keyboardHandler = (e) => {
      // Start game with Space or Enter from intro screen
      if (
        (e.key === " " || e.key === "Enter") &&
        this.handlers.onStartKey &&
        document.getElementById("intro-screen") &&
        !document.getElementById("intro-screen").classList.contains("hidden")
      ) {
        e.preventDefault();
        this.handlers.onStartKey();
      }

      // Toggle pause with P key during gameplay
      if (e.key === "p" && this.handlers.onPauseKey) {
        e.preventDefault();
        this.handlers.onPauseKey();
      }

      // Block hand with Space during gameplay
      if (e.key === " " && this.handlers.onSpaceKey) {
        e.preventDefault();
        this.handlers.onSpaceKey();
      }
    };

    // Add the new handler
    this.document.addEventListener("keydown", this._keyboardHandler);
  }

  _setupButtonHandlers() {
    const startButton = document.getElementById("start-button");
    if (startButton && this.handlers.onStartKey) {
      startButton.addEventListener("click", (e) => {
        e.preventDefault();

        if (window.audioManager) {
          window.audioManager
            .resumeAudioContext()
            .then(() => {
              // Initialize audio system
              if (typeof window.audioManager.init === "function") {
                window.audioManager.init();
                window.audioManager.startDiagnosticAuditing();
              }

              // Check pool health - only call primeAudioPool once
              try {
                window.audioManager.primeAudioPool({ skipClickSound: true });
              } catch (e) {
                console.warn("[Input] Error priming audio pool:", e);
              }

              // Play click sound
              window.audioManager.play("ui", "click", 0.5).catch((error) => {
                console.warn("[Input] Click sound play error:", error);
                window.audioManager.playDirect("click.mp3", 0.5);
              });
            })
            .catch((e) => {
              console.warn("[Input] Failed to resume audio context:", e);
              // Try to play click sound anyway as last resort
              try {
                window.audioManager.playDirect("click.mp3", 0.5);
              } catch (err) {
                // Silent fail
              }
            });
        }

        // Start game after a short delay
        setTimeout(() => {
          this.handlers.onStartKey();
        }, 200);
      });
    }
  }

  /**
   * Set up Trump hand hitbox handlers
   * @private
   */
  _setupHitboxHandlers() {
    // Get the hitbox element
    const trumpHandHitBox = document.getElementById("trump-hand-hitbox");
    if (!trumpHandHitBox || !this.handlers.onSpaceKey) return;

    // Use a more reliable way to track and remove event listeners
    if (!trumpHandHitBox) return;

    // Store reference to the element we're working with
    this._hitboxElement = trumpHandHitBox;

    // Create unified handler for all hitbox events
    const handleHitboxEvent = (event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();

      // Check audio initialization
      if (this.audio && !this.audio.initialized && typeof this.audio.init === "function") {
        this.audio.init();
      }

      if (this.handlers.onSpaceKey) {
        this.handlers.onSpaceKey(event);
      }
    };

    // Remove old listeners if element is the same as before
    if (this._hitboxHandlers && this._hitboxElement === trumpHandHitBox) {
      Object.entries(this._hitboxHandlers).forEach(([event, handler]) => {
        trumpHandHitBox.removeEventListener(event, handler);
      });
    }

    // Store new handlers
    this._hitboxHandlers = {
      click: handleHitboxEvent,
      touchstart: handleHitboxEvent,
      mousedown: handleHitboxEvent,
    };

    // Add new event listeners
    Object.entries(this._hitboxHandlers).forEach(([event, handler]) => {
      trumpHandHitBox.addEventListener(event, handler, { passive: false });
    });
    // Special handler for touchend to prevent ghost clicks
    trumpHandHitBox.addEventListener("touchend", (e) => e.preventDefault(), { passive: false });

    // Update reference in hitbox manager
    if (window.handHitboxManager) {
      window.handHitboxManager.trumpHandHitBox = trumpHandHitBox;
    }
  }
}

// Initialize the game when document is ready
document.addEventListener("DOMContentLoaded", function () {
  // console.log("Initializing game...");

  // Create and initialize game engine
  const engine = new GameEngine({
    debug: true,
  });

  engine.init();

  // Global access for debugging
  window.gameEngine = engine;
});

/**
 * GameSpeedManager handles game speed progression and tutorial instructions
 */
class GameSpeedManager {
  /**
   * Create a new GameSpeedManager
   * @param {Object} gameState - The game state object
   * @param {Object} animationManager - The animation manager
   * @param {Object} audioManager - The audio manager
   */
  constructor(gameState, animationManager, audioManager) {
    // System references
    this.gameState = gameState;
    this.animationManager = animationManager;
    this.audioManager = audioManager;

    // Configuration
    this.config = {
      NOTIFICATION_DURATION: 5100,
      INITIAL_INSTRUCTION_DELAY: 6000,
      INSTRUCTION_INTERVAL: 8100,
      TUTORIAL_TIMEOUT: 45000,
      DEFAULT_SPEED_INTERVAL: 16000,
    };

    // Speed levels configuration
    this.baseSpeedLevels = [
      { multiplier: 1.2, name: "Tutorial", sound: "tutorial" },
      { multiplier: 2.5, name: "Faster?", sound: "faster" },
      { multiplier: 3.3, name: "oopsie trade war", sound: "oopsieTradeWar" },
      { multiplier: 4.3, name: "Faster", sound: "faster" },
      { multiplier: 4.9, name: "no one is coming", sound: "noOneIsComingToSaveUs" }, // Reduced from 3.5
      { multiplier: 5.5, name: "get up and fight", sound: "getUpAndFight" },
    ];
    
    this.isMobile = window.DeviceUtils ? window.DeviceUtils.isMobile() : false;


    // Mobile speed levels (keep original as mobile is already easier)
    this.mobileSpeedLevels = this.baseSpeedLevels;
    
    // Desktop speed levels (slower for trackpad users)
    this.desktopSpeedLevels = this.baseSpeedLevels.map(level => ({
      ...level,
      multiplier: Math.max(level.multiplier * 0.7, 0.7) // 30% slower for desktop/trackpad
    }));
    
    // Choose appropriate speed levels based on device
    this.speedLevels = this.isMobile ? this.mobileSpeedLevels : this.desktopSpeedLevels;


    // Tutorial instruction messages
    this.instructionMessages = [
      { text: "STOP HIM!", audio: "stopHim" },
      { text: "SMACK THAT HAND!", audio: "smackThatHand" },
      { text: "CLICK ON TRUMPS HAND AS HE GRABS A COUNTRY!", audio: "instruction" },
      { text: "HANDS OFF!", audio: "stopHim" },
    ];

    // State variables
    this.state = {
      currentSpeedIndex: 0,
      initialInstructionsShown: false,
      currentInstructionIndex: 0,
      tutorialCompleted: false,
      initialBlockCount: 0,
    };

    // Timers
    this.timers = {
      speedIncreaseInterval: null,
      instructionTimeout: null,
      tutorialFailsafeTimeout: null,
    };
  }

  /**
   * Initialize the manager
   */
  init() {
    // Nothing needed here for initialization
  }

  showNotification(message) {
    // Create notification element
    const notification = this._createNotificationElement(message);

    // Add to game screen
    const gameScreen = document.getElementById("game-screen");
    if (gameScreen) {
      gameScreen.appendChild(notification);

      // Remove after animation completes
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, this.config.NOTIFICATION_DURATION);
    }
  }

  _createNotificationElement(message) {
    const notification = document.createElement("div");
    notification.className = "speed-notification";
    notification.textContent = message;

    // Add accessibility attributes
    notification.setAttribute("role", "alert");
    notification.setAttribute("aria-live", "assertive");

    return notification;
  }

  /**
   * Start the speed progression system
   * @param {number} intervalMs - Milliseconds between speed increases
   */
  startSpeedProgression(intervalMs = this.config.DEFAULT_SPEED_INTERVAL) {
    // Clear any existing timers
    this.stopSpeedProgression();

    // Initialize tutorial state
    this._initializeTutorial();

    // Schedule initial instructions if not shown yet
    if (!this.state.initialInstructionsShown) {
      this.showInitialInstructions();
    }
  }

  _initializeTutorial() {
    // Capture initial block count to detect when player has blocked
    this.state.initialBlockCount = this.gameState.stats.successfulBlocks;
    this.state.tutorialCompleted = false;

    // Reset to initial tutorial speed
    this.state.currentSpeedIndex = 0;
    this.setSpeed(this.speedLevels[0].multiplier);
  }

  checkTutorialCompletion() {
    // Tutorial is complete if player has made a successful block
    if (this.gameState.stats.successfulBlocks > this.state.initialBlockCount) {
      if (!this.state.tutorialCompleted) {
        // console.log("Tutorial completed! Player has successfully blocked.");
        this.state.tutorialCompleted = true;

        // Clean up tutorial timers
        this._cleanupTutorialTimers();

        // Start the speed progression now that tutorial is complete
        this._startRegularSpeedProgression();
      }
      return true;
    }
    return false;
  }

  _cleanupTutorialTimers() {
    // Clear instruction timeout
    if (this.timers.instructionTimeout) {
      clearTimeout(this.timers.instructionTimeout);
      this.timers.instructionTimeout = null;
    }

    // Clear existing speed interval
    if (this.timers.speedIncreaseInterval) {
      clearInterval(this.timers.speedIncreaseInterval);
      this.timers.speedIncreaseInterval = null;
    }
  }

  _startRegularSpeedProgression() {
    let currentInterval = this.config.DEFAULT_SPEED_INTERVAL;

    this.timers.speedIncreaseInterval = setInterval(() => {
      // Add check for gameEnding state
      if (!this.gameState.isPlaying || this.gameState.isPaused || this.gameState.gameEnding) return;
      if (this.state.currentSpeedIndex < this.speedLevels.length - 1) {
        this.increaseSpeed();

        // More aggressive interval reduction in later stages
        const reductionFactor = this.state.currentSpeedIndex >= 3 ? 0.7 : 0.9;
        currentInterval = Math.max(currentInterval * reductionFactor, 8000);

        // Reset the interval with new timing
        clearInterval(this.timers.speedIncreaseInterval);
        this._startRegularSpeedProgression();
      }
    }, currentInterval);

    // Store reference in game state for cleanup
    this.gameState.speedIncreaseInterval = this.timers.speedIncreaseInterval;
  }

  /**
   * Show initial tutorial instructions
   */
  showInitialInstructions() {
    this.state.initialInstructionsShown = true;
    this.state.currentInstructionIndex = 0;

    // Clear any existing timeout
    if (this.timers.instructionTimeout) {
      clearTimeout(this.timers.instructionTimeout);
    }

    // Show the first instruction after a delay
    this.timers.instructionTimeout = setTimeout(() => {
      this.showNextInstruction();
    }, this.config.INITIAL_INSTRUCTION_DELAY);

    // Set up failsafe to exit tutorial after timeout
    this._setupTutorialFailsafe();
  }

  /**
   * Set up failsafe timer to exit tutorial mode if player doesn't block
   * @private
   */
  _setupTutorialFailsafe() {
    this.timers.tutorialFailsafeTimeout = setTimeout(() => {
      if (!this.state.tutorialCompleted) {
        // console.log("Tutorial timeout reached. Auto-completing tutorial.");
        this.state.tutorialCompleted = true;

        // Clean up timers
        this._cleanupTutorialTimers();

        // Start regular speed progression
        this._startRegularSpeedProgression();
      }
    }, this.config.TUTORIAL_TIMEOUT);
  }

  /**
   * Show the next instruction in the tutorial sequence
   */
  showNextInstruction() {
    if (this.gameState.isPaused) return;
    if (this.gameState.gameEnding) return;

    // Skip if tutorial is already completed
    if (this.checkTutorialCompletion()) {
      return;
    }

    // Reset to beginning if we've shown all instructions
    if (this.state.currentInstructionIndex >= this.instructionMessages.length) {
      this.state.currentInstructionIndex = 0;
    }

    // Show current instruction
    this._displayCurrentInstruction();

    // Schedule next instruction if tutorial not completed
    this._scheduleNextInstruction();
  }

  _displayCurrentInstruction() {
    const instruction = this.instructionMessages[this.state.currentInstructionIndex];

    // Show notification
    if (instruction.text) {
      this.showNotification(instruction.text);
    }

    if (this.audioManager && instruction.audio) {
      // this.audioManager.play("ui", instruction.audio, 0.6);
      this.audioManager.playIfContextReady("ui", instruction.audio, 0.8);
    }

    // Move to next instruction for next time
    this.state.currentInstructionIndex++;
  }

  /**
   * Schedule the next instruction
   * @private
   */
  _scheduleNextInstruction() {
    this.timers.instructionTimeout = setTimeout(() => {
      // Check again if tutorial is completed or game is paused before showing next instruction
      if (!this.state.tutorialCompleted && !this.gameState.isPaused) {
        this.showNextInstruction();
      }
    }, this.config.INSTRUCTION_INTERVAL);
  }

  stopSpeedProgression() {
    // Clear speed increase interval
    if (this.timers.speedIncreaseInterval) {
      clearInterval(this.timers.speedIncreaseInterval);
      this.timers.speedIncreaseInterval = null;
    }

    // Clear instruction timeout
    if (this.timers.instructionTimeout) {
      clearTimeout(this.timers.instructionTimeout);
      this.timers.instructionTimeout = null;
    }

    // Clear tutorial failsafe timeout
    if (this.timers.tutorialFailsafeTimeout) {
      clearTimeout(this.timers.tutorialFailsafeTimeout);
      this.timers.tutorialFailsafeTimeout = null;
    }

    // Remove all notifications
    this._removeAllNotifications();

    // Additional safety: unlink from gameState's interval reference if it exists
    if (this.gameState && this.gameState.speedIncreaseInterval) {
      clearInterval(this.gameState.speedIncreaseInterval);
      this.gameState.speedIncreaseInterval = null;
    }
  }

  _clearAllTimers() {
    if (this.timers.speedIncreaseInterval !== null) {
      clearInterval(this.timers.speedIncreaseInterval);
      this.timers.speedIncreaseInterval = null;
    }

    if (this.timers.instructionTimeout !== null) {
      clearTimeout(this.timers.instructionTimeout);
      this.timers.instructionTimeout = null;
    }

    if (this.timers.tutorialFailsafeTimeout !== null) {
      clearTimeout(this.timers.tutorialFailsafeTimeout);
      this.timers.tutorialFailsafeTimeout = null;
    }
  }

  /**
   * Remove all notification elements
   * @private
   */
  _removeAllNotifications() {
    const gameScreen = document.getElementById("game-screen");
    if (gameScreen) {
      const notifications = gameScreen.querySelectorAll(".speed-notification");
      notifications.forEach((notification) => {
        notification.remove();
      });
    }
  }

  /**
   * Increase the game speed to the next level
   * @returns {boolean} True if speed was increased
   */
  increaseSpeed() {
    // Only increase speed if tutorial is completed
    if (!this.state.tutorialCompleted) {
      return false;
    }

    // Check if we can increase to next level
    if (this.state.currentSpeedIndex < this.speedLevels.length - 1) {
      // Move to next speed level
      this.state.currentSpeedIndex++;
      const newSpeed = this.speedLevels[this.state.currentSpeedIndex];

      // Apply the new speed
      this.setSpeed(newSpeed.multiplier);

      // Show notification
      this.showNotification(newSpeed.name.toUpperCase() + "!");

      // Play appropriate sound
      this._playSpeedChangeSound(newSpeed);

      // console.log(`Game speed increased to ${newSpeed.multiplier.toFixed(2)}x (${newSpeed.name})`);

      return true;
    }
    return false;
  }

  _playSpeedChangeSound(speedLevel) {
    if (!this.audioManager) return;

    if (speedLevel.sound) {
      try {
        // Make sure audioContext is resumed first
        if (typeof this.audioManager.resumeAudioContext === "function") {
          // this.audioManager.resumeAudioContext().then(() => {
          this.audioManager.playIfContextReady("ui", speedLevel.sound, 0.6);
          // });
        } else {
          // Direct play as fallback
          this.audioManager.play("ui", speedLevel.sound, 0.6);
        }
      } catch (error) {
        // console.log(`Couldn't play speed sound ${speedLevel.sound}, falling back to generic`);
        this.audioManager.play("ui", "speedup", 0.6);
      }
    } else {
      // Use generic speedup sound if no specific one is defined
      this.audioManager.play("ui", "speedup", 0.6);
    }
  }

  /**
   * Set the game speed to a specific multiplier
   * @param {number} multiplier - Speed multiplier value
   */
  setSpeed(multiplier) {
    this.gameState.gameSpeedMultiplier = multiplier;

    // Update both animation and audio systems
    if (this.animationManager && typeof this.animationManager.setGameSpeed === "function") {
      this.animationManager.setGameSpeed(multiplier);
    }

    if (this.audioManager && typeof this.audioManager.setGameSpeed === "function") {
      this.audioManager.setGameSpeed(multiplier);
    }
  }

  getGameSpeed() {
    return this.gameState.gameSpeedMultiplier;
  }

  /**
   * Get the current speed information
   * @returns {Object} Current speed info with multiplier and name
   */
  getCurrentSpeed() {
    return {
      multiplier: this.gameState.gameSpeedMultiplier,
      name: this.speedLevels[this.state.currentSpeedIndex].name,
    };
  }

  /**
   * Reset the speed manager to initial state
   */
  reset() {
    // Stop all timers
    this.stopSpeedProgression();

    this.state.currentSpeedIndex = 0;
    this.state.initialInstructionsShown = false;
    this.state.currentInstructionIndex = 0;
    this.state.tutorialCompleted = false;
    this.state.initialBlockCount = 0;

    // Reset speed and ensure both systems are updated
    this.setSpeed(this.speedLevels[0].multiplier);
    this._removeAllNotifications();
  }

  /**
   * Clean up resources used by the manager
   */
  destroy() {
    // Reset state and clean up
    this.reset();

    // Remove any lingering UI elements
    this._removeAllNotifications();
  }
}
// window.GameSpeedManager = GameSpeedManager;

class GlowOutline {
  constructor() {
    this.initializeGlobalStyles();
  }

  initializeGlobalStyles() {
    if (!document.getElementById("glow-outline-style")) {
      const styleElement = document.createElement("style");
      styleElement.id = "glow-outline-style";
      styleElement.textContent = `
              @keyframes outlinePulse {
                  0% { transform: scale(1.0); }
                  50% { transform: scale(1.1); }
                  100% { transform: scale(1.0); }
              }
              
              @keyframes cartoonGlowPulse {
                  0% { 
                      box-shadow: 
                          0 0 0 4px var(--glow-color, rgba(0, 255, 13, 1)),
                          0 0 0 8px var(--glow-color, rgba(0, 255, 34, 0.4));
                  }
                  50% { 
                      box-shadow: 
                          0 0 0 6px var(--glow-color, rgba(0, 255, 26, 1)),
                          0 0 0 12px var(--glow-color, rgba(0, 255, 51, 0.4));
                  }
                  100% { 
                      box-shadow: 
                          0 0 0 4px var(--glow-color, rgba(17, 255, 0, 1)),
                          0 0 0 8px var(--glow-color, rgba(56, 133, 57, 0.4));
                  }
              }

              .record-button-glow {
                  position: relative;
                  z-index: 1;
              }

              .record-button-glow::before {
                  content: '';
                  position: absolute;
                  top: -8px;
                  left: -8px;
                  right: -8px;
                  bottom: -8px;
                  border-radius: 50%;
                  background: transparent;
                  z-index: -1;
                  animation: cartoonGlowPulse 2s infinite ease-in-out;
                  pointer-events: none;
              }

              .record-button-glow.recording::before {
                  --glow-color: rgba(231, 76, 60, .9);
              }

              .record-button-glow.waiting::before {
                  --glow-color: rgba(243, 156, 18, .9);
              }
          `;
      document.head.appendChild(styleElement);
    }
  }

  create({
    parentId,
    position = { left: 0, top: 0 },
    size = { width: 100, height: 100 },
    color = "#FFD700",
    borderWidth = 4,
    zIndex = "10210",
    borderRadius = "50%",
  }) {
    const wrapper = document.createElement("div");
    wrapper.id = `${parentId}-protestors-wrapper`;
    Object.assign(wrapper.style, {
      position: "absolute",
      left: `${position.left}px`,
      top: `${position.top}px`,
      width: `${size.width}px`,
      height: `${size.height}px`,
      pointerEvents: "none", // Keep this as none
      cursor: "pointer",
      zIndex: zIndex.toString(),
      transformOrigin: "bottom center",
    });

    const outlineContainer = document.createElement("div");
    outlineContainer.id = `${parentId}-protestors-outline`;
    Object.assign(outlineContainer.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      borderRadius: borderRadius,
      border: `${borderWidth}px solid ${color}`,
      boxShadow: `0 0 15px 5px ${this.getRGBAFromColor(color, 0.7)}`,
      opacity: "0",
      animation: "outlinePulse 1.5s infinite ease-in-out",
      pointerEvents: "none",
      zIndex: "1",
      transition: "opacity 0.3s ease-out, box-shadow 0.2s ease",
    });

    // Store references to event listeners for later removal
    const onMouseMove = (e) => {
      const rect = wrapper.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        outlineContainer.style.boxShadow = `0 0 20px 10px #ff8800`;
      }
    };

    const onMouseOut = () => {
      outlineContainer.style.boxShadow = `0 0 15px 5px ${this.getRGBAFromColor(color, 0.7)}`;
    };

    // Attach the listeners to the wrapper instead of document
    wrapper.addEventListener("mousemove", onMouseMove);
    wrapper.addEventListener("mouseleave", onMouseOut);

    // Store the listener references for cleanup
    wrapper._glowListeners = {
      mousemove: onMouseMove,
      mouseleave: onMouseOut,
    };

    wrapper.appendChild(outlineContainer);
    return wrapper;
  }

  // New method specifically for adding glow to record button
  addToRecordButton(buttonElement) {
    // Add a class to the record button for the glow effect
    buttonElement.classList.add("record-button-glow");

    // Return the button element for chaining
    return buttonElement;
  }

  // New method to update the glow color based on button state
  updateGlowColor(buttonElement, color) {
    if (buttonElement && buttonElement.style) {
      // Extract RGB values from color
      let rgba = color;
      if (color.startsWith("#")) {
        rgba = this.getRGBAFromColor(color, 0.5);
      }

      // Set the custom property for the glow color
      buttonElement.style.setProperty("--glow-color", rgba);
    }
  }

  getRGBAFromColor(color, alpha) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

class TrumpHandEffectsController {
  /**
   * Create a new TrumpHandEffectsController
   * @param {Object} gameState - The game state reference
   * @param {Object} audioManager - The audio manager reference
   */
  constructor(gameState, audioManager) {
    this.audioManager = audioManager;

    this.elements = {
      visual: document.getElementById("trump-hand-visual"),
      hitbox: document.getElementById("trump-hand-hitbox"),
      gameContainer: document.getElementById("game-container") || document.body,
    };

    this.gameState = gameState;
    this.promptShownTime = 0;

    // Use the global DeviceUtils for mobile detection
    this.isMobile = window.DeviceUtils ? window.DeviceUtils.isMobile() : false;

    // Constant state definitions
    this.STATES = {
      IDLE: "idle",
      HITTABLE: "hittable",
      HIT: "hit",
      GRAB_SUCCESS: "grab-success",
    };

    this._styleUpdatePending = false;

    // Current state tracking
    this.state = {
      current: this.STATES.IDLE,
      isAnimating: false,
      isHovering: false,
      isGrabbing: false,
      targetCountry: null,
    };

    // Configuration
    this.config = this._createConfiguration();

    // Store original z-index values for restoration
    this.originalZIndices = {
      visual: this.elements.visual ? window.getComputedStyle(this.elements.visual).zIndex : null,
      hitbox: this.elements.hitbox ? window.getComputedStyle(this.elements.hitbox).zIndex : null,
    };

    // Ensure the visual element has the proper initial styles
    if (this.elements.visual) {
      // Make sure the visual element isn't inheriting unwanted visibility
      this.elements.visual.style.visibility = "visible";
      // Set initial styles, including z-index 0
      this.elements.visual.style.zIndex = "2";
      this.resetVisual();
    }

    this.clickPromptElement = null;
  }

  _createConfiguration() {
    return {
      animationDuration: 650,
      promptDelay: 1500, // Delay before showing the prompt
      // CSS class names for state management
      defaultStateClass: "state-idle",
      hitStateClass: "hit", // Match existing CSS class
      hittableStateClass: "hittable", // Match existing CSS class
      grabSuccessStateClass: "grab-success", // Match existing CSS class
      firstBlockModifier: "first-block",
      grabbingModifier: "grabbing",
      hoverModifier: "hover-active",
      animationCompletedModifier: "animation-completed",
    };
  }

  _addFlagToCountry(country) {
    console.log("yyy in add flagAdding flag");

    // For Canada, handle east/west special case
    const targetCountry = country === "eastCanada" || country === "westCanada" ? "canada" : country;

    // Get current claim count to determine which flag position to use
    const countryState = this.gameState.countries[targetCountry];
    const claimIndex = Math.min(countryState.claims, countryState.maxClaims);
    if (claimIndex >= 0) {
    }

    if (countryState.flagPositions.length) {
      console.log("countryState.flagPositions.length");
    }
    // Only proceed if there's a valid position and we haven't exceeded max claims
    if (claimIndex >= 0 && claimIndex < countryState.flagPositions.length) {
      const position = countryState.flagPositions[claimIndex];

      // Scale position based on current map scale
      const mapElement = document.getElementById("map-background");
      if (mapElement) {
        const mapScale = mapElement.clientWidth / mapElement.naturalWidth;
        const scaledPosition = {
          x: position.x * mapScale,
          y: position.y * mapScale,
          scale: position.scale * mapScale,
        };

        // Add map offset
        const mapRect = mapElement.getBoundingClientRect();
        const gameContainer = document.getElementById("game-container");
        if (gameContainer) {
          const containerRect = gameContainer.getBoundingClientRect();
          scaledPosition.x += mapRect.left - containerRect.left;
          scaledPosition.y += mapRect.top - containerRect.top;
        }

        // Create the flag animation
        const flagInfo = window.animationManager.createFlagAnimation(`${targetCountry}-${claimIndex}`, scaledPosition, scaledPosition.scale);

        // Store reference to the flag
        if (flagInfo) {
          // Initialize flags array if it doesn't exist yet (defensive programming)
          if (!countryState.flags) {
            countryState.flags = [];
          }
          
          countryState.flags.push(flagInfo);
          console.log(`Flag added to ${targetCountry}, total flags: ${countryState.flags.length}`);
        }
      }
    }
  }

  setVisualZIndex(zIndex) {
    if (this.elements.visual) {
      this.elements.visual.style.zIndex = zIndex;
    }
  }

  updateVisualStyles() {
    if (!this.elements.visual) return;

    // Add throttling to prevent multiple updates in rapid succession
    if (this._styleUpdatePending) return;

    this._styleUpdatePending = true;

    requestAnimationFrame(() => {
      // Remember current z-index to preserve it
      const currentZIndex = this.elements.visual.style.zIndex;

      // Clear all state classes first
      this.elements.visual.classList.remove(
        "state-idle",
        "state-hittable",
        "hittable",
        "hit",
        "grab-success",
        "first-block",
        "grabbing",
        "hover-active",
        "animation-completed"
      );

      // Add the appropriate class for the current state
      if (this.state.current === this.STATES.IDLE) {
        // Don't add any classes for idle
      } else if (this.state.current === this.STATES.HITTABLE) {
        this.elements.visual.classList.add("hittable");
      } else if (this.state.current === this.STATES.HIT) {
        this.elements.visual.classList.add("hit");
      } else if (this.state.current === this.STATES.GRAB_SUCCESS) {
        this.elements.visual.classList.add("grab-success");
      }

      // Add modifiers based on state
      if (this.isFirstBlock() && this.state.current === this.STATES.HITTABLE) {
        this.elements.visual.classList.add("first-block");
      }

      if (this.state.isGrabbing && this.state.current === this.STATES.HITTABLE) {
        this.elements.visual.classList.add("grabbing");
      }

      if (this.state.isHovering) {
        this.elements.visual.classList.add("hover-active");
      }

      // Ensure the visual doesn't interfere with clicks
      this.elements.visual.style.pointerEvents = "none";

      // Restore the z-index we saved earlier
      this.elements.visual.style.zIndex = currentZIndex;

      // Ensure the hitbox remains interactive
      if (this.elements.hitbox) {
        this.elements.hitbox.style.pointerEvents = "all";
        this.elements.hitbox.style.cursor = "pointer";
        this.elements.hitbox.style.zIndex = "1";
      }

      // Reset flag after update
      this._styleUpdatePending = false;
    });
  }

  setStyles(element, styles) {
    if (!element) return;

    Object.entries(styles).forEach(([property, value]) => {
      element.style[property] = value;
    });
  }

  resetVisual() {
    if (!this.elements.visual) return;

    // Remove all state and effect classes
    this.elements.visual.classList.remove(
      "state-idle",
      "state-hittable",
      "hittable",
      "hit",
      "grab-success",
      "first-block",
      "grabbing",
      "hover-active",
      "animation-completed"
    );

    // Don't hide the visual element completely; instead, make it transparent
    // Remove: this.elements.visual.style.display = "none";
    this.elements.visual.style.opacity = "0";
    this.elements.visual.style.zIndex = "0";

    // Remove any dynamic shard elements
    this.removeShards();

    // Reset state
    this.state.isAnimating = false;
    this.state.isHovering = false;
    this.state.isGrabbing = false;
    this.state.targetCountry = null;
    this.state.current = this.STATES.IDLE;

    logger.debug("effects", "Visual reset to default state");
  }

  isFirstBlock() {
    return this.gameState?.stats?.successfulBlocks === 0;
  }

  _scheduleHitEffectCleanup() {
    setTimeout(() => {
      // Remove screen shake
      this.elements.gameContainer.classList.remove("screen-shake");

      // Add animation completed class
      this.elements.visual.classList.add(this.config.animationCompletedModifier);

      // Complete reset after a short delay
      setTimeout(() => {
        this.resetVisual();
      }, 100);
    }, this.config.animationDuration);
  }

  _scheduleGrabEffectCleanup() {
    setTimeout(() => {
      // Remove screen shake
      this.elements.gameContainer.classList.remove("grab-screen-shake");

      // Add animation completed class
      this.elements.visual.classList.add(this.config.animationCompletedModifier);

      // Complete reset after a short delay
      setTimeout(() => {
        this.resetVisual();
      }, 100);
    }, this.config.animationDuration);
  }

  makeHittable(isFirstBlock = this.isFirstBlock()) {
    if (!this.elements.visual || !this.elements.hitbox) {
      console.error("Cannot make hittable: visual or hitbox element is missing");
      return;
    }

    // Update classes on the hitbox
    this.elements.hitbox.classList.add("hittable");

    // Clear all state classes on the visual
    this.elements.visual.classList.remove("state-idle", "hit", "grab-success", "animation-completed");

    // IMPORTANT: Always make the visual visible for all grabs
    this.elements.visual.style.display = "block";

    // Add hittable class to visual
    this.elements.visual.classList.add("hittable");

    // Set appropriate opacity based on first block status
    if (isFirstBlock) {
      this.elements.visual.style.opacity = "0.8";
      this.elements.visual.classList.add("first-block");
    } else if (this.state.isGrabbing) {
      // don't think we ever make it in here
      this.elements.visual.classList.add("grabbing");
    } else {
      // supposed to be but not actually Standard non-first hittable state < -this is where we acutally end up in grabs
      this.elements.visual.style.opacity = "0.9";
      // this.elements.visual.style.zIndex = "2";

      this.elements.visual.classList.add("grabbing");
    }

    // Make hitbox interactive
    this.elements.hitbox.style.pointerEvents = "all";
    this.elements.hitbox.style.cursor = "pointer";
    // this.elements.hitbox.style.zIndex = "1";

    // Make visual non-interactive
    this.elements.visual.style.pointerEvents = "none";

    // Update state
    this.state.isAnimating = false;
    this.state.current = this.STATES.HITTABLE;

    // Check if we need to show the prompt
    this.updatePromptVisibility();
  }

  applyHitEffect() {
    if (!this.elements.visual) return;

    // Stop if already animating this effect
    if (this.state.isAnimating && this.state.current === this.STATES.HIT) return;

    // Update state
    this.state.isAnimating = true;
    this.state.current = this.STATES.HIT;
    this.state.isHovering = false;
    this.state.isGrabbing = false; // Not grabbing anymore after being hit

    // First ensure the visual element is visible
    this.elements.visual.style.display = "block";
    this.elements.visual.style.opacity = "1";

    // Remove existing classes and add hit class
    this.elements.visual.classList.remove("state-hittable", "hittable", "grab-success", "first-block", "grabbing", "hover-active");
    this.elements.visual.classList.add("hit");

    // Ensure pointer events are disabled
    this.elements.visual.style.pointerEvents = "none";

    // Apply screen shake
    this.elements.gameContainer.classList.add("screen-shake");

    // Force reflow for animation
    void this.elements.visual.offsetWidth;

    // Clean up after animation
    this._scheduleHitEffectCleanup();
  }

  applyGrabSuccessEffect(targetCountry) {
    if (!this.elements.visual) return;

    // Stop if already animating this effect
    if (this.state.isAnimating && this.state.current === this.STATES.GRAB_SUCCESS) return;

    // Update state
    this.state.isAnimating = true;
    this.state.current = this.STATES.GRAB_SUCCESS;
    this.state.isHovering = false;
    this.state.isGrabbing = false; // Grab is complete, not grabbing anymore

    // Remove existing classes and add grab-success class
    this.elements.visual.classList.remove("state-hittable", "hittable", "hit", "first-block", "grabbing", "hover-active");
    this.elements.visual.classList.add("grab-success");

    // Ensure pointer events are disabled
    this.elements.visual.style.pointerEvents = "none";

    // Create shard elements
    this.createShards();

    // Apply screen shake
    this.elements.gameContainer.classList.add("grab-screen-shake");

    // Force reflow for animation
    void this.elements.visual.offsetWidth;

    // Add Trump flag to the country
    // Add Trump flag to the country - using targetCountry if provided, otherwise from game state
    if (targetCountry) {
      this._addFlagToCountry(targetCountry);
    }  else {
        console.log("yyy no target country");
        
      }
    
    // Clean up after animation
    this._scheduleGrabEffectCleanup();

    if (window.handHitboxManager) {
      window.handHitboxManager.hideHandHitbox();
    }
  }
  /**
   * Create shard elements for grab success effect
   */
  createShards() {
    if (!this.elements.visual) return;

    // Remove existing shards first
    this.removeShards();

    // Create new shards
    for (let i = 3; i <= 8; i++) {
      const shard = document.createElement("div");
      shard.className = `shard${i}`;
      shard.setAttribute("data-shard-id", i.toString());

      // Apply styles directly - ensure shards are visible but don't interfere with clicks
      this.setStyles(shard, {
        position: "absolute",
        opacity: "1",
        // zIndex: "2", // Higher z-index than the parent
        top: "50%",
        left: "50%",
        visibility: "visible",
        pointerEvents: "none", // Ensure shards don't block clicks
      });

      this.elements.visual.appendChild(shard);
    }
  }

  /**
   * Remove shard elements
   */
  removeShards() {
    if (!this.elements.visual) return;

    const shards = this.elements.visual.querySelectorAll("[data-shard-id]");
    shards.forEach((shard) => shard.remove());
  }

  highlightTargetCountry(country, isTargeting) {
    if (!country) return;

    // Get the flag overlay element
    const flagOverlay = document.getElementById(`${country}-flag-overlay`);
    if (!flagOverlay) return;

    if (isTargeting) {
      // Store current opacity for restoration
      flagOverlay._previousOpacity = flagOverlay.style.opacity || "0";

      // Add highlight class
      flagOverlay.classList.add("targeting-pulse");

      // Calculate the "threat" opacity (5% darker than current)
      const currentOpacity = parseFloat(flagOverlay._previousOpacity);
      // Add 0.05 (5%) to the current opacity for the slight darkening effect
      const threatOpacity = Math.min(0.95, currentOpacity + 0.05).toString();
      flagOverlay.style.opacity = threatOpacity;

      // Store the currently targeted country
      this.state.targetCountry = country;
    } else {
      // Remove highlight
      flagOverlay.classList.remove("targeting-pulse");

      // Restore previous opacity
      if (flagOverlay._previousOpacity !== undefined) {
        flagOverlay.style.opacity = flagOverlay._previousOpacity;
        delete flagOverlay._previousOpacity;
      }

      // Clear the targeted country if it matches
      if (this.state.targetCountry === country) {
        this.state.targetCountry = null;
      }
    }
  }

  updateHoverState(isHovering) {
    if (!this.elements.visual || !this.elements.hitbox) return;

    // Update hover state tracking
    this.state.isHovering = isHovering;

    // Prevent hover effects during animations
    if (this.state.isAnimating) return;

    // Only apply hover effects if hand is in hittable state
    if (this.elements.hitbox.classList.contains(this.STATES.HITTABLE)) {
      // Update visual based on current state configuration
      this.updateVisualStyles();

      logger.debug("effects", isHovering ? "Applied hover styles" : "Removed hover styles", {
        isGrabbing: this.state.isGrabbing,
        isFirstBlock: this.isFirstBlock(),
      });
    }
  }

  /**
   * Set grabbing state (when Trump is trying to grab)
   */
  setGrabbingState() {
    if (!this.elements.visual) return;

    // Only update if the state is changing
    if (!this.state.isGrabbing) {
      // Update grabbing state
      this.state.isGrabbing = true;

      // If we're in hittable state, update styling
      if (this.state.current === this.STATES.HITTABLE) {
        this.updateVisualStyles();
      }

      logger.debug("effects", "Set to grabbing state");
    }
  }

  /**
   * Set not-grabbing state
   */
  setNotGrabbingState() {
    console.log("set not grabbing state");

    if (!this.elements.visual) return;

    // Only update if the state is changing
    if (this.state.isGrabbing) {
      // Update grabbing state
      this.state.isGrabbing = false;

      // If we're in hittable state, restore appropriate styling
      if (this.state.current === this.STATES.HITTABLE) {
        this.updateVisualStyles();
      } else {
        // Reset to default state
        this.resetVisual();
      }

      logger.debug("effects", "Set to not-grabbing state");
    }
  }

  /**
   * PUBLIC API METHODS
   */

  /**
   * Handle the start of a grab sequence
   * @param {string} country - The country being targeted
   * @param {boolean} isFirstBlock - Whether this is the first block attempt
   */
  handleGrabStart(country, isFirstBlock = this.isFirstBlock()) {
    // Make hand hittable
    this.makeHittable(isFirstBlock);

    // Highlight the targeted country
    this.highlightTargetCountry(country, true);

    // Set grabbing state
    this.setGrabbingState();

    logger.debug("effects", "Started grab sequence", {
      country,
      isFirstBlock,
    });
  }

  /**
   * Handle successful grab block by player
   */
  handleGrabBlocked() {
    // Unhighlight the country
    if (this.state.targetCountry) {
      this.highlightTargetCountry(this.state.targetCountry, false);
    }

    // Set to not grabbing
    this.setNotGrabbingState();

    // Apply hit effect
    this.applyHitEffect();

    logger.debug("effects", "Handled grab block");
  }

  addClickHerePrompt() {
    // Remove any existing prompt first
    this.removeClickHerePrompt();

    const isMobile = window.DeviceUtils ? window.DeviceUtils.isMobile() : false;

    // Create the prompt element
    this.clickPromptElement = document.createElement("div");
    this.clickPromptElement.id = "trump-hand-click-prompt";
    this.clickPromptElement.textContent = "CLICK HERE";

    // Add base classes
    this.clickPromptElement.classList.add(
      "hand-click-prompt",
      isMobile ? "hand-click-prompt--mobile" : "hand-click-prompt--desktop",
      "hand-click-prompt--pulsing"
    );

    // Styling
    // this.clickPromptElement.style.zIndex = "2";
    this.clickPromptElement.style.pointerEvents = "none";

    // Add prompt styles if not already present
    if (!document.getElementById("hand-prompt-style")) {
      this.addPromptStyles();
    }

    // Append to visual element
    if (this.elements.visual) {
      this.elements.visual.appendChild(this.clickPromptElement);
    }
  }

  removeClickHerePrompt() {
    // Remove trump-hand-click-prompt
    const existingPrompt = document.getElementById("trump-hand-click-prompt");
    if (existingPrompt && existingPrompt.parentNode) {
      existingPrompt.parentNode.removeChild(existingPrompt);
    }

    // Remove any .hitbox-prompt elements
    if (this.elements.hitbox) {
      const hitboxPrompts = this.elements.hitbox.querySelectorAll(".hitbox-prompt");
      hitboxPrompts.forEach((prompt) => prompt.remove());
    }

    // Remove style elements
    const handPromptStyle = document.getElementById("hand-prompt-style");
    if (handPromptStyle) handPromptStyle.remove();

    const hitboxPromptStyle = document.getElementById("hitbox-prompt-style");
    if (hitboxPromptStyle) hitboxPromptStyle.remove();

    // Clear reference
    this.clickPromptElement = null;
  }

  addPromptStyles() {
    const style = document.createElement("style");
    style.id = "hand-prompt-style";
    style.textContent = `
      
    `;
    document.head.appendChild(style);
  }

  removeClickHerePrompt() {
    // Minimal fallback if no effects controller
    const prompt = document.getElementById("trump-hand-click-prompt");
    if (prompt && prompt.parentNode) {
      prompt.parentNode.removeChild(prompt);
    }
  }

  updatePromptVisibility() {
    // Double check if gameState is available and properly structured
    if (!this.gameState) {
      console.warn("Game state not available for prompt visibility check");
      return;
    }

    const isBeforeFirstBlock =
      this.gameState &&
      this.gameState.stats &&
      typeof this.gameState.stats.successfulBlocks === "number" &&
      this.gameState.stats.successfulBlocks === 0;

    // Get the current game time (seconds elapsed since start)
    const currentGameTime = this.gameState.config ? this.gameState.config.GAME_DURATION - this.gameState.timeRemaining : 0;

    // Only show prompt after 10 seconds of game time has passed
    const shouldShowPrompt = isBeforeFirstBlock && this.state.current === this.STATES.HITTABLE && currentGameTime >= 3;

    if (shouldShowPrompt) {
      // Set higher z-index when showing the prompt
      this.setVisualZIndex("10");
      this.addClickHerePrompt();
    } else {
      // Reset to normal z-index when not showing prompt
      this.setVisualZIndex("1");
      this.removeClickHerePrompt();
    }
  }
  handleSuccessfulHit() {
    console.log("successful hit");

    // Remove the click here prompt after a successful hit
    this.removeClickHerePrompt();

    // Explicitly set z-index back to 0 after first hit
    // this.setVisualZIndex("1");

    this.updateVisualStyles();
  }

  reset() {
    // Reset visual elements
    this.resetVisual();

    // Remove any prompts
    this.removeClickHerePrompt();

    // Reset prompt shown state
    this.promptShownTime = 0;

    // Reset state
    this.state = {
      current: this.STATES.IDLE,
      isAnimating: false,
      isHovering: false,
      isGrabbing: false,
      targetCountry: null,
    };

    // Make non-hittable
    if (this.elements.hitbox) {
      this.elements.hitbox.classList.remove(this.STATES.HITTABLE);
      this.elements.hitbox.style.pointerEvents = "none";
    }
    // Remove any animation elements
    this.removeShards();

    // Remove classes from gameContainer
    if (this.elements.gameContainer) {
      this.elements.gameContainer.classList.remove("screen-shake", "grab-screen-shake");
    }

    logger.debug("effects", "Reset Trump hand effects controller");
  }
}

/**
 * Manages the hitbox for Trump's hand in grab animations
 */
class HandHitboxManager {
  /**
   * Create a new HandHitboxManager
   * @param {Object} audioManager - The audio manager reference
   */
  constructor(audioManager) {
    this.audioManager = audioManager;

    // Configuration
    this.config = {
      VISUAL_SCALE_FACTOR: 0.55,
      MOBILE_TOUCH_FACTOR: 1.2,
      DESKTOP_TOUCH_FACTOR: 1.0,
      REFERENCE_SCALE: 1.0,
    };

    // DOM elements - direct references to preserve original behavior
    this.trumpHandHitBox = document.getElementById("trump-hand-hitbox");
    this.trumpHandHitBoxVisual = document.getElementById("trump-hand-visual");

    // Also store in elements object for consistency
    this.elements = {
      hitbox: this.trumpHandHitBox,
      visual: this.trumpHandHitBoxVisual,
    };

    // Animation state
    this.currentState = "";
    this.currentFrame = 0;
    this.isVisible = false;
    this.isDebugMode = false;

    // Event handlers
    this._hoverHandlers = null;

    // Animation data reference
    this.animations = null;

    // Allowed animation states
    this.animationTypes = {
      grab: [
        "grabEastCanada",
        "grabEastCanadaSmall",
        "grabEastCanadaSmaller",
        "grabEastCanadaSmallest",
        "grabWestCanada",
        "grabWestCanadaSmall",
        "grabWestCanadaSmaller",
        "grabWestCanadaSmallest",
        "grabMexico",
        "grabMexicoSmall",
        "grabMexicoSmaller",
        "grabMexicoSmallest",
        "grabGreenland",
        "grabGreenlandSmall",
        "grabGreenlandSmaller",
        "grabGreenlandSmallest",
      ],
      smack: ["slapped"],
    };

    this.init();
  }

  /**
   * Initialize the hitbox manager
   */
  init() {
    if (this.trumpHandHitBox) {
      this.trumpHandHitBox.style.display = "none";
      this.trumpHandHitBox.style.pointerEvents = "none";

      // Don't set up hover effects if TrumpHandEffectsController exists
      if (!window.trumpHandEffects) {
        this.setupHoverEffects();
      }
    } else {
    }

    // Clear any existing tracking interval
    if (window.handVisualInterval) {
      clearInterval(window.handVisualInterval);
      window.handVisualInterval = null;
    }
  }

  /**
   * Hide the hitbox
   */
  hideHandHitbox() {
    if (this.trumpHandHitBox) {
      this.trumpHandHitBox.style.display = "none";
      this.trumpHandHitBox.style.pointerEvents = "none";
      this.isVisible = false;

      // If TrumpHandEffectsController exists, use its method
      if (window.trumpHandEffects) {
        window.trumpHandEffects.removeClickHerePrompt();
      } else {
        // Fallback removal if no effects controller
        // this.removeClickHerePrompt();
      }
    }
  }

  /**
   * Setup hover effects for the hitbox
   */
  setupHoverEffects() {
    if (!this.trumpHandHitBox || !this.trumpHandHitBoxVisual) return;

    // Remove existing listeners first
    this.removeHoverEffects();

    // Define new handlers using the effects controller
    const onMouseEnter = () => {
      if (window.trumpHandEffects) {
        window.trumpHandEffects.updateHoverState(true);
      }

      // Add additional visual feedback by changing cursor
      this.trumpHandHitBox.style.cursor = "pointer";
    };

    const onMouseLeave = () => {
      if (window.trumpHandEffects) {
        window.trumpHandEffects.updateHoverState(false);
      }
    };

    // Add click sound effect
    const onClick = (e) => {
      // Prevent event bubbling
      e.stopPropagation();

      // if (this.audioManager) {
      //   this.audioManager
      //     .resumeAudioContext()
      //     .then(() => {
      //       try {
      //         this.audioManager.play("ui", "click", 0.5);
      //       } catch (error) {
      //         console.warn("[Hitbox] Error playing click sound:", error);
      //         // Try direct play as fallback
      //         try {
      //           this.audioManager.playDirect("click.mp3", 0.5);
      //         } catch (e) {
      //           // Silent fail on fallback
      //         }
      //       }
      //     })
      //     .catch((e) => {
      //       console.warn("[Hitbox] Failed to resume audio context for click:", e);
      //     });
      // }
    };

    // Add the event listeners
    this.trumpHandHitBox.addEventListener("mouseenter", onMouseEnter);
    this.trumpHandHitBox.addEventListener("mouseleave", onMouseLeave);
    this.trumpHandHitBox.addEventListener("click", onClick);

    // Store for later removal
    this._hoverHandlers = {
      enter: onMouseEnter,
      leave: onMouseLeave,
      click: onClick,
    };
  }

  /**
   * Remove hover effects
   */
  removeHoverEffects() {
    if (!this.trumpHandHitBox || !this._hoverHandlers) return;

    // Remove the stored event listeners
    if (this._hoverHandlers.enter) {
      this.trumpHandHitBox.removeEventListener("mouseenter", this._hoverHandlers.enter);
    }

    if (this._hoverHandlers.leave) {
      this.trumpHandHitBox.removeEventListener("mouseleave", this._hoverHandlers.leave);
    }

    if (this._hoverHandlers.click) {
      this.trumpHandHitBox.removeEventListener("click", this._hoverHandlers.click);
    }

    // Clear the stored handlers
    this._hoverHandlers = null;
  }

  /**
   * Set animations data
   * @param {Object} animations - Animations data object
   */
  setAnimationsData(animations) {
    this.animations = animations;
  }

  /**
   * Update current state and frame
   * @param {string} state - Current animation state
   * @param {number} frameIndex - Current frame index
   */
  updateStateAndFrame(state, frameIndex) {
    console.log("updating state and frame");

    this.currentState = state;
    this.currentFrame = frameIndex;
    this.updatePosition();
  }

  /**
   * Adjust hitbox size
   * @param {number} width - New width in pixels
   * @param {number} height - New height in pixels
   * @returns {Object|undefined} Current hitbox info or undefined if not visible
   */
  adjustHitboxSize(width, height) {
    if (!this.trumpHandHitBox || !this.isVisible) {
      return;
    }

    // Store original coordinates
    const x = parseInt(this.trumpHandHitBox.style.left, 10);
    const y = parseInt(this.trumpHandHitBox.style.top, 10);

    // Apply new dimensions
    this.trumpHandHitBox.style.width = `${width}px`;
    this.trumpHandHitBox.style.height = `${height}px`;

    // Update stored coordinates for current frame
    if (this.animations && this.animations[this.currentState]) {
      if (this.animations[this.currentState].handCoordinates && this.animations[this.currentState].handCoordinates[this.currentFrame]) {
        this.animations[this.currentState].handCoordinates[this.currentFrame].width = width;
        this.animations[this.currentState].handCoordinates[this.currentFrame].height = height;
      }
    }

    return { x, y, width, height };
  }

  /**
   * Get coordinates for a specific animation frame
   * @param {Object} animation - The animation data
   * @param {number} frameIndex - The frame index to get coordinates for
   * @param {boolean} isMobile - Whether the device is mobile
   * @returns {Object|null} The scaled coordinates or null if not found
   */
  getCoordinatesForFrame(animation, frameIndex, isMobile) {
    // Check if coordinates exist for this frame
    if (!animation.handCoordinates || !animation.handCoordinates[frameIndex]) {
      return null;
    }

    const baseCoords = animation.handCoordinates[frameIndex];

    // Get the current map element
    const mapElem = document.getElementById("map-background");
    if (!mapElem) {
      return baseCoords; // Return unscaled as fallback
    }

    // Calculate current map scale compared to natural size
    const currentMapScale = mapElem.clientWidth / mapElem.naturalWidth;

    // This is your "reference" scale at which the desktop coordinates were calibrated
    const referenceDesktopScale = this.config.REFERENCE_SCALE;

    // Calculate the adjustment needed
    const scaleAdjustment = currentMapScale / referenceDesktopScale;

    // For mobile, you might want to make hitboxes slightly larger for easier touch targets
    const touchFactor = isMobile ? this.config.MOBILE_TOUCH_FACTOR : this.config.DESKTOP_TOUCH_FACTOR;

    // Apply scaling
    const scaledCoords = {
      x: Math.round(baseCoords.x * scaleAdjustment),
      y: Math.round(baseCoords.y * scaleAdjustment),
      width: Math.round(baseCoords.width * scaleAdjustment * touchFactor),
      height: Math.round(baseCoords.height * scaleAdjustment * touchFactor),
    };

    return scaledCoords;
  }

  /**
   * Update hitbox position based on current state and frame
   * @param {boolean} predictFrame - Whether to predict next frame position for smoother animations
   */
  updatePosition(predictFrame = false) {
    // Validate required elements and data
    if (!this.trumpHandHitBox) {
      return;
    }

    if (!this.animations) {
      return;
    }

    const grabAnimations = this.animationTypes.grab;
    const smackedAnimations = this.animationTypes.smack;
    this.isDebugMode = document.body.classList.contains("debug-mode");

    // No hitbox for idle or after being smacked
    if (this.currentState === "idle" || smackedAnimations.includes(this.currentState)) {
      if (!window.trumpHandEffects?.state.isAnimating) {
        this.hideHandHitbox();

        // Also ensure the visual is hidden if not animating
        if (this.trumpHandHitBoxVisual) {
          this.trumpHandHitBoxVisual.style.opacity = "0";
        }
      }
      return;
    }

    // Only continue for grab animations
    if (!grabAnimations.includes(this.currentState)) {
      this.hideHandHitbox();
      return;
    }

    const animation = this.animations[this.currentState];
    if (!animation || !animation.handCoordinates) {
      this.hideHandHitbox();
      return;
    }

    const isMobile = window.DeviceUtils ? window.DeviceUtils.isMobile() : false;

    // If prediction is enabled and we're not on the last frame, look ahead
    let frameToUse = this.currentFrame;
    if (predictFrame && frameToUse < animation.handCoordinates.length - 2) {
      frameToUse += 2; // Look ahead one frame to account for rendering delay
    }

    // Get the coordinates for the specified frame
    let coords = this.getCoordinatesForFrame(animation, frameToUse, isMobile);

    if (!coords) {
      this.hideHandHitbox();
      return;
    }

    // Position the hitbox
    this.positionHitbox(coords, isMobile);
  }

  /**
   * Scale coordinates by given factors
   * @param {Object} baseCoords - Base coordinates
   * @param {number} scaleFactor - Scale factor for all dimensions
   * @param {number} touchFactor - Additional factor for width/height
   * @returns {Object} Scaled coordinates
   */
  scaleCoordinates(baseCoords, scaleFactor, touchFactor = 1.0) {
    return {
      x: Math.round(baseCoords.x * scaleFactor),
      y: Math.round(baseCoords.y * scaleFactor),
      width: Math.round(baseCoords.width * scaleFactor * touchFactor),
      height: Math.round(baseCoords.height * scaleFactor * touchFactor),
    };
  }

  /**
   * Position the hitbox at specified coordinates
   * @param {Object} coords - Coordinates for positioning
   * @param {boolean} isMobile - True if on mobile device
   */
  positionHitbox(coords, isMobile) {
    // Position the hitbox
    this.trumpHandHitBox.style.position = "absolute";
    this.trumpHandHitBox.style.left = `${coords.x}px`;
    this.trumpHandHitBox.style.top = `${coords.y}px`;
    this.trumpHandHitBox.style.width = `${coords.width}px`;
    this.trumpHandHitBox.style.height = `${coords.height}px`;

    // Make it visible and explicitly set pointer events to all
    this.trumpHandHitBox.style.display = "block";
    this.trumpHandHitBox.style.pointerEvents = "all";
    this.trumpHandHitBox.style.cursor = "pointer"; // Add cursor pointer
    this.trumpHandHitBox.style.zIndex = "300"; // Ensure it's above visual elements
    this.isVisible = true;

    // Position the visual element directly, adjusting for the different coordinate space
    if (this.trumpHandHitBoxVisual) {
      // Get the sprite container's position relative to its parent
      const trumpContainer = document.getElementById("trump-sprite-container");
      const containerRect = trumpContainer ? trumpContainer.getBoundingClientRect() : { left: 0, top: 0 };
      const parentRect = trumpContainer && trumpContainer.parentElement ? trumpContainer.parentElement.getBoundingClientRect() : { left: 0, top: 0 };

      // Calculate the offset from sprite container to its parent
      const offsetX = containerRect.left - parentRect.left;
      const offsetY = containerRect.top - parentRect.top;

      // Apply sizing and account for the coordinate system difference
      const scaledWidth = coords.width * this.config.VISUAL_SCALE_FACTOR;
      const scaledHeight = coords.height * this.config.VISUAL_SCALE_FACTOR;
      const adjustedX = coords.x + offsetX + (coords.width - scaledWidth) / 2;
      const adjustedY = coords.y + offsetY + (coords.height - scaledHeight) / 2;

      this.trumpHandHitBoxVisual.style.position = "absolute";
      this.trumpHandHitBoxVisual.style.left = `${adjustedX}px`;
      this.trumpHandHitBoxVisual.style.top = `${adjustedY}px`;
      this.trumpHandHitBoxVisual.style.width = `${scaledWidth}px`;
      this.trumpHandHitBoxVisual.style.height = `${scaledHeight}px`;
      this.trumpHandHitBoxVisual.style.pointerEvents = "none"; // Ensure visual doesn't block clicks

      // After positioning, let the effects controller restore styling
      if (this.trumpHandHitBoxVisual) {
        // After positioning, try to restore styling with effects controller
        if (window.trumpHandEffects && this.trumpHandHitBox.classList.contains("hittable")) {
          try {
            if (typeof window.trumpHandEffects.updateVisualStyles === "function") {
              window.trumpHandEffects.updateVisualStyles();
            }
          } catch (e) {
            console.warn("Error restoring visual state:", e);
          }
        } else if (!this.trumpHandHitBoxVisual.classList.contains("hit") && !this.trumpHandHitBoxVisual.classList.contains("grab-success")) {
          // Only basic visibility if no effects controller
          this.trumpHandHitBoxVisual.style.display = "block";
          this.trumpHandHitBoxVisual.style.visibility = "visible";
        }
      }
    }

    // Ensure hover effects are attached
    if (!this._hoverHandlers) {
      this.setupHoverEffects();
    }

    // Check if we need to show the prompt - now using the effects controller
    const isBeforeFirstBlock =
      window.gameManager &&
      window.gameManager.gameState &&
      window.gameManager.gameState.stats &&
      window.gameManager.gameState.stats.successfulBlocks === 0;

    if (isBeforeFirstBlock && window.trumpHandEffects) {
      window.trumpHandEffects.updatePromptVisibility();
    }
  }

  /**
   * Handle successful hit - can be called to remove prompt after first successful hit
   */
  handleSuccessfulHit() {
    // If we have the effects controller, let it handle the prompt removal
    if (window.trumpHandEffects) {
      window.trumpHandEffects.handleSuccessfulHit();
    }
  }

  /**
   * Reset the hitbox state
   */
  reset() {
    // Reset any hitbox state as needed

    // Get a fresh reference to the hitbox element
    this.trumpHandHitBox = document.getElementById("trump-hand-hitbox");

    // Reset any flags or state
    if (this.trumpHandHitBox) {
      this.trumpHandHitBox.classList.remove("hittable", "first-block-help", "hit");
      this.trumpHandHitBox.style.visibility = "hidden";
      this.trumpHandHitBox.style.pointerEvents = "none";
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Remove event listeners
    this.removeHoverEffects();

    // Remove the prompt - now using the effects controller if available
    if (window.trumpHandEffects) {
      window.trumpHandEffects.removeClickHerePrompt();
    }

    // Hide hitbox
    this.hideHandHitbox();

    // Clear references
    this.trumpHandHitBox = null;
    this.trumpHandHitBoxVisual = null;
    this.elements.hitbox = null;
    this.elements.visual = null;
  }

  /**
   * Set debug mode
   * @param {boolean} enabled - Whether debug mode is enabled
   */
  setDebugMode(enabled) {
    this.isDebugMode = enabled;

    if (this.isVisible) {
      this.updatePosition(); // Update visual style
    }

    // Apply debug visuals if needed
    if (this.trumpHandHitBox) {
      if (enabled) {
        // this.trumpHandHitBox.style.border = "2px dashed red";
        // this.trumpHandHitBox.style.backgroundColor = "rgba(255, 0, 0, 0.2)";
      } else {
        this.trumpHandHitBox.style.border = "none";
        this.trumpHandHitBox.style.backgroundColor = "transparent";
      }
    }
  }

  /**
   * Get current hitbox information
   * @returns {Object|null} Hitbox information or null if not visible
   */
  getHitboxInfo() {
    if (!this.trumpHandHitBox || !this.isVisible) {
      return null;
    }

    return {
      x: parseInt(this.trumpHandHitBox.style.left, 10),
      y: parseInt(this.trumpHandHitBox.style.top, 10),
      width: parseInt(this.trumpHandHitBox.style.width, 10),
      height: parseInt(this.trumpHandHitBox.style.height, 10),
      visible: this.isVisible,
      state: this.currentState,
      frame: this.currentFrame,
    };
  }
}

// window.HandHitboxManager = HandHitboxManager;

/**
 * Shared utility functions for hitbox management
 */
const HitboxUtils = {
  /**
   * Position an element using coordinates
   * @param {HTMLElement} element - Element to position
   * @param {Object} coords - Coordinates object with x, y, width, height
   * @param {Object} styles - Optional additional styles to apply
   * @returns {boolean} Success status
   */
  positionElement(element, coords, styles = {}) {
    if (!element) return false;

    // Position the element
    element.style.position = "absolute";
    element.style.left = `${coords.x}px`;
    element.style.top = `${coords.y}px`;
    element.style.width = `${coords.width}px`;
    element.style.height = `${coords.height}px`;

    // Apply additional styles
    Object.entries(styles).forEach(([prop, value]) => {
      element.style[prop] = value;
    });

    return true;
  },

  /**
   * Calculate scale factor based on current map size vs reference scale
   * @param {HTMLElement} mapElement - Map element
   * @param {number} referenceScale - Reference scale
   * @returns {number} Scale factor
   */
  calculateScaleFactor(mapElement, referenceScale = 1.0) {
    if (!mapElement) return 1.0;

    const currentMapScale = mapElement.clientWidth / mapElement.naturalWidth;
    return currentMapScale / referenceScale;
  },

  /**
   * Apply debug visual style to an element
   * @param {HTMLElement} element - Element to style
   * @param {boolean} enabled - Whether debug mode is enabled
   */
  applyDebugVisuals(element, enabled) {
    if (!element) return;

    if (enabled) {
      // element.style.border = "2px dashed red";
      // element.style.backgroundColor = "rgba(255, 0, 0, 0.2)";
    } else {
      element.style.border = "none";
      element.style.backgroundColor = "transparent";
    }
  },

  /**
   * Set up event handlers with clone technique to prevent memory leaks
   * @param {HTMLElement} element - Element to attach events to
   * @param {Object} handlers - Map of event types to handler functions
   * @returns {HTMLElement} The new element with attached handlers
   */
  setupEventHandlers(element, handlers) {
    if (!element) return null;

    // Create a clone to remove any existing handlers
    const newElement = element.cloneNode(true);
    if (element.parentNode) {
      element.parentNode.replaceChild(newElement, element);
    }

    // Add new handlers to the clone
    Object.entries(handlers).forEach(([event, handler]) => {
      newElement.addEventListener(event, handler);
    });

    return newElement;
  },

  /**
   * Remove click here prompt and related elements
   */
  removeClickPrompt() {
    // Remove trump-hand-click-prompt
    const prompt = document.getElementById("trump-hand-click-prompt");
    if (prompt && prompt.parentNode) {
      prompt.parentNode.removeChild(prompt);
    }

    // Also remove any .hitbox-prompt elements
    const hitbox = document.getElementById("trump-hand-hitbox");
    if (hitbox) {
      const existingPrompts = hitbox.querySelectorAll(".hitbox-prompt");
      existingPrompts.forEach((prompt) => prompt.remove());
    }

    // Remove style elements
    const handPromptStyle = document.getElementById("hand-prompt-style");
    if (handPromptStyle) handPromptStyle.remove();

    const hitboxPromptStyle = document.getElementById("hitbox-prompt-style");
    if (hitboxPromptStyle) hitboxPromptStyle.remove();
  },
};

// Make utilities globally available
// window.HitboxUtils = HitboxUtils;

/**
 * Manages hitboxes for protestors in the game
 */
class ProtestorHitboxManager {
  /**
   * Create a new ProtestorHitboxManager
   * @param {boolean} lazyInit - Whether to use lazy initialization
   */
  constructor(lazyInit = false) {
    logger.info("protestor-hitbox", "Creating Protestor Hitbox Manager");

    // State tracking
    this.protestorHitboxes = {
      canada: { element: null, isVisible: false, scale: 1.0 },
      mexico: { element: null, isVisible: false, scale: 1.0 },
      greenland: { element: null, isVisible: false, scale: 1.0 },
      usa: { element: null, isVisible: false, scale: 1.0 }, // Add USA
    };

    this.isDebugMode = false;
    this.lazyInit = lazyInit; // Store lazy init flag

    // Reference to the map element for scaling calculations
    this.mapElement = document.getElementById("map-background");

    // Calibrated at map scale: 0.24
    // Multiple spawn locations for each country (will be scaled based on map size)
    // These are the natural coordinates relative to the original map size
    this.spawnLocations = {
      canada: [
        {
          x: 408, // van
          y: 1600,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 580, //cal
          y: 1600,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 608, //ed
          y: 1300,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 508, //wh
          y: 1100,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 408, //daw
          y: 900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 791, //sask checked
          y: 1300,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 891, //nwt checked
          y: 900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        // {
        //   x: 991, //tor
        //   y: 1500,
        //   width: 300,
        //   height: 300,
        //   calibrationScale: 0.24,
        // },
        {
          x: 1091, //ott
          y: 1400,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1091, //north of ott
          y: 1600,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1291, //north of mon
          y: 1400,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 1291, //mon
          y: 1850,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1800, // n queb
          y: 1600,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1491, //queb
          y: 1800,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1891, //sher
          y: 1850,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 1991, //ns
          y: 1850,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2091, //ns
          y: 1850,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2191, //nl
          y: 1850,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
      ],

      usa: [
        {
          x: 400, // Seattle area
          y: 1900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 500, // Seattle area
          y: 1900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 600,
          y: 1900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 700,
          y: 1900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 700,
          y: 2100,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 700,
          y: 2200,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 430,
          y: 2000,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 460,
          y: 2100,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 560,
          y: 2200,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 700, // Minnesota area
          y: 1900,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 1400, // pits  area
          y: 2100,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 600, // California area
          y: 2200,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1400,
          y: 2300,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 1600,
          y: 2300,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1440,
          y: 2200,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 1640,
          y: 2200,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
      ],
      mexico: [
        {
          x: 1102,
          y: 2536,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1050,
          y: 2450,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1180,
          y: 2510,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1102,
          y: 2636,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1050,
          y: 2650,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 1180,
          y: 2650,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
      ],
      greenland: [
        {
          x: 1900,
          y: 377,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2000,
          y: 377,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2200,
          y: 377,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2400,
          y: 377,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2192,
          y: 577,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2080,
          y: 520,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2300,
          y: 620,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2192,
          y: 777,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2180,
          y: 720,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2300,
          y: 720,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2500,
          y: 720,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2600,
          y: 720,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2192,
          y: 877,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2180,
          y: 820,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2300,
          y: 820,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2500,
          y: 820,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
        {
          x: 2600,
          y: 820,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2500,
          y: 920,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2400,
          y: 920,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2300,
          y: 920,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2250,
          y: 920,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2400,
          y: 1020,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },

        {
          x: 2400,
          y: 1220,
          width: 300,
          height: 300,
          calibrationScale: 0.24,
        },
      ],
    };

    // Store currently selected coordinates for each country
    this.currentCoordinates = {};

    // Reference to the currently associated freedom manager
    this.freedomManager = null;

    // Initialize the manager with or without lazy loading
    if (!lazyInit) {
      this.init();
    } else {
      // Just create container, don't create hitboxes yet
      this.ensureHitboxContainer();
      this.selectRandomSpawnLocations();
    }
  }

  /**
   * Initialize hitboxes
   */
  init() {
    // logger.debug("protestor-hitbox", "Initializing protestor hitboxes");

    // Create container for hitboxes if it doesn't exist
    this.ensureHitboxContainer();

    // Select random spawn locations for each country
    this.selectRandomSpawnLocations();

    // Pre-create hitboxes but keep them hidden initially
    // Only if not using lazy initialization
    if (!this.lazyInit) {
      Object.keys(this.protestorHitboxes).forEach((countryId) => {
        this.createHitbox(countryId);
      });
    }

    // Check if debug mode is enabled
    this.isDebugMode = document.body.classList.contains("debug-mode");

    // Set up resize listener
    window.addEventListener("resize", () => this.repositionAllHitboxes());
  }

  /**
   * Select random spawn locations for all countries
   */
  selectRandomSpawnLocations() {
    Object.keys(this.spawnLocations).forEach((countryId) => {
      const locations = this.spawnLocations[countryId];
      if (locations && locations.length > 0) {
        // Select a random location from the array
        const randomIndex = Math.floor(Math.random() * locations.length);
        this.currentCoordinates[countryId] = locations[randomIndex];

        logger.debug("protestor-hitbox", `Selected random spawn location ${randomIndex} for ${countryId}`);
      }
    });
  }

  /**
   * Select a new random spawn location for a specific country
   * @param {string} countryId - Country identifier
   */
  selectNewRandomSpawnLocation(countryId) {
    const locations = this.spawnLocations[countryId];
    if (locations && locations.length > 0) {
      const randomIndex = Math.floor(Math.random() * locations.length);
      this.currentCoordinates[countryId] = locations[randomIndex];

      logger.debug("protestor-hitbox", `Selected new random spawn location ${randomIndex} for ${countryId}`);

      // Reposition hitbox if it's visible
      if (this.protestorHitboxes[countryId]?.isVisible) {
        this.positionHitbox(countryId);
      }
    }
  }

  /**
   * Ensure the hitbox container exists
   * @returns {HTMLElement} The hitbox container
   */
  ensureHitboxContainer() {
    let container = document.getElementById("protestor-hitboxes-container");

    if (!container) {
      container = document.createElement("div");
      container.id = "protestor-hitboxes-container";
      container.style.position = "absolute";
      container.style.left = "0";
      container.style.top = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.pointerEvents = "none";
      container.style.zIndex = "4"; // Should match FreedomManager.Z_INDEXES.PROTESTORS

      // Add to game container
      const gameContainer = document.getElementById("game-container");
      if (gameContainer) {
        gameContainer.appendChild(container);
        logger.debug("protestor-hitbox", "Created protestor hitboxes container");
      } else {
        logger.error("protestor-hitbox", "Game container not found, cannot create hitbox container");
      }
    }

    this.container = container;
    return container;
  }

  /**
   * Create a hitbox for a specific country
   * @param {string} countryId - Country identifier
   * @returns {HTMLElement} The created hitbox
   */
  createHitbox(countryId) {
    // Clean up any existing hitbox first
    this.removeHitbox(countryId);

    // Create new hitbox element
    const hitbox = document.createElement("div");
    hitbox.id = `${countryId}-protestor-hitbox`;
    hitbox.className = "protestor-hitbox";
    hitbox.style.position = "absolute";
    hitbox.style.pointerEvents = "all";
    hitbox.style.cursor = "pointer";
    hitbox.style.display = "none"; // Start hidden

    hitbox.setAttribute("role", "button");
    hitbox.setAttribute("aria-label", `Support ${countryId.charAt(0).toUpperCase() + countryId.slice(1)} protestors`);

    // Add debug styling if in debug mode
    if (this.isDebugMode) {
      HitboxUtils.applyDebugVisuals(hitbox, true);
    }

    // Store reference to the element
    this.protestorHitboxes[countryId].element = hitbox;
    this.protestorHitboxes[countryId].scale = 1.0; // Reset scale

    // Add to container
    if (this.container) {
      this.container.appendChild(hitbox);
      logger.debug("protestor-hitbox", `Created protestor hitbox for ${countryId}`);
    }

    return hitbox;
  }

  /**
   * Remove a specific country's hitbox
   * @param {string} countryId - Country identifier
   */
  removeHitbox(countryId) {
    const existingHitbox = this.protestorHitboxes[countryId].element;
    if (existingHitbox && existingHitbox.parentNode) {
      existingHitbox.parentNode.removeChild(existingHitbox);
      logger.debug("protestor-hitbox", `Removed existing protestor hitbox for ${countryId}`);
    }
    this.protestorHitboxes[countryId].element = null;
    this.protestorHitboxes[countryId].isVisible = false;
    this.protestorHitboxes[countryId].scale = 1.0;
  }

  /**
   * Show a hitbox for a specific country
   * @param {string} countryId - Country identifier
   * @param {Object} freedomManager - Freedom manager reference
   * @returns {HTMLElement|null} The hitbox or null if failed
   */
  showHitbox(countryId, freedomManager) {
    if (!this.protestorHitboxes[countryId]) {
      console.error(`[HITBOX ERROR] Invalid country ID: ${countryId}`);
      logger.error("protestor-hitbox", `Invalid country ID: ${countryId}`);
      return null;
    }

    // Store reference to the freedom manager for click handling
    this.freedomManager = freedomManager;

    // Create or ensure hitbox exists
    let hitbox = this.protestorHitboxes[countryId].element;
    if (!hitbox) {
      hitbox = this.createHitbox(countryId);
    }

    // Position the hitbox
    this.positionHitbox(countryId);

    // Make it visible
    hitbox.style.display = "block";
    this.protestorHitboxes[countryId].isVisible = true;

    // Add click handler that calls the freedomManager's handleProtestorClick
    this.setClickHandler(countryId, hitbox, freedomManager);

    const wrapper = document.getElementById(`${countryId}-protestors-wrapper`);
    if (wrapper) {
      console.log(`777 Hitbox shown for ${countryId}, wrapper exists`);
    } else {
      console.log(`777 Hitbox shown for ${countryId}, but wrapper doesn't exist yet`);
    }
    return hitbox;
  }

  /**
   * Hide a specific country's hitbox
   * @param {string} countryId - Country identifier
   */
  hideProtestorHitbox(countryId) {
    const hitboxInfo = this.protestorHitboxes[countryId];
    if (hitboxInfo && hitboxInfo.element) {
      hitboxInfo.element.style.display = "none";
      hitboxInfo.isVisible = false;
      logger.debug("protestor-hitbox", `Hidden protestor hitbox for ${countryId}`);
    }
  }

  /**
   * Position a hitbox based on the current coordinates
   * @param {string} countryId - Country identifier
   */
  positionHitbox(countryId) {
    const hitbox = this.protestorHitboxes[countryId].element;
    if (!hitbox) return;

    // Get the current coordinates for this country
    const baseCoords = this.currentCoordinates[countryId];
    if (!baseCoords) {
      logger.error("protestor-hitbox", `No coordinates defined for ${countryId}`);
      return;
    }

    // Get the map element
    const mapElement = document.getElementById("map-background");
    if (!mapElement) {
      logger.error("protestor-hitbox", "Map element not found");
      return;
    }

    // Get the game container
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer) {
      logger.error("protestor-hitbox", "Game container not found");
      return;
    }

    // Get container positions
    const mapRect = mapElement.getBoundingClientRect();
    const containerRect = gameContainer.getBoundingClientRect();

    // Calculate map offset
    const mapOffsetX = mapRect.left - containerRect.left;
    const mapOffsetY = mapRect.top - containerRect.top;

    // Calculate scale
    const currentMapScale = mapRect.width / mapElement.naturalWidth;
    const hitboxScale = this.protestorHitboxes[countryId].scale || 1.0;

    // Scale and position the hitbox
    const scaledX = baseCoords.x * currentMapScale;
    const scaledY = baseCoords.y * currentMapScale;
    const scaledWidth = baseCoords.width * currentMapScale * hitboxScale;
    const scaledHeight = baseCoords.height * currentMapScale * hitboxScale;

    // Center adjustment for growing hitbox
    const widthDiff = (scaledWidth - baseCoords.width * currentMapScale) / 2;
    const heightDiff = (scaledHeight - baseCoords.height * currentMapScale) / 2;

    // Calculate final position
    const finalX = mapOffsetX + scaledX - widthDiff;
    const finalY = mapOffsetY + scaledY - heightDiff;

    // Position the hitbox using the utility function
    HitboxUtils.positionElement(hitbox, {
      x: finalX,
      y: finalY,
      width: scaledWidth,
      height: scaledHeight,
    });

    logger.debug(
      "protestor-hitbox",
      `Positioned protestor hitbox for ${countryId} at map-relative (${scaledX}, ${scaledY}), absolute (${finalX}, ${finalY})`
    );
  }

  /**
   * Calculate scale factor for a specific country
   * @param {string} countryId - Country identifier
   * @returns {number} Scale factor
   */
  calculateScaleFactor(countryId) {
    if (!this.mapElement) {
      logger.error("protestor-hitbox", "Map element not found for scaling calculation");
      return 1.0;
    }

    // Calculate current map scale compared to natural size
    const currentMapScale = this.mapElement.clientWidth / this.mapElement.naturalWidth;

    // Use the calibration scale stored with the coordinates
    const baseCoords = this.currentCoordinates[countryId];
    const referenceScale = baseCoords.calibrationScale || 1.0;

    // Calculate the adjustment needed
    const scaleFactor = currentMapScale / referenceScale;

    // Add detailed logging

    return scaleFactor;
  }

  /**
   * Set up click handler for a hitbox
   * @param {string} countryId - Country identifier
   * @param {HTMLElement} hitbox - The hitbox element
   * @param {Object} freedomManager - Freedom manager reference
   */
  setClickHandler(countryId, hitbox, freedomManager) {
    // Define the click handler
    const clickHandler = (event) => {
      event.stopPropagation();
      this.logClick("Click/Touch", event, hitbox, countryId);

      if (freedomManager && typeof freedomManager.handleProtestorClick === "function") {
        freedomManager.handleProtestorClick(countryId);
      } else {
        logger.error("protestor-hitbox", "Freedom manager or handler function not available");
      }
    };

    // Use utility to set up handlers (this handles the clone technique internally)
    const newHitbox = HitboxUtils.setupEventHandlers(hitbox, {
      click: clickHandler,
      touchstart: (event) => {
        event.preventDefault();
        event.stopPropagation();
        clickHandler(event);
      },
    });

    // Update reference to the new hitbox element
    this.protestorHitboxes[countryId].element = newHitbox;
  }

  /**
   * Log click information for debugging
   * @param {string} eventName - Name of the event
   * @param {Event} event - Event object
   * @param {HTMLElement} hitbox - Hitbox element
   * @param {string} countryId - Country identifier
   */
  logClick(eventName, event, hitbox, countryId) {
    logger.info("protestor-hitbox", `${eventName} detected on protestor hitbox for ${countryId}`);

    // Log position data for debugging
    const rect = hitbox.getBoundingClientRect();
    const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;

    logger.debug("protestor-hitbox", `Click coordinates: (${x}, ${y}), Hitbox: (${rect.left}, ${rect.top}, ${rect.width}, ${rect.height})`);

    // Check if click is within the bounds
    const isInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    logger.debug("protestor-hitbox", `Click inside hitbox: ${isInside}`);
  }

  /**
   * Update the size of a hitbox
   * @param {string} countryId - Country identifier
   * @param {number} scaleFactor - Scale factor to apply
   */
  updateSize(countryId, scaleFactor) {
    // Update the scale for this country
    const currentScale = this.protestorHitboxes[countryId].scale || 1.0;
    this.protestorHitboxes[countryId].scale = currentScale * scaleFactor;

    logger.debug("protestor-hitbox", `Updating scale for ${countryId} from ${currentScale} to ${this.protestorHitboxes[countryId].scale}`);

    // Reposition based on the new scale
    this.positionHitbox(countryId);
  }

  /**
   * Set debug mode
   * @param {boolean} enabled - Whether debug mode is enabled
   */
  setDebugMode(enabled) {
    this.isDebugMode = enabled;

    // Update all existing hitboxes
    Object.keys(this.protestorHitboxes).forEach((countryId) => {
      const hitbox = this.protestorHitboxes[countryId].element;
      if (!hitbox) return;

      HitboxUtils.applyDebugVisuals(hitbox, enabled);
    });

    logger.debug("protestor-hitbox", `Debug mode ${enabled ? "enabled" : "disabled"} for protestor hitboxes`);
  }

  /**
   * Reposition all visible hitboxes
   */
  repositionAllHitboxes() {
    Object.keys(this.protestorHitboxes).forEach((countryId) => {
      if (this.protestorHitboxes[countryId].isVisible) {
        this.positionHitbox(countryId);
      }
    });

    logger.debug("protestor-hitbox", "Repositioned all visible protestor hitboxes");
  }

  /**
   * Clean up all hitboxes
   */
  cleanupAll() {
    // Remove all hitbox elements
    Object.keys(this.protestorHitboxes).forEach((countryId) => {
      const hitbox = this.protestorHitboxes[countryId];
      if (hitbox && hitbox.element && hitbox.element.parentNode) {
        hitbox.element.parentNode.removeChild(hitbox.element);
      }
    });

    // Reset hitbox data
    this.protestorHitboxes = {
      canada: { element: null, isVisible: false, scale: 1.0 },
      mexico: { element: null, isVisible: false, scale: 1.0 },
      greenland: { element: null, isVisible: false, scale: 1.0 },
      usa: { element: null, isVisible: false, scale: 1.0 }, // Add USA here too
    };

    // Clear any click handlers
    if (this._clickHandler) {
      document.removeEventListener("click", this._clickHandler);
    }

    logger.info("protestor-hitbox", "Cleaned up all protestor hitboxes");
  }

  pause() {
    // Disable hitbox interactions TODO
    this.isPaused = true;
  }

  resume() {
    // Re-enable hitbox interactions TODO
    this.isPaused = false;
  }

  /**
   * Reset the manager
   */
  reset() {
    // Clean up existing hitboxes
    this.cleanupAll();

    // Reselect random spawn locations
    this.selectRandomSpawnLocations();

    // Reset state variables
    this.freedomManager = null;

    // Reinitialize core functionality if needed
    if (!this.lazyInit) {
      Object.keys(this.protestorHitboxes).forEach((countryId) => {
        this.createHitbox(countryId);
      });
    }

    logger.info("protestor-hitbox", "Reset protestor hitbox manager");
  }

  /**
   * Completely destroy the manager
   */
  destroy() {
    // Comprehensive cleanup
    this.cleanupAll();

    // Remove container if it exists
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // Reset all tracking variables
    this.container = null;
    this.currentCoordinates = {};
    this.freedomManager = null;
  }
}

// Make available to window
window.ProtestorHitboxManager = ProtestorHitboxManager;


/**
 * Unified Particle System that handles both confetti and fireworks
 */
class ParticleSystem {
  constructor(zIndexes) {
    this.Z_INDEXES = zIndexes || {
      CONFETTI: 505,
      FIREWORKS: 510,
    };
    this.activeParticles = [];
    this.isMobile = this._isMobile();
  }

  /**
   * Determine if the device is mobile
   * @private
   * @returns {boolean} - True if mobile device detected
   */
  _isMobile() {
    return window.DeviceUtils && window.DeviceUtils.isMobile();
  }

  /**
   * Create a particle burst effect
   * @param {Object} options - Burst configuration options
   */
  createBurst(options) {
    const {
      type,                 // 'confetti' or 'firework'
      position,             // {x, y, width, height}
      container,            // DOM container to append particles to
      count,                // Number of particles to create
      mobileCount = null,   // Optional override for particle count on mobile
    } = options;

    if (!container) return;
    if (!position) return;

    // Determine particle count based on device
    const particleCount = this.isMobile && mobileCount !== null 
      ? mobileCount 
      : count;

    // Calculate spawn points
    const spawnPoints = this._calculateSpawnPoints(position);
    
    // Stagger particle creation
    for (let i = 0; i < particleCount; i++) {
      setTimeout(() => {
        // Choose a random spawn point
        const point = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
        
        // Add variation to position
        const spreadFactor = this.isMobile ? 70 : 50;
        const startX = point.x + (Math.random() * spreadFactor - spreadFactor / 2);
        const startY = point.y + (Math.random() * spreadFactor - spreadFactor / 2);
        
        // Create the appropriate particle
        if (type === 'confetti') {
          this._createConfettiParticle(startX, startY, container, i % 2 === 0);
        } else if (type === 'firework') {
          this._createFireworkParticle(startX, startY, container);
        }
      }, i * (this.isMobile ? 30 : 15)); // Slower spawn rate on mobile
    }
  }

  /**
   * Calculate spawn points based on container position
   * @private
   * @param {Object} position - Position data {x, y, width, height}
   * @returns {Array} - Array of spawn points
   */
  _calculateSpawnPoints(position) {
    const { left, top, width, height } = position;
    
    return [
      { x: left + width * 0.2, y: top + height * 0.3 },
      { x: left + width * 0.5, y: top + height * 0.5 },
      { x: left + width * 0.8, y: top + height * 0.4 },
    ];
  }

  /**
   * Create a confetti particle
   * @private
   * @param {number} startX - Starting X position
   * @param {number} startY - Starting Y position
   * @param {HTMLElement} container - Container element
   * @param {boolean} isLarger - Whether this should be a larger particle
   */
  _createConfettiParticle(startX, startY, container, isLarger = false) {
    if (!container) return;

    // Early return on mobile to reduce particle count
    if (this.isMobile && Math.random() > 0.33) return;

    // Create the particle element
    const particle = document.createElement("div");
    particle.className = "freedom-confetti";

    // Performance optimization
    particle.style.willChange = "transform, opacity";

    // Apply random shape
    const shapes = ["circle", "square", "rectangle", "triangle"];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    particle.classList.add(`confetti-${shape}`);

    // Set size based on device and particle type
    const shouldBeLarger = this.isMobile ? Math.random() > 0.5 : isLarger;
    const baseSize = this.isMobile ? 7 : 4;
    const variance = this.isMobile ? 8 : 6;
    const size = shouldBeLarger
      ? baseSize + Math.random() * variance * 1.5
      : baseSize + Math.random() * variance;

    particle.style.width = `${size}px`;
    particle.style.height = shape === "rectangle" ? `${size * 2}px` : `${size}px`;

    // Set color and style
    const hue = Math.floor(Math.random() * 360);
    const lightness = 50 + Math.random() * 30;
    particle.style.backgroundColor = `hsl(${hue}, 100%, ${lightness}%)`;
    particle.style.border = "1px solid black";

    // Position the particle
    particle.style.position = "absolute";
    particle.style.left = `${startX}px`;
    particle.style.top = `${startY}px`;
    particle.style.zIndex = this.Z_INDEXES.CONFETTI;

    // Add to container
    container.appendChild(particle);

    // Set up animation parameters
    const angle = Math.random() * Math.PI * 2;
    const distance = this.isMobile
      ? 60 + Math.random() * 140
      : 40 + Math.random() * 120;

    const destinationX = startX + Math.cos(angle) * distance;
    const destinationY = startY + Math.sin(angle) * distance;
    const duration = 1200 + Math.random() * 1500;

    // Control points for bezier curve
    const cp1x = startX + (destinationX - startX) * 0.3 + (Math.random() * 30 - 15);
    const cp1y = startY + (destinationY - startY) * 0.3 - Math.random() * 20;
    const cp2x = startX + (destinationX - startX) * 0.6 + (Math.random() * 30 - 15);
    const cp2y = destinationY - Math.random() * 50;

    // Initial rotation
    const rotation = Math.random() * 360;
    particle.style.transform = `rotate(${rotation}deg)`;

    // Create particle data
    const particleData = {
      type: 'confetti',
      element: particle,
      startTime: performance.now(),
      animationCompleted: false,
      paused: false,
      startX,
      startY,
      destinationX,
      destinationY,
      rotation,
      duration,
      cp1x,
      cp1y,
      cp2x,
      cp2y,
      simplifiedPath: this.isMobile,
    };

    // Add to active particles
    this.activeParticles.push(particleData);

    // Start the animation
    this._animateParticle(particleData);
  }

  /**
   * Create a firework particle
   * @private
   * @param {number} startX - Starting X position
   * @param {number} startY - Starting Y position
   * @param {HTMLElement} container - Container element
   */
  _createFireworkParticle(startX, startY, container) {
    if (!container) return;

    // Reduce particle creation on mobile
    if (this.isMobile && Math.random() > 0.6) return;

    // Create the particle element
    const particle = document.createElement("div");
    particle.className = "freedom-firework";

    // Choose particle type based on device
    const particleTypes = this.isMobile ? ["circle", "circle", "spark"] : ["spark", "circle", "spark"];
    const particleType = particleTypes[Math.floor(Math.random() * particleTypes.length)];

    // Random vibrant color
    const hue = Math.floor(Math.random() * 360);

    // Style based on particle type
    if (particleType === "circle") {
      particle.style.backgroundColor = `hsl(${hue}, 100%, 60%)`;
      particle.style.borderRadius = "50%";
    } else if (particleType === "spark") {
      const sparkAngle = Math.random() * 360;
      particle.style.backgroundColor = `hsl(${hue}, 100%, 65%)`;
      particle.style.borderRadius = "40% 40% 5% 5%";
      particle.style.transform = `rotate(${sparkAngle}deg)`;
    }

    // Add border - thinner on mobile
    particle.style.border = this.isMobile ? "1px solid black" : "2px solid black";

    // Size based on device and type
    const sizeFactor = this.isMobile ? 1.3 : 1.0;
    const size = particleType === "spark" 
      ? (6 + Math.random() * 12) * sizeFactor 
      : (10 + Math.random() * 15) * sizeFactor;

    particle.style.width = `${size}px`;
    if (particleType === "spark") {
      const elongation = this.isMobile ? 2.5 + Math.random() : 3 + Math.random();
      particle.style.height = `${size * elongation}px`;
    } else {
      particle.style.height = `${size}px`;
    }

    // Position the particle
    particle.style.position = "absolute";
    particle.style.left = `${startX}px`;
    particle.style.top = `${startY}px`;
    particle.style.zIndex = this.Z_INDEXES.FIREWORKS;

    // Add to container
    container.appendChild(particle);

    // Set up animation parameters
    const angle = Math.random() * Math.PI * 2;
    const distance = this.isMobile
      ? 60 + Math.random() * 100
      : 80 + Math.random() * 180;

    const destinationX = startX + Math.cos(angle) * distance;
    const destinationY = startY + Math.sin(angle) * distance;

    // Duration based on device
    const duration = this.isMobile
      ? 1000 + Math.random() * 500
      : 1500 + Math.random() * 1000;

    // Create particle data
    const particleData = {
      type: 'firework',
      element: particle,
      startTime: performance.now(),
      animationCompleted: false,
      paused: false,
      startX,
      startY,
      destinationX,
      destinationY,
      duration,
      particleType,
      centerX: startX,
      centerY: startY,
    };

    // Add to active particles
    this.activeParticles.push(particleData);

    // Start the animation
    this._animateParticle(particleData);
  }

  /**
   * Unified animation function for all particles
   * @private
   * @param {Object} particleData - Particle data
   */
  _animateParticle(particleData) {
    if (particleData.paused || particleData.animationCompleted) return;

    const element = particleData.element;
    if (!element || !element.parentNode) {
      particleData.animationCompleted = true;
      this._removeParticle(particleData);
      return;
    }

    const animateFrame = (timestamp) => {
      if (particleData.paused || particleData.animationCompleted) return;

      const elapsed = timestamp - particleData.startTime;
      const progress = Math.min(elapsed / particleData.duration, 1);

      if (progress < 1) {
        // Handle animation based on particle type
        if (particleData.type === 'confetti') {
          this._updateConfettiParticle(particleData, progress);
        } else if (particleData.type === 'firework') {
          this._updateFireworkParticle(particleData, progress);
        }

        // Optimize frame rate on mobile
        if (this.isMobile && Math.random() > 0.7) {
          setTimeout(() => requestAnimationFrame(animateFrame), 32);
        } else {
          requestAnimationFrame(animateFrame);
        }
      } else {
        // Animation complete, remove particle
        particleData.animationCompleted = true;
        this._removeParticle(particleData);
      }
    };

    requestAnimationFrame(animateFrame);
  }

  /**
   * Update confetti particle position and appearance
   * @private
   * @param {Object} particleData - Particle data
   * @param {number} progress - Animation progress (0-1)
   */
  _updateConfettiParticle(particleData, progress) {
    const element = particleData.element;
    
    let currentX, currentY;

    if (particleData.simplifiedPath) {
      // Linear path for mobile (more efficient)
      currentX = particleData.startX + (particleData.destinationX - particleData.startX) * progress;
      currentY = particleData.startY + (particleData.destinationY - particleData.startY) * progress;
    } else {
      // Cubic bezier calculations for smooth movement on desktop
      const t = progress;
      const t_ = 1 - t;

      currentX = Math.pow(t_, 3) * particleData.startX + 
                3 * Math.pow(t_, 2) * t * particleData.cp1x + 
                3 * t_ * Math.pow(t, 2) * particleData.cp2x + 
                Math.pow(t, 3) * particleData.destinationX;
                
      currentY = Math.pow(t_, 3) * particleData.startY + 
                3 * Math.pow(t_, 2) * t * particleData.cp1y + 
                3 * t_ * Math.pow(t, 2) * particleData.cp2y + 
                Math.pow(t, 3) * particleData.destinationY;
    }

    // Update position
    element.style.left = `${currentX}px`;
    element.style.top = `${currentY}px`;

    // Simplified rotation on mobile
    if (particleData.simplifiedPath) {
      const spin = particleData.rotation + progress * 180 * (Math.random() > 0.5 ? 1 : -1);
      element.style.transform = `rotate(${spin}deg)`;
    } else {
      // Add spin animation
      const spin = particleData.rotation + progress * progress * 720 * (Math.random() > 0.5 ? 1 : -1);

      // Scale down at the end
      if (progress > 0.7) {
        const scale = 1 - ((progress - 0.7) / 0.3) * 0.7;
        element.style.transform = `rotate(${spin}deg) scale(${scale})`;
      } else {
        element.style.transform = `rotate(${spin}deg)`;
      }
    }
  }

  /**
   * Update firework particle position and appearance
   * @private
   * @param {Object} particleData - Particle data
   * @param {number} progress - Animation progress (0-1)
   */
  _updateFireworkParticle(particleData, progress) {
    const element = particleData.element;
    
    // Arc path with gentle gravity
    const easedProgress = progress;
    const currentX = particleData.centerX + (particleData.destinationX - particleData.centerX) * easedProgress;

    // Arc effect - gentler on mobile
    const arcHeight = this.isMobile ? 30 : 60;
    const gravityStrength = this.isMobile ? 20 : 40;

    const verticalOffset = Math.sin(progress * Math.PI) * arcHeight;
    const gravity = Math.pow(progress, 2) * gravityStrength;
    const currentY = particleData.centerY + 
                    (particleData.destinationY - particleData.centerY) * easedProgress - 
                    verticalOffset + 
                    gravity;

    // Update position
    element.style.left = `${currentX}px`;
    element.style.top = `${currentY}px`;

    // Rotation based on particle type
    if (particleData.particleType === "spark") {
      // Calculate angle based on movement direction
      const dx = currentX - parseFloat(element.style.left || particleData.centerX);
      const dy = currentY - parseFloat(element.style.top || particleData.centerY);
      let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;

      // Add slight wobble
      const wobble = this.isMobile ? 2 : 5;
      angle += Math.sin(progress * Math.PI * 2) * wobble;

      element.style.transform = `rotate(${angle}deg)`;
    } else {
      // Minimal rotation for circles
      const rotation = progress * 30 * (Math.random() > 0.5 ? 1 : -1);
      element.style.transform = `rotate(${rotation}deg)`;
    }

    // Fade out near the end
    if (progress > 0.8) {
      const exitScale = 1 - (progress - 0.8) / 0.2;
      element.style.opacity = exitScale.toString();
    }
  }

  /**
   * Remove a particle from the active list and the DOM
   * @private
   * @param {Object} particleData - Particle data
   */
  _removeParticle(particleData) {
    // Remove from DOM
    if (particleData.element && particleData.element.parentNode) {
      particleData.element.parentNode.removeChild(particleData.element);
    }

    // Remove from active particles list
    const index = this.activeParticles.indexOf(particleData);
    if (index !== -1) {
      this.activeParticles.splice(index, 1);
    }
  }

  /**
   * Pause all active particles
   */
  pauseAll() {
    this.activeParticles.forEach(particle => {
      particle.paused = true;
    });
  }

  /**
   * Resume all paused particles
   */
  resumeAll() {
    this.activeParticles.forEach(particle => {
      if (particle.paused) {
        particle.paused = false;
        particle.startTime = performance.now() - 
                           (particle.duration * (particle.lastProgress || 0));
        this._animateParticle(particle);
      }
    });
  }

  /**
   * Clean up all particles
   */
  cleanupAll() {
    // Make a copy of the array since we'll be modifying it
    const particles = [...this.activeParticles];
    
    particles.forEach(particle => {
      particle.animationCompleted = true;
      if (particle.element && particle.element.parentNode) {
        particle.element.parentNode.removeChild(particle.element);
      }
    });
    
    this.activeParticles = [];
  }
}

/**
 * Visual Effects Manager to handle all effects including text and flashes
 */
class VisualEffectsManager {
  constructor(zIndexes) {
    this.Z_INDEXES = zIndexes || {
      BASE: 500,
      CONFETTI: 505,
      FIREWORKS: 510,
      FLASH: 0,
      TEXT: 520,
    };
    
    this.particleSystem = new ParticleSystem(this.Z_INDEXES);
    this.isMobile = this._isMobile();
    this.activeEffects = {
      flashes: [],
      texts: []
    };
  }

  /**
   * Determine if the device is mobile
   * @private
   * @returns {boolean} - True if mobile device detected
   */
  _isMobile() {
    return window.DeviceUtils && window.DeviceUtils.isMobile();
  }

  /**
   * Create a resistance celebration with multiple effects
   * @param {string} countryId - Country identifier
   * @param {Object} positionData - Position data for the effect
   * @param {HTMLElement} container - Container element
   * @param {Object} options - Effect options
   */
  createResistanceCelebration(countryId, positionData, container, options = {}) {
    if (!container || !positionData) return;

    const { left, top, width, height } = positionData;
    const effectOptions = {
      playSound: true,
      screenShake: true,
      confetti: true,
      fireworks: true,
      ...options
    };

    // Create flash effect
    this.createFlashEffect(left, top, width, height, container);

    // Add resistance text
    this.createResistanceText(left, top, width, height, container);

    // Add particle effects based on options
    if (effectOptions.confetti) {
      this.createConfettiBurst(left, top, width, height, container);
    }

    if (effectOptions.fireworks) {
      this.createFireworkBurst(left, top, width, height, container);
    }

    // Screen shake effect
    if (effectOptions.screenShake) {
      this.applyScreenShake(container, false);
    }
  }

  /**
   * Create a flash effect
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @param {number} width - Width
   * @param {number} height - Height
   * @param {HTMLElement} container - Container element
   */
  createFlashEffect(left, top, width, height, container) {
    const flash = document.createElement("div");
    flash.className = "freedom-flash mobile-optimized";
    Object.assign(flash.style, {
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      borderRadius: "10%",
      zIndex: this.Z_INDEXES.FLASH,
    });
    container.appendChild(flash);

    // Track flash for cleanup
    this.activeEffects.flashes.push(flash);

    // Cleanup flash after animation
    setTimeout(() => this._cleanupElement(flash, "freedom-flash"), 1500);
  }

  /**
   * Create resistance text effect
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} width - Width
   * @param {number} height - Height
   * @param {HTMLElement} container - Container element
   * @param {string} message - Optional custom message
   */
  createResistanceText(x, y, width, height, container, message = "!") {
    const text = document.createElement("div");
    text.className = "freedom-text";
    text.textContent = message;
    text.style.position = "absolute";
    text.style.zIndex = this.Z_INDEXES.TEXT;

    // MUCH larger text
    text.style.fontSize = ".24rem";

    // Thicker outline
    text.style.webkitTextStroke = ".5px black";
    text.style.textStroke = ".5px black";

    // More vibrant color
    const hue = Math.floor(Math.random() * 60); // Randomize between red-yellow
    text.style.color = `hsl(${hue}, 100%, 50%)`;
    text.style.fontWeight = "900";

    // Calculate center position
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Position to allow for animation
    const textWidth = 300; // Generous width estimate
    text.style.width = `${textWidth}px`;
    text.style.left = `${centerX - textWidth / 2}px`;
    text.style.top = `${centerY - 30}px`;
    text.style.textAlign = "center";

    container.appendChild(text);
    this.activeEffects.texts.push(text);

    // Random starting rotation for more dynamism
    const startRotation = -10 + Math.random() * 20;

    // Create unique animation ID to avoid conflicts
    const animationId = `resistance-text-${Date.now()}`;

    // Create custom keyframes for this specific instance
    const style = document.createElement("style");
    style.textContent = `
      @keyframes ${animationId} {
        0% {
          transform: scale(0.1) rotate(${startRotation - 15}deg);
          opacity: 0;
        }
        15% {
          transform: scale(1.6) rotate(${startRotation + 10}deg);
          opacity: 1;
        }
        30% {
          transform: scale(1.1) rotate(${startRotation - 8}deg);
          opacity: 1;
        }
        45% {
          transform: scale(1.4) rotate(${startRotation + 6}deg);
          opacity: 1;
        }
        65% {
          transform: scale(1.2) rotate(${startRotation - 4}deg);
          opacity: 1;
        }
        80% {
          transform: scale(1.3) rotate(${startRotation + 2}deg);
          opacity: 0.9;
        }
        100% {
          transform: scale(2.5) rotate(${startRotation}deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);

    // Apply the animation
    text.style.animation = `${animationId} 2.5s cubic-bezier(0.22, 0.61, 0.36, 1) forwards`;

    // Remove text and style after animation
    setTimeout(() => {
      if (text.parentNode) {
        text.parentNode.removeChild(text);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
      const index = this.activeEffects.texts.indexOf(text);
      if (index !== -1) {
        this.activeEffects.texts.splice(index, 1);
      }
    }, 2500);
  }

  /**
   * Create a confetti burst effect
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @param {number} width - Width
   * @param {number} height - Height
   * @param {HTMLElement} container - Container element
   */
  createConfettiBurst(left, top, width, height, container) {
    this.particleSystem.createBurst({
      type: 'confetti',
      position: { left, top, width, height },
      container,
      count: 60,
      mobileCount: 20
    });
  }

  /**
   * Create a firework burst effect
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @param {number} width - Width
   * @param {number} height - Height
   * @param {HTMLElement} container - Container element
   */
  createFireworkBurst(left, top, width, height, container) {
    const burstLocations = this.isMobile
      ? [
          { x: left + width * 0.3, y: top + height * 0.3, delay: 0 },
          { x: left + width * 0.7, y: top + height * 0.4, delay: 300 },
        ]
      : [
          { x: left + width * 0.3, y: top + height * 0.3, delay: 0 },
          { x: left + width * 0.7, y: top + height * 0.4, delay: 300 },
          { x: left + width * 0.5, y: top + height * 0.2, delay: 600 },
        ];
  
    const burstArea = Math.min(width, height) * 0.3; // Create a reasonable area around burst point
  
    burstLocations.forEach((burst) => {
      setTimeout(() => {
        this.particleSystem.createBurst({
          type: 'firework',
          position: { 
            left: burst.x - burstArea/2, 
            top: burst.y - burstArea/2, 
            width: burstArea, 
            height: burstArea 
          },
          container,
          count: 15 + Math.floor(Math.random() * 10),
          mobileCount: 8
        });
      }, burst.delay);
    });
  }

  /**
   * Apply screen shake effect
   * @param {HTMLElement} container - Container element
   * @param {boolean} isHeavy - Whether to use a heavy shake
   */
  applyScreenShake(container, isHeavy = false) {
    if (!container) return;
    
    container.classList.add(isHeavy ? "heavy-screen-shake" : "screen-shake");
    
    setTimeout(
      () => {
        container.classList.remove("screen-shake", "heavy-screen-shake");
      },
      isHeavy ? 1000 : 500
    );
  }

  /**
   * Clean up an element with class removal
   * @private
   * @param {HTMLElement} element - Element to clean up
   * @param {string} className - Class name to remove
   */
  _cleanupElement(element, className) {
    if (!element || !element.parentNode) return;

    // Remove animation class
    if (className) {
      element.classList.remove(className);
    }

    // Force a reflow to ensure animation stops
    void element.offsetWidth;

    // Remove element
    element.parentNode.removeChild(element);

    // Remove from active effects
    Object.keys(this.activeEffects).forEach(key => {
      const index = this.activeEffects[key].indexOf(element);
      if (index !== -1) {
        this.activeEffects[key].splice(index, 1);
      }
    });
  }

  /**
   * Pause all animations
   */
  pause() {
    this.particleSystem.pauseAll();
  }

  /**
   * Resume all animations
   */
  resume() {
    this.particleSystem.resumeAll();
  }

  /**
   * Clean up all effects
   */
  cleanupAll() {
    // Clean up particles
    this.particleSystem.cleanupAll();

    // Clean up flashes
    this.activeEffects.flashes.forEach(flash => {
      if (flash.parentNode) {
        flash.parentNode.removeChild(flash);
      }
    });
    this.activeEffects.flashes = [];

    // Clean up texts
    this.activeEffects.texts.forEach(text => {
      if (text.parentNode) {
        text.parentNode.removeChild(text);
      }
    });
    this.activeEffects.texts = [];

    // Remove all freedom-related elements directly
    document.querySelectorAll(".freedom-flash, .freedom-text, .freedom-confetti, .freedom-firework").forEach((el) => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
  }
}

// Define the Protestor class to encapsulate behavior
class Protestor {
  constructor(countryId, hitbox, gameContainer, config, callbacks) {
    this.countryId = countryId;
    this.hitbox = hitbox;
    this.gameContainer = gameContainer;
    this.config = config;
    this.callbacks = callbacks;
    this.element = null;
    this.wrapper = null;
    this.clickCounter = 0;
    this.disappearTimeout = null;
    this.shrinkTimeout = null;
    this.animations = {};
    this.additionalProtestors = [];
    this.currentScale = 1.0;
    this.isMobile = this._isMobile();
    this.zIndexes = this.config.Z_INDEXES;
  }

  // Check for mobile device
  _isMobile() {
    return window.DeviceUtils && window.DeviceUtils.isMobile();
  }

  // Create the protestor elements
  create() {
    // Clean up any existing elements
    this.cleanup();

    const { left, top, width, height } = this._getHitboxDimensions();

    // Create wrapper with glow
    this.wrapper = this._createWrapper(left, top, width, height);
    
    // Create protestors sprite
    const protestors = document.createElement("div");
    protestors.id = `${this.countryId}-protestors`;
    Object.assign(protestors.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      backgroundImage: "url('images/protest.png')",
      backgroundSize: "400% 100%", // For 4-frame sprite sheet
      backgroundPosition: "0% 0%",
      backgroundRepeat: "no-repeat",
      opacity: "0",
      transition: "opacity 0.3s ease-out",
      zIndex: "2",
    });
    this.wrapper.appendChild(protestors);
    this.element = protestors;

    this.gameContainer.appendChild(this.wrapper);
    
    // Start animations
    this._setupAnimations();
    
    // Set disappear timeout
    this._setDisappearTimeout();
    
    return this.wrapper;
  }

  // Get hitbox dimensions
  _getHitboxDimensions() {
    return {
      left: parseInt(this.hitbox.style.left) || 0,
      top: parseInt(this.hitbox.style.top) || 0,
      width: parseInt(this.hitbox.style.width) || 100,
      height: parseInt(this.hitbox.style.height) || 100
    };
  }

  // Create wrapper with glow
  _createWrapper(left, top, width, height) {
    const glowOutline = new GlowOutline();
    const wrapper = glowOutline.create({
      parentId: this.countryId,
      position: { left, top },
      size: { width, height },
      color: "#FFD700", // Gold color
      zIndex: 10,
    });
    wrapper.id = `${this.countryId}-protestors-wrapper`;
    // wrapper.classList.add("protestor-underglow");
    return wrapper;
  }

  // Set up protestor animations
  _setupAnimations() {
    // Get the outline element
    const outline = document.getElementById(`${this.countryId}-protestors-outline`);
  
    if (this.element) {
      // Track sprite transition separately
      this.element.addEventListener("transitionend", () => {
        console.debug(`Protestor sprite for ${this.countryId} visible`);
      }, { once: true });
  
      // Use animation manager for sprite animation
      if (window.animationManager) {
        const animationId = window.animationManager.createSpriteAnimation({
          element: this.element,
          frameCount: 4,
          frameDuration: this.isMobile ? 450 : 300, // Slower on mobile
          loop: true,
          id: `protestor-${this.countryId}`,
        });
  
        // Store the animation ID for cleanup
        this.animations.main = animationId;
      }
    }
  
    if (this.wrapper) {
      // Add grow-from-ground animation
      this.wrapper.style.transform = "scale(1, 0.2) translateY(10px)"; // Start small from ground
  
      // Fade in protestors after a short delay
      setTimeout(() => {
        if (this.wrapper) {
          // Now grow up with transition
          this.wrapper.style.transition = "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out";
          this.wrapper.style.transform = "scale(1, 1)"; // Grow to full size
        }
        
        if (this.element) {
          this.element.style.opacity = "1"; // Fade in the sprite
        }
  
        // Fade in the outline
        if (outline) {
          outline.style.transition = "opacity 0.5s ease-out";
          outline.style.opacity = "1";
        }
      }, 100);
    }
  }

  // Set timeout for protestors to disappear
  _setDisappearTimeout() {
    if (this.disappearTimeout) {
      clearTimeout(this.disappearTimeout);
    }
    
    this.disappearTimeout = setTimeout(() => {
      this.shrink();
    }, this.config.PROTESTOR_TIMING.FADE_AWAY_TIME);
  }

  // Handle click on protestor
  handleClick() {
    // Debounce clicks
    const now = Date.now();
    if (this.lastClickTime && now - this.lastClickTime < 100) {
      return;
    }
    this.lastClickTime = now;

    if (this.callbacks.onPlaySound && this.clickCounter < 3) {
      this.callbacks.onPlaySound('growProtestors', 0.2);
    }
    
    // Increment counter
    this.clickCounter += 1;

    // Call score update callback
    if (this.callbacks.onScoreUpdate) {
      this.callbacks.onScoreUpdate();
    }

    // Clear existing timeouts
    if (this.disappearTimeout) {
      clearTimeout(this.disappearTimeout);
    }

    // Handle based on click count
    if (this.clickCounter >= 3) {
      if (this.callbacks.onThirdClick) {
        this.callbacks.onThirdClick(this.countryId);
      }
      this.clickCounter = 0;
    } else {
      this._processClick();
    }
  }

  // Process protestor click (first or second click)
  _processClick() {
    // Reset animation/transition for clean state
    this.wrapper.style.animation = "none";
    this.wrapper.style.transition = "none";
    void this.wrapper.offsetWidth; // Force reflow

    // Store original position
    const originalPosition = {
      left: this.wrapper.style.left,
      top: this.wrapper.style.top,
      width: this.wrapper.style.width,
      height: this.wrapper.style.height,
    };

    // Set transform origin
    this.wrapper.style.transformOrigin = "bottom center";

    // Play sound
    if (this.callbacks.onPlaySound) {
      this.callbacks.onPlaySound('growProtestors', 0.2);
    }

    // On larger screens, create additional protestors
    if (!this.isMobile && (this.clickCounter === 1 || this.clickCounter === 2)) {
      this._createAdditionalProtestors();
    }

    // Apply visual effects based on click count
    this.wrapper.style.transition = "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";

    const scales = this.config.MOBILE_CONFIG.PROTESTOR_SCALE;
    if (this.clickCounter === 2) {
      this.element.style.backgroundImage = "url('images/protestHeart.png')";
      this.wrapper.style.transform = `scale(${scales.CLICK2})`;
    } else {
      this.wrapper.style.transform = `scale(${scales.CLICK1})`;
    }

    // Set disappear timeout
    this._setDisappearTimeout();

    // Maintain position with efficient style updates
    Object.assign(this.wrapper.style, {
      position: "absolute",
      left: originalPosition.left,
      top: originalPosition.top,
      width: originalPosition.width,
      height: originalPosition.height,
      zIndex: "10210",
    });
  }

  // Create additional protestors around the main one
  _createAdditionalProtestors() {
    // Remove any previous additional protestors
    this._cleanupAdditionalProtestors();

    // Only add additional protestors after first click
    if (this.clickCounter < 1) return;

    // Get the base position
    const left = parseInt(this.wrapper.style.left) || 0;
    const top = parseInt(this.wrapper.style.top) || 0;
    const width = parseInt(this.wrapper.style.width) || 100;
    const height = parseInt(this.wrapper.style.height) || 100;

    // Create 1-2 additional protestors based on click count
    const count = Math.min(this.clickCounter, 2);

    for (let i = 0; i < count; i++) {
      // Create a new protestor element
      const additionalProtestor = document.createElement("div");
      additionalProtestor.id = `${this.countryId}-additional-protestor-${i}`;
      additionalProtestor.className = `${this.countryId}-additional-protestor`;
      additionalProtestor.style.position = "absolute";

      // Position on either side of the main protestor
      // First click: Add one protestor to the right
      // Second click: Add one protestor to the left
      const side = i === 0 ? 1 : -1; // 1 for right, -1 for left
      const offsetX = side * (width * 0.6); // Place at 80% of the width to the side
      const offsetY = -5; // Slightly higher than the original

      additionalProtestor.style.left = `${left + offsetX}px`;
      additionalProtestor.style.top = `${top + offsetY}px`;
      additionalProtestor.style.width = `${width * 0.8}px`; // Slightly smaller
      additionalProtestor.style.height = `${height * 0.8}px`; // Slightly smaller
      additionalProtestor.style.zIndex = "10209"; // Below the main protestor
      additionalProtestor.style.backgroundImage = "url('images/protest.png')";
      additionalProtestor.style.backgroundSize = "400% 100%";
      additionalProtestor.style.backgroundPosition = "0% 0%";
      additionalProtestor.style.backgroundRepeat = "no-repeat";
      additionalProtestor.style.pointerEvents = "none";
      additionalProtestor.style.opacity = "0.9";
      additionalProtestor.style.transformOrigin = "bottom center";

      // Add to game container
      this.gameContainer.appendChild(additionalProtestor);
      this.additionalProtestors.push(additionalProtestor);

      // Animate the additional protestor
      this._animateAdditionalProtestor(i, additionalProtestor);
    }
  }

  // Animate an additional protestor
  _animateAdditionalProtestor(index, protestor) {
    // Use animation manager for additional protestor animation
    const animationId = window.animationManager.createSpriteAnimation({
      element: protestor,
      frameCount: 4,
      frameDuration: this.isMobile ? 500 : 350, // Slower on mobile
      loop: true,
      id: `${this.countryId}-additional-${index}`,
    });

    // Store animation ID for cleanup
    this.animations[`additional-${index}`] = animationId;
  }

  // Shrink and hide protestors
  shrink() {
    if (!this.wrapper) return;

    // Set up shrink animation
    this.wrapper.style.transformOrigin = "bottom center";
    this.wrapper.style.transition = "transform 0.5s ease-out, opacity 0.5s ease-out";
    this.wrapper.style.opacity = "0";
    this.wrapper.style.transform = "scale(1, 0.2) translateY(10px)";

    // After animation, call hide
    if (this.shrinkTimeout) {
      clearTimeout(this.shrinkTimeout);
    }

    this.shrinkTimeout = setTimeout(() => {
      if (this.callbacks.onHide) {
        this.callbacks.onHide(this.countryId);
      }
    }, 500);
  }

  // Clean up additional protestors
  _cleanupAdditionalProtestors() {
    // Remove DOM elements
    this.additionalProtestors.forEach(protestor => {
      if (protestor.parentNode) {
        protestor.parentNode.removeChild(protestor);
      }
    });
    
    // Stop animations
    Object.keys(this.animations).forEach(key => {
      if (key.startsWith('additional-')) {
        window.animationManager.stopSpriteAnimation(this.animations[key]);
        delete this.animations[key];
      }
    });
    
    this.additionalProtestors = [];
  }

  // Clean up all resources
  cleanup() {
    // Stop animations
    Object.values(this.animations).forEach(animId => {
      if (animId) {
        window.animationManager.stopSpriteAnimation(animId);
      }
    });
    this.animations = {};

    // Clear timeouts
    if (this.disappearTimeout) {
      clearTimeout(this.disappearTimeout);
      this.disappearTimeout = null;
    }
    
    if (this.shrinkTimeout) {
      clearTimeout(this.shrinkTimeout);
      this.shrinkTimeout = null;
    }

    // Clean up additional protestors
    this._cleanupAdditionalProtestors();

    // Remove main elements
    const elementsToClean = [
      this.wrapper,
      document.getElementById(`${this.countryId}-protestors-outline`),
      document.getElementById(`${this.countryId}-glow-wrapper`),
    ];

    elementsToClean.forEach(element => {
      if (element && element.parentNode) {
        // Remove event listeners if we stored any
        if (element._glowListeners) {
          Object.entries(element._glowListeners).forEach(([event, handler]) => {
            element.removeEventListener(event, handler);
          });
          element._glowListeners = null;
        }
        
        element.parentNode.removeChild(element);
      }
    });

    this.wrapper = null;
    this.element = null;
  }
}

// ProtestorManager class to handle all protestor operations
class ProtestorManager {
  constructor(gameState, elements, audioManager, config, gameEngine, logger) {
    this.gameState = gameState;
    this.elements = elements;
    this.audioManager = audioManager;
    this.config = config;
    this.gameEngine = gameEngine;
    this.logger = logger || this._createDefaultLogger();
    
    // Initialization
    this.protestors = new Map(); // Map of countryId to Protestor instance
    this.protestorTimers = new Map(); // Map of countryId to timer IDs
    this.usaTimingCheckDone = false;
    
    // Set up country data
    this.countries = {};
    this._initCountries();
    
    // Initialize protestor hitbox manager
    this._initProtestorHitboxManager();
  }

  // Create default logger if none provided
  _createDefaultLogger() {
    return {
      debug: (category, message) => console.log(`[DEBUG] ${category}: ${message}`),
      info: (category, message) => console.log(`[INFO] ${category}: ${message}`),
      warn: (category, message) => console.warn(`[WARN] ${category}: ${message}`),
      error: (category, message) => console.error(`[ERROR] ${category}: ${message}`),
    };
  }

  // Initialize country data
  _initCountries() {
    const countryIds = ['canada', 'mexico', 'greenland', 'usa'];
    
    countryIds.forEach(id => {
      this.countries[id] = {
        id,
        annexTime: 0,
        protestorsShown: false,
        initialDelaySet: false,
        initialDelay: null,
      };
    });
  }

  // Initialize protestor hitbox manager
  _initProtestorHitboxManager() {
    if (!window.protestorHitboxManager) {
      this.logger.info("freedom", "Creating new Protestor Hitbox Manager");
      window.protestorHitboxManager = new ProtestorHitboxManager(true); // Pass flag for lazy initialization
    }
    this.protestorHitboxManager = window.protestorHitboxManager;
  }

  // Main update method called by the game loop
  update(deltaTime) {
    if (!this.gameState.isPlaying || this.gameState.isPaused) return;

    this._checkUSAInitialAppearance();
    this._updateCountries(deltaTime);
  }

  // Check if USA protestors should initially appear
  _checkUSAInitialAppearance() {
    if (this.usaTimingCheckDone) return;

    const totalGameTime = this.gameState.config.GAME_DURATION;
    const currentGameTime = totalGameTime - this.gameState.timeRemaining;
    const usaThreshold = totalGameTime * this.config.PROTESTOR_TIMING.USA_INITIAL_APPEARANCE_THRESHOLD;

    if (currentGameTime >= usaThreshold) {
      this.showProtestors("usa");
      this.usaTimingCheckDone = true;
    }
  }

  // Update country states
  _updateCountries(deltaTime) {
    Object.keys(this.countries).forEach((countryId) => {
      if (countryId === "usa") return; // Skip USA, handled separately

      const country = this.countries[countryId];
      const gameCountry = this.gameState.countries[countryId];

      if (!gameCountry) return;

      if (gameCountry.claims >= 1) {
        // Update annexation time
        country.annexTime += deltaTime;

        // Show protestors if enough time has passed AND they're not already shown
        if (!country.protestorsShown && !country.initialDelaySet) {
          // Schedule first appearance
          this._scheduleProtestors(countryId);
        }
      } else {
        this._resetCountryState(country);
      }
    });
  }

  // Reset a country's state
  _resetCountryState(country) {
    const countryId = country.id;

    if (country.protestorsShown) {
      this.hideProtestors(countryId);
    }

    country.annexTime = 0;
    country.initialDelaySet = false;
    country.initialDelay = null;
  }

  // Schedule protestors to appear
  _scheduleProtestors(countryId) {
    // Clear any existing timer
    if (this.protestorTimers.has(countryId)) {
      clearTimeout(this.protestorTimers.get(countryId));
      this.protestorTimers.delete(countryId);
    }

    const isUSA = countryId === "usa";

    // Calculate delay based on country type
    let delay;
    if (isUSA) {
      delay = this._getRandomBetween(
        this.config.PROTESTOR_TIMING.USA_REAPPEAR_MIN_TIME, 
        this.config.PROTESTOR_TIMING.USA_REAPPEAR_MAX_TIME
      );
    } else {
      if (!this.countries[countryId].initialDelaySet) {
        delay = this._getRandomBetween(
          this.config.PROTESTOR_TIMING.INITIAL_ANNEX_MIN_DELAY,
          this.config.PROTESTOR_TIMING.INITIAL_ANNEX_MAX_DELAY
        );
        this.countries[countryId].initialDelaySet = true;
      } else {
        delay = this.config.PROTESTOR_TIMING.REGENERATION_DELAY;
      }
    }

    // Set new timer with more robust callback
    const timerId = setTimeout(() => {
      this.protestorTimers.delete(countryId);

      // Check game state before showing protestors
      const gameIsRunning = this.gameEngine.systems.state.isPlaying && !this.gameState.isPaused;

      if (gameIsRunning) {
        this.showProtestors(countryId);
      } else {
        // Reschedule if conditions are not met
        this._scheduleProtestors(countryId);
      }
    }, delay);

    this.protestorTimers.set(countryId, timerId);
  }

  // Utility function to get random number between min and max
  _getRandomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  // Get game container element
  _getGameContainer() {
    return document.getElementById("game-container");
  }

  // Show protestors for a country
  showProtestors(countryId) {
    // Check if protestors are already shown
    if (this.protestors.has(countryId)) {
      this.hideProtestors(countryId);
    }
console.log(`sss cid ${countryId}`);

    const hitbox = this.protestorHitboxManager.showHitbox(countryId, this);
    if (!hitbox) return null;

    const gameContainer = this._getGameContainer();
    if (!gameContainer) return null;


    if (this.audioManager) {
      if (countryId === "canada") {
        const region = "westCanada";
        // this.audioManager.play("protestors", region + "Protestors", 0.7);
      } else {
        // this.audioManager.play("protestors", countryId + "Protestors", 0.7);
      }
    }
    // Create protestor with callbacks
    const protestor = new Protestor(
      countryId, 
      hitbox, 
      gameContainer, 
      this.config, 
      {
        onScoreUpdate: () => this._updateScore(),
        onThirdClick: (id) => this._handleThirdClick(id),
        onPlaySound: (soundType, volume) => {
          if (this.audioManager) {
            if (soundType === 'growProtestors') {
              this.audioManager.playGrowProtestorsSound(volume);
            }
          }
        },
        onHide: (id) => this.hideProtestors(id)
      }
    );

    // Create and store the protestor instance
    const wrapper = protestor.create();
    this.protestors.set(countryId, protestor);
    
    // Update country state
    this.countries[countryId].protestorsShown = true;

    this.logger.info("freedom", `Created protestors for ${countryId}`);
    
    return wrapper;
  }

  // Handle protestor click
  handleProtestorClick(countryId) {
    const protestor = this.protestors.get(countryId);
    if (!protestor) return;
    
    protestor.handleClick();
  }

  // Update score when protestor is clicked
  _updateScore() {
    let scoreElement = document.getElementById("score");
    scoreElement.classList.add("score-bounce");
    setTimeout(() => {
      scoreElement.classList.remove("score-bounce");
    }, 500);

    this.gameState.score += 5;
    this.gameEngine.systems.ui.updateHUD(this.gameState);
    this.gameEngine.systems.ui.announceForScreenReaders(`Protestor supported! +5 points. Total score: ${this.gameState.score}`);
  }

  // Handle third click on protestor
  _handleThirdClick(countryId) {
    // Handle visual changes immediately
    if (countryId === "usa") {
      if (this.gameEngine.systems.freedom) {
        this.gameEngine.systems.freedom.handleUSAThirdClick();
      }
    } else {
      if (this.gameEngine.systems.freedom) {
        this.gameEngine.systems.freedom.triggerCountryResistance(countryId);
      }
    }

    // Handle audio with slight delay
    if (this.audioManager) {
      // this.audioManager.playRandom("resistance", countryId, null, 0.9);  
    }
  }

  // Hide protestors for a country
  hideProtestors(countryId) {
    const protestor = this.protestors.get(countryId);
    if (!protestor) return;


    /// stop protestor sound doesn't exist yet
    // if (this.audioManager) {
    //   if (countryId === "canada") {
    //     const region = "westCanada";
    //     this.audioManager.stopProtestorSound(region + "Protestors");
    //   } else {
    //     this.audioManager.stopProtestorSound(countryId + "Protestors");
    //   }
    // }
    
    // Clean up the protestor instance
    protestor.cleanup();
    this.protestors.delete(countryId);

    // Hide hitbox
    if (this.protestorHitboxManager) {
      this.protestorHitboxManager.hideProtestorHitbox(countryId);
    }

    // Update country state
    if (this.countries[countryId]) {
      this.countries[countryId].protestorsShown = false;
    }

    // Schedule next appearance
    setTimeout(() => {
      this._scheduleProtestors(countryId);
    }, 200);

    this.logger.info("freedom", `Removed protestors for ${countryId}`);
  }

  // Clean up all protestors
  cleanupAllProtestors() {
    // Clear all timers
    for (const timerId of this.protestorTimers.values()) {
      clearTimeout(timerId);
    }
    this.protestorTimers.clear();

    // Clean up each protestor instance
    for (const [countryId, protestor] of this.protestors.entries()) {
      protestor.cleanup();
      
      // Hide hitbox
      if (this.protestorHitboxManager) {
        this.protestorHitboxManager.hideProtestorHitbox(countryId);
      }
      
      // Update country state
      if (this.countries[countryId]) {
        this.countries[countryId].protestorsShown = false;
      }
    }
    
    // Clear protestors map
    this.protestors.clear();

    // Clean up hitboxes
    if (this.protestorHitboxManager) {
      this.protestorHitboxManager.cleanupAll();
    }

    this.logger.info("freedom", "All protestors cleaned up");
  }

  // Pause the protestor manager
  pause() {
    // Store current state
    this._pausedState = {
      protestorIds: Array.from(this.protestors.keys())
    };
    
    // Hide all protestors without scheduling reappearance
    for (const [countryId, protestor] of this.protestors.entries()) {
      protestor.cleanup();
    }
    
    // Clear the protestors map but keep track of which ones were active
    this.protestors.clear();
    
    // Clear timers
    for (const timerId of this.protestorTimers.values()) {
      clearTimeout(timerId);
    }
    this.protestorTimers.clear();
  }

  // Resume the protestor manager
  resume() {
    if (!this._pausedState) return;
    
    // Restore protestors that were active
    this._pausedState.protestorIds.forEach(countryId => {
      this._scheduleProtestors(countryId);
    });
    
    this._pausedState = null;
  }

  // Reset the protestor manager
  reset() {
    // Clean up all protestors
    this.cleanupAllProtestors();
    
    // Reset USA protestor timing
    this.usaTimingCheckDone = false;
    
    // Reset all country states
    Object.keys(this.countries).forEach((countryId) => {
      this.countries[countryId] = {
        id: countryId,
        annexTime: 0,
        protestorsShown: false,
        initialDelaySet: false,
        initialDelay: null,
      };
    });
    
    // Re-initialize protestor hitbox manager
    this._initProtestorHitboxManager();
  }

  // Clean up all resources
  destroy() {
    // Clean up all protestors
    this.cleanupAllProtestors();
    
    // Clear all timers
    for (const timerId of this.protestorTimers.values()) {
      clearTimeout(timerId);
    }
    this.protestorTimers.clear();
    
    // Destroy protestor hitbox manager
    if (this.protestorHitboxManager) {
      this.protestorHitboxManager.destroy();
    }
  }
}



class FreedomManager {
  // ===== CONSTANTS =====

  static Z_INDEXES = {
    BASE: 500,
    CONFETTI: 505,
    FIREWORKS: 510,
    FLASH: 0,
    TEXT: 520,
    PROTESTORS: 525,
  };

  static MOBILE_CONFIG = {
    CONFETTI_COUNT: 20, // Reduced from 60
    FIREWORK_COUNT: 8, // Reduced from 15-25
    PROTESTOR_SCALE: {
      CLICK1: 1.4,
      CLICK2: 1.75,
    },
    ANIMATION_CLEANUP_DELAY: 50,
  };

  static SOUND_STATES = {
    INITIAL: "initial",
    PLAYING: "playing",
    STOPPED: "stopped",
    ERROR: "error",
  };

  static PROTESTOR_TIMING = {
    // Regular (non-USA) protestors
    INITIAL_ANNEX_MIN_DELAY: 5000, // When a country is first annexed, wait at least 10 seconds before showing protestors
    INITIAL_ANNEX_MAX_DELAY: 10000, // When a country is first annexed, wait at most 40 seconds before showing protestors
    FADE_AWAY_TIME: 4000, // If protestors aren't clicked, they fade away after 4 seconds
    REGENERATION_DELAY: 8000, // After protestors disappear (fade or liberate), wait 60 seconds before next group appears

    // USA protestors
    USA_INITIAL_APPEARANCE_THRESHOLD: 0.5, // USA protestors first appear when 10% of total game time has elapsed
    USA_REAPPEAR_MIN_TIME: 15000, // After USA protestors disappear, wait at least 20 seconds before next group
    USA_REAPPEAR_MAX_TIME: 20000, // After USA protestors disappear, wait at most 1 second before next group
  };

  // ===== CONSTRUCTOR & INITIALIZATION =====


  constructor(gameState, elements, audioManager, config = {}, gameEngine) {
    this.gameState = gameState;
    this.elements = elements;
    this.audioManager = audioManager;
    this.gameEngine = gameEngine;
    this.animationManager = animationManager;


    // Initialization
    this.usaTimingCheckDone = false;
    this.glowOutline = new GlowOutline();

    this.visualEffectsManager = new VisualEffectsManager(FreedomManager.Z_INDEXES);



    // Trump size state
    this.trumpShrinkLevel = 0;
    this.trumpSizeState = {
      currentSize: "normal", // 'normal', 'small', 'smaller', 'smallest'
      sizeIndex: 0, // 0-3 matching the size arrays
      sizes: ["normal", "small", "smaller", "smallest"],
      transitioning: false,
    };

    // Configuration with defaults
    this.config = {
      effectsEnabled: {
        confetti: true,
        screenShake: true,
        fireworks: true,
      },
      ...config,
    };

    // Set up logger reference
    this.logger = this._initLogger();

    // Set up country data in a unified structure
    this.countries = this._initCountries();


    // Initialize protestor hitbox manager
    this._initProtestorHitboxManager();

    // Create containers for particles
    this._createParticleContainers();

    this.protestorManager = new ProtestorManager(
      gameState, 
      elements, 
      audioManager, 
      {
        Z_INDEXES: FreedomManager.Z_INDEXES,
        MOBILE_CONFIG: FreedomManager.MOBILE_CONFIG,
        PROTESTOR_TIMING: FreedomManager.PROTESTOR_TIMING
      },
      gameEngine,
      this.logger
    );

    this.logger.info("freedom", "Enhanced Freedom Manager initialized");
  }

  _initLogger() {
    return (
      window.logger || {
        debug: (category, message) => console.log(`[DEBUG] ${category}: ${message}`),
        info: (category, message) => console.log(`[INFO] ${category}: ${message}`),
        warn: (category, message) => console.warn(`[WARN] ${category}: ${message}`),
        error: (category, message) => console.error(`[ERROR] ${category}: ${message}`),
      }
    );
  }


  _initCountries() {
    return {
      canada: this._createCountryState("canada"),
      mexico: this._createCountryState("mexico"),
      greenland: this._createCountryState("greenland"),
      usa: this._createCountryState("usa"),
    };
  }


  _createCountryState(id) {
    return {
      id,
      annexTime: 0,
      clickCounter: 0,
      disappearTimeout: null,
      initialDelaySet: false,
      initialDelay: null,
      animations: {},
      protestorWrapper: null,
      currentScale: 1.0,
    };
  }


  _initProtestorHitboxManager() {
    if (!window.protestorHitboxManager) {
      this.logger.info("freedom", "Creating new Protestor Hitbox Manager");
      window.protestorHitboxManager = new ProtestorHitboxManager(true); // Pass flag for lazy initialization
    }
    this.protestorHitboxManager = window.protestorHitboxManager;
  }

  _removeCountryFlags(countryId) {
    console.log(`Removing flags for country: ${countryId}`);
    
    if (!countryId || !this.gameState || !this.gameState.countries[countryId]) {
      console.log(`Invalid parameters for flag removal`);
      return;
    }
    
    const country = this.gameState.countries[countryId];
    
    // Initialize flags array if it doesn't exist
    if (!country.flags) {
      country.flags = [];
      console.log(`Initialized flags array for ${countryId}`);
      return; // No flags to remove, so we can return early
    }
    
    // Check if there are any flags to remove
    if (country.flags.length === 0) {
      console.log(`No flags to remove for ${countryId}`);
      return;
    }
        
    // Remove each flag (single loop)
    country.flags.forEach((flagInfo, index) => {
      console.log(`[removeCountryFlags] Processing flag ${index}:`, flagInfo);
      
      // Stop the animation
      if (flagInfo.animationId && window.animationManager) {
        console.log(`[removeCountryFlags] Stopping animation ${flagInfo.animationId}`);
        window.animationManager.stopSpriteAnimation(flagInfo.animationId);
      } else if (!window.animationManager) {
        console.warn(`[removeCountryFlags] window.animationManager is not available!`);
      }
  
      // Remove the element with animation
      if (flagInfo.element) {
        console.log(`[removeCountryFlags] Adding fade-out animation to flag element`);
        flagInfo.element.style.transition = "opacity 0.5s ease-out, transform 0.5s ease-out";
        flagInfo.element.style.opacity = "0";
        flagInfo.element.style.transform = "scale(0.5) rotate(45deg)";
  
        // Remove after animation
        setTimeout(() => {
          if (flagInfo.element && flagInfo.element.parentNode) {
            console.log(`[removeCountryFlags] Removing flag element from DOM`);
            flagInfo.element.parentNode.removeChild(flagInfo.element);
          } else {
            console.warn(`[removeCountryFlags] Could not remove flag element - missing element or parent`);
          }
        }, 500);
      } else {
        console.warn(`[removeCountryFlags] Flag ${index} has no element!`);
      }
    });
    
    // Clear the flags array
    country.flags = [];
    console.log(`All flags removed for ${countryId}`);
  }

  _createParticleContainers() {
    const gameContainer = document.getElementById("game-container");
    if (!gameContainer) {
      this.logger.error("freedom", "Game container not found for particle containers");
      return;
    }

    // Create one container per country
    Object.keys(this.countries).forEach((countryId) => {
      // Check if container already exists
      if (document.getElementById(`${countryId}-particles`)) {
        return;
      }

      const container = document.createElement("div");
      container.id = `${countryId}-particles`;
      container.className = "freedom-particles";
      container.style.position = "absolute";
      container.style.left = "0";
      container.style.top = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.pointerEvents = "none";
      container.style.zIndex = FreedomManager.Z_INDEXES.BASE;
      container.style.overflow = "hidden";

      gameContainer.appendChild(container);
      this.logger.debug("freedom", `Created particle container for ${countryId}`);
    });
  }

  // ===== DOM HELPER METHODS =====

  /**
   * Get DOM element safely with logging
   * @private
   * @param {string} id - Element ID
   * @param {string} context - Context for error logging
   * @returns {HTMLElement|null} - The element or null if not found
   */
  _getElement(id, context) {
    const element = document.getElementById(id);
    // Only log as error if in a critical context, otherwise log as debug
    if (!element) {
      if (context === "critical") {
        this.logger.error("freedom", `Element ${id} not found for ${context}`);
      } else {
        this.logger.debug("freedom", `Element ${id} not found for ${context}`);
      }
    }
    return element;
  }

  /**
   * Get game container element
   * @private
   * @returns {HTMLElement|null} - Game container or null
   */
  _getGameContainer() {
    return this._getElement("game-container", "operation");
  }

  /**
   * Utility function to get random number between min and max
   * @private
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} - Random number between min and max
   */
  _getRandomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * Determine if the device is mobile
   * @private
   * @returns {boolean} - True if mobile device detected
   */
  _isMobile() {
    return window.DeviceUtils && window.DeviceUtils.isMobile();
  }


  // ===== GAME STATE MANAGEMENT =====

  /**
   * Main update method called by the game loop
   * @param {number} deltaTime - Time elapsed since last update
   */
  update(deltaTime) {
    const startTime = performance.now();
  
    if (!this.gameState.isPlaying || this.gameState.isPaused) return;
  
    // Delegate protestor management to the protestorManager
    this.protestorManager.update(deltaTime);
  
    const processingTime = performance.now() - startTime;
    if (processingTime > 16) {
      // More than one frame
      console.warn("Performance warning: Update took too long", processingTime);
    }
  }







  updateFlagOpacity(countryId) {
    const flagOverlay = this._getElement(`${countryId}-flag-overlay`, "flag update");
    if (!flagOverlay) return;

    const gameCountry = this.gameState.countries[countryId];
    if (!gameCountry) {
      this.logger.error("freedom", `Country ${countryId} not found in game state!`);
      return;
    }

    const claims = gameCountry.claims;

    // Remove previous opacity classes
    flagOverlay.classList.remove("opacity-33", "opacity-66", "opacity-100");

    // Add appropriate class based on claims
    if (claims === 0) {
      flagOverlay.style.opacity = "0"; // Use string "0" instead of number 0
    } else if (claims === 1) {
      flagOverlay.classList.add("opacity-33");
      flagOverlay.style.opacity = ""; // Clear direct opacity styling
    } else if (claims === 2) {
      flagOverlay.classList.add("opacity-66");
      flagOverlay.style.opacity = ""; // Clear direct opacity styling
    } else if (claims === 3) {
      flagOverlay.classList.add("opacity-100");
      flagOverlay.style.opacity = ""; // Clear direct opacity styling
    }
  }

  cleanupAllEffects() {
    // Clean up all protestors
    this.protestorManager.cleanupAllProtestors();
  
    // Clean up visual effects
    this.visualEffectsManager.cleanupAll();
  
    // Remove any resistance indicators
    document.querySelectorAll(".resistance-possible").forEach((el) => {
      el.classList.remove("resistance-possible");
    });
  
    if (window.animationManager) {
      window.animationManager.reset();
    }
  }
 

  /**
   * Clean up all sound resources
   */
  cleanup() {   
  }

  // ===== TRUMP SIZE MANAGEMENT =====

  /**
   * Get Trump's current size
   * @returns {Object} Trump size state
   */
  getTrumpSize() {
    return {
      size: this.trumpSizeState.currentSize,
      index: this.trumpSizeState.sizeIndex,
      isTransitioning: this.trumpSizeState.transitioning,
    };
  }

  /**
   * Reset Trump size to normal
   */
  resetTrumpSize() {
    this.trumpSizeState = {
      currentSize: "normal",
      sizeIndex: 0,
      sizes: ["normal", "small", "smaller", "smallest"],
      transitioning: false,
    };

    // Update sprite if animation manager exists
    if (this.animationManager?.trumpSprite && this.animationManager.currentState) {
      const baseState = this.animationManager.currentState.replace(/(Small|Smaller|Smallest)$/, "");
      if (this.animationManager.animations?.[baseState]?.spriteSheet) {
        this.animationManager.trumpSprite.style.backgroundImage = `url('${this.animationManager.animations[baseState].spriteSheet}')`;
      }
    }
  }


  handleProtestorClick(countryId) {
    this.protestorManager.handleProtestorClick(countryId);

  }
  /**
   * Handle USA third click (Trump shrink sequence)
   */
  handleUSAThirdClick() {
    this._handleUSAShrinkSequence();
    this.protestorManager.hideProtestors('usa');

  }


  _handleUSAShrinkSequence() {
    // Get or create effect container
    let effectContainer = document.getElementById("shrink-effects-container");
    if (!effectContainer) {
      effectContainer = document.createElement("div");
      effectContainer.id = "shrink-effects-container";
      effectContainer.style.position = "absolute";
      effectContainer.style.top = "0";
      effectContainer.style.left = "0";
      effectContainer.style.width = "100%";
      effectContainer.style.height = "100%";
      effectContainer.style.pointerEvents = "none";
      effectContainer.style.zIndex = "4";
      document.getElementById("game-container").appendChild(effectContainer);
    }

    this.trumpShrinkLevel++;
    const isFinalShrink = this.trumpShrinkLevel >= 4;

    // Create shrink effect centered on Trump
    this.createShrinkEffect(effectContainer, isFinalShrink);

    // Add the shrink text message
    const shrinkMessages = ["SHRINKY!", "SHRUNK!", "SHRINKY DINK!", "BYEEEE!"];

    // const shrinkMessages = ["SHRINKY!", "TRUMBELLINA?!", "SHRINKY-DINK!"];
    const currentMessage = shrinkMessages[this.trumpShrinkLevel - 1] || shrinkMessages[2];

    const trumpPosition = this._getTrumpPosition();

    const text = document.createElement("div");
    text.className = "shrink-text";
    text.textContent = currentMessage;
    text.style.position = "absolute";
    text.style.zIndex = FreedomManager.Z_INDEXES.TEXT;
    

    // Calculate position (centered above Trump)
    const textWidth = 300;
    text.style.width = `${textWidth}px`;
    text.style.left = `${trumpPosition.x - textWidth / 2}px`;
    text.style.top = `${trumpPosition.y - 150}px`; // Position above Trump
    text.style.textAlign = "center";

    effectContainer.appendChild(text);

    // Animate the text
    const startRotation = -5 + Math.random() * 10;
    const animationId = `shrink-text-${Date.now()}`;

    const style = document.createElement("style");
    style.textContent = `
        @keyframes ${animationId} {
            0% {
                transform: scale(0.1) rotate(${startRotation - 10}deg);
                opacity: 0;
            }
            20% {
                transform: scale(1.4) rotate(${startRotation + 5}deg);
                opacity: 1;
            }
            80% {
                transform: scale(1.2) rotate(${startRotation - 3}deg);
                opacity: 1;
            }
            100% {
                transform: scale(2.0) rotate(${startRotation}deg);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    text.style.animation = `${animationId} 1.5s cubic-bezier(0.22, 0.61, 0.36, 1) forwards`;

    // Remove text and style after animation
    setTimeout(() => {
      if (text.parentNode) text.parentNode.removeChild(text);
      if (style.parentNode) style.parentNode.removeChild(style);
    }, 1500);

    // Add screen shake
    const gameContainer = document.getElementById("game-container");
    if (gameContainer) {
      gameContainer.classList.add(isFinalShrink ? "heavy-screen-shake" : "screen-shake");
      setTimeout(
        () => {
          gameContainer.classList.remove("screen-shake", "heavy-screen-shake");
        },
        isFinalShrink ? 1000 : 500
      );
    }

    // Update Trump size state
    const sizes = ["normal", "small", "smaller", "smallest", "tiniest"];
    this.trumpSizeState = {
      currentSize: sizes[this.trumpShrinkLevel] || "smallest",
      sizeIndex: this.trumpShrinkLevel,
      sizes: sizes,
      transitioning: false,
    };

    if (this.animationManager?.trumpSprite) {
      const targetSize = sizes[this.trumpShrinkLevel];
      const currentState = this.animationManager.currentState;
      const targetState =
        currentState.replace(/(Small|Smaller|Smallest)$/, "") +
        (targetSize === "normal" ? "" : targetSize.charAt(0).toUpperCase() + targetSize.slice(1));

      if (this.animationManager.animations?.[targetState]?.spriteSheet) {
        // Add a brief delay to let the effect start before changing sprite
        setTimeout(() => {
          this.animationManager.trumpSprite.style.backgroundImage = `url('${this.animationManager.animations[targetState].spriteSheet}')`;
          this.currentTrumpSize = targetSize;
        }, 100);
      }
    }

    // Hide protestors
    this.protestorManager.hideProtestors("usa")
    // Play sound with timing aligned to visual effect
    if (this.audioManager) {
      setTimeout(() => {
        // Then play the appropriate sound
        if (isFinalShrink) {
          this.audioManager.playRandom("trump", "finalShrink", null, 0.9);
        } else {
          this.audioManager.playRandom("trump", "shrink", null, 0.7);
        }
      }, 50);
    }

    // Handle final shrink
    if (isFinalShrink) {
      // Force Trump to an angry or defeated state before ending
      if (this.animationManager?.trumpSprite) {
        const endStateAnimation = "angryIdle"; // Or whatever your specific end state animation is called
        
        // Check if the animation exists before changing
        if (this.animationManager.animations?.[endStateAnimation]) {
          this.animationManager.changeState(endStateAnimation);
        }
      }
      
      // Short delay to let the animation start before ending the game
      setTimeout(() => {
        this.gameEngine.triggerGameEnd(this.gameEngine.END_STATES.TRUMP_DESTROYED, "trump_destroyed");
      }, 200);
    }
  }


  _getTrumpPosition() {
    console.log("Calculating Trump's Position - Start");

    // Get the map element and game container
    const mapElement = document.getElementById("map-background");
    const gameContainer = document.getElementById("game-container");
    const reddotElement = document.getElementById("reddot");

    console.log("Map Element:", mapElement);
    console.log("Game Container:", gameContainer);
    console.log("Reddot Element:", reddotElement);

    if (!mapElement || !gameContainer || !reddotElement) {
      console.warn("Map, Game Container, or Reddot not found! Using screen center fallback.");
      return {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        width: 100,
        height: 150,
      };
    }

    // Get container positions
    const mapRect = mapElement.getBoundingClientRect();
    const containerRect = gameContainer.getBoundingClientRect();

    console.log("Map Rectangle:", {
      left: mapRect.left,
      top: mapRect.top,
      width: mapRect.width,
      height: mapRect.height,
      naturalWidth: mapElement.naturalWidth,
    });

    console.log("Container Rectangle:", {
      left: containerRect.left,
      top: containerRect.top,
      width: containerRect.width,
      height: containerRect.height,
    });

    // Calculate map offset from game container
    const mapOffsetX = mapRect.left - containerRect.left;
    const mapOffsetY = mapRect.top - containerRect.top;

    console.log("Map Offset:", {
      x: mapOffsetX,
      y: mapOffsetY,
    });

    // Calculate current scale of the map
    const currentMapScale = mapRect.width / mapElement.naturalWidth;

    console.log("Current Map Scale:", currentMapScale);

    // Get current animation from animation manager
    const currentAnimation = window.animationManager?.getCurrentAnimation();
    const animationName = currentAnimation?.name || "idle";

    // Determine base coordinates based on animation
    const trumpBaseCoords = animationName.includes("grabWestCanada")
      ? { x: 1000, y: 2200, width: 150, height: 200, calibrationScale: 0.24 }
      : animationName.includes("grabEastCanada") || animationName.includes("grabGreenland")
      ? { x: 1400, y: 2200, width: 150, height: 200, calibrationScale: 0.24 }
      : { x: 1200, y: 2200, width: 150, height: 200, calibrationScale: 0.24 };

    console.log("Trump Base Coordinates:", trumpBaseCoords);

    // Scale coordinates based on current map scale
    const scaledX = trumpBaseCoords.x * currentMapScale;
    const scaledY = trumpBaseCoords.y * currentMapScale;
    const scaledWidth = trumpBaseCoords.width * currentMapScale;
    const scaledHeight = trumpBaseCoords.height * currentMapScale;

    console.log("Scaled Coordinates:", {
      x: scaledX,
      y: scaledY,
      width: scaledWidth,
      height: scaledHeight,
    });

    // Calculate final position within the game container
    const finalX = mapOffsetX + scaledX;
    const finalY = mapOffsetY + scaledY;

    const finalPosition = {
      x: finalX,
      y: finalY,
      width: scaledWidth,
      height: scaledHeight,
    };

    console.log("Final Trump Position:", finalPosition);

    // Position the reddot element
    if (reddotElement) {
      reddotElement.style.position = "absolute";
      reddotElement.style.left = `${finalPosition.x}px`;
      reddotElement.style.top = `${finalPosition.y}px`;
      reddotElement.style.width = `${finalPosition.width}px`;
      reddotElement.style.height = `${finalPosition.height}px`;
    }

    return finalPosition;
  }



  createShrinkEffect(container, isFinal = false) {
    // Get Trump's position
    const trumpPosition = this._getTrumpPosition();

    console.log("Creating Shrink Effect with Position:", trumpPosition);

    // Create the effect wrapper
    const effect = document.createElement("div");
    effect.className = `shrink-effect ${isFinal ? "final-shrink" : ""}`;

    // Calculate the center point of Trump
    const centerX = trumpPosition.x + trumpPosition.width / 2;
    const centerY = trumpPosition.y + trumpPosition.height / 2;

    // Set absolute positioning centered on Trump
    effect.style.position = "absolute";
    effect.style.left = `${centerX}px`;
    effect.style.top = `${centerY}px`;
    effect.style.transform = "translate(-50%, -50%)"; // This centers the effect precisely

    // Optional: Set a consistent size for the effect
    effect.style.width = "60vw"; // Or whatever size makes sense for your effect
    effect.style.height = "60vh";

    // Log CSS variable settings
    console.log("Setting CSS Variables:", {
      "--trump-x": `${centerX}px`,
      "--trump-y": `${centerY}px`,
      "--trump-width": `${trumpPosition.width}px`,
      "--trump-height": `${trumpPosition.height}px`,
    });

    // Set CSS variables for positioning relative to Trump's position
    effect.style.setProperty("--trump-x", `${centerX}px`);
    effect.style.setProperty("--trump-y", `${centerY}px`);
    effect.style.setProperty("--trump-width", `${trumpPosition.width}px`);
    effect.style.setProperty("--trump-height", `${trumpPosition.height}px`);

    // Create star impact
    const starImpact = document.createElement("div");
    starImpact.className = "star-impact";
    effect.appendChild(starImpact);

    // Create flash effect
    const flash = document.createElement("div");
    flash.className = "flash-effect";
    effect.appendChild(flash);

    // Create shards
    for (let i = 1; i <= 4; i++) {
      const shardy = document.createElement("div");
      shardy.className = `shardy shardy${i}`;
      effect.appendChild(shardy);
    }

    // Create SVG arcs
    this._createShrinkArcs(effect);

    // Insert the effect at the beginning of the container
    container.insertBefore(effect, container.firstChild);

    // Create style element if it doesn't exist
    if (!document.getElementById("shrink-effect-styles")) {
      const styleElement = document.createElement("style");
      styleElement.id = "shrink-effect-styles";
      styleElement.textContent = `
    /* Styles for hand-drawn arcs */
    
  `;
      document.head.appendChild(styleElement);
    }

    // Remove effect after animation
    setTimeout(
      () => {
        effect.remove();
      },
      isFinal ? 2000 : 1500
    );
  }

  _createShrinkArcs(effect) {
    const svgNS = "http://www.w3.org/2000/svg";

    const arcContainer1 = document.createElement("div");
    arcContainer1.className = "hand-drawn-arc";
    arcContainer1.style.animation = "shrink-arc-outer 0.8s ease-in forwards";

    const arcContainer2 = document.createElement("div");
    arcContainer2.className = "hand-drawn-arc";
    arcContainer2.style.animation = "shrink-arc-inner 0.8s ease-in forwards 0.3s";

    const svgOuter = document.createElementNS(svgNS, "svg");
    svgOuter.setAttribute("width", "100%");
    svgOuter.setAttribute("height", "100%");
    svgOuter.setAttribute("viewBox", "-250 -250 500 500");

    const svgInner = document.createElementNS(svgNS, "svg");
    svgInner.setAttribute("width", "100%");
    svgInner.setAttribute("height", "100%");
    svgInner.setAttribute("viewBox", "-250 -250 500 500");

    // Simplified wobble arc generation (similar to previous implementation)
    const createWobblyArc = (startAngle, endAngle, radius, variation) => {
      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;
      const arcLength = endRad - startRad;
      const numPoints = Math.max(8, Math.floor(arcLength * 8)); // Reduced from 12 and 15
      const angleStep = arcLength / numPoints;

      let pathData = "";
      for (let i = 0; i <= numPoints; i++) {
        const angle = startRad + angleStep * i;
        const wobble = Math.random() * variation * 4 - variation * 2;
        const r = radius + wobble;
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);

        if (i === 0) {
          pathData += `M ${x} ${y} `;
        } else {
          const prevAngle = startRad + angleStep * (i - 1);
          const cpAngle = prevAngle + angleStep * 0.3;
          const cpWobble = Math.random() * variation * 4 - variation * 2;
          const cpRadius = radius + cpWobble;
          const cpx = cpRadius * Math.cos(cpAngle);
          const cpy = cpRadius * Math.sin(cpAngle);
          pathData += `Q ${cpx} ${cpy} ${x} ${y} `;
        }
      }

      const outlinePath = document.createElementNS(svgNS, "path");
      outlinePath.setAttribute("d", pathData);
      outlinePath.setAttribute("class", "arc-outline");
      outlinePath.style.stroke = "#000";
      outlinePath.style.strokeWidth = "16px";
      outlinePath.style.fill = "none";
      outlinePath.style.strokeLinecap = "round";
      outlinePath.style.strokeLinejoin = "round";

      const fillPath = document.createElementNS(svgNS, "path");
      fillPath.setAttribute("d", pathData);
      fillPath.setAttribute("class", "arc-fill");
      fillPath.style.stroke = "white";
      fillPath.style.strokeWidth = "4px";
      fillPath.style.fill = "none";
      fillPath.style.strokeLinecap = "round";
      fillPath.style.strokeLinejoin = "round";

      return [outlinePath, fillPath];
    };

    const outerArcs = [
      { start: 0, end: 85, radius: 200, variation: 15 },
      { start: 95, end: 175, radius: 210, variation: 12 },
      { start: 185, end: 265, radius: 205, variation: 18 },
      { start: 275, end: 355, radius: 215, variation: 14 },
    ];

    const innerArcs = [
      { start: 20, end: 100, radius: 150, variation: 10 }, // Increased from 120
      { start: 110, end: 190, radius: 155, variation: 8 }, // Increased from 125
      { start: 200, end: 280, radius: 160, variation: 12 }, // Increased from 130
      { start: 290, end: 370, radius: 158, variation: 9 }, // Increased from 128
    ];

    // Create the arcs
    outerArcs.forEach((arcData) => {
      const [outline, fill] = createWobblyArc(arcData.start, arcData.end, arcData.radius, arcData.variation);
      svgOuter.appendChild(outline);
      svgOuter.appendChild(fill);
    });

    innerArcs.forEach((arcData) => {
      const [outline, fill] = createWobblyArc(arcData.start, arcData.end, arcData.radius, arcData.variation);
      svgInner.appendChild(outline);
      svgInner.appendChild(fill);
    });

    arcContainer1.appendChild(svgOuter);
    arcContainer2.appendChild(svgInner);

    effect.appendChild(arcContainer1);
    effect.appendChild(arcContainer2);
  }

  // ===== COUNTRY RESISTANCE EFFECTS =====


  triggerCountryResistance(countryId) {
    this.logger.info("freedom", `MAJOR RESISTANCE in ${countryId}!`);


    // Add 50 points for successful revolution
    if (this.gameState) {
      let scoreElement = document.getElementById("score");
      scoreElement.classList.add("score-bounce");
      setTimeout(() => {
        scoreElement.classList.remove("score-bounce");
      }, 500);

      this.gameState.score += 50;
      // Update HUD
      this.gameEngine.systems.ui.updateHUD(this.gameState);
      // Announce for screen readers
      this.gameEngine.systems.ui.announceForScreenReaders(`Revolution successful! +50 points. Total score: ${this.gameState.score}`);
    }

    // Remove pulsing effect if it exists
    const countryElement = this.elements.countries[countryId];
    if (countryElement) {
      countryElement.classList.remove("resistance-possible");
    }

    console.log("nnnn about to remove flags");
    
    // Remove Trump flags from the country
    this._removeCountryFlags(countryId);

    // Reset claims to 0 (completely liberate the country)
    if (this.gameState.countries[countryId]) {
      this.gameState.countries[countryId].claims = 0;
    }

    // Update the flag overlay to be completely transparent
    const flagOverlay = this._getElement(`${countryId}-flag-overlay`, "resistance");
    if (flagOverlay) {
      this.logger.info("freedom", `Resetting flag opacity for ${countryId} to zero`);
      flagOverlay.classList.remove("opacity-33", "opacity-66", "opacity-100");
      flagOverlay.style.opacity = "0";
    }

    // Store position data before removing elements
    const positionData = this._capturePositionData(countryId);

    // Create celebration effects
    this._createResistanceCelebration(countryId, positionData);

    this._playResistanceAnimation(countryId);

    // IMPORTANT: Delay protestor cleanup until after animation
    setTimeout(() => {
      this.protestorManager.hideProtestors(countryId);
    }, this.config.animationDuration + 100); // Add small buffer after animation

    // Reset claims in game state
    if (this.gameState.countries[countryId]) {
      this.gameState.countries[countryId].claims = 0;
    }
    return true;
  }

 
  _capturePositionData(countryId) {
    const protestorWrapper = this._getElement(`${countryId}-protestors-wrapper`, "position capture");
    const hitbox = this.protestorHitboxManager?.protestorHitboxes[countryId]?.element;

    if (protestorWrapper) {
      const gameContainer = this._getGameContainer();
      if (!gameContainer) return null;

      const containerRect = gameContainer.getBoundingClientRect();
      const wrapperRect = protestorWrapper.getBoundingClientRect();

      return {
        source: "wrapper",
        left: wrapperRect.left - containerRect.left,
        top: wrapperRect.top - containerRect.top,
        width: wrapperRect.width,
        height: wrapperRect.height,
      };
    } else if (hitbox) {
      const gameContainer = this._getGameContainer();
      if (!gameContainer) return null;

      const containerRect = gameContainer.getBoundingClientRect();
      const hitboxRect = hitbox.getBoundingClientRect();

      return {
        source: "hitbox",
        left: hitboxRect.left - containerRect.left,
        top: hitboxRect.top - containerRect.top,
        width: hitboxRect.width,
        height: hitboxRect.height,
      };
    }

    // Fallback coordinates as last resort
    const fallbackCoords = {
      canada: { left: 117, top: 328, width: 35, height: 35 },
      mexico: { left: 126, top: 440, width: 35, height: 35 },
      greenland: { left: 249, top: 208, width: 35, height: 35 },
    };

    if (fallbackCoords[countryId]) {
      return {
        source: "fallback",
        ...fallbackCoords[countryId],
      };
    }

    return null;
  }

  _createResistanceCelebration(countryId, positionData) {
    const gameContainer = this._getGameContainer();
    if (!gameContainer || !positionData) return;
  
    // Generate effect options based on config
    const effectOptions = {
      playSound: true,
      screenShake: this.config.effectsEnabled.screenShake,
      confetti: this.config.effectsEnabled.confetti,
      fireworks: this.config.effectsEnabled.fireworks
    };
  
    // Use the visual effects manager to create the celebration
    this.visualEffectsManager.createResistanceCelebration(
      countryId, 
      positionData, 
      gameContainer, 
      effectOptions
    );
  
    // Handle audio separately if needed
    if (this.audioManager) {
      this.audioManager.playRandom("particles", "freedom", null, 0.8);
    }
  }
 
  _playResistanceAnimation(countryId) {
    let smackAnimation = "";

    // Map country to correct animation
    if (countryId === "canada") {
      smackAnimation = Math.random() < 0.5 ? "smackEastCanada" : "smackWestCanada";
    } else if (countryId === "mexico") {
      smackAnimation = "smackMexico";
    } else if (countryId === "greenland") {
      smackAnimation = "smackGreenland";
    }

    if (smackAnimation && (window.animationManager || this.animationManager)) {
      const animationManager = window.animationManager || this.animationManager;

      this.logger.info("freedom", `Playing smack animation ${smackAnimation} for resistance effect`);
      // Commented out in original code:
      // animationManager.playSmackAnimation(smackAnimation, () => {
      //   this.logger.debug("freedom", "Resistance animation completed");
      // });
    }
  }

  
  // ===== SYSTEM LIFECYCLE METHODS =====

  /**
   * Pause the freedom manager
   */
  pause() {
    this.logger.info("freedom", "Pausing Freedom Manager");

    this.protestorManager.pause();


    this.visualEffectsManager.pause();


    // Store the current state of various animations and timers
    this._pausedState = {
      disappearTimeouts: {},
    };


      }

  /**
   * Resume the freedom manager
   */
  resume() {
    // Ensure we have a saved paused state
    if (!this._pausedState) {
      return;
    }

    this.protestorManager.resume();


    this.visualEffectsManager.resume();


    // Restore disappear timeouts
    Object.keys(this._pausedState.disappearTimeouts).forEach((countryId) => {
      const timeout = this._pausedState.disappearTimeouts[countryId];
      if (timeout) {
        this.countries[countryId].disappearTimeout = setTimeout(() => {
          this._shrinkAndHideProtestors(countryId);
        }, timeout - (Date.now() - timeout.startTime));
      }
    });


    // Clear the paused state
    this._pausedState = null;
  }

  /**
   * Reset the freedom manager
   */
  reset() {
    // Clear all timers
 
    this.protestorManager.reset();

    this.logger.info("freedom", "Resetting Freedom Manager");

    // Stop ALL animations first
    this.cleanupAllEffects();

   
    // Re-initialize protestor hitbox manager
    this._initProtestorHitboxManager();

    // Reset ALL country states
    Object.keys(this.countries).forEach((countryId) => {
      // Full country state reset
      this.countries[countryId] = {
        id: countryId,
        annexTime: 0,
      };

      // Reset visual state of country overlay
      const flagOverlay = this._getElement(`${countryId}-flag-overlay`, "reset");
      if (flagOverlay) {
        flagOverlay.classList.remove("opacity-33", "opacity-66", "opacity-100", "resistance-possible", "targeting-pulse");
        flagOverlay.style.opacity = "";
      }
    });

    // Reset trump size
    this.trumpShrinkLevel = 0;
    this.resetTrumpSize();
  }

  /**
   * Handle grab success
   */
  handleGrabSuccess() {
    // FIRST: Clean up protestors if this is a game-ending grab
    const isGameEnding = this._checkGameOverCondition();
    if (isGameEnding) {
      this.protestorManager.cleanupAllProtestors();
    }

    // THEN: Unhighlight the country
    if (this.state && this.state.targetCountry) {
      this.highlightTargetCountry(this.state.targetCountry, false);
    }

    // Set to not grabbing
    if (typeof this.setNotGrabbingState === "function") {
      this.setNotGrabbingState();
    }

    // Apply success effect only if game isn't ending
    if (!isGameEnding && typeof this.applyGrabSuccessEffect === "function") {
      this.applyGrabSuccessEffect(targetCountry);
    }

    this.logger.debug("freedom", "Handled grab success");
  }


  destroy() {


    // Stop all sounds first
    if (this.audioManager) {
      this.audioManager.stopAll();
    }

    // Clean up all effects and protestors
    this.cleanupAllEffects();


    this.protestorManager.destroy();


    // // Explicitly destroy protestor hitbox manager
    // if (this.protestorHitboxManager) {
    //   this.protestorHitboxManager.destroy();
    // }

    // Reset internal state for all countries
    Object.keys(this.countries).forEach((countryId) => {
      const country = this.countries[countryId];
      country.annexTime = 0;
      country.clickCounter = 0;
    });

    

    // Clear references to other systems
    // this.animationManager = null;
    // this.protestorHitboxManager = null;
  }

  // ===== DEBUG METHODS =====


  /**
   * Debug method to set country claims
   * @param {string} countryId - Country identifier
   * @param {number} claimLevel - Number of claims to set
   * @returns {boolean} - Success status
   */
  setCountryClaims(countryId, claimLevel) {
    const gameCountry = this.gameState.countries[countryId];
    if (!gameCountry) {
      this.logger.error("freedom", `Country ${countryId} not found in gameState`);
      return false;
    }

    // Set the claim level (between 0 and maxClaims)
    const maxClaims = gameCountry.maxClaims;
    const newClaims = Math.max(0, Math.min(claimLevel, maxClaims));

    gameCountry.claims = newClaims;
    this.updateFlagOpacity(countryId);

    return true;
  }

  /**
   * Debug method to annex a country
   * @param {string} countryId - Country identifier
   * @returns {boolean} - Success status
   */
  annexCountry(countryId) {
    const gameCountry = this.gameState.countries[countryId];
    if (!gameCountry) {
      this.logger.error("freedom", `Country ${countryId} not found in gameState`);
      return false;
    }

    // Set claims to max
    gameCountry.claims = gameCountry.maxClaims;

    // Update the flag overlay
    this.updateFlagOpacity(countryId);

    return true;
  }
}


window.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("record")) {
    // Hide intro screen
    document.getElementById("intro-screen").classList.add("hidden");

    // Directly show game over screen without animations
    if (window.gameEngine) {
      // Skip animations and flash effects
      window.gameEngine.systems.state.gameEnding = true;
      window.gameEngine.systems.state.isPlaying = false;

      // Show game over screen directly
      window.gameEngine.systems.ui.showGameOverScreen(true, window.gameEngine.systems.state);

      // Show recorder after a slight delay
      setTimeout(() => {
        openVoiceRecordingInterface();
      }, 500);
    } else {
      // If game engine isn't ready yet, wait a short moment
      setTimeout(() => {
        window.gameEngine.systems.state.gameEnding = true;
        window.gameEngine.systems.state.isPlaying = false;
        window.gameEngine.systems.ui.showGameOverScreen(true, window.gameEngine.systems.state);
        setTimeout(() => {
          openVoiceRecordingInterface();
        }, 500);
      }, 100);
    }
  }
});

document.addEventListener("click", function (event) {
  const trumpHandHitbox = document.getElementById("trump-hand-hitbox");
  const trumpHandVisual = document.getElementById("trump-hand-visual");
  const protestorHitboxes = document.querySelectorAll('[id$="-protestor-hitbox"]');

  // Check if click is within Trump's hand hitbox
  const isClickInTrumpHitbox = trumpHandHitbox
    ? event.clientX >= trumpHandHitbox.getBoundingClientRect().left &&
      event.clientX <= trumpHandHitbox.getBoundingClientRect().right &&
      event.clientY >= trumpHandHitbox.getBoundingClientRect().top &&
      event.clientY <= trumpHandHitbox.getBoundingClientRect().bottom
    : false;

  // Check if click is within any protestor hitboxes
  const protestorHitboxIntersections = Array.from(protestorHitboxes).map((hitbox) => {
    const rect = hitbox.getBoundingClientRect();
    const isIntersecting = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;

    return {
      id: hitbox.id,
      isIntersecting,
      rect,
    };
  });

  console.log("bbb 🤚 Comprehensive Click Debug:", {
    clickCoordinates: {
      x: event.clientX,
      y: event.clientY,
    },
    clickedElement: {
      tagName: event.target.tagName,
      id: event.target.id,
      className: event.target.className,
    },
    trumpHandHitbox: trumpHandHitbox
      ? {
          exists: true,
          rect: trumpHandHitbox.getBoundingClientRect(),
          style: {
            display: trumpHandHitbox.style.display,
            visibility: trumpHandHitbox.style.visibility,
            opacity: trumpHandHitbox.style.opacity,
            pointerEvents: trumpHandHitbox.style.pointerEvents,
            zIndex: trumpHandHitbox.style.zIndex,
          },
          isClickWithin: isClickInTrumpHitbox,
        }
      : { exists: false },
    protestorHitboxes: {
      count: protestorHitboxes.length,
      intersections: protestorHitboxIntersections,
    },
    handHitboxManager: window.handHitboxManager
      ? {
          isVisible: window.handHitboxManager.isVisible,
          currentState: window.handHitboxManager.currentState,
          currentFrame: window.handHitboxManager.currentFrame,
        }
      : "No HandHitboxManager",
    gameState: window.gameEngine
      ? {
          isPlaying: window.gameEngine.systems.state.isPlaying,
          isPaused: window.gameEngine.systems.state.isPaused,
          currentTarget: window.gameEngine.systems.state.currentTarget,
        }
      : "Game engine not available",
  });
});



document.addEventListener('click', function(event) {
  // Get the map element
  const mapElement = document.getElementById('map-background');
  if (!mapElement) return;
  
  // Get the game container
  const gameContainer = document.getElementById('game-container');
  if (!gameContainer) return;
  
  // Get container positions
  const mapRect = mapElement.getBoundingClientRect();
  const containerRect = gameContainer.getBoundingClientRect();
  
  // Get the current map scale
  const currentMapScale = mapRect.width / mapElement.naturalWidth;
  
  // Calculate click position relative to the container
  const clickX = event.clientX - containerRect.left;
  const clickY = event.clientY - containerRect.top;
  
  // Convert to "natural" coordinates by dividing by the current scale
  const naturalX = Math.round((clickX - (mapRect.left - containerRect.left)) / currentMapScale);
  const naturalY = Math.round((clickY - (mapRect.top - containerRect.top)) / currentMapScale);
  
  // Log with the POSPOS prefix
  console.log(`POSPOS x: ${naturalX} y: ${naturalY}`);
});