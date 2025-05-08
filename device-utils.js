const DeviceUtils = {
  // Device detection results
  isMobileDevice: false,
  isTouchDevice: false,
  viewportWidth: 0,
  viewportHeight: 0,
  isInitialized: false,
  
  // Initialize device detection
  init() {
    if (this.isInitialized) return this;
    
    // Detect mobile device
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileByUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isMobileViewport = (window.innerWidth < 768);
    this.isMobileDevice = isMobileByUA || isMobileViewport;
    
    // Detect touch capability
    this.isTouchDevice = ('ontouchstart' in window) || 
                         (navigator.maxTouchPoints > 0) || 
                         (navigator.msMaxTouchPoints > 0);
    
    // Store viewport dimensions
    this.viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    this.viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    
    // Add resize listener to update dimensions
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // console.log(`DeviceUtils initialized: Mobile=${this.isMobileDevice}, Touch=${this.isTouchDevice}, Viewport=${this.viewportWidth}x${this.viewportHeight}`);
    
    this.isInitialized = true;
    return this;
  },
  
  // Update dimensions on resize
  handleResize() {
    this.viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    this.viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    
    // Re-check mobile status on resize
    const isMobileViewport = (this.viewportWidth < 768);
    const wasMobile = this.isMobileDevice;
    
    // Update mobile status if viewport-based detection changes
    if (isMobileViewport !== this.isMobileDevice) {
      this.isMobileDevice = isMobileViewport;
      // console.log(`Device mobile status changed: ${wasMobile} → ${this.isMobileDevice}`);
    }
  },
  
  // Convenience methods - use these for consistent access
  isMobile() {
    return this.isMobileDevice;
  },
  
  isTouch() {
    return this.isTouchDevice;
  },
  
  getWidth() {
    return this.viewportWidth;
  },
  
  getHeight() {
    return this.viewportHeight;
  }
};

// Initialize immediately, but safely
if (typeof window !== 'undefined') {
window.DeviceUtils = DeviceUtils.init();

// Ensure it's initialized on DOMContentLoaded too
document.addEventListener('DOMContentLoaded', function() {
  window.DeviceUtils = window.DeviceUtils || DeviceUtils.init();
});
}





document.addEventListener('DOMContentLoaded', function() {
  // Prevent zooming on double-tap
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
  
  // Prevent pinch-zoom
  document.addEventListener('touchmove', function(event) {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });
  
  // Prevent touchstart from causing zoom behavior
  document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });
});


document.ontouchmove = function(event) {
  event.preventDefault();
};