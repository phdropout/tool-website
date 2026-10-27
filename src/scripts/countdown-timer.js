const root = document.querySelector("[data-countdown-timer]");

if (root) {
  const hoursInput = root.querySelector("#hoursInput");
  const minutesInput = root.querySelector("#minutesInput");
  const secondsInput = root.querySelector("#secondsInput");
  const timerTitleInput = root.querySelector("#timerTitleInput");
  const timerMessageInput = root.querySelector("#timerMessageInput");
  const timerTitle = root.querySelector("#timerTitle");
  const timerMessage = root.querySelector("#timerMessage");
  const timerDisplay = root.querySelector("#timerDisplay");
  const timerStage = root.querySelector("#timerStage");
  const startPauseButton = root.querySelector("#startPauseButton");
  const resetButton = root.querySelector("#resetButton");
  const fullscreenButton = root.querySelector("#fullscreenButton");
  const fullscreenLabel = root.querySelector("#fullscreenLabel");
  const progressBar = root.querySelector("#progressBar");
  const endTimeValue = root.querySelector("#endTimeValue");
  const timerStatus = root.querySelector("#timerStatus");
  const soundToggle = root.querySelector("#soundToggle");
  const adjustmentButtons = root.querySelectorAll("[data-adjust]");

  let totalDuration = getInputSeconds();
  let remainingSeconds = totalDuration;
  let endTimestamp = null;
  let timerInterval = null;
  let isRunning = false;
  let hasStarted = false;
  let hasFinished = false;
  let audioContext = null;
  let wakeLock = null;

  updatePresentationText();
  updateDisplay();
  updateProgress();
  updateEndTime();

  [hoursInput, minutesInput, secondsInput].forEach((input) => {
    input.addEventListener("input", handleTimeInput);
    input.addEventListener("change", normalizeInputs);
  });

  timerTitleInput.addEventListener("input", updatePresentationText);
  timerMessageInput.addEventListener("input", updatePresentationText);

  startPauseButton.addEventListener("click", toggleTimer);
  resetButton.addEventListener("click", resetTimer);
  fullscreenButton.addEventListener("click", toggleFullscreen);

  adjustmentButtons.forEach((button) => {
    button.addEventListener("click", () => adjustTimer(Number(button.dataset.adjust)));
  });

  document.addEventListener("fullscreenchange", () => {
    fullscreenLabel.textContent =
      document.fullscreenElement === timerStage
        ? "Exit fullscreen"
        : "Present fullscreen";
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && isRunning) {
      await requestWakeLock();
    }
  });

  window.addEventListener("pagehide", releaseWakeLock);

  document.addEventListener("keydown", (event) => {
    const activeElement = document.activeElement;
    const isTyping =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement;

    if (isTyping) return;

    if (event.code === "Space") {
      event.preventDefault();
      toggleTimer();
    } else if (event.key.toLowerCase() === "r") {
      resetTimer();
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  });

  function getInputSeconds() {
    return (
      Math.max(0, Number(hoursInput.value) || 0) * 3600 +
      Math.max(0, Number(minutesInput.value) || 0) * 60 +
      Math.max(0, Number(secondsInput.value) || 0)
    );
  }

  function normalizeInputs() {
    hoursInput.value = clampValue(hoursInput.value, 0, 99);
    minutesInput.value = clampValue(minutesInput.value, 0, 59);
    secondsInput.value = clampValue(secondsInput.value, 0, 59);
  }

  function clampValue(value, minimum, maximum) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return minimum;
    return Math.min(Math.max(number, minimum), maximum);
  }

  function handleTimeInput() {
    normalizeInputs();
    if (isRunning) return;

    totalDuration = getInputSeconds();
    remainingSeconds = totalDuration;
    hasStarted = false;
    hasFinished = false;

    startPauseButton.textContent = "Start timer";
    timerStatus.textContent = "Ready";

    updateDisplay();
    updateProgress();
    updateEndTime();
    updateTimerState();
  }

  function toggleTimer() {
    if (isRunning) pauseTimer();
    else startTimer();
  }

  async function startTimer() {
    if (hasFinished || remainingSeconds <= 0) {
      totalDuration = getInputSeconds();
      remainingSeconds = totalDuration;
      hasFinished = false;
    }

    if (remainingSeconds <= 0) {
      timerStatus.textContent = "Set a duration";
      return;
    }

    unlockAudio();

    isRunning = true;
    hasStarted = true;
    endTimestamp = Date.now() + remainingSeconds * 1000;

    startPauseButton.textContent = "Pause";
    timerStatus.textContent = "Running";

    updateEndTime();

    clearInterval(timerInterval);
    timerInterval = window.setInterval(updateTimer, 200);
    updateTimer();

    await requestWakeLock();
  }

  async function pauseTimer() {
    if (!isRunning) return;

    updateRemainingTime();
    isRunning = false;

    clearInterval(timerInterval);
    timerInterval = null;

    startPauseButton.textContent = "Resume";
    timerStatus.textContent = "Paused";

    updateDisplay();
    updateProgress();
    updateEndTime();

    await releaseWakeLock();
  }

  function updateTimer() {
    updateRemainingTime();
    updateDisplay();
    updateProgress();
    updateTimerState();

    if (remainingSeconds <= 0) finishTimer();
  }

  function updateRemainingTime() {
    if (!isRunning || endTimestamp === null) return;
    remainingSeconds = Math.max(0, (endTimestamp - Date.now()) / 1000);
  }

  async function finishTimer() {
    remainingSeconds = 0;
    isRunning = false;
    hasFinished = true;

    clearInterval(timerInterval);
    timerInterval = null;

    startPauseButton.textContent = "Restart timer";
    timerStatus.textContent = "Time is up";
    endTimeValue.textContent = "Now";

    updateDisplay();
    updateProgress();
    updateTimerState();

    await releaseWakeLock();

    if (soundToggle.checked) playTimerSound();
  }

  async function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;

    isRunning = false;
    hasStarted = false;
    hasFinished = false;
    endTimestamp = null;

    totalDuration = getInputSeconds();
    remainingSeconds = totalDuration;

    startPauseButton.textContent = "Start timer";
    timerStatus.textContent = "Ready";

    updateDisplay();
    updateProgress();
    updateEndTime();
    updateTimerState();

    await releaseWakeLock();
  }

  function adjustTimer(seconds) {
    updateRemainingTime();

    const newRemaining = Math.max(0, remainingSeconds + seconds);
    const durationDelta = newRemaining - remainingSeconds;

    remainingSeconds = newRemaining;
    totalDuration = Math.max(newRemaining, totalDuration + durationDelta);

    if (hasStarted && newRemaining <= 0) {
      if (!hasFinished) finishTimer();
      return;
    }

    hasFinished = false;

    if (isRunning) {
      endTimestamp = Date.now() + newRemaining * 1000;
    } else {
      // Setup adjustments configure the next timer. Once started, adjustments
      // change only the current session so Reset keeps its configured duration.
      if (!hasStarted) setInputsFromSeconds(remainingSeconds);
      startPauseButton.textContent = hasStarted ? "Resume" : "Start timer";
      timerStatus.textContent = hasStarted ? "Paused" : "Ready";
    }

    updateDisplay();
    updateProgress();
    updateEndTime();
    updateTimerState();
  }

  function setInputsFromSeconds(totalSeconds) {
    const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
    hoursInput.value = Math.floor(wholeSeconds / 3600);
    minutesInput.value = Math.floor((wholeSeconds % 3600) / 60);
    secondsInput.value = wholeSeconds % 60;
  }

  function updateDisplay() {
    const displaySeconds = remainingSeconds > 0 ? Math.ceil(remainingSeconds) : 0;
    const hours = Math.floor(displaySeconds / 3600);
    const minutes = Math.floor((displaySeconds % 3600) / 60);
    const seconds = displaySeconds % 60;

    timerDisplay.textContent =
      hours > 0
        ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    timerDisplay.setAttribute("aria-label", createAccessibleTimeLabel(displaySeconds));
  }

  function createAccessibleTimeLabel(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pieces = [];

    if (hours > 0) pieces.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    if (minutes > 0) pieces.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
    if (seconds > 0 || pieces.length === 0) {
      pieces.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
    }

    return `${pieces.join(", ")} remaining`;
  }

  function updateProgress() {
    const progress =
      totalDuration > 0
        ? Math.min(1, Math.max(0, remainingSeconds / totalDuration))
        : 0;

    progressBar.style.transform = `scaleX(${progress})`;
  }

  function updateTimerState() {
    timerStage.classList.remove("timer-warning", "timer-critical", "timer-finished");

    if (hasFinished) {
      timerStage.classList.add("timer-finished");
      return;
    }

    if (!hasStarted) return;

    if (remainingSeconds <= 300) {
      timerStage.classList.add("timer-critical");
    } else if (remainingSeconds <= 600) {
      timerStage.classList.add("timer-warning");
    }
  }

  function updateEndTime() {
    if (remainingSeconds <= 0) {
      endTimeValue.textContent = "—";
      return;
    }

    const target =
      isRunning && endTimestamp
        ? new Date(endTimestamp)
        : new Date(Date.now() + remainingSeconds * 1000);

    endTimeValue.textContent = target.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function updatePresentationText() {
    timerTitle.textContent = timerTitleInput.value.trim();
    timerMessage.textContent = timerMessageInput.value.trim();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === timerStage) {
        await document.exitFullscreen();
      } else {
        await timerStage.requestFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen mode could not be activated.", error);
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || !isRunning || document.visibilityState !== "visible") {
      return;
    }

    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    } catch (error) {
      console.debug("Screen wake lock is not available.", error);
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;

    try {
      await wakeLock.release();
    } catch (error) {
      console.debug("Wake lock could not be released cleanly.", error);
    } finally {
      wakeLock = null;
    }
  }

  function unlockAudio() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }

    if (audioContext?.state === "suspended") audioContext.resume();
  }

  function playTimerSound() {
    unlockAudio();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    playTone(now, 660, 0.18);
    playTone(now + 0.28, 660, 0.18);
    playTone(now + 0.56, 820, 0.42);
  }

  function playTone(startTime, frequency, duration) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
  }
}
