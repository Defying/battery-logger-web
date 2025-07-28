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
        this.epsilonResistance = 0.01;
        this.epsilonVoltage = 0.001;
        this.isReadingInProgress = false;
        this.lastReadingTime = 0;
        this.COOLDOWN_PERIOD = 3000; // 3 seconds cooldown
        this.noSignalTimeout = null;
        this.waitingForProbeRemoval = false;
        this.PROBE_REMOVAL_THRESHOLD = 0.1; // Voltage threshold to detect probe removal
        this.readingLocked = false; // New property to track if we're between multiple readings

        // UI Elements
        this.connectButton = document.getElementById('connectButton');
        this.statusText = document.getElementById('statusText');
        this.cellTypeInput = document.getElementById('cellType');
        this.customCellTypeInput = document.getElementById('customCellType');
        this.averagingCheckbox = document.getElementById('averaging');
        this.numReadingsInput = document.getElementById('numReadings');
        this.cellNumberSpan = document.getElementById('cellNumber');
        this.voltageSpan = document.getElementById('voltage');
        this.resistanceSpan = document.getElementById('resistance');
        this.stabilityText = document.getElementById('stabilityText');
        this.stabilityProgress = document.getElementById('stabilityProgress').querySelector('.progress');
        this.readingsLog = document.getElementById('readingsLog');
        this.exportButton = document.getElementById('exportButton');
        this.clearButton = document.getElementById('clearButton');
        this.readingCounterSpan = document.createElement('div');
        this.readingCounterSpan.className = 'text-sm text-gray-600 dark:text-gray-400 mt-2';
        this.stabilityText.parentNode.insertBefore(this.readingCounterSpan, this.stabilityText.nextSibling);
        this.readingNumberSpan = document.getElementById('readingNumber');
        this.readingsLogTitle = document.getElementById('readingsLogTitle');
        
        // Update title initially
        this.updateReadingsLogTitle();

        // Add event listener for cell type changes
        this.cellTypeInput.addEventListener('change', () => {
            const isCustom = this.cellTypeInput.value === 'custom';
            this.customCellTypeInput.classList.toggle('hidden', !isCustom);
            if (isCustom) {
                this.customCellTypeInput.focus();
            }
        });

        // Update readings log title when either input changes
        this.cellTypeInput.addEventListener('change', () => this.updateReadingsLogTitle());
        this.customCellTypeInput.addEventListener('input', () => {
            if (this.cellTypeInput.value === 'custom') {
                this.updateReadingsLogTitle();
            }
        });

        this.initializeEventListeners();
        this.progressBar = document.querySelector('#stabilityProgress .progress');
        this.progressBar.classList.add('waiting');
        this.stabilityText.textContent = 'Idle';
    }

    initializeEventListeners() {
        this.connectButton.addEventListener('click', () => this.toggleConnection());
        this.exportButton.addEventListener('click', () => this.exportToCSV());
        this.clearButton.addEventListener('click', () => this.clearLog());
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
            
            this.updateUI('connected');
            this.stabilityText.textContent = 'Waiting for stable reading...';
            this.startReading();
        } catch (error) {
            console.error('Connection error:', error);
            this.updateUI('error', 'Failed to connect to device');
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
        this.updateUI('disconnected');
        this.stabilityText.textContent = 'Idle';
        this.readingNumberSpan.textContent = '-';
    }

    async startReading() {
        while (true) {
            try {
                const { value, done } = await this.reader.read();
                if (done) {
                    break;
                }
                this.processData(value);
            } catch (error) {
                console.error('Read error:', error);
                this.updateUI('error', 'Connection lost');
                break;
            }
        }
    }

    processData(data) {
        // Process 10-byte packets
        if (data.length >= 10) {
            const packet = new Uint8Array(data);
            const [statusDisp, rRangeCode, rDisp1, rDisp2, rDisp3, signCode, vRangeCode, vDisp1, vDisp2, vDisp3] = packet;

            // Process resistance
            const rDispCode = (statusDisp & 0xF0) >> 4;
            // Match Python's struct.unpack('I', bytes + b'\x00')[0] exactly
            let resistance = ((rDisp1 & 0xFF) | ((rDisp2 & 0xFF) << 8) | ((rDisp3 & 0xFF) << 16)) / 10000;
            let rUnit = 'mΩ';

            if (rDispCode === 0x05) {
                rUnit = 'mΩ';
            } else if (rDispCode === 0x06) {
                rUnit = 'mΩ';
                resistance = 'OL';
            } else if (rDispCode === 0x09) {
                rUnit = 'Ω';
            } else if (rDispCode === 0x0a) {
                rUnit = 'Ω';
                resistance = 'OL';
            }

            // Process voltage
            const vDispCode = statusDisp & 0x0F;
            // Match Python's struct.unpack('I', bytes + b'\x00')[0] exactly
            let voltage = ((vDisp1 & 0xFF) | ((vDisp2 & 0xFF) << 8) | ((vDisp3 & 0xFF) << 16)) / 10000;
            voltage = (signCode === 1 ? 1 : -1) * voltage;

            if (vDispCode === 0x08) {
                voltage = 'OL';
            }

            this.updateReadings(voltage, resistance, rUnit);
        }
    }

    updateReadings(voltage, resistance, rUnit) {
        // Always update current values for real-time display
        this.updateCurrentValues(voltage, resistance, rUnit);

        const now = Date.now();
        const isValid = typeof voltage === 'number' && typeof resistance === 'number' && voltage > 0;

        // Clear any existing timeout
        if (this.noSignalTimeout) {
            clearTimeout(this.noSignalTimeout);
        }

        // Check if probes have been removed (voltage near zero)
        if (this.waitingForProbeRemoval && (!isValid || (typeof voltage === 'number' && voltage < this.PROBE_REMOVAL_THRESHOLD))) {
            this.waitingForProbeRemoval = false;
            this.isReadingInProgress = false;
            this.stableCount = 0;
            this.updateStabilityUI(0);
            if (this.currentReadings.length < (this.averagingCheckbox.checked ? parseInt(this.numReadingsInput.value) : 1)) {
                this.stabilityText.textContent = 'Ready for next reading';
            }
            return;
        }

        // Set timeout to detect complete signal loss
        this.noSignalTimeout = setTimeout(() => {
            if (!isValid && !this.waitingForProbeRemoval) {
                this.stableCount = 0;
                this.updateStabilityUI(0);
                if (!this.waitingForProbeRemoval) {
                    this.stabilityText.textContent = 'Waiting for stable reading...';
                }
            }
        }, 1000);

        if (!isValid) {
            if (!this.waitingForProbeRemoval && this.isReadingInProgress) {
                this.stableCount = 0;
                this.updateStabilityUI(0);
                this.stabilityText.textContent = 'Invalid reading';
            }
            return;
        }

        // If waiting for probe removal, don't process new readings
        if (this.waitingForProbeRemoval) {
            this.stabilityText.textContent = 'Remove probes before next reading';
            return;
        }

        // If in cooldown and not in a reading sequence, don't start new reading
        if (!this.isReadingInProgress && now - this.lastReadingTime < this.COOLDOWN_PERIOD) {
            this.stabilityText.textContent = 'Please wait before next reading...';
            return;
        }

        // Start new reading if not in progress
        if (!this.isReadingInProgress) {
            this.isReadingInProgress = true;
            this.stableCount = 0;
            this.prevVoltage = null;
            this.prevResistance = null;
            this.updateStabilityUI(0);
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
        if (typeof voltage !== 'number' || typeof resistance !== 'number') {
            return false;
        }

        if (this.prevVoltage === null || this.prevResistance === null) {
            this.prevVoltage = voltage;
            this.prevResistance = resistance;
            this.prevRUnit = rUnit;
            return false;
        }

        // Check if values are within acceptable range
        const voltageStable = Math.abs(voltage - this.prevVoltage) < this.epsilonVoltage;
        const resistanceStable = Math.abs(resistance - this.prevResistance) < this.epsilonResistance;
        const unitsMatch = rUnit === this.prevRUnit;
        
        // Always update previous values for better stability tracking
        this.prevVoltage = voltage;
        this.prevResistance = resistance;
        this.prevRUnit = rUnit;

        // Only consider stable if all conditions are met
        return voltageStable && resistanceStable && unitsMatch;
    }

    recordReading(voltage, resistance, rUnit) {
        if (typeof voltage !== 'number' || typeof resistance !== 'number') {
            return;
        }

        const numReadings = this.averagingCheckbox.checked ? parseInt(this.numReadingsInput.value) : 1;
        
        this.currentReadings.push({ voltage, resistance });
        const currentReadingNum = this.currentReadings.length;
        this.readingCounterSpan.textContent = `Reading ${currentReadingNum} of ${numReadings}`;
        this.stabilityText.textContent = currentReadingNum === numReadings ? 'Final reading captured' : 'Reading captured';
        
        // Wait for probe removal before next reading
        this.waitingForProbeRemoval = true;

        if (currentReadingNum === numReadings) {
            const avgVoltage = this.currentReadings.reduce((sum, r) => sum + r.voltage, 0) / numReadings;
            const avgResistance = this.currentReadings.reduce((sum, r) => sum + r.resistance, 0) / numReadings;

            let cellType = this.cellTypeInput.value;
            if (cellType === 'custom') {
                cellType = this.customCellTypeInput.value.trim() || 'Custom';
            }

            const reading = {
                cellNum: this.cellNum,
                cellType: cellType,
                voltage: avgVoltage.toFixed(4),
                resistance: avgResistance.toFixed(4),
                rUnit: rUnit,
                timestamp: new Date().toISOString()
            };

            this.readings.push(reading);
            this.addReadingToTable(reading);
            
            this.cellNum++;
            this.currentReadings = [];
            this.waitingForProbeRemoval = true;
            this.stabilityText.textContent = 'Reading saved. Move probes to next cell.';
            this.readingCounterSpan.textContent = '';
        } else {
            this.stabilityText.textContent = 'Remove probes before next reading';
        }
    }

    updateCurrentValues(voltage, resistance, rUnit) {
        this.cellNumberSpan.textContent = this.cellNum;
        const totalReadings = this.averagingCheckbox.checked ? parseInt(this.numReadingsInput.value) : 1;
        this.readingNumberSpan.textContent = this.isConnected ? `${this.currentReadings.length + 1}/${totalReadings}` : '-';
        this.voltageSpan.textContent = typeof voltage === 'number' ? voltage.toFixed(4) + 'V' : voltage;
        this.resistanceSpan.textContent = typeof resistance === 'number' ? resistance.toFixed(4) + ' ' + rUnit : resistance;
    }

    updateStabilityUI(progress) {
        // Only update UI if not waiting for probe removal
        if (!this.waitingForProbeRemoval) {
            if (progress === 0) {
                this.progressBar.style.width = '100%';
                this.progressBar.classList.add('waiting');
                this.stabilityText.textContent = 'Waiting for stable reading...';
            } else {
                this.progressBar.style.width = `${progress * 100}%`;
                this.progressBar.classList.remove('waiting');
                if (progress < 1) {
                    this.stabilityText.textContent = 'Stabilizing...';
                }
            }
        }
    }

    addReadingToTable(reading) {
        const row = document.createElement('tr');
        row.className = 'text-gray-900 dark:text-gray-200'; // Add dark mode text color
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">${reading.cellNum}</td>
            <td class="px-6 py-4 whitespace-nowrap">${reading.cellType || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap">${reading.voltage}V</td>
            <td class="px-6 py-4 whitespace-nowrap">${reading.resistance} ${reading.rUnit}</td>
            <td class="px-6 py-4 whitespace-nowrap">${new Date(reading.timestamp).toLocaleTimeString()}</td>
        `;
        this.readingsLog.insertBefore(row, this.readingsLog.firstChild);
    }

    updateUI(state, message = '') {
        switch (state) {
            case 'connected':
                this.connectButton.textContent = 'Disconnect';
                this.statusText.textContent = 'Connected';
                this.statusText.className = 'text-green-600 dark:text-green-400';
                break;
            case 'disconnected':
                this.connectButton.textContent = 'Connect Device';
                this.statusText.textContent = 'Not Connected';
                this.statusText.className = 'text-gray-700 dark:text-gray-300';
                break;
            case 'error':
                this.statusText.textContent = message;
                this.statusText.className = 'text-red-600 dark:text-red-400';
                break;
        }
    }

    exportToCSV() {
        if (this.readings.length === 0) {
            alert('No readings to export');
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const cellType = this.cellTypeInput.value.replace('/', '_') || 'NA';
        const filename = `${timestamp}-${cellType}.csv`;

        const csvContent = [
            ['Cell #', 'Type', 'Voltage', 'ACIR', 'Time'],
            ...this.readings.map(r => [
                r.cellNum,
                r.cellType || 'N/A',
                r.voltage + 'V',
                r.resistance + ' ' + r.rUnit,
                r.timestamp
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    }

    updateReadingsLogTitle() {
        let cellType = this.cellTypeInput.value;
        if (cellType === 'custom') {
            cellType = this.customCellTypeInput.value.trim() || 'Custom';
        }
        this.readingsLogTitle.textContent = `${cellType} Readings`;
    }

    clearLog() {
        if (confirm('Are you sure you want to clear all readings?')) {
            this.readings = [];
            this.readingsLog.innerHTML = '';
            this.cellNum = 1;
            this.currentReadings = [];
            this.stableCount = 0;
            this.isReadingInProgress = false;
            this.waitingForProbeRemoval = false;
            this.lastReadingTime = 0;
            this.updateCurrentValues('-', '-', '');
            this.readingNumberSpan.textContent = '-/-';
            this.updateStabilityUI(0);
            this.readingCounterSpan.textContent = '';
            this.stabilityText.textContent = 'Waiting for stable reading...';
            this.updateReadingsLogTitle();
        }
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
            this.stabilityText.textContent = this.isConnected ? 'Waiting for stable reading...' : 'Idle';
            this.readingNumberSpan.textContent = '-';
        }
    }
}

// Check if WebSerial is supported
if ('serial' in navigator && window.isSecureContext) {
    const logger = new BatteryLogger();
} else {
    const errorMessage = !window.isSecureContext 
        ? 'WebSerial requires a secure context (HTTPS or localhost).'
        : 'WebSerial is not supported in this browser. Please use a Chromium-based browser (Chrome, Edge, Opera, Brave, etc).';
    alert(errorMessage);
    document.querySelector('.container').innerHTML = `
        <header class="flex justify-between items-center py-6 px-6">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Battery Logger for RC3563</h1>
        </header>
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow text-center">
            <h2 class="text-xl font-semibold text-red-600 dark:text-red-400 mb-4">WebSerial Not Supported</h2>
            <p class="text-gray-700 dark:text-gray-300">${errorMessage}</p>
        </div>
    `;
} 