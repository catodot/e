
class DebugManager {
  /**
   * Create a new DebugManager instance
   * @param {Object} gameElements - UI element references
   * @param {Object} gameState - Game state reference
   * @param {Object} animationManager - Animation manager reference
   */
  constructor(gameElements, gameState, animationManager) {
    this.enabled = true;
    this.elements = gameElements || {};
    this.gameState = gameState || {};
    this.animationManager = animationManager;

    // Reference to other game managers
    this.audioManager = null;
    this.freedomManager = null;
    this.handHitboxManager = null;
    this.protestorHitboxManager = null;
    this.UFOManager = null;
    this.speedManager = null;

    // Debug panel elements
    this.panel = null;
    this.sections = {};
    this.controls = {};

    // Track open/closed state of collapsible sections
    this.sectionStates = {};

    // Animation tracking and states
    this.animInfoInterval = null;
    this.resistanceStatusInterval = null;

    // Calibration state
    this.calibration = {
      isCalibrating: false,
      originalAnimState: null,
      currentAnimation: null,
      frameCoordinates: [],
      wasPlaying: false,
      wasPaused: false,
      originalHandlerClick: null,
      originalHandlerTouch: null,
      originalContainerClick: null,
    };

    // Protestor calibration state
    this.protestorCalibration = {
      isCalibrating: false,
      country: null,
      wasPlaying: false,
      wasPaused: false,
      originalCoordinates: null,
      locationIndex: 0,
      totalLocations: 3,
    };

    // Bind methods for event handling
    this._bindMethods();

    // console.log("[Debug] Debug Manager created");
  }

  /**
   * Bind class methods to maintain 'this' context
   * @private
   */
  _bindMethods() {
    this.togglePanel = this.togglePanel.bind(this);
    this.toggleSectionVisibility = this.toggleSectionVisibility.bind(this);
    this.updateAnimationInfo = this.updateAnimationInfo.bind(this);
    this.updateResistanceStatus = this.updateResistanceStatus.bind(this);
    this.setupKeyBindings = this.setupKeyBindings.bind(this);
  }

  /**
   * Initialize the debug manager and create the debug panel
   */
  init() {
    if (!this.enabled) return;

    // console.log("[Debug] Initializing debug tools");

    // Find or create the debug panel
    this.createDebugPanel();

    // Add toggle button to show/hide debug panel
    this.createToggleButton();

    // Set up all sections
    this.setupGameControlsSection();
    this.setupAnimationControlsSection();
    this.setupHitboxControlsSection();
    this.setupAudioControlsSection();
    this.setupResistanceControlsSection();
    // this.setupProtestorControlsSection();
    this.setupUfoControlsSection();
    this.setupPerformanceControlsSection();

    // Initialize panel state
    this.panel.classList.toggle("hidden", localStorage.getItem("debugPanelVisible") !== "true");

    // Restore section visibility states from localStorage
    this.restoreSectionStates();

    // Set up key bindings for quick debug actions
    this.setupKeyBindings();

    // Connect to other managers if they exist
    this.connectManagers();

    // Start status updates
    this.startStatusUpdates();

    // console.log("[Debug] Debug panel initialized");

    return this;
  }

  /**
   * Create the main debug panel
   */
  createDebugPanel() {
    // Look for existing panel first
    this.panel = document.getElementById("debug-panel");

    // Create new panel if it doesn't exist
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.id = "debug-panel";
      this.panel.className = "dbg-panel";
      document.body.appendChild(this.panel);
    } else {
    }

    // Add panel title
    const title = document.createElement("div");
    title.className = "dbg-panel-title";
    title.innerHTML = "<span>DEBUG TOOLS</span>";
    this.panel.appendChild(title);

    // Add close button
    const closeButton = document.createElement("button");
    closeButton.className = "dbg-close-button";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => this.togglePanel(false));
    title.appendChild(closeButton);
  }
  createToggleButton() {
    let toggleBtn = document.getElementById("debug-toggle");

    // Create if it doesn't exist
    if (!toggleBtn) {
      toggleBtn = document.createElement("div");
      toggleBtn.id = "debug-toggle";
      toggleBtn.className = "dbg-toggle";
      toggleBtn.textContent = "D";
      toggleBtn.title = "Toggle Debug Panel";
      document.body.appendChild(toggleBtn);
    }

    // Update toggle button appearance based on panel visibility
    const isVisible = localStorage.getItem("debugPanelVisible") === "true";
    toggleBtn.classList.toggle("dbg-toggle-active", isVisible);

    // Remove any existing click handlers first
    const oldButton = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(oldButton, toggleBtn);

    // Add click handler
    oldButton.addEventListener("click", (e) => {
      // console.log("[Debug] Toggle button clicked");
      this.togglePanel();
    });
}

togglePanel(forceState) {
  // Check current state
  const isHidden = this.panel.classList.contains("hidden");
  
  // Flip the state unless forceState is provided
  const shouldShow = (forceState !== undefined) ? forceState : isHidden;
  
  // Apply change directly
  this.panel.classList.toggle("hidden", !shouldShow);
  
  // Update button
  const toggleBtn = document.getElementById("debug-toggle");
  if (toggleBtn) {
    toggleBtn.classList.toggle("dbg-toggle-active", shouldShow);
  }
  
  // Save state
  localStorage.setItem("debugPanelVisible", shouldShow);
  
  // Update statuses
  if (shouldShow) {
    this.startStatusUpdates();
  } else {
    this.stopStatusUpdates();
  }
}

  /**
   * Create a collapsible section in the debug panel
   * @param {string} id - Section ID
   * @param {string} title - Section title
   * @param {boolean} fullWidth - Whether the content should be full width
   * @returns {Object} Object containing section elements
   */
  createSection(id, title, fullWidth = false) {
    const section = document.createElement("div");
    section.id = `debug-section-${id}`;
    section.className = "dbg-section";

    const header = document.createElement("div");
    header.className = "dbg-section-header";
    header.innerHTML = `<span>${title}</span><span class="toggle-icon">▼</span>`;
    header.addEventListener("click", () => this.toggleSectionVisibility(id));

    const content = document.createElement("div");
    content.id = `debug-section-content-${id}`;
    content.className = fullWidth ? "dbg-section-content full-width" : "dbg-section-content";

    // Check if section should start hidden
    if (this.sectionStates[id] === false) {
      content.classList.add("hidden");
      header.querySelector(".toggle-icon").textContent = "►";
    }

    section.appendChild(header);
    section.appendChild(content);
    this.panel.appendChild(section);

    this.sections[id] = {
      section,
      header,
      content,
    };

    return this.sections[id];
  }

  /**
   * Toggle section visibility
   * @param {string} id - Section ID
   */
  toggleSectionVisibility(id) {
    const section = this.sections[id];
    if (!section) return;

    const content = section.content;
    const icon = section.header.querySelector(".toggle-icon");

    const isHidden = content.classList.toggle("hidden");
    icon.textContent = isHidden ? "►" : "▼";

    // Save state to localStorage
    this.sectionStates[id] = !isHidden;
    this.saveSectionStates();
  }

  /**
   * Save section visibility states to localStorage
   */
  saveSectionStates() {
    localStorage.setItem("debugSectionStates", JSON.stringify(this.sectionStates));
  }

  /**
   * Restore section visibility states from localStorage
   */
  restoreSectionStates() {
    try {
      const savedStates = localStorage.getItem("debugSectionStates");
      if (savedStates) {
        this.sectionStates = JSON.parse(savedStates);
      }
    } catch (e) {
      console.error("Error restoring debug section states:", e);
      this.sectionStates = {};
    }
  }

  /**
   * Create a button element
   * @param {string} text - Button text
   * @param {Function} clickHandler - Click handler function
   * @param {Object} options - Button options
   * @returns {HTMLButtonElement} The created button
   */
  createButton(text, clickHandler, options = {}) {
    const button = document.createElement("button");
    button.textContent = text;
    button.className = options.className || "dbg-button";

    if (options.fullWidth) {
      button.classList.add("full-width");
    }

    if (options.small) {
      button.classList.add("small");
    }

    button.addEventListener("click", (e) => {
      if (clickHandler) {
        clickHandler(e);
      }

      if (options.showEffect) {
        this.showButtonEffect(button);
      }
    });

    if (options.tooltip) {
      button.title = options.tooltip;
    }

    return button;
  }

  /**
   * Show a button click effect
   * @param {HTMLButtonElement} button - The button element
   */
  showButtonEffect(button) {
    button.classList.add("button-active");
    setTimeout(() => {
      button.classList.remove("button-active");
    }, 300);
  }

  /**
   * Create a status display element
   * @param {string} id - Status element ID
   * @param {string} defaultText - Default text
   * @returns {HTMLDivElement} The created status element
   */
  createStatus(id, defaultText) {
    const status = document.createElement("div");
    status.id = id;
    status.className = "dbg-status";
    status.textContent = defaultText || "Status information will appear here";
    return status;
  }

  /**
   * Connect to other game managers
   */
  connectManagers() {
    // Find audio manager
    this.audioManager = window.audioManager || (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.audio);

    // Find freedom manager
    this.freedomManager = window.freedomManager || (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.freedom);

    // Find hitbox managers
    this.handHitboxManager = window.handHitboxManager || (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.collision);

    this.protestorHitboxManager =
      window.protestorHitboxManager || (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.protestorHitbox);

    // Find UFO manager
    this.UFOManager = window.UFOManager || (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.ufo);

    // Find speed manager
    this.speedManager = window.speedManager || (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.speed);

    // console.log("[Debug] Connected managers:", {
    //   audioManager: !!this.audioManager,
    //   freedomManager: !!this.freedomManager,
    //   handHitboxManager: !!this.handHitboxManager,
    //   protestorHitboxManager: !!this.protestorHitboxManager,
    //   UFOManager: !!this.UFOManager,
    //   speedManager: !!this.speedManager,
    // });
  }
  setupKeyBindings() {
    // Remove existing listener if it exists
    if (this._keydownHandler) {
      document.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null; // Clear the reference
    }
    
    // Create a new bound handler
    this._keydownHandler = (e) => {
      // console.log("[Debug] Keydown event:", e.key, e.ctrlKey, e.metaKey);
      
      // Special handling for debug panel
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        // console.log("[Debug] D key pressed, toggling panel");
        this.togglePanel();
        return;
      }
  
      if (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._togglePause();
        return;
      }
  
      // Only activate other shortcuts when debug panel is NOT hidden
      if (this.panel.classList.contains('hidden')) return;
      
      // Avoid capturing when user is typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Debug key bindings
      switch (e.key.toLowerCase()) {
        case 'a':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.toggleHitboxVisibility();
          }
          break;
        case 's':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this._startCalibration();
          }
          break;
        case 'h':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this._testAnimationSequence();
          }
          break;
      }
    };
  
    // Add new listener
    document.addEventListener('keydown', this._keydownHandler);
  

}

  /**
   * Start status update timers
   */
  startStatusUpdates() {
    // Animation info updates
    if (!this.animInfoInterval) {
      this.animInfoInterval = setInterval(() => {
        this.updateAnimationInfo();
      }, 200);
    }

    // Resistance status updates
    if (!this.resistanceStatusInterval && this.freedomManager) {
      this.resistanceStatusInterval = setInterval(() => {
        this.updateResistanceStatus();
      }, 500);
    }

    
  }

  setupResistanceControlsSection() {
    const { content } = this.createSection("resistance", "Resistance & Protestor Controls");
  
    // Country selector
    const countrySelector = document.createElement("select");
    countrySelector.className = "dbg-select";
    countrySelector.style.marginRight = "5px";
    ["canada", "mexico", "greenland", "usa"].forEach((country) => {
      const option = document.createElement("option");
      option.value = country;
      option.textContent = country;
      countrySelector.appendChild(option);
    });
  
    const selectorWrapper = document.createElement("div");
    selectorWrapper.className = "dbg-group";
    selectorWrapper.innerHTML = `<div class="dbg-label">Country: </div>`;
    selectorWrapper.appendChild(countrySelector);
    content.appendChild(selectorWrapper);
  
    // Flag controls
    const flagControls = document.createElement("div");
    flagControls.className = "dbg-group";
  
    const claimsControls = document.createElement("div");
    claimsControls.style.display = "flex";
    claimsControls.style.flexWrap = "wrap";
    claimsControls.style.gap = "5px";
    claimsControls.style.marginTop = "5px";
  
    // Claims buttons (0-3)
    [0, 1, 2, 3].forEach((claims) => {
      const btn = this.createButton(
        `Set ${claims}/3`,
        () => {
          const country = countrySelector.value;
          if (window.freedomManager) {
            window.freedomManager.setCountryClaims(country, claims);
          }
        },
        { small: true }
      );
      claimsControls.appendChild(btn);
    });
  
    flagControls.appendChild(claimsControls);
    content.appendChild(flagControls);
  
    // Protestor controls
    const protestorControls = document.createElement("div");
    protestorControls.className = "dbg-group";
  
    // Show/Hide controls
    const visibilityControls = document.createElement("div");
    visibilityControls.style.display = "flex";
    visibilityControls.style.gap = "5px";
    visibilityControls.style.marginBottom = "10px";
  
    const showProtestorsBtn = this.createButton(
      "Show Protestors",
      () => {
        const country = countrySelector.value;
        if (window.freedomManager) {
          window.freedomManager.showProtestors(country);
        }
      },
      { small: true }
    );
  
    const hideProtestorsBtn = this.createButton(
      "Hide Protestors",
      () => {
        const country = countrySelector.value;
        if (window.freedomManager) {
          window.freedomManager.hideProtestors(country);
        }
      },
      { small: true }
    );
  
    visibilityControls.appendChild(showProtestorsBtn);
    visibilityControls.appendChild(hideProtestorsBtn);
    protestorControls.appendChild(visibilityControls);
  
    // Action controls
    const actionControls = document.createElement("div");
    actionControls.style.display = "flex";
    actionControls.style.flexWrap = "wrap";
    actionControls.style.gap = "5px";
  
    const triggerResistanceBtn = this.createButton(
      "Trigger Resistance",
      () => {
        const country = countrySelector.value;
        if (window.freedomManager) {
          window.freedomManager.triggerCountryResistance(country);
        }
      },
      { small: true }
    );
  
    const cleanupAllBtn = this.createButton(
      "Cleanup All",
      () => {
        if (window.freedomManager) {
          window.freedomManager.cleanupAllProtestors();
        }
      },
      { small: true }
    );
  
    // Size controls
    const sizeControls = document.createElement("div");
    sizeControls.style.display = "flex";
    sizeControls.style.gap = "5px";
    sizeControls.style.marginTop = "5px";
  
    const scaleUpBtn = this.createButton(
      "Scale Up",
      () => {
        const country = countrySelector.value;
        if (window.protestorHitboxManager) {
          window.protestorHitboxManager.updateSize(country, 1.2);
        }
      },
      { small: true }
    );
    
    const resetSizeBtn = this.createButton(
      "Reset Size",
      () => {
        const country = countrySelector.value;
        if (window.protestorHitboxManager) {
          window.protestorHitboxManager.updateSize(country, 1.0);
        }
      },
      { small: true }
    );
  
    actionControls.appendChild(triggerResistanceBtn);
    actionControls.appendChild(cleanupAllBtn);
    sizeControls.appendChild(scaleUpBtn);
    sizeControls.appendChild(resetSizeBtn);
  
    protestorControls.appendChild(actionControls);
    protestorControls.appendChild(sizeControls);
    content.appendChild(protestorControls);
  
    // Status display
    const resistanceStatus = this.createStatus("resistance-status", "Resistance & protestor status");
    content.appendChild(resistanceStatus);
  
    // Update status periodically
    setInterval(() => this.updateResistanceStatus(), 500);
  }
  
  // Update the status display method
  updateResistanceStatus() {
    if (!window.freedomManager) return;
  
    const statusElement = document.getElementById("resistance-status");
    if (!statusElement) return;
  
    try {
      let statusHTML = "";
  
      // For each country, show resistance status
      Object.keys(window.freedomManager.countries).forEach((country) => {
        const countryData = window.freedomManager.countries[country];
        const gameCountry = this.gameState?.countries?.[country];
  
        statusHTML += `
          <div style="margin-bottom: 5px;">
            <strong>${country}:</strong> 
            ${gameCountry ? `${gameCountry.claims}/${gameCountry.maxClaims} claims` : "Unknown"} |
            Protestors: ${countryData.protestorsShown ? "Shown" : "Hidden"} |
            Click Count: ${countryData.clickCounter || 0}
          </div>
        `;
      });
  
      statusElement.innerHTML = statusHTML;
    } catch (e) {
      statusElement.textContent = "Error updating resistance status: " + e.message;
    }
  }

  /**
   * Stop status update timers
   */
  stopStatusUpdates() {
    if (this.animInfoInterval) {
      clearInterval(this.animInfoInterval);
      this.animInfoInterval = null;
    }

    if (this.resistanceStatusInterval) {
      clearInterval(this.resistanceStatusInterval);
      this.resistanceStatusInterval = null;
    }
  }

  setupGameControlsSection() {
    const { content } = this.createSection("game", "Game Controls");
  
    // Time control
    const timeControls = document.createElement("div");
    timeControls.className = "dbg-group";
    timeControls.innerHTML = `
      <div class="dbg-label">
        Time:
        <input type="number" id="debug-time-input" class="dbg-input" min="1" max="180" value="${this.gameState?.timeRemaining || 60}">
        sec
      </div>
    `;
  
    const timeButtons = document.createElement("div");
    timeButtons.style.display = "flex";
    timeButtons.style.gap = "5px";
    timeButtons.style.marginTop = "5px";
  
    // Create set time button
    const setTimeBtn = this.createButton(
      "Set Time",
      () => {
        const newTime = parseInt(document.getElementById("debug-time-input").value);
        if (newTime && newTime > 0 && this.gameState) {
          this.gameState.timeRemaining = newTime;
          this._updateGameUI();
        }
      },
      { showEffect: true, small: true }
    );
    timeButtons.appendChild(setTimeBtn);
  
    // Add time buttons
    [30, 60, 120, 168].forEach((seconds) => {
      const btn = this.createButton(
        `${seconds}s`,
        () => {
          if (this.gameState) {
            this.gameState.timeRemaining = seconds;
            document.getElementById("debug-time-input").value = seconds;
            this._updateGameUI();
          }
        },
        { small: true }
      );
      timeButtons.appendChild(btn);
    });
  
    timeControls.appendChild(timeButtons);
    content.appendChild(timeControls);
  
    // Score controls 
    const scoreControls = document.createElement("div");
    scoreControls.className = "dbg-group";
    scoreControls.innerHTML = `
      <div class="dbg-label">
        Score:
        <input type="number" id="debug-score-input" class="dbg-input" min="0" max="9999" value="${this.gameState?.score || 0}">
      </div>
    `;
  
    const setScoreBtn = this.createButton(
      "Set Score",
      () => {
        const newScore = parseInt(document.getElementById("debug-score-input").value);
        if (newScore >= 0 && this.gameState) {
          this.gameState.score = newScore;
          this._updateGameUI();
        }
      },
      { showEffect: true }
    );
    scoreControls.appendChild(setScoreBtn);
    content.appendChild(scoreControls);
  
    // Game flow controls with game end states
    const flowControls = document.createElement("div");
    flowControls.className = "dbg-group";
  
    const startBtn = this.createButton("Start Game", () => {
      if (window.gameEngine?.startGame) {
        window.gameEngine.startGame();
      }
    });
  
    const pauseBtn = this.createButton("Toggle Pause", () => {
      if (window.gameEngine?.togglePause) {
        window.gameEngine.togglePause();
      }
    });
  
    const gameOverBtns = document.createElement("div");
    gameOverBtns.style.display = "flex";
    gameOverBtns.style.gap = "5px";
    gameOverBtns.style.marginTop = "5px";
    gameOverBtns.style.flexWrap = "wrap";
  
    // Updated end game buttons to match new states
    const endStates = {
      "Trump Victory": "trump_victory",
      "Resistance Win": "resistance_win",
      "Trump Destroyed": "trump_destroyed"
    };
  
    Object.entries(endStates).forEach(([label, state]) => {
      const btn = this.createButton(
        label,
        () => {
          if (window.gameEngine?.triggerGameEnd) {
            window.gameEngine.triggerGameEnd(state);
          }
        },
        { className: "dbg-button small" }
      );
      gameOverBtns.appendChild(btn);
    });
  
    const restartBtn = this.createButton("Restart Game", () => {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('record')) {
        // Load the base game without any parameters
        window.location.href = window.location.pathname;
        // window.location.href = window.location.origin + window.location.pathname;

      } else {
        // Normal restart
        if (window.gameEngine?.restartGame) {
          window.gameEngine.restartGame();
        }
      }
    });
  
    flowControls.appendChild(startBtn);
    flowControls.appendChild(pauseBtn);
    flowControls.appendChild(gameOverBtns);
    flowControls.appendChild(restartBtn);
    content.appendChild(flowControls);
  
    // Game state display
    const stateStatus = this.createStatus("game-state-status", "Game state information");
    content.appendChild(stateStatus);
  
    // Schedule state updates
    setInterval(() => this._updateGameStateDisplay(), 500);
  }
  


  _updateGameStateDisplay() {
    if (!this.gameState) return;
  
    const status = document.getElementById("game-state-status");
    if (!status) return;
  
    const speed = window.speedManager ? window.speedManager.getCurrentSpeed() : { multiplier: 1, name: "Normal" };
  
    status.innerHTML = `
      <div>Playing: ${this.gameState.isPlaying ? "Yes" : "No"}</div>
      <div>Paused: ${this.gameState.isPaused ? "Yes" : "No"}</div>
      <div>Time: ${this.gameState.timeRemaining}s</div>
      <div>Score: ${this.gameState.score}</div>
      <div>Speed: ${speed.multiplier.toFixed(1)}x (${speed.name})</div>
      <div>Tutorial Complete: ${window.speedManager?.state?.tutorialCompleted ? "Yes" : "No"}</div>
      <div>Blocks: ${this.gameState.stats?.successfulBlocks || 0}</div>
      <div>Consecutive Hits: ${this.gameState.consecutiveHits || 0}</div>
      ${this.gameState.gameEnding ? '<div style="color: #f55;">Game Ending: ' + this.gameState.endReason + '</div>' : ''}
    `;
  }


  /**
   * Update game UI
   * @private
   */
  _updateGameUI() {
    // Try different methods to update UI
    if (typeof window.updateHUD === "function") {
      window.updateHUD();
    } else if (window.gameEngine && window.gameEngine.systems && window.gameEngine.systems.ui) {
      window.gameEngine.systems.ui.updateHUD(this.gameState);
      window.gameEngine.systems.ui.updateProgressBar(this.gameState.timeRemaining, this.gameState.config?.GAME_DURATION || 168);
    }
  }

  /**
   * Toggle game pause state
   * @private
   */
  _togglePause() {
    if (window.gameEngine && window.gameEngine.togglePause) {
      window.gameEngine.togglePause();
    } else if (this.gameState) {
      this.gameState.isPaused = !this.gameState.isPaused;

      // Update UI pause button if it exists
      const pauseButton = document.getElementById("pause-button");
      if (pauseButton) {
        pauseButton.setAttribute("aria-pressed", this.gameState.isPaused ? "true" : "false");
      }
    }
  }



  setupAnimationControlsSection() {
    const { content } = this.createSection("animations", "Animation Controls");
  
    // Get available animations
    let animationStates = [];
    if (this.animationManager && this.animationManager.animations) {
      animationStates = Object.keys(this.animationManager.animations);
    }
  
    // Create animation selector
    const animSelector = document.createElement("select");
    animSelector.id = "debug-anim-select";
    animSelector.className = "dbg-select";
  
    animationStates.forEach((state) => {
      const option = document.createElement("option");
      option.value = state;
      option.textContent = state;
      animSelector.appendChild(option);
    });
  
    const animControls = document.createElement("div");
    animControls.className = "dbg-group";
    animControls.innerHTML = `<div class="dbg-label">Animation: </div>`;
    animControls.appendChild(animSelector);
    content.appendChild(animControls);
  
    // Animation playback controls
    const playbackControls = document.createElement("div");
    playbackControls.className = "dbg-group controls-margin-bottom";
  
    const playBtn = this.createButton("Play", () => {
      if (this.animationManager) {
        const selectedAnim = animSelector.value;
        this.animationManager.changeState(selectedAnim);
      }
    });
  
    const stopBtn = this.createButton("Stop", () => {
      if (this.animationManager) {
        this.animationManager.stop();
        this.animationManager.changeState("idle");
      }
    });
  
    const pauseBtn = this.createButton("Pause/Resume", () => {
      if (this.animationManager) {
        if (this.animationManager.isPaused) {
          this.animationManager.resume();
        } else {
          this.animationManager.pause();
        }
      }
    });
  
    // Frame controls
    const frameControls = document.createElement("div");
    frameControls.style.display = "flex";
    frameControls.style.gap = "5px";
    frameControls.style.marginTop = "5px";
  
    const prevFrameBtn = this.createButton(
      "◀",
      () => {
        if (this.animationManager) {
          const currentFrame = this.animationManager.currentFrame || 0;
          this.animationManager.setFrame(Math.max(0, currentFrame - 1));
        }
      },
      { small: true }
    );
  
    const frameInput = document.createElement("input");
    frameInput.type = "number";
    frameInput.id = "debug-frame-input";
    frameInput.className = "dbg-input";
    frameInput.min = 0;
    frameInput.max = 10;
    frameInput.value = this.animationManager?.currentFrame || 0;
    frameInput.style.width = "40px";
  
    const setFrameBtn = this.createButton(
      "Set",
      () => {
        if (this.animationManager) {
          const frame = parseInt(frameInput.value);
          this.animationManager.setFrame(frame);
        }
      },
      { small: true }
    );
  
    const nextFrameBtn = this.createButton(
      "▶",
      () => {
        if (this.animationManager) {
          const currentFrame = this.animationManager.currentFrame || 0;
          const currentAnim = this.animationManager.animations[this.animationManager.currentState];
          const maxFrame = currentAnim ? currentAnim.frameCount - 1 : 0;
          this.animationManager.setFrame(Math.min(maxFrame, currentFrame + 1));
        }
      },
      { small: true }
    );
  
    frameControls.appendChild(prevFrameBtn);
    frameControls.appendChild(frameInput);
    frameControls.appendChild(setFrameBtn);
    frameControls.appendChild(nextFrameBtn);
  
    playbackControls.appendChild(playBtn);
    playbackControls.appendChild(stopBtn);
    playbackControls.appendChild(pauseBtn);
    playbackControls.appendChild(frameControls);
    content.appendChild(playbackControls);
  
  
    // Test sequences
    const sequenceControls = document.createElement("div");
    sequenceControls.className = "dbg-group";
  
    const testGrabBtn = this.createButton("Test Grab Sequence", () => {
      if (window.gameEngine && window.gameEngine.initiateGrab) {
        window.gameEngine.initiateGrab();
      }
    });
  
    const testBlockBtn = this.createButton(
      "Test Block Sequence",
      () => {
        this._testAnimationSequence();
      },
      { tooltip: "Test the block animation sequence (Ctrl+H)" }
    );
  
    // Add test for 'victory' animation
    const testVictoryBtn = this.createButton("Test Victory Animation", () => {
      if (this.animationManager) {
        this.animationManager.changeState("victory", () => {
          // Return to idle after animation completes
          this.animationManager.changeState("idle");
        });
      }
    });
  
    sequenceControls.appendChild(testGrabBtn);
    sequenceControls.appendChild(testBlockBtn);
    sequenceControls.appendChild(testVictoryBtn);
    content.appendChild(sequenceControls);
  
    // Animation info display
    const animInfo = this.createStatus("anim-info-status", "Animation information will appear here");
    content.appendChild(animInfo);
  }

  /**
   * Update animation info display
   */
  updateAnimationInfo() {
    const infoElement = document.getElementById("anim-info-status");
    if (!infoElement || !this.animationManager) return;

    try {
      const currentAnim = this.animationManager.getCurrentAnimation();
      if (!currentAnim) return;

      const hitboxInfo = this.animationManager.getHitboxInfo() || {};

      infoElement.innerHTML = `
          <div>State: ${currentAnim.name}</div>
          <div>Frame: ${currentAnim.frame}/${(currentAnim.data?.frameCount || 1) - 1}</div>
          ${
            currentAnim.data?.handVisible
              ? `<div>Hitbox: ${hitboxInfo.visible ? "Visible" : "Hidden"}</div>
             <div>Hitbox Pos: (${hitboxInfo.x || 0}, ${hitboxInfo.y || 0})</div>
             <div>Size: ${hitboxInfo.width || 0}×${hitboxInfo.height || 0}</div>`
              : ""
          }
        `;
    } catch (e) {
      infoElement.textContent = "Error updating animation info: " + e.message;
    }
  }


  

  setupHitboxControlsSection() {
    const { content } = this.createSection("hitboxes", "Hitbox Controls");
  
    // Basic hitbox visibility toggle
    const visibilityControls = document.createElement("div");
    visibilityControls.className = "dbg-group";
  
    const toggleHitboxBtn = this.createButton(
      "Toggle Hitboxes",
      () => this.toggleHitboxVisibility(),
      { tooltip: "Toggle hitbox visibility (Ctrl+A)" }
    );
  
    visibilityControls.appendChild(toggleHitboxBtn);
    content.appendChild(visibilityControls);
  
    // Calibration controls
    const calibrationControls = document.createElement("div");
    calibrationControls.className = "dbg-group";
  
    // Animation selector for calibration
    const animSelect = document.createElement("select");
    animSelect.id = "calibration-anim-select";
    animSelect.className = "dbg-select";
  
    // Start with basic grab animations
    const basicAnims = ["grabEastCanada", "grabWestCanada", "grabMexico", "grabGreenland"];
    basicAnims.forEach(anim => {
      const option = document.createElement("option");
      option.value = anim;
      option.textContent = anim;
      animSelect.appendChild(option);
    });
  
    const startCalibrationBtn = this.createButton(
      "Start Calibration",
      () => {
        const selectedAnim = animSelect.value;
        this.startCalibration(selectedAnim);
      },
      { tooltip: "Start hitbox calibration (Ctrl+S)" }
    );
  
    calibrationControls.appendChild(document.createTextNode("Animation: "));
    calibrationControls.appendChild(animSelect);
    calibrationControls.appendChild(startCalibrationBtn);
    content.appendChild(calibrationControls);
  
    // Add calibration info display
    const calibrationStatus = this.createStatus(
      "calibration-status", 
      "Calibration status information"
    );
    content.appendChild(calibrationStatus);
  }
  
  toggleHitboxVisibility() {
    document.body.classList.toggle("debug-mode");
    const isDebugMode = document.body.classList.contains("debug-mode");
    
    // Update animation manager if available
    if (this.animationManager) {
      this.animationManager.setDebugMode?.(isDebugMode);
    }
    
    // For now, just create a red dot placeholder if in debug mode
    let hitboxDot = document.getElementById("debug-hitbox-dot");
    if (isDebugMode && !hitboxDot) {
      hitboxDot = document.createElement("div");
      hitboxDot.id = "debug-hitbox-dot";
      hitboxDot.style.cssText = `
        position: absolute;
        width: 10px;
        height: 10px;
        background: #ea1487;
        border-radius: 50%;
        pointer-events: none;
        display: none;
        z-index: 9999;
      `;
      document.body.appendChild(hitboxDot);
    } else if (!isDebugMode && hitboxDot) {
      hitboxDot.remove();
    }
  }
  
// Update the calibration panel creation to be floating instead of in the debug panel
// _createCalibrationPanel(animationName) {
//   // Remove existing panel if there is one
//   const existingPanel = document.getElementById("calibration-panel");
//   if (existingPanel) existingPanel.remove();

//   const panel = document.createElement("div");
//   panel.id = "calibration-panel";
//   panel.style.cssText = `
//     position: fixed;
//     top: 7rem;
//     right: 13rem;

//     background: rgba(0, 0, 0, 0.8);
//     color: white;
//     padding: 10px;
//     border-radius: 5px;
//     z-index: 50000;
//   `;

//   panel.innerHTML = `
//     <h4 style="margin: 0 0 10px 0">Calibrating: ${animationName}</h4>
//     <div style="margin-bottom: 10px">
//       Frame: <span id="current-frame">0</span>
//       <button id="prev-frame" style="margin: 0 5px">◀</button>
//       <button id="next-frame" style="margin: 0 5px">▶</button>
//     </div>
//     <div id="coords-display" style="margin-bottom: 10px">Click to place hitbox</div>
//     <div style="display: flex; gap: 5px;">
//       <button id="save-calib">Save</button>
//       <button id="cancel-calib">Cancel</button>
//     </div>
//   `;

//   document.body.appendChild(panel);

//   // Add event listeners
//   panel.querySelector("#prev-frame").addEventListener("click", () => {
//     console.log("Previous frame");
//   });

//   panel.querySelector("#next-frame").addEventListener("click", () => {
//     console.log("Next frame");
//   });

//   panel.querySelector("#save-calib").addEventListener("click", () => {
//     this.endCalibration(true);
//   });

//   panel.querySelector("#cancel-calib").addEventListener("click", () => {
//     this.endCalibration(false);
//   });
// }

// Update the hitbox dragging functionality to match the old code
// _makeHitboxDraggable() {
//   const hitbox = document.getElementById("calibration-hitbox");
//   const container = document.getElementById("trump-sprite-container");
//   if (!hitbox || !container) return;

//   let isDragging = false;
//   let offsetX = 0;
//   let offsetY = 0;

//   const onMouseDown = (e) => {
//     isDragging = true;
//     const hitboxRect = hitbox.getBoundingClientRect();
//     offsetX = e.clientX - hitboxRect.left;
//     offsetY = e.clientY - hitboxRect.top;
//     e.preventDefault();
//   };

//   const onMouseMove = (e) => {
//     if (!isDragging) return;

//     const containerRect = container.getBoundingClientRect();
//     const x = e.clientX - containerRect.left - offsetX;
//     const y = e.clientY - containerRect.top - offsetY;

//     hitbox.style.left = `${x}px`;
//     hitbox.style.top = `${y}px`;
//     hitbox.style.transform = 'none';

//     // Update coordinate display
//     const coordsDisplay = document.getElementById("coords-display");
//     if (coordsDisplay) {
//       coordsDisplay.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;
//     }

//     // Store coordinates for current frame
//     const currentFrame = parseInt(document.getElementById("current-frame").textContent);
//     this.calibration.frameCoordinates[currentFrame] = {
//       x: Math.round(x),
//       y: Math.round(y),
//       width: parseInt(hitbox.style.width) || 50,
//       height: parseInt(hitbox.style.height) || 50
//     };
//   };

//   const onMouseUp = () => {
//     isDragging = false;
//   };

//   // Add both mouse and touch events
//   hitbox.addEventListener('mousedown', onMouseDown);
//   document.addEventListener('mousemove', onMouseMove);
//   document.addEventListener('mouseup', onMouseUp);

//   // Touch events
//   hitbox.addEventListener('touchstart', (e) => {
//     const touch = e.touches[0];
//     onMouseDown(touch);
//   });

//   document.addEventListener('touchmove', (e) => {
//     const touch = e.touches[0];
//     onMouseMove(touch);
//   });

//   document.addEventListener('touchend', onMouseUp);
// }

// Update the calibration start to position elements correctly
startCalibration(animationName) {
  // Store current game state
  this.calibration = {
    isCalibrating: true,
    originalAnimState: this.animationManager?.currentState || null,
    currentAnimation: animationName,
    frameCoordinates: [],
    wasPlaying: this.gameState.isPlaying,
    wasPaused: this.gameState.isPaused
  };

  // Pause the game
  if (this.calibration.wasPlaying) {
    this.gameState.isPlaying = false;
    this.gameState.isPaused = true;
    clearTimeout(this.gameState.grabTimer);
    clearInterval(this.gameState.countdownTimer);
    
    if (this.animationManager) {
      this.animationManager.stop();
    }
  }

  // Create placeholders in the correct container
  const container = document.getElementById("trump-sprite-container");
  if (!container) {
    console.error("Could not find game container");
    return;
  }

  // Animation frame placeholder
  const placeholderBox = document.createElement("div");
  placeholderBox.id = "calibration-placeholder";
  placeholderBox.style.cssText = `
    position: absolute;
    width: 200px;
    height: 200px;
    background: rgba(0, 255, 0, 0.2);
    border: 2px solid green;
    z-index: 999;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  `;
  container.appendChild(placeholderBox);

  // Hitbox
  const hitboxPlaceholder = document.createElement("div");
  hitboxPlaceholder.id = "calibration-hitbox";
  hitboxPlaceholder.style.cssText = `
    position: absolute;
    width: 50px;
    height: 50px;
    background: rgba(255, 0, 0, 0.3);
    border: 2px solid red;
    cursor: move;
    z-index: 40000;
    left: 25%;
    top: 25%;
  `;
  container.appendChild(hitboxPlaceholder);

  // Show debug markers
  document.body.classList.add("debug-mode");
  
  // Create calibration panel
  this._createCalibrationPanel(animationName);

  // Make hitbox draggable
  this._makeHitboxDraggable();

  // Update animation preview
  if (this.animationManager) {
    const animation = this.animationManager.animations[animationName];
    if (animation) {
      this.animationManager.currentState = animationName;
      if (this.animationManager.trumpSprite) {
        this.animationManager.trumpSprite.style.backgroundImage = `url('${animation.spriteSheet}')`;
      }
    }
  }
}
  
  // _handleCalibrationClick(e) {
  //   if (!this.calibration?.isCalibrating) return;
  
  //   const dot = document.getElementById("debug-hitbox-dot");
  //   if (!dot) return;
  
  //   // Get click coordinates relative to the game container
  //   const container = document.getElementById("game-container") || document.body;
  //   const rect = container.getBoundingClientRect();
  //   const x = e.clientX - rect.left;
  //   const y = e.clientY - rect.top;
  
  //   // Update dot position
  //   dot.style.left = `${x}px`;
  //   dot.style.top = `${y}px`;
  //   dot.style.display = "block";
  
  //   // Update coordinates display
  //   const coordsDisplay = document.getElementById("coords-display");
  //   if (coordsDisplay) {
  //     coordsDisplay.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}`;
  //   }
  // }

 
  


  
  // endCalibration(save = false) {
  //   if (!this.calibration) return;
  
  //   // Remove calibration panel
  //   const panel = document.getElementById("calibration-panel");
  //   if (panel) panel.remove();
  
  //   // Remove placeholders
  //   const hitboxPlaceholder = document.getElementById("calibration-hitbox");
  //   if (hitboxPlaceholder) hitboxPlaceholder.remove();
  
  //   const animPlaceholder = document.getElementById("calibration-placeholder");
  //   if (animPlaceholder) animPlaceholder.remove();
  
  //   // Restore game state
  //   if (this.calibration.wasPlaying && !this.calibration.wasPaused) {
  //     this.gameState.isPlaying = true;
  //     this.gameState.isPaused = false;
  //     this.gameState.countdownTimer = setInterval(window.updateCountdown, 1000);
  //     window.scheduleNextGrab?.();
  
  //     // Restore animation state
  //     if (this.animationManager && this.calibration.originalAnimState) {
  //       this.animationManager.changeState(this.calibration.originalAnimState);
  //     }
  //   }
  
  //   // Update status
  //   const status = document.getElementById("calibration-status");
  //   if (status) {
  //     status.textContent = save ? 
  //       "Calibration saved!" : 
  //       "Calibration cancelled";
  //   }
  
  //   // Clean up calibration state
  //   this.calibration = null;
  
  //   // Remove body class if we're not in regular debug mode
  //   if (!this.enabled) {
  //     document.body.classList.remove("debug-mode");
  //   }
  // }


  /**
   * Test animation sequence
   * @private
   */
  _testAnimationSequence() {
    // First stop any existing animations
    if (this.animationManager) {
      this.animationManager.stop();
    }

    // Randomly select a country to smack
    const countries = ["eastCanada", "westCanada", "mexico", "greenland"];
    const country = countries[Math.floor(Math.random() * countries.length)];

    // Play smack animation using smackManager
    if (window.smackManager && typeof window.smackManager.playSmackAnimation === "function") {
      window.smackManager.playSmackAnimation(country, () => {
        // After smack completes, play slapped animation
        if (this.animationManager) {
          this.animationManager.changeState("slapped", () => {
            // Then go back to idle
            this.animationManager.changeState("idle");
          });
        }
      });
    } else if (this.animationManager) {
      // Fallback if no smack manager
      this.animationManager.changeState(`smack${country.charAt(0).toUpperCase() + country.slice(1)}`, () => {
        this.animationManager.changeState("slapped", () => {
          this.animationManager.changeState("idle");
        });
      });
    }
  }



  setupAudioControlsSection() {
    const { content } = this.createSection("audio", "Audio Controls");
  
    // Volume Controls
    const volumeControls = document.createElement("div");
    volumeControls.className = "dbg-group";
    volumeControls.innerHTML = `
      <div class="dbg-label">
        Volume:
        <input type="range" id="debug-volume-slider" min="0" max="1" step="0.1" value="${this.audioManager?.volume || 1}" style="width: 100px;">
        <span id="debug-volume-value">${this.audioManager?.volume || 1}</span>
      </div>
    `;
  
    const volumeSlider = volumeControls.querySelector("#debug-volume-slider");
    const volumeValue = volumeControls.querySelector("#debug-volume-value");
  
    volumeSlider.addEventListener("input", () => {
      const vol = parseFloat(volumeSlider.value);
      volumeValue.textContent = vol.toFixed(1);
  
      if (this.audioManager && typeof this.audioManager.setVolume === "function") {
        this.audioManager.setVolume(vol);
      }
    });
  
    const muteBtn = this.createButton("Toggle Mute", () => {
      if (this.audioManager && typeof this.audioManager.toggleMute === "function") {
        const isMuted = this.audioManager.toggleMute();
        muteBtn.textContent = isMuted ? "Unmute" : "Toggle Mute";
      }
    });
  
    volumeControls.appendChild(muteBtn);
    content.appendChild(volumeControls);
  
    // Audio Context Controls
    const contextControls = document.createElement("div");
    contextControls.className = "dbg-group";
  
    const resumeContextBtn = this.createButton("Resume Audio Context", () => {
      if (this.audioManager && typeof this.audioManager.resumeAudioContext === "function") {
        this.audioManager.resumeAudioContext();
      }
    });
  
    const unlockBtn = this.createButton("Unlock Audio", () => {
      if (this.audioManager && typeof this.audioManager.unlock === "function") {
        this.audioManager.unlock();
      }
    });
  
    const primePoolBtn = this.createButton("Prime Audio Pool", () => {
      if (this.audioManager && typeof this.audioManager.primeAudioPool === "function") {
        this.audioManager.primeAudioPool();
      }
    });
  
    contextControls.appendChild(resumeContextBtn);
    contextControls.appendChild(unlockBtn);
    contextControls.appendChild(primePoolBtn);
    content.appendChild(contextControls);
  
    // Music controls
    const musicControls = document.createElement("div");
    musicControls.className = "dbg-group";
  
    const musicTitle = document.createElement("div");
    musicTitle.textContent = "Background Music:";
    musicTitle.style.marginBottom = "5px";
  
    const startMusicBtn = this.createButton("Start Music", () => {
      if (this.audioManager && typeof this.audioManager.startBackgroundMusic === "function") {
        this.audioManager.startBackgroundMusic();
      }
    });
  
    const stopMusicBtn = this.createButton("Stop Music", () => {
      if (this.audioManager && typeof this.audioManager.stopBackgroundMusic === "function") {
        this.audioManager.stopBackgroundMusic();
      }
    });
  
    const fadeOutBtn = this.createButton("Fade Out Music", () => {
      if (this.audioManager && typeof this.audioManager.fadeTo === "function" && this.audioManager.backgroundMusic) {
        this.audioManager.fadeTo(
          this.audioManager.backgroundMusic,
          0, // Target volume
          2000, // Duration in ms
          () => {
            this.audioManager.stopBackgroundMusic();
          }
        );
      }
    });
  
    musicControls.appendChild(musicTitle);
    musicControls.appendChild(startMusicBtn);
    musicControls.appendChild(stopMusicBtn);
    musicControls.appendChild(fadeOutBtn);
    content.appendChild(musicControls);
  
    // Sound test categories
    const soundCategories = [
      {
        id: "ui",
        name: "UI Sounds",
        sounds: ["click", "gameStart", "gameOver", "win", "lose", "grabWarning", "instruction", "stopHim", "smackThatHand", "faster", "aliens", "musk", "growProtestors"],
      },
      { 
        id: "trump", 
        name: "Trump Sounds", 
        sounds: ["trumpGrabbing", "partialAnnexCry", "trumpSob", "trumpYa", "beenVeryNiceToYou"] 
      },
      { 
        id: "defense", 
        name: "Defense Sounds", 
        sounds: ["slap", "peopleSayNo"] 
      }
    ];
  
    soundCategories.forEach((category) => {
      const categoryControls = document.createElement("div");
      categoryControls.className = "dbg-group";
  
      const categoryTitle = document.createElement("div");
      categoryTitle.textContent = category.name + ":";
      categoryTitle.style.marginBottom = "5px";
  
      const soundButtons = document.createElement("div");
      soundButtons.style.display = "flex";
      soundButtons.style.flexWrap = "wrap";
      soundButtons.style.gap = "5px";
  
      category.sounds.forEach((sound) => {
        const btn = this.createButton(
          sound,
          () => {
            if (this.audioManager) {
              this.audioManager.play(category.id, sound);
            }
          },
          { small: true }
        );
        soundButtons.appendChild(btn);
      });
  
      categoryControls.appendChild(categoryTitle);
      categoryControls.appendChild(soundButtons);
      content.appendChild(categoryControls);
    });
  
    // Country-specific sound tests
    const countrySoundControls = document.createElement("div");
    countrySoundControls.className = "dbg-group";
  
    const countryTitle = document.createElement("div");
    countryTitle.textContent = "Country Sounds:";
    countryTitle.style.marginBottom = "5px";
  
    const countrySelector = document.createElement("select");
    countrySelector.className = "dbg-select";
    countrySelector.style.marginRight = "5px";
    ["eastCanada", "westCanada", "mexico", "greenland"].forEach((country) => {
      const option = document.createElement("option");
      option.value = country;
      option.textContent = country;
      countrySelector.appendChild(option);
    });
  
    const testCatchphraseBtn = this.createButton(
      "Catchphrase",
      () => {
        const country = countrySelector.value;
        if (this.audioManager && typeof this.audioManager.playCatchphrase === "function") {
          this.audioManager.playCatchphrase(country);
        }
      },
      { small: true }
    );
  
    const testProtestBtn = this.createButton(
      "Play Protest",
      () => {
        const country = countrySelector.value;
        if (this.audioManager && typeof this.audioManager.playProtestorSound === "function") {
          // this.audioManager.playProtestorSound(country);
        }
      },
      { small: true }
    );
  
    const stopProtestBtn = this.createButton(
      "Stop Protest",
      () => {
        const country = countrySelector.value;
        if (this.audioManager && typeof this.audioManager.stopProtestorSound === "function") {
          this.audioManager.stopProtestorSound(country);
        }
      },
      { small: true }
    );
  
    countrySoundControls.appendChild(countryTitle);
    countrySoundControls.appendChild(countrySelector);
    countrySoundControls.appendChild(document.createElement("br"));
    countrySoundControls.appendChild(testCatchphraseBtn);
    countrySoundControls.appendChild(testProtestBtn);
    countrySoundControls.appendChild(stopProtestBtn);
    content.appendChild(countrySoundControls);
  
    // Game event sound tests
    const gameEventSounds = document.createElement("div");
    gameEventSounds.className = "dbg-group";
    gameEventSounds.innerHTML = `<div>Game Event Sounds:</div>`;
  
    const successfulBlockBtn = this.createButton("Successful Block", () => {
      if (this.audioManager && typeof this.audioManager.playSuccessfulBlock === "function") {
        this.audioManager.playSuccessfulBlock("mexico");
      }
    });
  
    const successfulGrabBtn = this.createButton("Successful Grab", () => {
      if (this.audioManager && typeof this.audioManager.playSuccessfulGrab === "function") {
        this.audioManager.playSuccessfulGrab("mexico");
      }
    });
    
    const annexBtn = this.createButton("Full Annexation", () => {
      if (this.audioManager && typeof this.audioManager.playCountryFullyAnnexedCry === "function") {
        this.audioManager.playCountryFullyAnnexedCry("mexico");
      }
    });
  
    gameEventSounds.appendChild(successfulBlockBtn);
    gameEventSounds.appendChild(successfulGrabBtn);
    gameEventSounds.appendChild(annexBtn);
    content.appendChild(gameEventSounds);
  
    // Audio system control and status
    const systemControls = document.createElement("div");
    systemControls.className = "dbg-group";
  
    const stopAllBtn = this.createButton("Stop All Sounds", () => {
      if (this.audioManager && typeof this.audioManager.stopAll === "function") {
        this.audioManager.stopAll();
      }
    });
  
    const resetBtn = this.createButton("Reset Audio System", () => {
      if (this.audioManager && typeof this.audioManager.reset === "function") {
        this.audioManager.reset();
      }
    });
  
    systemControls.appendChild(stopAllBtn);
    systemControls.appendChild(resetBtn);
    content.appendChild(systemControls);
  
    // Add audio status display
    const audioStatus = this.createStatus("audio-status", "Audio system status");
    content.appendChild(audioStatus);
  
    // Update status periodically
    setInterval(() => {
      if (!this.audioManager) return;
      
      const status = document.getElementById("audio-status");
      if (!status) return;
  
      status.innerHTML = `
        <div>Context: ${this.audioManager.audioContext?.state || "none"}</div>
        <div>Initialized: ${this.audioManager.initialized ? "Yes" : "No"}</div>
        <div>Muted: ${this.audioManager.muted ? "Yes" : "No"}</div>
        <div>Volume: ${this.audioManager.volume?.toFixed(2) || "1.00"}</div>
        <div>Playing Sounds: ${this.audioManager.currentlyPlaying?.length || 0}</div>
        <div>Music Playing: ${this.audioManager.backgroundMusicPlaying ? "Yes" : "No"}</div>
        <div>Loaded Sounds: ${this.audioManager.loadedSounds?.size || 0}</div>
      `;
    }, 500);
  }





  /**
   * Protestor controls section
   */
  // setupProtestorControlsSection() {
  //   const { content } = this.createSection("protestors", "Protestor Controls");

  //   // Country selector
  //   const countrySelector = document.createElement("select");
  //   countrySelector.id = "debug-protestor-country";
  //   countrySelector.className = "dbg-select";
  //   ["canada", "mexico", "greenland"].forEach((country) => {
  //     const option = document.createElement("option");
  //     option.value = country;
  //     option.textContent = country;
  //     countrySelector.appendChild(option);
  //   });

  //   const selectorWrapper = document.createElement("div");
  //   selectorWrapper.className = "dbg-group";
  //   selectorWrapper.appendChild(document.createTextNode("Country: "));
  //   selectorWrapper.appendChild(countrySelector);
  //   content.appendChild(selectorWrapper);

  //   // Protestor action buttons
  //   const actionControls = document.createElement("div");
  //   actionControls.className = "dbg-group";

  //   const showProtestorsBtn = this.createButton("Show Protestors", () => {
  //     const country = document.getElementById("debug-protestor-country").value;
  //     if (this.freedomManager && typeof this.freedomManager.showProtestors === "function") {
  //       this.freedomManager.showProtestors(country);
  //     }
  //   });

  //   const hideProtestorsBtn = this.createButton("Hide Protestors", () => {
  //     const country = document.getElementById("debug-protestor-country").value;
  //     if (this.freedomManager && typeof this.freedomManager.hideProtestors === "function") {
  //       this.freedomManager.hideProtestors(country);
  //     }
  //   });

  //   const simulateClickBtn = this.createButton("Simulate Click", () => {
  //     const country = document.getElementById("debug-protestor-country").value;
  //     if (this.freedomManager && typeof this.freedomManager.handleProtestorClick === "function") {
  //       this.freedomManager.handleProtestorClick(country);
  //     }
  //   });

  //   const cleanupAllBtn = this.createButton("Clean Up All Protestors", () => {
  //     if (this.freedomManager && typeof this.freedomManager.cleanupAllProtestors === "function") {
  //       this.freedomManager.cleanupAllProtestors();
  //     }
  //   });

  //   actionControls.appendChild(showProtestorsBtn);
  //   actionControls.appendChild(hideProtestorsBtn);
  //   actionControls.appendChild(simulateClickBtn);
  //   actionControls.appendChild(cleanupAllBtn);
  //   content.appendChild(actionControls);

  //   // Protestor calibration controls
  //   const calibrationControls = document.createElement("div");
  //   calibrationControls.className = "dbg-group";

  //   const calibrateProtestorsBtn = this.createButton("Calibrate Protestors", () => {
  //     // protestor calibration goes here?
  //   });

  //   calibrationControls.appendChild(calibrateProtestorsBtn);
  //   content.appendChild(calibrationControls);

  //   // Additional controls for updating protestors
  //   const updateControls = document.createElement("div");
  //   updateControls.className = "dbg-group";

  //   const scaleSizeBtn = this.createButton("Scale Size", () => {
  //     const country = document.getElementById("debug-protestor-country").value;
  //     const scaleFactor = 1.2; // 20% larger

  //     if (this.protestorHitboxManager && typeof this.protestorHitboxManager.updateSize === "function") {
  //       this.protestorHitboxManager.updateSize(country, scaleFactor);
  //     }
  //   });

  //   const resetSizeBtn = this.createButton("Reset Size", () => {
  //     const country = document.getElementById("debug-protestor-country").value;

  //     if (this.protestorHitboxManager) {
  //       // Use 1.0 scale to reset
  //       if (typeof this.protestorHitboxManager.updateSize === "function") {
  //         this.protestorHitboxManager.updateSize(country, 1.0);
  //       }
  //       // Or try completely rebuilding
  //       else if (typeof this.protestorHitboxManager.cleanupAll === "function") {
  //         this.protestorHitboxManager.cleanupAll();
  //       }
  //     }
  //   });

  //   const repositionBtn = this.createButton("Reposition All", () => {
  //     if (this.protestorHitboxManager && typeof this.protestorHitboxManager.repositionAllHitboxes === "function") {
  //       this.protestorHitboxManager.repositionAllHitboxes();
  //     }
  //   });

  //   updateControls.appendChild(scaleSizeBtn);
  //   updateControls.appendChild(resetSizeBtn);
  //   updateControls.appendChild(repositionBtn);
  //   content.appendChild(updateControls);
  // }

  setupUfoControlsSection() {
    const { content } = this.createSection("ufo", "UFO & Easter Eggs");
  
    // UFO controls
    if (this.UFOManager || window.UFOManager) {
      const ufoControls = document.createElement("div");
      ufoControls.className = "dbg-group";
  
      const showUfoBtn = this.createButton("Show UFO", () => {
        const ufo = this.UFOManager || window.UFOManager;
        if (ufo && typeof ufo.flyUfo === "function") {
          ufo.flyUfo();
        }
      });
  
      const hideUfoBtn = this.createButton("Hide UFO", () => {
        const ufo = this.UFOManager || window.UFOManager;
        if (ufo && this.elements && this.elements.ufo) {
          ufo.elements.ufo.style.opacity = "0";
        }
      });
  
  
      ufoControls.appendChild(showUfoBtn);
      ufoControls.appendChild(hideUfoBtn);
      content.appendChild(ufoControls);
    }
  
    // Elon appearance
    const elonControls = document.createElement("div");
    elonControls.className = "dbg-group";
  
    const showElonBtn = this.createButton("Show Elon", () => {
      const ufo = this.UFOManager || window.UFOManager;
      if (ufo && typeof ufo.showElonMusk === "function") {
        // Pass true to indicate this is a standalone test that should auto-cleanup
        ufo.showElonMusk(true);
  
        // Play sound if available
        if (this.audioManager) {
          this.audioManager.play("ui", "musk");
        }
      }
    });
  
    const cleanupElonBtn = this.createButton("Clean Up Elon", () => {
      const ufo = this.UFOManager || window.UFOManager;
      if (ufo) {
        if (typeof ufo.cleanupElonMusk === "function") {
          ufo.cleanupElonMusk();
        } else if (typeof ufo.cleanupElonElements === "function") {
          ufo.cleanupElonElements({ withTumble: true });
          ufo.removeElonHitbox && ufo.removeElonHitbox();
        }
      }
    });
  
    elonControls.appendChild(showElonBtn);
    elonControls.appendChild(cleanupElonBtn);
    content.appendChild(elonControls);
  
    // Aliens sound effect
    const aliensControls = document.createElement("div");
    aliensControls.className = "dbg-group";
  
    const playAliensBtn = this.createButton("Play Aliens Sound", () => {
      if (this.audioManager) {
        if (typeof this.audioManager.resumeAudioContext === "function") {
          this.audioManager.resumeAudioContext().then(() => {
            this.audioManager.play("ui", "aliens", 0.8);
          });
        } else {
          this.audioManager.play("ui", "aliens", 0.8);
        }
      }
    });
  
    aliensControls.appendChild(playAliensBtn);
    content.appendChild(aliensControls);
  
    // Add extra options for debugging
    const debugOptions = document.createElement("div");
    debugOptions.className = "dbg-group";
  
    const checkOrphanedBtn = this.createButton("Check Orphaned Elon Elements", () => {
      const ufo = this.UFOManager || window.UFOManager;
      if (ufo && typeof ufo.cleanupOrphanedElements === "function") {
        ufo.cleanupOrphanedElements();
      } else {
        // Fallback cleanup logic
        document.querySelectorAll('[id*="elon"]').forEach(el => {
          if (el && el.parentNode) {
            console.log(`Found and removing orphaned element: ${el.id}`);
            el.parentNode.removeChild(el);
          }
        });
      }
    });
  
    debugOptions.appendChild(checkOrphanedBtn);
    content.appendChild(debugOptions);
  
    // Add UFO Status display
    if (this.UFOManager || window.UFOManager) {
      const ufoStatus = this.createStatus("ufo-status", "UFO status information");
      content.appendChild(ufoStatus);
  
      // Update UFO status periodically
      setInterval(() => {
        const ufo = this.UFOManager || window.UFOManager;
        if (!ufo) return;
        
        const status = document.getElementById("ufo-status");
        if (!status) return;
  
        // Check if Elon elements exist
        const elonExists = !!document.getElementById("elon-sprite") || 
                            !!document.getElementById("elon-wrapper") ||
                            !!document.getElementById("elon-hitbox");
  
        status.innerHTML = `
          <div>Auto Spawn: ${ufo.state?.autoSpawnEnabled ? "Enabled" : "Disabled"}</div>
          <div>Animating: ${ufo.state?.isAnimating ? "Yes" : "No"}</div>
          <div>Elon Visible: ${elonExists ? "Yes" : "No"}</div>
          <div>UFO Visible: ${ufo.elements?.ufo?.style.opacity !== "0" ? "Yes" : "No"}</div>
        `;
      }, 500);
    }
  }

  setupPerformanceControlsSection() {
    const { content } = this.createSection("performance", "Performance Controls");
  
    // Debug class toggle
    const debugModeControls = document.createElement("div");
    debugModeControls.className = "dbg-group";
  
    const toggleDebugClassBtn = this.createButton("Toggle Debug Class", () => {
      document.body.classList.toggle("debug-mode");
    });
  
    debugModeControls.appendChild(toggleDebugClassBtn);
    content.appendChild(debugModeControls);
  
    // Frame rate monitoring
    const fpsControls = document.createElement("div");
    fpsControls.className = "dbg-group";
  
    const fpsMonitor = document.createElement("div");
    fpsMonitor.id = "debug-fps-monitor";
    fpsMonitor.className = "dbg-status";
    fpsMonitor.textContent = "FPS: --";
  
    const toggleFpsBtn = this.createButton("Monitor FPS", () => {
      if (!this._fpsMonitorActive) {
        this._startFpsMonitoring();
        toggleFpsBtn.textContent = "Stop Monitoring";
      } else {
        this._stopFpsMonitoring();
        toggleFpsBtn.textContent = "Monitor FPS";
      }
    });
  
    fpsControls.appendChild(toggleFpsBtn);
    fpsControls.appendChild(fpsMonitor);
    content.appendChild(fpsControls);
  
    // Memory usage monitoring
    const memoryControls = document.createElement("div");
    memoryControls.className = "dbg-group";
  
    const memoryMonitor = document.createElement("div");
    memoryMonitor.id = "debug-memory-monitor";
    memoryMonitor.className = "dbg-status";
    memoryMonitor.textContent = "Memory: --";
  
    // Add memory monitoring if performance API is available
    if (performance && performance.memory) {
      const checkMemoryBtn = this.createButton("Check Memory", () => {
        try {
          const memory = performance.memory;
          const usedHeap = Math.round(memory.usedJSHeapSize / (1024 * 1024));
          const totalHeap = Math.round(memory.totalJSHeapSize / (1024 * 1024));
          memoryMonitor.textContent = `Memory: ${usedHeap}MB / ${totalHeap}MB`;
        } catch (e) {
          memoryMonitor.textContent = "Memory: Not available";
        }
      });
      memoryControls.appendChild(checkMemoryBtn);
      memoryControls.appendChild(memoryMonitor);
      content.appendChild(memoryControls);
    }
  
    // Browser info
    const infoControls = document.createElement("div");
    infoControls.className = "dbg-group";
  
    // Collect browser and device info
    const isMobile = window.DeviceUtils?.isMobileDevice || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
    const isTouchDevice =
      window.DeviceUtils?.isTouchDevice || "ontouchstart" in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
  
    infoControls.innerHTML = `
      <div><strong>Browser:</strong> ${navigator.userAgent.split(/[()]/)[1] || navigator.userAgent}</div>
      <div><strong>Device:</strong> ${isMobile ? "Mobile" : "Desktop"} / ${isTouchDevice ? "Touch" : "No Touch"}</div>
      <div><strong>Viewport:</strong> ${viewportWidth}×${viewportHeight}</div>
      <div><strong>Chrome Mobile:</strong> ${window.isChromeOnMobile ? "Yes" : "No"}</div>
    `;
  
    content.appendChild(infoControls);
  
    // Page events monitoring
    const eventsControls = document.createElement("div");
    eventsControls.className = "dbg-group";
  
    // Create a toggle for enabling event monitoring
    const toggleEventsBtn = this.createButton("Monitor Events", () => {
      if (!this._eventMonitoringActive) {
        this._startEventMonitoring();
        toggleEventsBtn.textContent = "Stop Monitoring";
      } else {
        this._stopEventMonitoring();
        toggleEventsBtn.textContent = "Monitor Events";
      }
    });
  
    const clearEventsBtn = this.createButton("Clear Events", () => {
      const eventsLog = document.getElementById("debug-events-log");
      if (eventsLog) {
        eventsLog.innerHTML = "";
      }
    });
  
    const eventsLog = document.createElement("div");
    eventsLog.id = "debug-events-log";
    eventsLog.className = "dbg-log";
    eventsLog.style.maxHeight = "150px";
    eventsLog.style.overflowY = "auto";
    eventsLog.style.marginTop = "5px";
    eventsLog.style.fontSize = "12px";
    eventsLog.style.whiteSpace = "pre-wrap";
    eventsLog.style.border = "1px solid #ccc";
    eventsLog.style.padding = "5px";
  
    eventsControls.appendChild(toggleEventsBtn);
    eventsControls.appendChild(clearEventsBtn);
    eventsControls.appendChild(eventsLog);
    content.appendChild(eventsControls);
  
    // Clear cache and reload
    const cacheControls = document.createElement("div");
    cacheControls.className = "dbg-group";
  
    const reloadBtn = this.createButton("Reload Page", () => {
      window.location.reload();
    });
  
    const hardReloadBtn = this.createButton(
      "Hard Reload (Clear Cache)",
      () => {
        window.location.reload(true);
      },
      { className: "dbg-button warning" }
    );
  
    cacheControls.appendChild(reloadBtn);
    cacheControls.appendChild(hardReloadBtn);
    content.appendChild(cacheControls);
  }
  
  // Add event monitoring methods
  _startEventMonitoring() {
    this._eventMonitoringActive = true;
    this._eventsToMonitor = ["click", "touchstart", "mousedown", "keydown"];
    this._eventHandlers = {};
  
    // Create a log entry for each event
    const logEvent = (type, e) => {
      const eventsLog = document.getElementById("debug-events-log");
      if (!eventsLog) return;
  
      // Create a simplified event info string
      let infoString = `${type}: `;
      
      if (type === "keydown") {
        infoString += `key=${e.key}, code=${e.code}`;
      } else {
        infoString += `target=${e.target.tagName || "unknown"}`;
        if (e.clientX !== undefined) {
          infoString += `, pos=(${e.clientX}, ${e.clientY})`;
        }
      }
  
      // Add the log entry
      const entry = document.createElement("div");
      entry.textContent = infoString;
      eventsLog.insertBefore(entry, eventsLog.firstChild);
  
      // Limit log size
      if (eventsLog.children.length > 20) {
        eventsLog.removeChild(eventsLog.lastChild);
      }
    };
  
    // Add listeners for each event type
    this._eventsToMonitor.forEach(type => {
      this._eventHandlers[type] = (e) => logEvent(type, e);
      document.addEventListener(type, this._eventHandlers[type]);
    });
  }
  
  _stopEventMonitoring() {
    this._eventMonitoringActive = false;
  
    // Remove all event listeners
    if (this._eventsToMonitor && this._eventHandlers) {
      this._eventsToMonitor.forEach(type => {
        if (this._eventHandlers[type]) {
          document.removeEventListener(type, this._eventHandlers[type]);
        }
      });
    }
  
    this._eventsToMonitor = null;
    this._eventHandlers = {};
  }

  /**
   * Start FPS monitoring
   * @private
   */
  _startFpsMonitoring() {
    if (this._fpsMonitorActive) return;

    this._fpsMonitorActive = true;
    this._frameCount = 0;
    this._lastFpsUpdateTime = performance.now();

    const updateFps = () => {
      this._frameCount++;

      const now = performance.now();
      const elapsed = now - this._lastFpsUpdateTime;

      // Update FPS every 500ms
      if (elapsed >= 500) {
        const fps = Math.round(this._frameCount / (elapsed / 1000));

        const fpsMonitor = document.getElementById("debug-fps-monitor");
        if (fpsMonitor) {
          fpsMonitor.textContent = `FPS: ${fps}`;
          // Color-code based on performance
          if (fps >= 55) {
            fpsMonitor.style.color = "#5d5";
          } else if (fps >= 30) {
            fpsMonitor.style.color = "#dd5";
          } else {
            fpsMonitor.style.color = "#d55";
          }
        }

        this._frameCount = 0;
        this._lastFpsUpdateTime = now;
      }

      if (this._fpsMonitorActive) {
        this._fpsAnimFrame = requestAnimationFrame(updateFps);
      }
    };

    this._fpsAnimFrame = requestAnimationFrame(updateFps);
  }

  /**
   * Stop FPS monitoring
   * @private
   */
  _stopFpsMonitoring() {
    this._fpsMonitorActive = false;

    if (this._fpsAnimFrame) {
      cancelAnimationFrame(this._fpsAnimFrame);
      this._fpsAnimFrame = null;
    }

    const fpsMonitor = document.getElementById("debug-fps-monitor");
    if (fpsMonitor) {
      fpsMonitor.textContent = "FPS: --";
      fpsMonitor.style.color = "";
    }
  }

  // new


  // Toggle hitbox visibility
  toggleHitboxVisibility() {
    document.body.classList.toggle("debug-mode");
    const handHitbox = document.getElementById("hand-hitbox");

    const isDebugMode = document.body.classList.contains("debug-mode");
    if (this.animationManager) {
      this.animationManager.setDebugMode(isDebugMode);
    }
  }

  // Show animation test dialog
  showAnimationTestDialog() {
    let animationStates = [];
    if (this.animationManager && this.animationManager.animations) {
      animationStates = Object.keys(this.animationManager.animations);
    } else if (window.trumpAnimations) {
      animationStates = Object.keys(window.trumpAnimations);
    }

    const animSelect = document.createElement("select");
    animSelect.id = "animation-select";

    animationStates.forEach((state) => {
      const option = document.createElement("option");
      option.value = state;
      option.textContent = state;
      animSelect.appendChild(option);
    });

    const dialog = document.createElement("div");
    dialog.classList.add('animation-test-dialog');
    dialog.appendChild(animSelect);

    const testBtn = document.createElement("button");
    testBtn.textContent = "Test";
    testBtn.addEventListener("click", () => {
      const selectedAnimation = animSelect.value;
      if (this.animationManager) {
        const isGrabAnim = selectedAnimation.startsWith("grab");
        if (isGrabAnim && this.animationManager.currentState !== "idle") {
          this.animationManager.changeState("idle", () => {
            this.animationManager.changeState(selectedAnimation);
          });
        } else {
          this.animationManager.changeState(selectedAnimation);
        }
      } else if (typeof changeAnimationState === "function") {
        changeAnimationState(selectedAnimation);
      }
    });

    dialog.appendChild(testBtn);
    document.body.appendChild(dialog);
  }

  // Start hitbox calibration process
  // startCalibration() {
  //   const wasPlaying = this.gameState.isPlaying;
  //   if (wasPlaying) {
  //     this.gameState.isPlaying = false;
  //     clearTimeout(this.gameState.grabTimer);
  //     clearInterval(this.gameState.countdownTimer);
  //   }

  //   const dialog = document.createElement("div");
  //   dialog.classList.add('calibration-dialog');

  //   const title = document.createElement("h3");
  //   title.textContent = "Hitbox Calibration";
  //   dialog.appendChild(title);

  //   const animSelect = document.createElement("select");
  //   const animationStates = ["grabEastCanada", "grabWestCanada", "grabMexico", "grabGreenland"];

  //   animationStates.forEach((state) => {
  //     const option = document.createElement("option");
  //     option.value = state;
  //     option.textContent = state;
  //     animSelect.appendChild(option);
  //   });

  //   dialog.appendChild(animSelect);

  //   const startBtn = document.createElement("button");
  //   startBtn.classList.add('calibration-dialog-button');
  //   startBtn.textContent = "Start Calibration";
  //   startBtn.addEventListener("click", () => {
  //     this.beginCalibration(animSelect.value, wasPlaying);
  //     dialog.remove();
  //   });

  //   const cancelBtn = document.createElement("button");
  //   cancelBtn.classList.add('calibration-dialog-button');
  //   cancelBtn.textContent = "Cancel";
  //   cancelBtn.addEventListener("click", () => {
  //     dialog.remove();
  //     if (wasPlaying) {
  //       this.gameState.isPlaying = true;
  //       this.gameState.countdownTimer = setInterval(window.updateCountdown, 1000);
  //       window.scheduleNextGrab();
  //     }
  //   });

  //   dialog.appendChild(startBtn);
  //   dialog.appendChild(cancelBtn);
  //   document.body.appendChild(dialog);
  // }

  // Make the hitbox draggable for calibration
  makeHitboxDraggable() {
    const hitbox = document.getElementById("hand-hitbox");
    let isDragging = false;
    let offsetX, offsetY;

    const newHitbox = hitbox.cloneNode(true);
    hitbox.parentNode.replaceChild(newHitbox, hitbox);

    newHitbox.addEventListener("mousedown", (e) => {
      if (!this.calibration.isCalibrating) return;

      isDragging = true;
      const hitboxRect = newHitbox.getBoundingClientRect();
      offsetX = e.clientX - hitboxRect.left;
      offsetY = e.clientY - hitboxRect.top;

      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      const container = document.getElementById("trump-sprite-container");
      const containerRect = container.getBoundingClientRect();

      const x = e.clientX - containerRect.left - offsetX;
      const y = e.clientY - containerRect.top - offsetY;

      newHitbox.style.left = `${x}px`;
      newHitbox.style.top = `${y}px`;

      const currentFrame = parseInt(document.getElementById("current-frame").textContent);
      this.calibration.frameCoordinates[currentFrame] = {
        x: Math.round(x),
        y: Math.round(y),
        width: parseInt(newHitbox.style.width) || 50,
        height: parseInt(newHitbox.style.height) || 50,
      };

      this.updateCoordsDisplay(currentFrame);
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });
  }

  // Update coordinates display
  updateCoordsDisplay(frameIndex) {
    const coords = this.calibration.frameCoordinates[frameIndex];
    const display = document.getElementById("coords-display");
    if (display && coords) {
      display.textContent = `X: ${coords.x}, Y: ${coords.y}, W: ${coords.width}, H: ${coords.height}`;

      const output = document.getElementById("calib-output");
      if (output) {
        output.textContent = this.formatCoordinatesOutput();
      }
    }
  }

  beginCalibration(animationName, wasPlaying) {
    this.calibration = {
      isCalibrating: true,
      originalAnimState: this.animationManager ? this.animationManager.currentState : null,
      currentAnimation: animationName,
      frameCoordinates: [],
      wasPlaying: wasPlaying,
      originalHandlerClick: null,
      originalHandlerTouch: null,
      originalContainerClick: null,
    };

    document.body.classList.add("debug-mode");

    const handHitbox = document.getElementById("hand-hitbox");
    if (handHitbox) {
      this.calibration.originalHandlerClick = handHitbox.onclick;
      this.calibration.originalHandlerTouch = handHitbox.ontouchstart;

      handHitbox.onclick = null;
      handHitbox.ontouchstart = null;
    }

    const panel = document.createElement("div");
    panel.id = "calibration-panel";
    panel.classList.add('calibration-panel');

    let frameCount = 5;
    if (this.animationManager && this.animationManager.animations[animationName]) {
      frameCount = this.animationManager.animations[animationName].frameCount;
    } else if (this.trumpAnimations && this.trumpAnimations[animationName]) {
      frameCount = this.trumpAnimations[animationName].frameCount;
    }

    panel.innerHTML = `
      <h4>Calibrating: ${animationName}</h4>
      <div>Frame: <span id="current-frame">0</span>/<span id="total-frames">${frameCount - 1}</span></div>
      <div id="coords-display"></div>
      <button id="prev-frame">Previous Frame</button>
      <button id="next-frame">Next Frame</button>
      <button id="save-coords">Save Coordinates</button>
      <button id="cancel-calib">Cancel</button>
      <div id="calib-output" style="margin-top:10px;font-size:10px;max-height:100px;overflow-y:auto;"></div>
    `;

    document.body.appendChild(panel);

    let originalCoords = [];
    if (this.animationManager && this.animationManager.animations[animationName] && this.animationManager.animations[animationName].handCoordinates) {
      originalCoords = this.animationManager.animations[animationName].handCoordinates;
    } else if (this.trumpAnimations && this.trumpAnimations[animationName] && this.trumpAnimations[animationName].handCoordinates) {
      originalCoords = this.trumpAnimations[animationName].handCoordinates;
    }

    originalCoords.forEach((coord) => {
      this.calibration.frameCoordinates.push({ ...coord });
    });

    while (this.calibration.frameCoordinates.length < frameCount) {
      this.calibration.frameCoordinates.push({ x: 100, y: 50, width: 50, height: 50 });
    }

    if (this.animationManager) {
      this.animationManager.stop();
    }

    if (this.animationManager) {
      const animation = this.animationManager.animations[animationName];
      if (animation) {
        this.animationManager.currentState = animationName;
        if (this.animationManager.trumpSprite) {
          this.animationManager.trumpSprite.style.backgroundImage = `url('${animation.spriteSheet}')`;
        }
      }
    } else if (typeof window.changeAnimationState === "function") {
      window.changeAnimationState(animationName);
    }

    this.updateCalibrationFrame(0);

    document.getElementById("prev-frame").addEventListener("click", () => {
      const currentFrame = parseInt(document.getElementById("current-frame").textContent);
      if (currentFrame > 0) {
        this.updateCalibrationFrame(currentFrame - 1);
      }
    });

    document.getElementById("next-frame").addEventListener("click", () => {
      const currentFrame = parseInt(document.getElementById("current-frame").textContent);
      const totalFrames = parseInt(document.getElementById("total-frames").textContent);
      if (currentFrame < totalFrames) {
        this.updateCalibrationFrame(currentFrame + 1);
      }
    });

    document.getElementById("save-coords").addEventListener("click", () => {
      this.saveCalibration();
    });

    document.getElementById("cancel-calib").addEventListener("click", () => {
      this.cancelCalibration();
    });

    this.makeHitboxDraggable();

    const trumpContainer = document.getElementById("trump-sprite-container");
    if (trumpContainer) {
      this.calibration.originalContainerClick = trumpContainer.onclick;
      trumpContainer.onclick = (e) => {
        if (!this.calibration.isCalibrating) return;

        const containerRect = trumpContainer.getBoundingClientRect();
        const x = e.clientX - containerRect.left - 25;
        const y = e.clientY - containerRect.top - 25;

        const handHitbox = document.getElementById("hand-hitbox");
        if (handHitbox) {
          handHitbox.style.left = `${x}px`;
          handHitbox.style.top = `${y}px`;

          const currentFrame = parseInt(document.getElementById("current-frame").textContent);
          this.calibration.frameCoordinates[currentFrame] = {
            x: Math.round(x),
            y: Math.round(y),
            width: 50,
            height: 50,
          };

          this.updateCoordsDisplay(currentFrame);
        }
      };
    }
  }

  updateCalibrationFrame(frameIndex) {
    const currentFrameElement = document.getElementById("current-frame");
    if (currentFrameElement) {
      currentFrameElement.textContent = frameIndex;
    }

    if (this.animationManager) {
      this.animationManager.setFrame(frameIndex);
    } else if (this.gameState.animation) {
      this.gameState.animation.currentFrame = frameIndex;
      if (typeof window.updateAnimationFrame === "function") {
        window.updateAnimationFrame(frameIndex);
      }
    }

    const handHitbox = document.getElementById("hand-hitbox");
    if (!handHitbox) return;

    const coords = this.calibration.frameCoordinates[frameIndex];
    if (!coords) return;

    handHitbox.style.left = `${coords.x}px`;
    handHitbox.style.top = `${coords.y}px`;
    handHitbox.style.width = `${coords.width}px`;
    handHitbox.style.height = `${coords.height}px`;
    handHitbox.style.display = "block";
    handHitbox.classList.add('calibration-mode');

    this.updateCoordsDisplay(frameIndex);
  }

  formatCoordinatesOutput(deviceType) {
    const animName = this.calibration.currentAnimation;
    
    let output = `${animName}: {\n`;
    
    if (deviceType === "mobile") {
      output += `  deviceCoordinates: {\n`;
      output += `    mobile: [\n`;
      
      this.calibration.frameCoordinates.forEach((coords, index) => {
        output += `      { x: ${coords.x}, y: ${coords.y}, width: ${coords.width}, height: ${coords.height} }`;
        if (index < this.calibration.frameCoordinates.length - 1) {
          output += ",";
        }
        output += ` // Frame ${index}\n`;
      });
      
      output += `    ]\n`;
      output += `  },\n`;
    } else {
      output += `  handCoordinates: [\n`;
      
      this.calibration.frameCoordinates.forEach((coords, index) => {
        output += `    { x: ${coords.x}, y: ${coords.y}, width: ${coords.width}, height: ${coords.height} }`;
        if (index < this.calibration.frameCoordinates.length - 1) {
          output += ",";
        }
        output += ` // Frame ${index}\n`;
      });
      
      output += `  ],\n`;
    }
    
    output += `},`;
    
    return output;
  }

  saveCalibration() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const deviceType = isMobile ? "mobile" : "desktop";
    
    const formattedOutput = this.formatCoordinatesOutput(deviceType);
    
    navigator.clipboard
      .writeText(formattedOutput)
      .then(() => {
        alert(`${deviceType.toUpperCase()} coordinates saved and copied to clipboard.`);
      })
      .catch((err) => {
        console.error("Error copying to clipboard:", err);
        alert("Failed to copy to clipboard. See console for details.");
      });
  
    const animObj = this.animationManager?.animations[this.calibration.currentAnimation] || 
                   this.trumpAnimations?.[this.calibration.currentAnimation];
    
    if (animObj) {
      if (isMobile) {
        if (!animObj.deviceCoordinates) {
          animObj.deviceCoordinates = {};
        }
        animObj.deviceCoordinates.mobile = [...this.calibration.frameCoordinates];
      } else {
        animObj.handCoordinates = [...this.calibration.frameCoordinates];
      }
    }
  
    this.endCalibration();
  }

  cancelCalibration() {
    this.endCalibration();
  }

  // endCalibration() {
  //   const panel = document.getElementById("calibration-panel");
  //   if (panel) panel.remove();

  //   const handHitbox = document.getElementById("hand-hitbox");
  //   if (handHitbox) {
  //     handHitbox.onclick = this.calibration.originalHandlerClick;
  //     handHitbox.ontouchstart = this.calibration.originalHandlerTouch;
  //   }

  //   const trumpContainer = document.getElementById("trump-sprite-container");
  //   if (trumpContainer && this.calibration.originalContainerClick) {
  //     trumpContainer.onclick = this.calibration.originalContainerClick;
  //   }

  //   if (this.animationManager) {
  //     this.animationManager.changeState("idle", () => {
  //       if (this.calibration.originalAnimState && this.calibration.originalAnimState !== "idle") {
  //         this.animationManager.changeState(this.calibration.originalAnimState);
  //       }
  //     });
  //   } else if (typeof window.changeAnimationState === "function") {
  //     window.changeAnimationState("idle", () => {
  //       if (this.calibration.originalAnimState && this.calibration.originalAnimState !== "idle") {
  //         window.changeAnimationState(this.calibration.originalAnimState);
  //       }
  //     });
  //   }

  //   if (this.calibration.wasPlaying) {
  //     this.gameState.isPlaying = true;
  //     this.gameState.countdownTimer = setInterval(window.updateCountdown, 1000);
  //     window.scheduleNextGrab();
  //   }

  //   this.calibration.isCalibrating = false;

  //   if (!this.enabled) {
  //     document.body.classList.remove("debug-mode");
  //   }
  // }
}

// Make the DebugManager globally available
window.DebugManager = DebugManager;
