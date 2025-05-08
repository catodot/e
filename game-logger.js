class GameLogger {
  constructor(options = {}) {
    // Initialize DebugUtil first if it hasn't been
    if (!window.DebugUtil) {
      window.DebugUtil = {
        enabled: options.enabled || false,
        categories: {},
        init(opts = {}) {
          this.enabled = opts.enabled !== undefined ? opts.enabled : this.enabled;
          this.categories = { ...this.categories, ...opts.categories };
          return this;
        },
        log: console.log.bind(console),
        info: console.info.bind(console),
        debug: console.debug.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
      };
    }
    
    // Set up debug options
    window.DebugUtil.init({
      enabled: options.enabled !== undefined ? options.enabled : true,
      categories: this.convertToDebugCategories(options.categories)
    });
    
    // Store reference
    this.debugUtil = window.DebugUtil;
    
    // Log initialization
    this.info('system', 'Logger initialized');
  }
  
  // Convert GameLogger categories to DebugUtil format
  convertToDebugCategories(categories = {}) {
    const result = {};
    for (const cat in categories) {
      result[cat] = !!categories[cat]; // Convert to boolean
    }
    return result;
  }

  
  
  // Forward logging methods to DebugUtil
  error(category, message, ...args) {
    this.debugUtil.error(category, message, ...args);
  }
  
  warn(category, message, ...args) {
    this.debugUtil.warn(category, message, ...args);
  }
  
  info(category, message, ...args) {
    this.debugUtil.info(category, message, ...args);
  }
  
  debug(category, message, ...args) {
    this.debugUtil.debug(category, message, ...args);
  }
  
  trace(category, message, ...args) {
    // Trace maps to debug in DebugUtil
    this.debugUtil.debug(category, `[TRACE] ${message}`, ...args);
  }
  
  // Category management methods
  toggleCategory(category, enabled = null) {
    if (enabled === null) {
      // Toggle current value
      const current = this.debugUtil.categories[category] || false;
      this.debugUtil.categories[category] = !current;
      return !current;
    } else {
      // Set to specified value
      this.debugUtil.categories[category] = !!enabled;
      return !!enabled;
    }
  }
  
  toggleLevel(level, enabled = null) {
    // For compatibility, simulate the level functionality
    // In our new implementation we don't have levels, but we'll log an info message
    this.info('system', `Level toggling not supported in new logger implementation`);
    return false;
  }
  
  enableAllCategories() {
    for (const category in this.debugUtil.categories) {
      this.debugUtil.categories[category] = true;
    }
    this.info('system', 'All logging categories enabled');
  }
  
  disableAllCategories() {
    for (const category in this.debugUtil.categories) {
      this.debugUtil.categories[category] = false;
    }
    this.info('system', 'All logging categories disabled');
  }
  
  // Stub for compatibility - these functions can be simplified
  group() { return { end: () => {} }; }
  time() { return { end: () => {} }; }
}

// Export for both browser and Node.js environments
if (typeof window !== 'undefined') {
  window.GameLogger = GameLogger;
} else if (typeof module !== 'undefined') {
  module.exports = GameLogger;
}