class GlitchEngine {
  static defaultOptions = {
    interval: 1,
    squashIntensity: 0.4,
    rotationRange: 120,
    colorShiftIntensity: 2,
    pixelDistortionRange: 10,
    duplicateOffset: 50,
    scanlineFrequency: 5,
    pixelationLevel: 20,
    useRainbowColors: true,
    glitchModes: ['duplicate', 'invert', 'rgbshift', 'fragment']
  };

  constructor(container, options = {}) {
    this.container = container;
    this.options = { ...GlitchEngine.defaultOptions, ...options };
    this.glitchElements = [];
    this.glitchInterval = null;
    this.cleanupFunctions = new Map();
    this.originalStyles = new Map();
    
    this.setupGlitchElements();
  }

  setupGlitchElements() {
    this.glitchElements = Array.from(
      this.container.querySelectorAll('.glitch-element')
    );

    this.glitchElements.forEach(element => {
      if (!element.dataset.originalPosition && getComputedStyle(element).position === 'static') {
        element.style.position = 'relative';
      }

      this.originalStyles.set(element, {
        transform: element.style.transform || '',
        filter: element.style.filter || '',
        clipPath: element.style.clipPath || '',
        position: element.style.position || '',
        zIndex: element.style.zIndex || '',
        mixBlendMode: element.style.mixBlendMode || '',
        backgroundColor: element.style.backgroundColor || '',
        opacity: element.style.opacity || ''
      });
    });
  }

  startGlitching(customOptions = {}) {
    const activeOptions = { ...this.options, ...customOptions };
    this.stopGlitching();
    
    this.glitchInterval = setInterval(() => {
      this.glitchElements.forEach(element => 
        this.applyRandomGlitch(element, activeOptions)
      );
    }, activeOptions.interval);
  }

  stopGlitching() {
    if (this.glitchInterval) {
      clearInterval(this.glitchInterval);
      this.glitchInterval = null;
    }
    
    this.glitchElements.forEach(element => {
      const cleanup = this.cleanupFunctions.get(element);
      if (cleanup) cleanup();
      
      const overlays = element.querySelectorAll('.glitch-overlay, .glitch-duplicate, .glitch-scanline, .glitch-noise, .glitch-fragment');
      overlays.forEach(overlay => overlay.remove());
      
      const originalStyle = this.originalStyles.get(element);
      if (originalStyle) {
        Object.entries(originalStyle).forEach(([prop, value]) => {
          element.style[prop] = value;
        });
      }
    });
    
    this.cleanupFunctions.clear();
  }

  applyRandomGlitch(element, options) {
    const cleanup = this.cleanupFunctions.get(element);
    if (cleanup) cleanup();
    
    const elementOptions = this.getElementOptions(element, options);
    const cleanupFunctions = [];
    
    // Apply base transformations
    const squashStretch = this.generateSquashStretch(elementOptions.squashIntensity);
    const rotation = this.generateRotation(elementOptions.rotationRange);
    
    element.style.transform = `
      scale(${squashStretch.scaleX}, ${squashStretch.scaleY}) 
      rotate(${rotation}deg)
      translate(${(Math.random() - 0.5) * 10}px, ${(Math.random() - 0.5) * 10}px)
    `;

    // Randomly select and apply effects
    const selectedModes = this.shuffleArray([...elementOptions.glitchModes])
      .slice(0, Math.floor(Math.random() * 3) + 1);

    selectedModes.forEach(mode => {
      switch(mode) {
        case 'duplicate':
          cleanupFunctions.push(this.applyDuplication(element, elementOptions));
          break;
        case 'invert':
          cleanupFunctions.push(this.applyInvertedDuplicate(element, elementOptions));
          break;
        case 'rgbshift':
          cleanupFunctions.push(this.applyRGBShift(element, elementOptions));
          break;
        case 'fragment':
          cleanupFunctions.push(this.applyFragmentation(element, elementOptions));
          break;
      }
    });

    this.cleanupFunctions.set(element, () => {
      cleanupFunctions.forEach(fn => fn());
    });
  }

  generateVibrantColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsla(${hue}, 70%, 75%, 0.3)`;
  }

  generateRainbowColor(index = null) {
    const hue = index !== null ? index * 40 % 360 : Math.floor(Math.random() * 360);
    return `hsla(${hue}, 70%, 75%, 0.3)`;
  }

  applyDuplication(element, options) {
    const duplicates = Math.floor(Math.random() * 3) + 1;
    const cleanupFns = [];
    
    for (let i = 0; i < duplicates; i++) {
      const duplicate = document.createElement('div');
      duplicate.className = 'glitch-duplicate';
      
      duplicate.style.transform = `translate(${(Math.random() - 0.5) * options.duplicateOffset * 2}px, ${(Math.random() - 0.5) * options.duplicateOffset * 2}px)`;
      duplicate.style.zIndex = '50';
      
      const color = options.useRainbowColors ? this.generateRainbowColor(i) : this.generateVibrantColor();
      duplicate.style.backgroundColor = color;
      duplicate.style.opacity = '0.1';
      duplicate.style.mixBlendMode = 'screen';
      
      element.appendChild(duplicate);
      cleanupFns.push(() => duplicate.remove());
    }
    
    return () => cleanupFns.forEach(fn => fn());
  }

  applyInvertedDuplicate(element, options) {
    const duplicate = document.createElement('div');
    duplicate.className = 'glitch-duplicate';
    
    duplicate.style.transform = `translate(${(Math.random() - 0.5) * 10}px, ${(Math.random() - 0.5) * 10}px)`;
    duplicate.style.filter = 'invert(1) contrast(1.5)';
    duplicate.style.mixBlendMode = 'difference';
    duplicate.style.opacity = '0.8';
    
    element.appendChild(duplicate);
    return () => duplicate.remove();
  }

  applyRGBShift(element, options) {
    const rgbShiftAmount = Math.random() * 3 + 1;
    const originalFilter = element.style.filter;
    
    element.style.filter = `
      drop-shadow(${rgbShiftAmount}px 0 0 rgba(255,0,0,0.7))
      drop-shadow(-${rgbShiftAmount}px 0 0 rgba(0,255,255,0.7))
    `;
    
    return () => {
      element.style.filter = originalFilter;
    };
  }

  applyFragmentation(element, options) {
    const fragmentCount = Math.floor(Math.random() * 5) + 2;
    const container = document.createElement('div');
    container.className = 'glitch-fragment-container';
    
    for (let i = 0; i < fragmentCount; i++) {
      const fragment = document.createElement('div');
      fragment.className = 'glitch-fragment';
      
      const height = 100 / fragmentCount;
      fragment.style.position = 'absolute';
      fragment.style.top = `${i * height}%`;
      fragment.style.left = '0';
      fragment.style.width = '100%';
      fragment.style.height = `${height}%`;
      fragment.style.overflow = 'hidden';
      
      const xOffset = (Math.random() - 0.5) * 20;
      fragment.style.transform = `translateX(${xOffset}px)`;
      
      if (Math.random() > 0.5) {
        const color = options.useRainbowColors ? this.generateRainbowColor(i) : this.generateVibrantColor();
        fragment.style.backgroundColor = color;
        fragment.style.mixBlendMode = 'screen';
        fragment.style.opacity = '0.1';
      }
      
      container.appendChild(fragment);
    }
    
    element.appendChild(container);
    return () => container.remove();
  }

  getElementOptions(element, baseOptions) {
    const elementOptions = { ...baseOptions };
    
    if (element.dataset.squashIntensity) elementOptions.squashIntensity = parseFloat(element.dataset.squashIntensity);
    if (element.dataset.rotationRange) elementOptions.rotationRange = parseFloat(element.dataset.rotationRange);
    if (element.dataset.colorShiftIntensity) elementOptions.colorShiftIntensity = parseFloat(element.dataset.colorShiftIntensity);
    
    return elementOptions;
  }

  generateSquashStretch(intensity) {
    return {
      scaleX: 1 + (Math.random() - 0.5) * intensity,
      scaleY: 1 + (Math.random() - 0.5) * intensity
    };
  }

  generateRotation(range) {
    return (Math.random() - 0.5) * range;
  }

  shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }
}

// Main activation functions
function activateGlitchEffect() {
  document.body.classList.add('sentient-orb-activated');
  
  const sentientText = document.createElement("div");
  sentientText.id = "sentient-orb-text";
  sentientText.innerHTML = `
    <span class="glitch" data-text="S3NtI3Nt">S3NtI3Nt</span>
    <span class="glitch" data-text="0R8">0R8!!!!!!!</span>
    <span class="glitch" data-text="JUST">all 0f th13 1s a ch01c3!!! w3 c0uld just st0p!!!</span>
  `;
  document.body.appendChild(sentientText);
  
  const text = document.getElementById('sentient-orb-text');
    
  // Wrap each letter in a span
  text.innerHTML = text.textContent.split('').map(char => 
      `<span style="
          --random-rotation: ${(Math.random() * 20 - 10).toFixed(2)}deg;
          --random-scale: ${(Math.random() * 0.4 + 0.8).toFixed(2)}
      ">${char}</span>`
  ).join('');

  const chaosOverlay = document.createElement("div");
  chaosOverlay.id = "sentient-orb-chaos";
  document.body.appendChild(chaosOverlay);
  
  createChaosFragments(chaosOverlay);
  
  const glitchEngine = new GlitchEngine(document.body, {
    interval: 1,
    squashIntensity: 10.4,
    rotationRange: 45,
    colorShiftIntensity: 50,
    pixelDistortionRange: 10,
    useTransitions: true
  });
  
  glitchEngine.startGlitching();
  window.currentGlitchEngine = glitchEngine;
  
  return { glitchEngine, sentientText, chaosOverlay };
}

function createChaosFragments(container) {
  const fragmentCount = 45;
  const pastelColors = [
    'rgba(255,182,193,0.7)',
    'rgba(173,216,230,0.7)',
    'rgba(221,160,221,0.7)',
    'rgba(152,251,152,0.7)',
    'rgba(255,228,181,0.7)',
    'rgba(176,224,230,0.7)',
    'rgba(255,218,185,0.7)',
    'rgba(216,191,216,0.7)'
  ];
  
  for (let i = 0; i < fragmentCount; i++) {
    const fragment = document.createElement('div');
    fragment.className = 'chaos-fragment';
    
    const size = 40 + Math.random() * 120;
    fragment.style.width = `${size}px`;
    fragment.style.height = `${size}px`;
    
    fragment.style.position = 'fixed';
    fragment.style.left = `${Math.random() * 100}%`;
    fragment.style.top = `${Math.random() * 100}%`;
    
    fragment.style.transform = `rotate(${Math.random() * 360}deg) scale(${0.5 + Math.random()})`;
    
    const colorIndex = Math.floor(Math.random() * pastelColors.length);
    fragment.style.backgroundColor = pastelColors[colorIndex];
    
    const blendModes = ['screen', 'overlay', 'hard-light', 'soft-light'];
    fragment.style.mixBlendMode = blendModes[Math.floor(Math.random() * blendModes.length)];
    
    container.appendChild(fragment);
  }
}




function cleanupGlitchEffect(elements) {
  document.body.classList.remove('sentient-orb-activated');
  
  if (elements?.glitchEngine) {
    elements.glitchEngine.stopGlitching();
  } else if (window.currentGlitchEngine) {
    window.currentGlitchEngine.stopGlitching();
    window.currentGlitchEngine = null;
  }
  
  if (elements?.sentientText?.parentNode) {
    elements.sentientText.parentNode.removeChild(elements.sentientText);
  }
  
  if (elements?.chaosOverlay?.parentNode) {
    elements.chaosOverlay.parentNode.removeChild(elements.chaosOverlay);
  }
  
  document.querySelectorAll('.glitch-element').forEach(el => {
    if (el.id !== 'sentient-orb') {
      el.classList.remove('glitch-element');
    }
  });
}

// Initialization functions
function initializeStarfield() {
  const starScreen = document.getElementById("starScreen");
  const orbScreen = document.getElementById("orbScreen");

  if (!starScreen) {
    console.error("Stars container not found!");
    return;
  }
  
  createBasicStars(starScreen);
  createSentientOrb(orbScreen);
}

function createBasicStars(container) {
  const numStars = 80;
  const fragment = document.createDocumentFragment();
  
  for (let i = 0; i < numStars; i++) {
    const star = document.createElement("div");
    star.className = "star";
    
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    
    const size = Math.random() < 0.7 ? 
      Math.random() * 2 + 1 : 
      Math.random() * 3 + 2;
    
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    
    star.style.setProperty("--duration", `${3 + Math.random() * 4}s`);
    star.style.setProperty("--delay", `${Math.random() * 5}s`);
    star.style.setProperty("--brightness", `${0.6 + Math.random() * 0.4}`);
    
    fragment.appendChild(star);
  }
  
  container.appendChild(fragment);
}

function calculateSafePosition() {
  const isMobile = window.innerWidth <= 768;
  
  const desktopPositions = {
    topEdge: [
      { x: 2.7, y: 2.4 }, { x: 9.3, y: 3.9 }, { x: 14.9, y: 4.5 }, 
      { x: 23.8, y: 3.1 }, { x: 31, y: 3.1 }, { x: 37.3, y: 3.1 },
      { x: 69.6, y: 6.5 }
    ],
    rightEdge: [
      { x: 97.3, y: 42.3 }, { x: 96, y: 59 }, { x: 93.4, y: 66.8 },
      { x: 92.9, y: 77.8 }, { x: 96, y: 82.4 }, { x: 96, y: 93.4 },
      { x: 97, y: 29.4 }, { x: 96, y: 12.1 }
    ],
    bottomEdge: [
      { x: 12.9, y: 91.5 }, { x: 26.3, y: 92.2 }, { x: 73.3, y: 94 },
      { x: 85.8, y: 94 }
    ],
    leftEdge: [
      { x: 2.4, y: 10.4 }, { x: 2.5, y: 17.9 }, { x: 3.2, y: 32.2 },
      { x: 2.3, y: 53.5 }, { x: 3.7, y: 71.9 }, { x: 3.3, y: 91.5 }
    ],
    topRight: [
      { x: 83.6, y: 15.2 }, { x: 88.1, y: 17.2 }, { x: 91.7, y: 17 },
      { x: 89.3, y: 21.7 }, { x: 86.4, y: 29.5 }
    ],
    bottomRight: [
      { x: 84.2, y: 86.7 }, { x: 91.8, y: 71.9 }, { x: 93.3, y: 75.6 }
    ]
  };
  
  const mobilePositions = {
    topEdge: [
      { x: 6.4, y: 3.4 }, { x: 17.6, y: 3.7 }, { x: 28.5, y: 3.9 },
      { x: 45.6, y: 3.9 }, { x: 62.7, y: 3.9 }, { x: 79.7, y: 3.1 },
      { x: 92.8, y: 3.7 }, { x: 92.8, y: 7.8 }
    ],
    rightEdge: [
      { x: 94.4, y: 36.1 }, { x: 94.4, y: 67.8 }, { x: 94.1, y: 80.5 },
      { x: 95.5, y: 88 }, { x: 95.2, y: 63.9 }, { x: 95.2, y: 29.1 }
    ],
    bottomEdge: [
      { x: 81.6, y: 90.4 }, { x: 51.7, y: 90 }, { x: 41.9, y: 80.2 },
      { x: 65.3, y: 80.8 }
    ],
    leftEdge: [
      { x: 6.4, y: 85.5 }, { x: 6.4, y: 78 }, { x: 2.9, y: 67 },
      { x: 10.1, y: 16.5 }, { x: 7.7, y: 24 }
    ],
    topRight: [
      { x: 90.7, y: 22.6 }, { x: 89.6, y: 29.8 }
    ],
    bottomRight: [
      { x: 93.1, y: 71.7 }, { x: 80.3, y: 77.4 }, { x: 80.5, y: 77.1 }
    ]
  };
  
  const positions = isMobile ? mobilePositions : desktopPositions;
  let allPositions = [];
  
  allPositions = allPositions.concat(
    positions.topRight, positions.topRight,
    positions.bottomRight, positions.bottomRight,
    positions.rightEdge, positions.rightEdge
  );
  
  allPositions = allPositions.concat(
    positions.topEdge,
    positions.bottomEdge,
    positions.leftEdge
  );
  
  const randomIndex = Math.floor(Math.random() * allPositions.length);
  const basePosition = allPositions[randomIndex];
  
  return {
    x: basePosition.x + (Math.random() * 4 - 2),
    y: basePosition.y + (Math.random() * 4 - 2)
  };
}

function createSentientOrb(container) {
  const orb = document.createElement('div');
  orb.className = 'sentient-orb';
  orb.id = 'sentient-orb';
  
  orb.style.position = 'absolute';
  orb.style.left = '-20px';
  orb.style.top = '-20px';
  orb.style.width = '3.5px';
  orb.style.height = '3.5px';
  orb.style.backgroundColor = '#fff';
  orb.style.borderRadius = '50%';
  // orb.style.boxShadow = '0 0 10px 2px rgba(255, 255, 255, 0.7)';
  orb.style.cursor = 'pointer';
  orb.style.zIndex = '10000';
  orb.style.pointerEvents = 'auto';
  // orb.style.transition = 'left 0.5s ease-in-out, top 0.5s ease-in-out';
  
  container.appendChild(orb);
  
  const updatePosition = () => {
    const pos = calculateSafePosition();
    orb.style.left = `${pos.x}%`;
    orb.style.top = `${pos.y}%`;
  };
  
  orb.addEventListener('click', function() {
    if (!orb.dataset.glitching) {
      orb.dataset.glitching = 'true';
      const glitchElements = activateGlitchEffect();
      
      setTimeout(() => {
        cleanupGlitchEffect(glitchElements);
        orb.dataset.glitching = '';
        updatePosition();
      }, 2000);
    }
  });
  
  setTimeout(updatePosition, 500);
  window.addEventListener('resize', updatePosition);
  
  return orb;
}

document.addEventListener('DOMContentLoaded', initializeStarfield);