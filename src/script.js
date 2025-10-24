// Toast Notification System
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  const iconBg = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';

  toast.innerHTML = `
    <div class="${iconBg} text-white w-6 h-6 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">${icon}</div>
    <span class="text-gray-900 dark:text-gray-100 flex-1">${message}</span>
  `;

  container.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

class BatteryLogger {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.cellNum = 1;
    this.readings = [];
    this.currentReadings = [];
    this.stableCount = 0;
    this.prevResistance = null;
    this.prevVoltage = null;
    this.prevRUnit = null;
    this.requiredStable = 10;
    this.epsilonResistance = 0.002;
    this.epsilonVoltage = 0.01;
    this.isReadingInProgress = false;
    this.lastReadingTime = 0;
    this.COOLDOWN_PERIOD = 3000; // 3 seconds cooldown
    this.noSignalTimeout = null;
    this.waitingForProbeRemoval = false;
    this.PROBE_REMOVAL_THRESHOLD = 0.1; // Voltage threshold to detect probe removal
    this.readingLocked = false; // New property to track if we're between multiple readings
    this.messageBuffer = new Uint8Array(0); // NEW: rolling buffer

    // UI Elements
    this.connectButton = document.getElementById("connectButton");
    this.statusText = document.getElementById("statusText");
    this.cellTypeInput = document.getElementById("cellType");
    this.customCellTypeInput = document.getElementById("customCellType");
    this.averagingCheckbox = document.getElementById("averaging");
    this.enableSoundCheckbox = document.getElementById("enableSound");
    this.numReadingsInput = document.getElementById("numReadings");
    this.cellNumberSpan = document.getElementById("cellNumber");
    this.voltageSpan = document.getElementById("voltage");
    this.resistanceSpan = document.getElementById("resistance");
    this.stabilityText = document.getElementById("stabilityText");
    this.stabilityProgress = document
      .getElementById("stabilityProgress")
      .querySelector(".progress");
    this.readingsLog = document.getElementById("readingsLog");
    this.exportButton = document.getElementById("exportButton");
    this.importButton = document.getElementById("importButton");
    this.importFileInput = document.getElementById("importFileInput");
    this.clearButton = document.getElementById("clearButton");
    this.readingCounterSpan = document.createElement("div");
    this.readingCounterSpan.className =
      "text-sm text-gray-600 dark:text-gray-400 mt-2";
    this.stabilityText.parentNode.insertBefore(
      this.readingCounterSpan,
      this.stabilityText.nextSibling
    );
    this.readingNumberSpan = document.getElementById("readingNumber");
    this.readingsLogTitle = document.getElementById("readingsLogTitle");
    this.currentMeasurementsPanel = document.getElementById("currentMeasurementsPanel");
    this.measurementsContainer = document.getElementById("measurementsContainer");
    this.usbIcon = document.getElementById("usbIcon");

    // Update title initially
    this.updateReadingsLogTitle();

    // Add event listener for cell type changes
    this.cellTypeInput.addEventListener("change", () => {
      const isCustom = this.cellTypeInput.value === "custom";
      this.customCellTypeInput.classList.toggle("hidden", !isCustom);
      if (isCustom) {
        this.customCellTypeInput.focus();
      }
    });

    // Update readings log title when either input changes
    this.cellTypeInput.addEventListener("change", () =>
      this.updateReadingsLogTitle()
    );
    this.customCellTypeInput.addEventListener("input", () => {
      if (this.cellTypeInput.value === "custom") {
        this.updateReadingsLogTitle();
      }
    });

    this.initializeEventListeners();
    this.progressBar = document.querySelector("#stabilityProgress .progress");
    this.progressBar.classList.add("waiting");
    this.stabilityText.textContent = "Waiting for connection";
    this.updateCurrentValues("-", "-", "");
    this.readingNumberSpan.textContent = "-/-";
    this.updateStabilityUI(0);
    this.updateReadingsLogTitle();
  }

  initializeEventListeners() {
    this.connectButton.addEventListener("click", () => this.toggleConnection());
    this.exportButton.addEventListener("click", () => this.exportToCSV());
    this.importButton.addEventListener("click", () => this.importFileInput.click());
    this.importFileInput.addEventListener("change", (e) => this.importFromCSV(e));
    this.clearButton.addEventListener("click", () => this.clearLog());
  }

  playBeep() {
    // Only play beep if sound is enabled
    if (!this.enableSoundCheckbox.checked) {
      return;
    }

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Frequency in Hz
      oscillator.type = "sine"; // Sine wave for a pure tone

      gainNode.gain.setValueAtTime(0.15, audioContext.currentTime); // Quiet volume (0.15)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.15); // 150ms beep
    } catch (error) {
      console.log("Audio not available:", error);
    }
  }

  async toggleConnection() {
    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect();
    }
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      this.reader = this.port.readable.getReader();
      this.isConnected = true;

      this.updateUI("connected");
      this.stabilityText.textContent = "Waiting for stable reading...";
      this.startReading();
    } catch (error) {
      console.error("Connection error:", error);
      this.updateUI("error", "Failed to connect to device");
    }
  }

  async disconnect() {
    if (this.reader) {
      await this.reader.cancel();
      await this.reader.releaseLock();
    }
    if (this.port) {
      await this.port.close();
    }
    this.isConnected = false;
    this.updateUI("disconnected");
    this.stabilityText.textContent = "Idle";
    this.readingNumberSpan.textContent = "-";
  }

  async startReading() {
    while (true) {
      try {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value) {
          this.appendToBuffer(value);
        }
      } catch (error) {
        console.error("Read error:", error);
        this.updateUI("error", "Connection lost");
        break;
      }
    }
  }

  appendToBuffer(newData) {
    // Merge newData into existing buffer
    const combined = new Uint8Array(this.messageBuffer.length + newData.length);
    combined.set(this.messageBuffer, 0);
    combined.set(newData, this.messageBuffer.length);
    this.messageBuffer = combined;

    // While we have at least one full 10-byte packet, process it
    while (this.messageBuffer.length >= 10) {
      const packet = this.messageBuffer.slice(0, 10);
      this.processPacket(packet);
      this.messageBuffer = this.messageBuffer.slice(10);
    }
  }

  processPacket(packet) {
    if (packet.length !== 10) {
      return; // safety guard
    }

    const [
      statusDisp,
      rRangeCode,
      rDisp1,
      rDisp2,
      rDisp3,
      signCode,
      vRangeCode,
      vDisp1,
      vDisp2,
      vDisp3,
    ] = packet;

    // --- Resistance decode ---
    const rDispCode = (statusDisp & 0xf0) >> 4;
    let resistance =
      ((rDisp1 & 0xff) | ((rDisp2 & 0xff) << 8) | ((rDisp3 & 0xff) << 16)) /
      10000;
    let rUnit = "mΩ";

    if (rDispCode === 0x05) {
      rUnit = "mΩ";
    } else if (rDispCode === 0x06) {
      rUnit = "mΩ";
      resistance = "OL";
    } else if (rDispCode === 0x09) {
      rUnit = "Ω";
    } else if (rDispCode === 0x0a) {
      rUnit = "Ω";
      resistance = "OL";
    }

    // --- Voltage decode ---
    const vDispCode = statusDisp & 0x0f;
    let voltage =
      ((vDisp1 & 0xff) | ((vDisp2 & 0xff) << 8) | ((vDisp3 & 0xff) << 16)) /
      10000;
    voltage = (signCode === 1 ? 1 : -1) * voltage;

    if (vDispCode === 0x08) {
      voltage = "OL";
    }

    this.updateReadings(voltage, resistance, rUnit);
  }

  processData(data) {
    if (!data || data.length < 10) {
      return;
    }

    const packet = data.slice(0, 10); // first 10 bytes
    const [
      statusDisp,
      rRangeCode,
      rDisp1,
      rDisp2,
      rDisp3,
      signCode,
      vRangeCode,
      vDisp1,
      vDisp2,
      vDisp3,
    ] = packet;

    // Process resistance
    const rDispCode = (statusDisp & 0xf0) >> 4;
    let resistance =
      ((rDisp1 & 0xff) | ((rDisp2 & 0xff) << 8) | ((rDisp3 & 0xff) << 16)) /
      10000;
    let rUnit = "mΩ";

    if (rDispCode === 0x05) {
      rUnit = "mΩ";
    } else if (rDispCode === 0x06) {
      rUnit = "mΩ";
      resistance = "OL";
    } else if (rDispCode === 0x09) {
      rUnit = "Ω";
    } else if (rDispCode === 0x0a) {
      rUnit = "Ω";
      resistance = "OL";
    }

    // Process voltage
    const vDispCode = statusDisp & 0x0f;
    let voltage =
      ((vDisp1 & 0xff) | ((vDisp2 & 0xff) << 8) | ((vDisp3 & 0xff) << 16)) /
      10000;
    voltage = (signCode === 1 ? 1 : -1) * voltage;

    if (vDispCode === 0x08) {
      voltage = "OL";
    }

    this.updateReadings(voltage, resistance, rUnit);

    // Recursively handle remaining data
    if (data.length > 10) {
      this.processData(data.slice(10));
    }
  }

  updateReadings(voltage, resistance, rUnit) {
    // Always update current values for real-time display
    this.updateCurrentValues(voltage, resistance, rUnit);

    const now = Date.now();
    const isValid =
      typeof voltage === "number" &&
      typeof resistance === "number" &&
      voltage > 0;

    // Clear any existing timeout
    if (this.noSignalTimeout) {
      clearTimeout(this.noSignalTimeout);
    }

    // Check if probes have been removed (voltage near zero)
    if (
      this.waitingForProbeRemoval &&
      (!isValid ||
        (typeof voltage === "number" && voltage < this.PROBE_REMOVAL_THRESHOLD))
    ) {
      this.waitingForProbeRemoval = false;
      this.isReadingInProgress = false;
      this.stableCount = 0;
      this.updateStabilityUI(0);
      if (
        this.currentReadings.length <
        (this.averagingCheckbox.checked
          ? parseInt(this.numReadingsInput.value)
          : 1)
      ) {
        this.stabilityText.textContent = "Ready for next reading";
      }
      return;
    }

    // Set timeout to detect complete signal loss
    this.noSignalTimeout = setTimeout(() => {
      if (!isValid && !this.waitingForProbeRemoval) {
        this.stableCount = 0;
        this.updateStabilityUI(0);
        if (!this.waitingForProbeRemoval) {
          this.stabilityText.textContent = "Waiting for stable reading...";
        }
      }
    }, 1000);

    if (!isValid) {
      if (!this.waitingForProbeRemoval && this.isReadingInProgress) {
        this.stableCount = 0;
        this.updateStabilityUI(0);
        this.stabilityText.textContent = "Invalid reading";
      }
      return;
    }

    // If waiting for probe removal, don't process new readings
    if (this.waitingForProbeRemoval) {
      this.stabilityText.textContent = "Remove probes before next reading";
      return;
    }

    // If in cooldown and not in a reading sequence, don't start new reading
    if (
      !this.isReadingInProgress &&
      now - this.lastReadingTime < this.COOLDOWN_PERIOD
    ) {
      this.stabilityText.textContent = "Please wait before next reading...";
      return;
    }

    // Start new reading if not in progress
    if (!this.isReadingInProgress) {
      this.isReadingInProgress = true;
      this.stableCount = 0;
      this.prevVoltage = null;
      this.prevResistance = null;
      this.updateStabilityUI(0);

      // Initialize measurements display if starting a new cell
      if (this.currentReadings.length === 0) {
        this.updateMeasurementsDisplay();
      }
    }

    const isStable = this.checkStability(voltage, resistance, rUnit);

    if (isStable) {
      this.stableCount++;
      this.updateStabilityUI(this.stableCount / this.requiredStable);

      if (this.stableCount === this.requiredStable) {
        this.recordReading(voltage, resistance, rUnit);
        this.lastReadingTime = now;
      }
    } else if (!this.waitingForProbeRemoval) {
      this.stableCount = 0;
      this.updateStabilityUI(0);
    }
  }

  checkStability(voltage, resistance, rUnit) {
    // Only check stability for valid numbers
    if (typeof voltage !== "number" || typeof resistance !== "number") {
      return false;
    }

    if (this.prevVoltage === null || this.prevResistance === null) {
      this.prevVoltage = voltage;
      this.prevResistance = resistance;
      this.prevRUnit = rUnit;
      return false;
    }

    // Check if values are within acceptable range
    const voltageStable =
      Math.abs(voltage - this.prevVoltage) < this.epsilonVoltage;
    const resistanceStable =
      Math.abs(resistance - this.prevResistance) < this.epsilonResistance;
    const unitsMatch = rUnit === this.prevRUnit;

    // Always update previous values for better stability tracking
    this.prevVoltage = voltage;
    this.prevResistance = resistance;
    this.prevRUnit = rUnit;

    // Only consider stable if all conditions are met
    return voltageStable && resistanceStable && unitsMatch;
  }

  recordReading(voltage, resistance, rUnit) {
    if (typeof voltage !== "number" || typeof resistance !== "number") {
      return;
    }

    const numReadings = this.averagingCheckbox.checked
      ? parseInt(this.numReadingsInput.value)
      : 1;

    this.currentReadings.push({ voltage, resistance, rUnit });
    const currentReadingNum = this.currentReadings.length;
    this.readingCounterSpan.textContent = `Reading ${currentReadingNum} of ${numReadings}`;
    this.stabilityText.textContent =
      currentReadingNum === numReadings
        ? "Final reading captured"
        : "Reading captured";

    // Update the measurements display
    this.updateMeasurementsDisplay();

    // Play beep after each reading is captured
    this.playBeep();

    // Wait for probe removal before next reading
    this.waitingForProbeRemoval = true;

    if (currentReadingNum === numReadings) {
      const avgVoltage =
        this.currentReadings.reduce((sum, r) => sum + r.voltage, 0) /
        numReadings;
      const avgResistance =
        this.currentReadings.reduce((sum, r) => sum + r.resistance, 0) /
        numReadings;

      let cellType = this.cellTypeInput.value;
      if (cellType === "custom") {
        cellType = this.customCellTypeInput.value.trim() || "Custom";
      }

      const reading = {
        cellNum: this.cellNum,
        cellType: cellType,
        voltage: avgVoltage.toFixed(4),
        resistance: avgResistance.toFixed(4),
        rUnit: rUnit,
        timestamp: new Date().toISOString(),
      };

      this.readings.push(reading);
      this.addReadingToTable(reading);

      this.cellNum++;
      this.currentReadings = [];
      this.waitingForProbeRemoval = true;
      this.stabilityText.textContent =
        "Reading saved. Move probes to next cell.";
      this.readingCounterSpan.textContent = "";

      // Clear measurements display for next cell
      this.clearMeasurementsDisplay();
    } else {
      this.stabilityText.textContent = "Remove probes before next reading";
    }
  }

  updateCurrentValues(voltage, resistance, rUnit) {
    this.cellNumberSpan.textContent = this.cellNum;
    const totalReadings = this.averagingCheckbox.checked
      ? parseInt(this.numReadingsInput.value)
      : 1;
    this.readingNumberSpan.textContent = this.isConnected
      ? `${this.currentReadings.length + 1}/${totalReadings}`
      : "-";
    this.voltageSpan.textContent =
      typeof voltage === "number" ? voltage.toFixed(4) + "V" : voltage;
    this.resistanceSpan.textContent =
      typeof resistance === "number"
        ? resistance.toFixed(4) + " " + rUnit
        : resistance;
  }

  updateStabilityUI(progress) {
    // Only update UI if not waiting for probe removal
    if (!this.waitingForProbeRemoval) {
      if (!this.isConnected) {
        this.progressBar.style.width = "100%";
        this.progressBar.classList.add("waiting");
        this.stabilityText.textContent = "Waiting for connection";
      } else if (progress === 0) {
        this.progressBar.style.width = "100%";
        this.progressBar.classList.add("waiting");
        this.stabilityText.textContent = "Waiting for stable reading...";
      } else {
        this.progressBar.style.width = `${progress * 100}%`;
        this.progressBar.classList.remove("waiting");
        if (progress < 1) {
          this.stabilityText.textContent = "Stabilizing...";
        }
      }
    }
  }

  addReadingToTable(reading) {
    const row = document.createElement("tr");
    row.className = "bg-white dark:bg-gray-800";
    row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${reading.cellNum}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${reading.voltage}V</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${reading.resistance} ${reading.rUnit}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">${reading.timestamp}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-right">
                <button class="reload-cell-btn text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium" data-cell-num="${reading.cellNum}">
                    ↻ Retest
                </button>
            </td>
        `;

    // Add event listener to the reload button
    const reloadBtn = row.querySelector('.reload-cell-btn');
    reloadBtn.addEventListener('click', () => this.reloadCell(reading.cellNum));

    // Find the correct position to insert (descending order by cell number)
    const rows = Array.from(this.readingsLog.querySelectorAll('tr'));
    let insertBeforeRow = null;

    for (const existingRow of rows) {
      const cellNumCell = existingRow.querySelector('td:first-child');
      if (cellNumCell) {
        const existingCellNum = parseInt(cellNumCell.textContent);
        if (existingCellNum < reading.cellNum) {
          insertBeforeRow = existingRow;
          break;
        }
      }
    }

    if (insertBeforeRow) {
      this.readingsLog.insertBefore(row, insertBeforeRow);
    } else {
      this.readingsLog.appendChild(row);
    }
  }

  updateUI(state, message = "") {
    const buttonText = this.connectButton.querySelector("span");
    switch (state) {
      case "connected":
        buttonText.textContent = "Disconnect";
        this.statusText.textContent = "Connected";
        this.statusText.className = "text-green-600 dark:text-green-400";
        this.usbIcon.classList.remove("hidden");
        showToast("Connected successfully", "success");
        break;
      case "disconnected":
        buttonText.textContent = "Connect";
        this.statusText.textContent = "Not Connected";
        this.statusText.className = "text-gray-700 dark:text-gray-300";
        this.usbIcon.classList.add("hidden");
        showToast("Disconnected", "info");
        break;
      case "error":
        this.statusText.textContent = message;
        this.statusText.className = "text-red-600 dark:text-red-400";
        break;
    }
  }

  exportToCSV() {
    if (this.readings.length === 0) {
      showToast("No readings to export", "error");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const cellType = this.cellTypeInput.value.replace("/", "_") || "NA";
    const filename = `${timestamp}-${cellType}.csv`;

    const csvContent = [
      ["Cell #", "Type", "Voltage", "ACIR", "Time"],
      ...this.readings.map((r) => [
        r.cellNum,
        r.cellType || "N/A",
        r.voltage + "V",
        r.resistance + " " + r.rUnit,
        r.timestamp,
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  importFromCSV(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvContent = e.target.result;
        const lines = csvContent.split("\n");

        // Skip header row
        const dataLines = lines.slice(1).filter(line => line.trim());

        if (dataLines.length === 0) {
          showToast("No data found in CSV file", "error");
          return;
        }

        // Clear existing data
        this.readings = [];
        this.readingsLog.innerHTML = "";

        // Parse and import each row
        let maxCellNum = 0;
        dataLines.forEach((line) => {
          const parts = line.split(",");
          if (parts.length >= 5) {
            const cellNum = parseInt(parts[0]);
            const cellType = parts[1];
            const voltage = parts[2].replace("V", "");
            const acirParts = parts[3].trim().split(" ");
            const resistance = acirParts[0];
            const rUnit = acirParts[1] || "mΩ";
            const timestamp = parts[4];

            const reading = {
              cellNum: cellNum,
              cellType: cellType,
              voltage: voltage,
              resistance: resistance,
              rUnit: rUnit,
              timestamp: timestamp,
            };

            this.readings.push(reading);
            this.addReadingToTable(reading);

            if (cellNum > maxCellNum) {
              maxCellNum = cellNum;
            }
          }
        });

        // Update cell counter to continue from last imported cell
        this.cellNum = maxCellNum + 1;
        this.updateCurrentValues("-", "-", "");
        this.readingNumberSpan.textContent = "-/-";

        showToast(`Successfully imported ${dataLines.length} readings`, "success");
      } catch (error) {
        console.error("Error importing CSV:", error);
        showToast("Error importing CSV file. Please make sure it's in the correct format.", "error");
      }

      // Reset file input
      event.target.value = "";
    };

    reader.readAsText(file);
  }

  updateReadingsLogTitle() {
    let cellType = this.cellTypeInput.value;
    if (cellType === "custom") {
      cellType = this.customCellTypeInput.value.trim() || "Custom";
    }
    this.readingsLogTitle.textContent = `${cellType} Readings`;
  }

  clearLog() {
    if (
      this.readings.length === 0 ||
      confirm("Are you sure you want to clear all readings?")
    ) {
      this.readings = [];
      this.readingsLog.innerHTML = "";
      this.cellNum = 1;
      this.currentReadings = [];
      this.stableCount = 0;
      this.isReadingInProgress = false;
      this.waitingForProbeRemoval = false;
      this.lastReadingTime = 0;
      this.updateCurrentValues("-", "-", "");
      this.readingNumberSpan.textContent = "-/-";
      this.updateStabilityUI(0);
      this.readingCounterSpan.textContent = "";
      this.stabilityText.textContent = this.reader
        ? "Waiting for stable reading..."
        : "Waiting for connection";
      this.updateReadingsLogTitle();
      this.clearMeasurementsDisplay();
    }
  }

  reloadCell(cellNum) {
    if (!confirm(`Are you sure you want to reload Cell #${cellNum}? This will delete the current reading.`)) {
      return;
    }

    // Remove the reading from the array
    const readingIndex = this.readings.findIndex(r => r.cellNum === cellNum);
    if (readingIndex !== -1) {
      this.readings.splice(readingIndex, 1);
    }

    // Remove the row from the table
    const rows = this.readingsLog.querySelectorAll('tr');
    rows.forEach(row => {
      const cellNumCell = row.querySelector('td:first-child');
      if (cellNumCell && parseInt(cellNumCell.textContent) === cellNum) {
        row.remove();
      }
    });

    // Set up for reloading this cell
    this.cellNum = cellNum;
    this.currentReadings = [];
    this.stableCount = 0;
    this.isReadingInProgress = false;
    this.waitingForProbeRemoval = false;
    this.lastReadingTime = 0;
    this.updateCurrentValues("-", "-", "");
    this.readingNumberSpan.textContent = this.isConnected ? "1/" + (this.averagingCheckbox.checked ? parseInt(this.numReadingsInput.value) : 1) : "-/-";
    this.updateStabilityUI(0);
    this.readingCounterSpan.textContent = "";
    this.stabilityText.textContent = this.isConnected
      ? "Ready to measure cell #" + cellNum
      : "Waiting for connection";
    this.clearMeasurementsDisplay();
  }

  resetReadingState() {
    this.stableCount = 0;
    this.isReadingInProgress = false;
    this.waitingForProbeRemoval = false;
    this.prevVoltage = null;
    this.prevResistance = null;
    this.updateStabilityUI(0);

    // Only reset text if we're not in the middle of multiple readings
    if (this.currentReadings.length === 0) {
      this.stabilityText.textContent = this.isConnected
        ? "Waiting for stable reading..."
        : "Waiting for connection";
      this.readingNumberSpan.textContent = "-";
    }
  }

  updateMeasurementsDisplay() {
    const numReadings = this.averagingCheckbox.checked
      ? parseInt(this.numReadingsInput.value)
      : 1;

    // Show panel if we have averaging enabled and multiple readings
    if (numReadings > 1) {
      this.currentMeasurementsPanel.style.display = 'block';

      // Clear and rebuild the container
      this.measurementsContainer.innerHTML = '';

      for (let i = 0; i < numReadings; i++) {
        const measurementDiv = document.createElement('div');
        measurementDiv.className = 'measurement-item bg-gray-50 dark:bg-gray-700 p-4 rounded-lg flex items-center justify-between';

        const reading = this.currentReadings[i];
        const isEmpty = !reading;

        measurementDiv.innerHTML = `
          <div class="flex items-center gap-4 flex-1">
            <span class="font-medium text-gray-700 dark:text-gray-300">Reading ${i + 1}:</span>
            ${isEmpty ?
            '<span class="text-gray-400 dark:text-gray-500 italic">Waiting...</span>' :
            `<span class="text-gray-900 dark:text-white">
                Voltage: <strong>${reading.voltage.toFixed(4)}V</strong> | 
                ACIR: <strong>${reading.resistance.toFixed(4)} ${reading.rUnit}</strong>
              </span>`
          }
          </div>
          ${!isEmpty ?
            `<button 
              class="delete-reading text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold text-xl px-3 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              data-index="${i}"
              title="Delete this reading"
            >✕</button>` :
            ''
          }
        `;

        this.measurementsContainer.appendChild(measurementDiv);

        // Add delete listener if button exists
        if (!isEmpty) {
          const deleteBtn = measurementDiv.querySelector('.delete-reading');
          deleteBtn.addEventListener('click', () => this.deleteMeasurement(i));
        }
      }
    } else {
      this.currentMeasurementsPanel.style.display = 'none';
    }
  }

  clearMeasurementsDisplay() {
    this.measurementsContainer.innerHTML = '';
    this.currentMeasurementsPanel.style.display = 'none';
  }

  deleteMeasurement(index) {
    if (index < 0 || index >= this.currentReadings.length) {
      return;
    }

    // Remove the measurement from the array
    this.currentReadings.splice(index, 1);

    // Update the display
    this.updateMeasurementsDisplay();

    // Update the reading counter
    const numReadings = this.averagingCheckbox.checked
      ? parseInt(this.numReadingsInput.value)
      : 1;
    this.readingCounterSpan.textContent = `Reading ${this.currentReadings.length} of ${numReadings}`;

    // Update status
    if (this.currentReadings.length === 0) {
      this.stabilityText.textContent = "Ready for next reading";
    } else {
      this.stabilityText.textContent = "Reading deleted. Ready for next reading";
    }

    // Reset waiting state so we can take another reading
    this.waitingForProbeRemoval = false;
    this.isReadingInProgress = false;
    this.stableCount = 0;
    this.updateStabilityUI(0);
  }
}

// Check if WebSerial is supported
if ("serial" in navigator && window.isSecureContext) {
  const logger = new BatteryLogger();
} else {
  const errorMessage = !window.isSecureContext
    ? "WebSerial requires a secure context (HTTPS or localhost)."
    : "WebSerial is not supported in this browser. Please use a Chromium-based browser (Chrome, Edge, Opera, Brave, etc).";
  showToast(errorMessage, "error");
  document.querySelector(".container").innerHTML = `
        <header class="flex justify-between items-center py-6 px-6">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Battery Logger for RC3563</h1>
        </header>
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow text-center">
            <h2 class="text-xl font-semibold text-red-600 dark:text-red-400 mb-4">WebSerial Not Supported</h2>
            <p class="text-gray-700 dark:text-gray-300">${errorMessage}</p>
        </div>
    `;
}
