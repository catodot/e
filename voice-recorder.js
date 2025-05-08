class VoiceRecorder {
    constructor(options = {}) {
      // Configuration options
      this.maxRecordingLength = options.maxRecordingLength || 2000; // 2 seconds
      this.locations = ["Canada", "Greenland", "Mexico", "Turtle Island", "Other"];
  
      // State management
      this.recordings = [];
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.isRecording = false;
      this.selectedLocation = "";
      this.otherLocation = "";
      this.audioStream = null;
      this.recordingStartTime = 0;
      this.timerInterval = null;
  
      // Playback state
      this.currentlyPlaying = null;
      this.playbackInterval = null;

      this.glowOutline = new GlowOutline();


  
      // DOM Elements
      this.elements = {
        modal: null,
        recordButton: null,
        recordLabel: null,
        recordingTimer: null,
        recordingsContainer: null,
        recordingsList: null,
        locationSelect: null,
        otherLocationContainer: null,
        otherLocationInput: null,
        sendButton: null,
        closeButton: null,
        thankYouMessage: null,
        closeThankYouButton: null,
        recordingInfo: null
      };
  
      // Cloudinary config
      this.cloudName = "dvpixsxz0";
      this.uploadPreset = "catodot";
      this.uploadedUrls = [];
  
      // Detect mobile/iOS
      this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
      this.hasTriedGeolocation = false;
      
      // Audio analysis properties
      this.analyser = null;
      this.dataArray = null;
      this.volumeHistory = [];
      this.analyzerAnimationFrame = null;
    }
  
    init() {
      // Find all required DOM elements
      this.elements.modal = document.getElementById("voice-recorder-modal");
      this.elements.recordButton = document.getElementById("record-button");
      this.elements.recordLabel = this.elements.recordButton.querySelector(".record-label");
      this.elements.recordingTimer = document.getElementById("recording-timer");
      this.elements.recordingsContainer = document.getElementById("recordings-container");
      this.elements.recordingsList = document.getElementById("recordings-list");
      this.elements.locationSelect = document.getElementById("location-select");
      this.elements.otherLocationContainer = document.getElementById("other-location-container");
      this.elements.otherLocationInput = document.getElementById("other-location");
      this.elements.sendButton = document.getElementById("send-recording");
      this.elements.closeButton = document.getElementById("close-recorder");
      this.elements.thankYouMessage = document.getElementById("thank-you-message");
      this.elements.closeThankYouButton = document.getElementById("close-thank-you");
      this.elements.recordingInfo = document.getElementById("recording-info");

      // Set initial timer text
      this.elements.recordingTimer.textContent = "2.0 seconds";

      // Initialize audio context
      this.initAudioContext();
  
      // Set up event listeners
      this.setupEventListeners();
  
      // Try to detect location
      this.fetchLocationFromIP();
  
      // Show recordings container if there are any
      if (this.recordings.length > 0) {
        this.elements.recordingsContainer.classList.remove("hidden");
      }
      this.buttonGlow = this.glowOutline.addToRecordButton(this.elements.recordButton);

    }
  
    setupEventListeners() {
      // Setup handlers using the utility
      this.elements.recordButton = setupEventHandlers(this.elements.recordButton, {
        click: this.handleRecordButton.bind(this),
      });
  
      this.elements.locationSelect = setupEventHandlers(this.elements.locationSelect, {
        change: (e) => {
          this.selectedLocation = e.target.value;
          if (this.selectedLocation === "Other") {
            this.elements.otherLocationContainer.classList.remove("hidden");
          } else {
            this.elements.otherLocationContainer.classList.add("hidden");
          }
          this.validateSendButton();
        },
      });
  
      this.elements.otherLocationInput = setupEventHandlers(this.elements.otherLocationInput, {
        input: (e) => {
          this.otherLocation = e.target.value;
          this.validateSendButton();
        },
      });
  
      this.elements.sendButton = setupEventHandlers(this.elements.sendButton, {
        click: this.handleSendButton.bind(this),
      });
  
      this.elements.closeButton = setupEventHandlers(this.elements.closeButton, {
        click: this.closeRecorder.bind(this),
      });
  
      this.elements.closeThankYouButton = setupEventHandlers(this.elements.closeThankYouButton, {
        click: () => {
          this.elements.thankYouMessage.classList.add("hidden");
        },
      });
    }
  
    fetchLocationFromIP() {
      if (this.hasTriedGeolocation) return;
      this.hasTriedGeolocation = true;
  
      fetch("https://ipapi.co/json/")
        .then((response) => response.json())
        .then((data) => {
          const country = data.country_name;
          let matchFound = false;
  
          for (const location of this.locations) {
            if (
              location === country ||
              (country === "United States" && location === "Turtle Island") ||
              (country === "Denmark" && location === "Greenland")
            ) {
              this.selectedLocation = location;
              matchFound = true;
              break;
            }
          }
  
          if (!matchFound) {
            this.selectedLocation = "Other";
            this.otherLocation = country;
          }
  
          if (this.elements.locationSelect) {
            this.elements.locationSelect.value = this.selectedLocation;
  
            if (this.selectedLocation === "Other") {
              this.elements.otherLocationContainer.classList.remove("hidden");
              this.elements.otherLocationInput.value = this.otherLocation;
            }
  
            this.validateSendButton();
          }
        })
        .catch((error) => {
          console.error("Error detecting location:", error);
        });
    }
  
    handleRecordButton(e) {
      e.preventDefault();
      e.stopPropagation();
  
      if (this.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording();
      }
      const originalHandleRecordButton = this.handleRecordButton.bind(this);
        this.handleRecordButton = (e) => {
            originalHandleRecordButton(e);
            
            // Update glow color based on state
            if (this.isRecording) {
                this.glowOutline.updateGlowColor(this.buttonGlow, '#ea1487'); // Red when recording
            } else if (this.elements.recordButton.classList.contains('waiting')) {
                this.glowOutline.updateGlowColor(this.buttonGlow, '#f39c12'); // Yellow when waiting
            } else {
                this.glowOutline.updateGlowColor(this.buttonGlow, '#2ecc71'); // Green by default
            }
        };
    }
  
    handleSendButton(e) {
      e.preventDefault();
      e.stopPropagation();
  
      this.userInteracted = true;
      this.sendRecordings();
    }
  
    updateTimerDisplay(timeInMs) {
      const seconds = timeInMs / 1000;
      const displayValue = seconds.toFixed(1);
      this.elements.recordingTimer.textContent = `${displayValue} seconds`;
    }
  
    startRecording() {
      if (this.isRecording) return;
      
      if (!window.recordingCount) window.recordingCount = 0;

      if (window.recordingCount >= 3) {
        const errorElement = document.getElementById('recorder-error-message');
        if (errorElement) {
          errorElement.textContent = "3 recordings is enough. Hit 'add to game'!";
          errorElement.style.display = 'block';
        }
        return;
      }

      window.recordingCount++;


      // Reset audio chunks
      this.audioChunks = [];
      
      // Show "waiting for permission" state
      this.elements.recordButton.classList.add("waiting");
      this.elements.recordLabel.textContent = "WAITING";
      this.elements.recordingTimer.textContent = "Waiting...";
      
      // Request microphone access
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          // Permission granted
          this.elements.recordButton.classList.remove("waiting");
          this.audioStream = stream;
          
          // Setup audio analysis for volume detection
          this.setupAudioAnalysis(stream);
          
          // Setup MediaRecorder with options
          let options = {};
          if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
            options = { mimeType: "audio/webm;codecs=opus" };
          } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            options = { mimeType: "audio/mp4" };
          }
          
          try {
            this.mediaRecorder = new MediaRecorder(stream, options);
          } catch (err) {
            console.warn("Error with specified mime type, falling back to default", err);
            this.mediaRecorder = new MediaRecorder(stream);
          }
          
          // Handle recording data
          this.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              this.audioChunks.push(event.data);
            }
          };
          
          // Handle recording stop
          this.mediaRecorder.onstop = () => {
            if (this.audioChunks.length === 0) {
              console.error("No audio data captured");
              this.resetRecording();
              return;
            }
            
            setTimeout(() => {
              // Create audio blob and URL
              const mimeType = this.mediaRecorder.mimeType || "audio/webm";
              const audioBlob = new Blob(this.audioChunks, { type: mimeType });
              const audioUrl = URL.createObjectURL(audioBlob);
              
              // Use the intended duration (what was shown to the user)
              const duration = this.maxRecordingLength / 1000;
              const formattedDuration = Math.round(duration);
              
              // Use the waveform data we collected silently during recording
              const waveformData = this.volumeHistory;
              
              // Add to recordings
              this.recordings.push({
                blob: audioBlob,
                url: audioUrl,
                duration: formattedDuration,
                waveform: waveformData,
              });
              
              // Update UI to show the recording (with waveform) for playback
              this.updateRecordingsList();
              this.resetRecording();
              
              // Show recordings container
              this.elements.recordingsContainer.classList.remove("hidden");
            }, 200);
          };
          
          // Request data in chunks
          this.mediaRecorder.start(100);
          
          // Short delay to ensure the recorder is fully started
          setTimeout(() => {
            // Update UI to recording state
            this.elements.recordButton.classList.add("recording");
            this.elements.recordLabel.textContent = "STOP";
            
            // Show recording info
            this.elements.recordingInfo.classList.add("active");
            
            // Start the timer
            this.recordingStartTime = Date.now();
            this.updateTimerDisplay(this.maxRecordingLength);
            
            this.isRecording = true;
            
            // Update timer counting down
            this.timerInterval = setInterval(() => {
              const elapsed = Date.now() - this.recordingStartTime;
              const remaining = Math.max(0, this.maxRecordingLength - elapsed);
              
              this.updateTimerDisplay(remaining);
              
              if (remaining <= 0) {
                // Update UI immediately to show recording has stopped
                this.elements.recordingTimer.textContent = "0.0 seconds";
                clearInterval(this.timerInterval);
                this.timerInterval = null;
                
                // But continue actual recording silently for a bit longer
                setTimeout(() => {
                  if (this.mediaRecorder && this.isRecording) {
                    this.mediaRecorder.requestData();
                    setTimeout(() => {
                      this.stopRecording();
                    }, 100);
                  }
                }, 500); // Continue recording silently for 500ms
              }
            }, 10);
            
            // Safety timeout
            setTimeout(() => {
              if (this.isRecording) {
                this.stopRecording();
              }
            }, this.maxRecordingLength + 1000);
          }, 100);
        })
        .catch((err) => {
          console.error("Error accessing microphone:", err);
          this.resetRecording();
          
          if (err.name === "NotAllowedError") {
            alert("Please allow microphone access to record.");
          } else {
            alert("Error accessing microphone. Please try again.");
          }
        });
    }
  
    setupAudioAnalysis(stream) {
      // Initialize audio context for volume analysis
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const mediaStreamSource = audioContext.createMediaStreamSource(stream);
      
      // Create analyzer node with smaller FFT size for faster updates and more responsive bars
      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.3;
      mediaStreamSource.connect(this.analyser);
      
      // Buffer for analysis
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      
      // Track volume history for the waveform
      this.volumeHistory = [];
      
      // Start analysis immediately
      this.analyzeVolume();
    }
  
    analyzeVolume() {
        if (!this.isRecording || !this.analyser) return;
        
        // Get volume data
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Calculate average volume (0-255)
        let sum = 0;
        let peaks = 0;
        
        // Focus on frequencies that are most relevant to human voice
        const relevantRange = Math.min(this.dataArray.length, 40);
        
        for (let i = 0; i < relevantRange; i++) {
          sum += this.dataArray[i];
          // Count data points over 50% volume
          if (this.dataArray[i] > 127) peaks++;
        }
        
        const avgVolume = sum / relevantRange;
        
        // Scale to make bars dramatically taller
        const volumePercent = Math.min(95, Math.max(10, (avgVolume / 255) * 200));
        
        // Boost when peaks are detected
        const boostFactor = peaks > 2 ? 1.3 : (peaks > 0 ? 1.1 : 0.9);
        const adjustedVolume = Math.min(95, volumePercent * boostFactor);
        
        // Add to history with a minimum height to ensure visibility
        this.volumeHistory.push(Math.max(10, adjustedVolume));
        
        // Continue analyzing with higher frequency
        this.analyzerAnimationFrame = requestAnimationFrame(() => this.analyzeVolume());
      }
    
      stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) return;
        
        this.isRecording = false; // Mark as not recording immediately
        
        // Request final data chunk before stopping
        if (this.mediaRecorder.state === "recording") {
          try {
            this.mediaRecorder.requestData();
            
            // Small delay after requesting final data
            setTimeout(() => {
              try {
                if (this.mediaRecorder.state === "recording") {
                  this.mediaRecorder.stop();
                }
              } catch (e) {
                console.error("Error stopping MediaRecorder:", e);
                this.cleanupAudioResources();
              }
            }, 100);
          } catch (e) {
            console.error("Error requesting final data:", e);
            
            // Try to stop anyway
            try {
              if (this.mediaRecorder.state === "recording") {
                this.mediaRecorder.stop();
              }
            } catch (e2) {
              console.error("Error stopping MediaRecorder:", e2);
            }
            
            this.cleanupAudioResources();
          }
        }
        
        // Cancel the animation frame to stop volume analysis
        if (this.analyzerAnimationFrame) {
          cancelAnimationFrame(this.analyzerAnimationFrame);
          this.analyzerAnimationFrame = null;
        }
        
        // Clean up analysis resources
        this.analyser = null;
        this.dataArray = null;
        
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      }
    
      cleanupAudioResources() {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
    
        if (this.audioStream) {
          const tracks = this.audioStream.getTracks();
          tracks.forEach((track) => {
            track.stop();
          });
          this.audioStream = null;
        }
    
        if (this.mediaRecorder) {
          if (this.mediaRecorder.state !== "inactive") {
            try {
              this.mediaRecorder.stop();
            } catch (e) {
              console.warn("Error stopping MediaRecorder:", e);
            }
          }
          this.mediaRecorder = null;
        }
    
        this.isRecording = false;
      }
    
      initAudioContext() {
        // Fix for iOS Safari - create and resume AudioContext on user interaction
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          console.warn("AudioContext is not supported in this browser");
          return;
        }
    
        this.audioContext = new AudioContext();
    
        if (this.audioContext.state === "suspended") {
          const resumeOnInteraction = () => {
            this.audioContext
              .resume()
              .then(() => {
                console.log("AudioContext resumed successfully");
              })
              .catch((err) => {
                console.error("Failed to resume AudioContext:", err);
              });
    
            document.removeEventListener("touchstart", resumeOnInteraction);
            document.removeEventListener("click", resumeOnInteraction);
          };
    
          document.addEventListener("touchstart", resumeOnInteraction);
          document.addEventListener("click", resumeOnInteraction);
        }
      }
    
      resetRecording() {
        // Reset UI
        this.elements.recordButton.classList.remove("waiting");
        this.elements.recordButton.classList.remove("recording");
        this.elements.recordLabel.textContent = "RECORD";
        this.elements.recordingTimer.textContent = "2.0 seconds";
        
        // Hide recording info
        this.elements.recordingInfo.classList.remove("active");
        
        // Clean up audio analysis
        this.analyser = null;
        this.dataArray = null;
        
        // Clean up animation frame
        if (this.analyzerAnimationFrame) {
          cancelAnimationFrame(this.analyzerAnimationFrame);
          this.analyzerAnimationFrame = null;
        }
        
        // Clean up
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        
        if (this.audioStream) {
          this.audioStream.getTracks().forEach((track) => track.stop());
          this.audioStream = null;
        }
        
        this.isRecording = false;
      }
    
      updateRecordingsList() {
        const recordingsList = this.elements.recordingsList;
        recordingsList.innerHTML = "";
        
        if (this.recordings.length === 0) {
          return;
        }
        
        // Display all recordings, newest first
        [...this.recordings].reverse().forEach((recording, index) => {
          const actualIndex = this.recordings.length - 1 - index;
          const recordingElement = document.createElement("div");
          recordingElement.className = "recording-item";
          recordingElement.dataset.index = actualIndex;
          
          // Create play button and content structure
          recordingElement.innerHTML = `
            <button class="play-button" aria-label="Play recording">
              <img src="https://catodot.github.io/d/images/play-icon.png" alt="Play">
            </button>
            
            <div class="recording-content">
              <div class="waveform-container">
                <div class="waveform-track"></div>
                <div class="waveform-progress"></div>
              </div>
            </div>
            
            <button class="delete-button" aria-label="Delete recording">
              <img src="https://catodot.github.io/d/images/trash-icon.png" alt="Delete">
            </button>
          `;
          
          // Add waveform bars based on the recording's volume history
          const waveformTrack = recordingElement.querySelector(".waveform-track");
          
          // If we have volume history data for this recording
          if (Array.isArray(recording.waveform) && recording.waveform.length > 0) {
            // Use recorded waveform data
            recording.waveform.forEach(volume => {
              const bar = document.createElement("div");
              bar.className = "waveform-bar";
              bar.style.height = `${Math.max(5, volume)}%`;
              waveformTrack.appendChild(bar);
            });
          } else {
            // Fallback to random bars if no volume data
            for (let i = 0; i < 40; i++) {
              const bar = document.createElement("div");
              bar.className = "waveform-bar";
              const height = 15 + Math.floor(Math.random() * 60);
              bar.style.height = `${height}%`;
              waveformTrack.appendChild(bar);
            }
          }
          
          // Play button functionality
          const playButton = recordingElement.querySelector(".play-button");
          const waveformProgress = recordingElement.querySelector(".waveform-progress");
          
          playButton.addEventListener("click", (e) => {
            e.preventDefault();
            this.stopAllPlayback();
            
            const audio = new Audio(recording.url);
            audio.loop = false;
            
            playButton.classList.add("playing");
            recordingElement.classList.add("playing");
            
            audio.addEventListener("ended", () => {
              this.stopAllPlayback();
            });
            
            audio.play()
              .then(() => {
                const duration = parseFloat(recording.duration);
                
                this.currentlyPlaying = {
                  audio: audio,
                  element: recordingElement,
                  duration: duration,
                };
                
                this.playbackInterval = setInterval(() => {
                  if (!audio || audio.paused || audio.ended) {
                    this.stopAllPlayback();
                    return;
                  }
                  
                  const progress = Math.min(audio.currentTime / duration, 1);
                  waveformProgress.style.transform = `scaleX(${progress})`;
                }, 50);
              })
              .catch((err) => {
                console.error("Playback error:", err);
                this.stopAllPlayback();
              });
          });
          
          // Delete button functionality
          const deleteButton = recordingElement.querySelector(".delete-button");
          deleteButton.addEventListener("click", (e) => {
            e.preventDefault();
            this.stopAllPlayback();
            
            // Remove from recordings array
            URL.revokeObjectURL(recording.url);
            this.recordings.splice(actualIndex, 1);
            
            // Decrement the global recording count
  window.recordingCount = Math.max(0, (window.recordingCount || 1) - 1);
  

            // Update UI
            this.updateRecordingsList();
            
            // Hide container if no recordings
            if (this.recordings.length === 0) {
              this.elements.recordingsContainer.classList.add("hidden");
            }
            
            this.validateSendButton();
          });
          
          recordingsList.appendChild(recordingElement);
        });
        
        this.validateSendButton();
      }
    
      stopAllPlayback() {
        if (this.playbackInterval) {
          clearInterval(this.playbackInterval);
          this.playbackInterval = null;
        }
    
        if (this.currentlyPlaying && this.currentlyPlaying.audio) {
          try {
            this.currentlyPlaying.audio.pause();
            this.currentlyPlaying.audio.currentTime = 0;
    
            if (this.currentlyPlaying.element) {
              const playButton = this.currentlyPlaying.element.querySelector(".play-button");
              if (playButton) playButton.classList.remove("playing");
    
              this.currentlyPlaying.element.classList.remove("playing");
    
              const waveformProgress = this.currentlyPlaying.element.querySelector(".waveform-progress");
              if (waveformProgress) {
                waveformProgress.style.transform = "scaleX(0)";
              }
            }
          } catch (e) {
            console.warn("Error stopping playback:", e);
          }
    
          this.currentlyPlaying = null;
        }
    
        // Reset all play buttons and progress bars
        if (this.elements.recordingsList) {
          const allPlayButtons = this.elements.recordingsList.querySelectorAll(".play-button");
          allPlayButtons.forEach((button) => button.classList.remove("playing"));
    
          const allItems = this.elements.recordingsList.querySelectorAll(".recording-item");
          allItems.forEach((item) => item.classList.remove("playing"));
    
          const allProgress = this.elements.recordingsList.querySelectorAll(".waveform-progress");
          allProgress.forEach((progress) => (progress.style.transform = "scaleX(0)"));
        }
      }
    
      validateSendButton() {
        // const isValid = this.recordings.length > 0 && this.selectedLocation && 
        //                 (this.selectedLocation !== "Other" || this.otherLocation.trim() !== "");
    
        const isValid = this.recordings.length > 0;

        this.elements.sendButton.disabled = !isValid;
      }
    
      sendRecordings() {
        if (this.recordings.length === 0) {
          console.error("No recordings to send");
          return;
        }
    
        // Stop any playing audio
        this.stopAllPlayback();
    
        const location = this.selectedLocation === "Other" ? this.otherLocation : this.selectedLocation;
    
        // Show loading state
        this.elements.sendButton.disabled = true;
        this.elements.sendButton.textContent = "Uploading...";
    
        // Track uploads
        let uploadedCount = 0;
        let uploadErrors = 0;
        this.uploadedUrls = [];
    
        // Process each recording
        this.recordings.forEach((recording, index) => {
          const fileName = `voice_${location.replace(/\s+/g, "_")}_${Date.now()}_${index}`;
    
          const formData = new FormData();
          formData.append("file", recording.blob);
          formData.append("upload_preset", this.uploadPreset);
          formData.append("tags", location);
          formData.append("context", `location=${location}`);
          formData.append("resource_type", "video"); // Cloudinary uses 'video' for audio files
          formData.append("public_id", `audio/new/${fileName}`);
    
          // Create a timeout for the upload
          const uploadTimeout = setTimeout(() => {
            console.error("Upload timeout for recording " + index);
            uploadedCount++;
            uploadErrors++;
    
            if (uploadedCount === this.recordings.length) {
              this.handleUploadCompletion(uploadErrors > 0);
            }
          }, 30000); // 30 second timeout
    
          // Upload to Cloudinary
                    fetch(`https://meadowbreeze.anondns.net/upload/upload`, {

          // fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/upload`, {
            method: "POST",
            body: formData,
          })
            .then((response) => {
              clearTimeout(uploadTimeout);
    
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              return response.json();
            })
            .then((data) => {
              if (data.secure_url) {
                this.uploadedUrls.push(data.secure_url);
              } else {
                throw new Error("No URL in response");
              }
    
              uploadedCount++;
    
              // When all uploads are complete
              if (uploadedCount === this.recordings.length) {
                this.handleUploadCompletion(uploadErrors > 0);
              }
            })
            .catch((error) => {
              clearTimeout(uploadTimeout);
              console.error("Upload error:", error);
              uploadedCount++;
              uploadErrors++;
    
              if (uploadedCount === this.recordings.length) {
                this.handleUploadCompletion(uploadErrors > 0);
              }
            });
        });
      }
    
      handleUploadCompletion(hasError = false) {
        this.elements.sendButton.disabled = false;
        this.elements.sendButton.textContent = "SEND RECORDING";
    
        if (hasError) {
          // alert("Some uploads failed. Please try again.");
          // return;
        }
    
        // Success - show thank you message
        this.showThankYouMessage();
    
        // Clean up
        this.recordings.forEach((recording) => {
          URL.revokeObjectURL(recording.url);
        });
    
 window.recordingCount = 0;
    this.recordings = [];        this.elements.recordingsContainer.classList.add("hidden");
        this.elements.recordingsList.innerHTML = "";
        this.elements.modal.classList.add("hidden");
      }
    
      showThankYouMessage() {
        this.elements.thankYouMessage.classList.remove("hidden");
      }
    
      closeRecorder() {
        this.stopAllPlayback();
        this.elements.modal.classList.add("hidden");
      }
    
      show() {
        this.elements.modal.classList.remove("hidden");
      }
  }
  
  // Make it globally available
  window.VoiceRecorder = VoiceRecorder;