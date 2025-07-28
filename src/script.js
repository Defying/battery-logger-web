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

        // UI Elements
        this.connectButton = document.getElementById('connectButton');
        this.statusText = document.getElementById('statusText');
        this.cellTypeInput = document.getElementById('cellType');
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

        this.initializeEventListeners();
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
        const isValid = typeof voltage === 'number' && typeof resistance === 'number' && voltage > 0;

        if (isValid) {
            const isStable = this.checkStability(voltage, resistance, rUnit);
            
            if (isStable) {
                this.stableCount++;
                this.updateStabilityUI(this.stableCount / this.requiredStable);
                
                if (this.stableCount === this.requiredStable) {
                    this.recordReading(voltage, resistance, rUnit);
                }
            } else {
                this.stableCount = 0;
                this.updateStabilityUI(0);
            }
        } else {
            this.stableCount = 0;
            this.updateStabilityUI(0);
            this.stabilityText.textContent = 'Invalid reading';
        }

        // Update current values display
        this.updateCurrentValues(voltage, resistance, rUnit);
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
        // Only proceed if we have valid numbers
        if (typeof voltage !== 'number' || typeof resistance !== 'number') {
            return;
        }

        const numReadings = this.averagingCheckbox.checked ? parseInt(this.numReadingsInput.value) : 1;
        
        // Add to current readings only after stability is confirmed
        if (this.stableCount >= this.requiredStable) {
            this.currentReadings.push({ voltage, resistance });
            this.stabilityText.textContent = `Reading ${this.currentReadings.length} of ${numReadings} captured`;
            this.stableCount = 0; // Reset stability counter for next reading
            this.prevVoltage = null; // Reset previous values to force new stabilization
            this.prevResistance = null;
        }

        if (this.currentReadings.length === numReadings) {
            const avgVoltage = this.currentReadings.reduce((sum, r) => sum + r.voltage, 0) / numReadings;
            const avgResistance = this.currentReadings.reduce((sum, r) => sum + r.resistance, 0) / numReadings;

            const reading = {
                cellNum: this.cellNum,
                cellType: this.cellTypeInput.value,
                voltage: avgVoltage.toFixed(4),
                resistance: avgResistance.toFixed(4),
                rUnit: rUnit,
                timestamp: new Date().toISOString()
            };

            this.readings.push(reading);
            this.addReadingToTable(reading);
            
            this.cellNum++;
            this.currentReadings = [];
            this.stableCount = 0;
            this.prevVoltage = null; // Reset previous values
            this.prevResistance = null;
            
            this.updateStabilityUI(0);
            this.stabilityText.textContent = 'Reading saved. Move probes to next cell.';
        }
    }

    updateCurrentValues(voltage, resistance, rUnit) {
        this.cellNumberSpan.textContent = this.cellNum;
        this.voltageSpan.textContent = typeof voltage === 'number' ? voltage.toFixed(4) + 'V' : voltage;
        this.resistanceSpan.textContent = typeof resistance === 'number' ? resistance.toFixed(4) + ' ' + rUnit : resistance;
    }

    updateStabilityUI(progress) {
        this.stabilityProgress.style.width = `${progress * 100}%`;
        if (progress === 0) {
            this.stabilityText.textContent = 'Waiting for stable reading...';
        } else if (progress < 1) {
            this.stabilityText.textContent = 'Stabilizing...';
        }
    }

    addReadingToTable(reading) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${reading.cellNum}</td>
            <td>${reading.cellType || 'N/A'}</td>
            <td>${reading.voltage}V</td>
            <td>${reading.resistance} ${reading.rUnit}</td>
            <td>${new Date(reading.timestamp).toLocaleTimeString()}</td>
        `;
        this.readingsLog.insertBefore(row, this.readingsLog.firstChild);
    }

    updateUI(state, message = '') {
        switch (state) {
            case 'connected':
                this.connectButton.textContent = 'Disconnect';
                this.statusText.textContent = 'Connected';
                this.statusText.style.color = 'var(--success-color)';
                break;
            case 'disconnected':
                this.connectButton.textContent = 'Connect Device';
                this.statusText.textContent = 'Not Connected';
                this.statusText.style.color = 'var(--text-color)';
                break;
            case 'error':
                this.statusText.textContent = message;
                this.statusText.style.color = 'var(--error-color)';
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

    clearLog() {
        if (confirm('Are you sure you want to clear all readings?')) {
            this.readings = [];
            this.readingsLog.innerHTML = '';
            this.cellNum = 1;
            this.currentReadings = [];
            this.stableCount = 0;
            this.updateCurrentValues('-', '-', '');
            this.updateStabilityUI(0);
        }
    }
}

// Check if WebSerial is supported
if ('serial' in navigator) {
    const logger = new BatteryLogger();
} else {
    alert('WebSerial is not supported in this browser. Please use Chrome or Edge.');
    document.querySelector('.container').innerHTML = '<h1>WebSerial Not Supported</h1><p>Please use Chrome or Edge browser to access this application.</p>';
} 