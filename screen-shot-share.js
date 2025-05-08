
function initializeSocialSharing() {
    // console.log("Setting up social sharing and voice recording functionality");
  
    // Get references to social share buttons
    const downloadBtn = document.getElementById("download-screenshot");
    const twitterBtn = document.getElementById("share-twitter");
    const facebookBtn = document.getElementById("share-facebook");
    const blueskyBtn = document.getElementById("share-bluesky");
    const mastodonBtn = document.getElementById("share-mastodon");
    const shareBtn = document.getElementById("share-button");
  
    // Add native share button if supported
    if (navigator.share && !document.querySelector(".native-share-button")) {
      const buttonsRow = document.querySelector(".social-buttons-row");
      if (buttonsRow) {
        const nativeShareBtn = document.createElement("button");
        nativeShareBtn.className = "social-button native-share-button";
        nativeShareBtn.setAttribute("aria-label", "Share");
        nativeShareBtn.textContent = "↑";
        buttonsRow.insertBefore(nativeShareBtn, buttonsRow.firstChild);
  
        // Set up native share handler
        nativeShareBtn.addEventListener("click", () => shareContent("native"));
      }
    }
  
    // Set up social button click handlers
    if (downloadBtn) downloadBtn.addEventListener("click", () => captureAndDownload());
    if (twitterBtn) twitterBtn.addEventListener("click", () => shareContent("twitter"));
    if (facebookBtn) facebookBtn.addEventListener("click", () => shareContent("facebook"));
    if (blueskyBtn) blueskyBtn.addEventListener("click", () => shareContent("bluesky"));
    if (mastodonBtn) mastodonBtn.addEventListener("click", () => shareContent("mastodon"));
  
    // Special handling for the generic share button with possible data-action attribute
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        const action = shareBtn.getAttribute("data-action");
  
  
        if (action === "record-voice") {
          // console.log("Opening voice recording interface"); // Debug log
          openVoiceRecordingInterface();
        } else if (action === "external-link") {
          const link = shareBtn.getAttribute("data-link");
          if (link) {
            window.open(link, "_blank");
          }
        } else {
          // Default share behavior if no specific action
          shareContent(navigator.share ? "native" : "twitter");
        }
      });
    }
  
    // Helper function to get share text
    function getShareText() {
      const score = document.getElementById("final-score")?.textContent || "0";
      const blocksText = document.getElementById("blocks-stat")?.textContent || "0 attacks";
      const timeText = document.getElementById("time-stat")?.textContent || "0 months";
  
      return `I scored ${score} points in WHACK-A--HOLE: Shout! Smack! Fight back!! Blocked ${blocksText} and survived for ${timeText}. Join the resistance!`;
    }
  
    // Function to capture screenshot and download
    function captureAndDownload() {
      const gameOverScreen = document.getElementById("game-over-screen");
      if (!gameOverScreen) return;
  
      // Use html2canvas to capture the screen
      html2canvas(gameOverScreen)
        .then((canvas) => {
          // Get the score for filename
          const score = document.getElementById("final-score")?.textContent || "0";
  
          // Create download link
          const link = document.createElement("a");
          link.download = `welcome-to-the-resistance-score-${score}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
  
          // Copy share text to clipboard
          const shareText = getShareText();
          navigator.clipboard
            .writeText(shareText)
            .then(() => {
              // Show visual feedback
              if (downloadBtn) {
                downloadBtn.textContent = "✓";
                setTimeout(() => {
                  downloadBtn.textContent = "↓";
                }, 2000);
              }
            })
            .catch((err) => console.log("Could not copy text:", err));
        })
        .catch((err) => {
          console.error("Screenshot capture failed:", err);
        });
    }
  
    // Function to share content
    function shareContent(platform) {
      // Get data elements directly
      const score = document.getElementById("final-score")?.textContent || "0";
      const blocksText = document.getElementById("blocks-stat")?.textContent || "0 attacks";
      const timeText = document.getElementById("time-stat")?.textContent || "0 months";
      const shareUrl = window.location.href;
  
      let shareText = "";
  
      switch (platform) {
        case "native":
          shareText = `I scored ${score} points in WHACK-A--HOLE! Blocked ${blocksText} and survived for ${timeText}. Join the resistance!`;
          if (navigator.share) {
            navigator
              .share({
                title: "WHACK-A--HOLE Game",
                text: shareText,
                url: shareUrl,
              })
              .catch((err) => console.log("Share failed:", err));
          }
          break;
  
        case "twitter":
          // Twitter with line breaks
          shareText = `I scored ${score} points in WHACK-A--HOLE!\nBlocked ${blocksText} and survived for ${timeText}.\nJoin the resistance!\n\n(PS: After you play, let's meet up on Mastodon or Bluesky or really anywhere but here)`;
          window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank");
          break;
  
        case "facebook":
          // For Facebook, we'll use the simple share dialog
          shareText = `I scored ${score} points in WHACK-A--HOLE! Blocked ${blocksText} and survived for ${timeText}. Join the resistance!`;
          window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank");
          break;
  
        case "bluesky":
          // Bluesky with line breaks
          shareText = `I scored ${score} points in WHACK-A--HOLE!\n\nBlocked ${blocksText} and survived for ${timeText}.\n\nJoin the resistance!`;
          window.open(`https://bsky.app/intent/compose?text=${encodeURIComponent(shareText + "\n\n" + shareUrl)}`, "_blank");
          break;
  
        case "mastodon":
          // Mastodon with line breaks
          shareText = `I scored ${score} points in WHACK-A--HOLE!\n\nBlocked ${blocksText} and survived for ${timeText}.\n\nJoin the resistance!`;
          // Add image URL to help Mastodon pick up the preview
          const mastodonShareUrl = `${shareUrl}${shareUrl.includes("?") ? "&" : "?"}og_image=https://catodot.github.io/d/images/grab.png`;
          window.open(`https://mastodon.social/share?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(mastodonShareUrl)}`, "_blank");
          break;
      }
    }
  }
  
  function openVoiceRecordingInterface() {
    const recorderModal = document.getElementById("voice-recorder-modal");
  
    if (recorderModal) {
      // console.log("Showing voice recorder modal"); // Debug log
  
      // Explicitly remove hidden class and set display
      recorderModal.classList.remove("hidden");
      recorderModal.style.display = "flex";
      recorderModal.style.opacity = "1";
      recorderModal.style.visibility = "visible";
  
      // Create voice recorder if not exists
      if (!window.voiceRecorder) {
        window.voiceRecorder = new VoiceRecorder();
  
        // Just pass the modal ID - the VoiceRecorder class will handle finding
        // the elements inside it
        window.voiceRecorder.init("voice-recorder-modal");
      }
    } else {
      console.error("Recorder modal not found!");
      // console.log("Recorder Modal:", recorderModal);
    }
  }
  
  /**
   * Sets up the voice recorder modal close functionality
   */
  function setupVoiceRecorderModal() {
    const closeBtn = document.getElementById("close-recorder");
    const recorderModal = document.getElementById("voice-recorder-modal");
  
    if (closeBtn && recorderModal) {
      closeBtn.addEventListener("click", () => {
        recorderModal.classList.add("hidden");
        recorderModal.style.display = "none";
        recorderModal.style.opacity = "0";
        recorderModal.style.visibility = "hidden";
      });
    } else {
      console.error("Close button or modal not found");
      // console.log("Close Button:", closeBtn);
      // console.log("Recorder Modal:", recorderModal);
    }
  }
  
  /**
   * Initialize everything when the game over screen is shown
   */
  function initializeShareButtonsOnGameOver() {
    // console.log("Initializing share buttons"); // Debug log
  
    // Short timeout to ensure all game-over elements are fully rendered
    setTimeout(() => {
      initializeSocialSharing();
    }, 100);
  }
  
  // Set up voice recorder modal when DOM content is loaded
  document.addEventListener("DOMContentLoaded", setupVoiceRecorderModal);
  