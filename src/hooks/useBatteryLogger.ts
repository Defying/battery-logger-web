import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'

// WebSerial API types
declare global {
  interface Navigator {
    serial: {
      requestPort(): Promise<SerialPort>
    }
  }

  interface SerialPort {
    readable: ReadableStream<Uint8Array> | null
    open(options: { baudRate: number }): Promise<void>
    close(): Promise<void>
  }
}

export interface Reading {
  cellNum: number
  cellType: string
  voltage: string
  resistance: string
  rUnit: string
  timestamp: string
}

interface CurrentReading {
  voltage: number
  resistance: number
  rUnit: string
}

interface CurrentValues {
  voltage: string
  resistance: string
}

export function useBatteryLogger() {
  // Connection state
  const [isConnected, setIsConnected] = useState(false)
  const [currentValues, setCurrentValues] = useState<CurrentValues>({ voltage: '-', resistance: '-' })

  // Readings state
  const [readings, setReadings] = useState<Reading[]>([])
  const [cellNum, setCellNum] = useState(1)
  const [currentReadings, setCurrentReadings] = useState<CurrentReading[]>([])

  // Settings
  const [cellType, setCellType] = useState('Molicel P50B')
  const [customCellType, setCustomCellType] = useState('')
  const [enableSound, setEnableSound] = useState(true)
  const [averaging, setAveraging] = useState(true)
  const [numReadings, setNumReadings] = useState(3)

  // Stability tracking
  const [stabilityProgress, setStabilityProgress] = useState(0)
  const [stabilityText, setStabilityText] = useState('Waiting for connection')
  const [isWaiting, setIsWaiting] = useState(true)

  // Refs for serial connection
  const portRef = useRef<SerialPort | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  // Internal state refs
  const stableCountRef = useRef(0)
  const prevVoltageRef = useRef<number | null>(null)
  const prevResistanceRef = useRef<number | null>(null)
  const prevRUnitRef = useRef<string | null>(null)
  const isReadingInProgressRef = useRef(false)
  const waitingForProbeRemovalRef = useRef(false)
  const lastReadingTimeRef = useRef(0)
  const noSignalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Constants
  const REQUIRED_STABLE = 10
  const EPSILON_RESISTANCE = 0.002
  const EPSILON_VOLTAGE = 0.01
  const COOLDOWN_PERIOD = 3000
  const PROBE_REMOVAL_THRESHOLD = 0.1

  const playBeep = useCallback(() => {
    if (!enableSound) return

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.frequency.value = 800
      oscillator.type = 'sine'

      gainNode.gain.setValueAtTime(0.15, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15)

      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.15)
    } catch (error) {
      console.log('Audio not available:', error)
    }
  }, [enableSound])

  const getEffectiveCellType = useCallback(() => {
    return cellType === 'custom' ? (customCellType.trim() || 'Custom') : cellType
  }, [cellType, customCellType])

  const updateCurrentValues = useCallback((voltage: number | string, resistance: number | string, rUnit: string) => {
    const voltageStr = typeof voltage === 'number' ? `${voltage.toFixed(4)}V` : String(voltage)
    const resistanceStr = typeof resistance === 'number' ? `${resistance.toFixed(4)} ${rUnit}` : String(resistance)
    setCurrentValues({ voltage: voltageStr, resistance: resistanceStr })
  }, [])

  const checkStability = useCallback((voltage: number, resistance: number, rUnit: string): boolean => {
    if (typeof voltage !== 'number' || typeof resistance !== 'number') {
      return false
    }

    if (prevVoltageRef.current === null || prevResistanceRef.current === null) {
      prevVoltageRef.current = voltage
      prevResistanceRef.current = resistance
      prevRUnitRef.current = rUnit
      return false
    }

    const voltageStable = Math.abs(voltage - prevVoltageRef.current) < EPSILON_VOLTAGE
    const resistanceStable = Math.abs(resistance - prevResistanceRef.current) < EPSILON_RESISTANCE
    const unitsMatch = rUnit === prevRUnitRef.current

    prevVoltageRef.current = voltage
    prevResistanceRef.current = resistance
    prevRUnitRef.current = rUnit

    return voltageStable && resistanceStable && unitsMatch
  }, [])

  // Effect to handle completing a cell when we have enough readings
  useEffect(() => {
    const targetReadings = averaging ? numReadings : 1

    if (currentReadings.length === targetReadings && currentReadings.length > 0) {
      // Calculate averages
      const avgVoltage = currentReadings.reduce((sum, r) => sum + r.voltage, 0) / targetReadings
      const avgResistance = currentReadings.reduce((sum, r) => sum + r.resistance, 0) / targetReadings
      const rUnit = currentReadings[0].rUnit

      const reading: Reading = {
        cellNum: cellNum,
        cellType: getEffectiveCellType(),
        voltage: avgVoltage.toFixed(4),
        resistance: avgResistance.toFixed(4),
        rUnit: rUnit,
        timestamp: new Date().toISOString(),
      }

      // Check for duplicates before adding
      setReadings(prev => {
        if (prev.some(r => r.cellNum === reading.cellNum)) {
          return prev
        }
        return [...prev, reading]
      })

      setCellNum(c => c + 1)
      setCurrentReadings([])
      setStabilityText('Reading saved. Move probes to next cell.')
      waitingForProbeRemovalRef.current = true
    }
  }, [currentReadings, averaging, numReadings, cellNum, getEffectiveCellType])

  const recordReading = useCallback((voltage: number, resistance: number, rUnit: string) => {
    if (typeof voltage !== 'number' || typeof resistance !== 'number') return

    // Prevent adding if we just completed (waiting for probe removal)
    if (waitingForProbeRemovalRef.current) return

    setCurrentReadings(prev => {
      const targetReadings = averaging ? numReadings : 1
      // Don't add more than needed
      if (prev.length >= targetReadings) return prev
      return [...prev, { voltage, resistance, rUnit }]
    })

    setStabilityText('Remove probes before next reading')
    waitingForProbeRemovalRef.current = true
    playBeep()
  }, [averaging, numReadings, playBeep])

  const processData = useCallback((data: Uint8Array) => {
    if (!data || data.length < 10) return

    const packet = data.slice(0, 10)
    const [statusDisp, _rRangeCode, rDisp1, rDisp2, rDisp3, signCode, _vRangeCode, vDisp1, vDisp2, vDisp3] = packet

    // Process resistance
    const rDispCode = (statusDisp & 0xf0) >> 4
    let resistance: number | string = ((rDisp1 & 0xff) | ((rDisp2 & 0xff) << 8) | ((rDisp3 & 0xff) << 16)) / 10000
    let rUnit = 'mΩ'

    if (rDispCode === 0x05) {
      rUnit = 'mΩ'
    } else if (rDispCode === 0x06) {
      rUnit = 'mΩ'
      resistance = 'OL'
    } else if (rDispCode === 0x09) {
      rUnit = 'Ω'
    } else if (rDispCode === 0x0a) {
      rUnit = 'Ω'
      resistance = 'OL'
    }

    // Process voltage
    const vDispCode = statusDisp & 0x0f
    let voltage: number | string = ((vDisp1 & 0xff) | ((vDisp2 & 0xff) << 8) | ((vDisp3 & 0xff) << 16)) / 10000
    voltage = (signCode === 1 ? 1 : -1) * voltage

    if (vDispCode === 0x08) {
      voltage = 'OL'
    }

    // Update display
    updateCurrentValues(voltage, resistance, rUnit)

    const now = Date.now()
    const isValid = typeof voltage === 'number' && typeof resistance === 'number' && voltage > 0

    // Clear existing timeout
    if (noSignalTimeoutRef.current) {
      clearTimeout(noSignalTimeoutRef.current)
    }

    // Check if probes have been removed
    if (waitingForProbeRemovalRef.current && (!isValid || (typeof voltage === 'number' && voltage < PROBE_REMOVAL_THRESHOLD))) {
      waitingForProbeRemovalRef.current = false
      isReadingInProgressRef.current = false
      stableCountRef.current = 0
      setStabilityProgress(0)
      setIsWaiting(true)
      return
    }

    // Set timeout for signal loss
    noSignalTimeoutRef.current = setTimeout(() => {
      if (!isValid && !waitingForProbeRemovalRef.current) {
        stableCountRef.current = 0
        setStabilityProgress(0)
        setIsWaiting(true)
        setStabilityText('Waiting for stable reading...')
      }
    }, 1000)

    if (!isValid) {
      if (!waitingForProbeRemovalRef.current && isReadingInProgressRef.current) {
        stableCountRef.current = 0
        setStabilityProgress(0)
        setIsWaiting(true)
        setStabilityText('Invalid reading')
      }
      return
    }

    if (waitingForProbeRemovalRef.current) {
      setStabilityText('Remove probes before next reading')
      return
    }

    // Cooldown check
    if (!isReadingInProgressRef.current && now - lastReadingTimeRef.current < COOLDOWN_PERIOD) {
      setStabilityText('Please wait before next reading...')
      return
    }

    // Start new reading
    if (!isReadingInProgressRef.current) {
      isReadingInProgressRef.current = true
      stableCountRef.current = 0
      prevVoltageRef.current = null
      prevResistanceRef.current = null
      setStabilityProgress(0)
      setIsWaiting(true)
    }

    const isStable = checkStability(voltage as number, resistance as number, rUnit)

    if (isStable) {
      stableCountRef.current++
      const progress = stableCountRef.current / REQUIRED_STABLE
      setStabilityProgress(progress * 100)
      setIsWaiting(false)

      if (progress < 1) {
        setStabilityText('Stabilizing...')
      }

      if (stableCountRef.current === REQUIRED_STABLE) {
        recordReading(voltage as number, resistance as number, rUnit)
        lastReadingTimeRef.current = now
      }
    } else if (!waitingForProbeRemovalRef.current) {
      stableCountRef.current = 0
      setStabilityProgress(0)
      setIsWaiting(true)
      setStabilityText('Waiting for stable reading...')
    }

    // Recursively handle remaining data
    if (data.length > 10) {
      processData(data.slice(10))
    }
  }, [updateCurrentValues, checkStability, recordReading])

  const startReading = useCallback(async () => {
    const reader = readerRef.current
    if (!reader) return

    while (true) {
      try {
        const { value, done } = await reader.read()
        if (done) break
        processData(value)
      } catch (error) {
        console.error('Read error:', error)
        toast.error('Connection lost')
        break
      }
    }
  }, [processData])

  const connect = useCallback(async () => {
    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 115200 })

      portRef.current = port
      readerRef.current = port.readable?.getReader() ?? null
      setIsConnected(true)
      setStabilityText('Waiting for stable reading...')
      setIsWaiting(true)

      toast.success('Connected successfully')
      startReading()
    } catch (error) {
      console.error('Connection error:', error)
      toast.error('Failed to connect to device')
    }
  }, [startReading])

  const disconnect = useCallback(async () => {
    if (readerRef.current) {
      await readerRef.current.cancel()
      readerRef.current.releaseLock()
    }
    if (portRef.current) {
      await portRef.current.close()
    }
    readerRef.current = null
    portRef.current = null
    setIsConnected(false)
    setStabilityText('Disconnected')
    toast.info('Disconnected')
  }, [])

  const toggleConnection = useCallback(async () => {
    if (isConnected) {
      await disconnect()
    } else {
      await connect()
    }
  }, [isConnected, connect, disconnect])

  const clearReadings = useCallback(() => {
    setReadings([])
    setCellNum(1)
    setCurrentReadings([])
    stableCountRef.current = 0
    isReadingInProgressRef.current = false
    waitingForProbeRemovalRef.current = false
    lastReadingTimeRef.current = 0
    setCurrentValues({ voltage: '-', resistance: '-' })
    setStabilityProgress(0)
    setIsWaiting(true)
    setStabilityText(isConnected ? 'Waiting for stable reading...' : 'Waiting for connection')
    toast.info('Readings cleared')
  }, [isConnected])

  const reloadCell = useCallback((targetCellNum: number) => {
    setReadings(prev => prev.filter(r => r.cellNum !== targetCellNum))
    setCellNum(targetCellNum)
    setCurrentReadings([])
    stableCountRef.current = 0
    isReadingInProgressRef.current = false
    waitingForProbeRemovalRef.current = false
    lastReadingTimeRef.current = 0
    setCurrentValues({ voltage: '-', resistance: '-' })
    setStabilityProgress(0)
    setIsWaiting(true)
    setStabilityText(isConnected ? `Ready to measure cell #${targetCellNum}` : 'Waiting for connection')
  }, [isConnected])

  const deleteMeasurement = useCallback((index: number) => {
    setCurrentReadings(prev => {
      const newReadings = [...prev]
      newReadings.splice(index, 1)
      return newReadings
    })
    waitingForProbeRemovalRef.current = false
    isReadingInProgressRef.current = false
    stableCountRef.current = 0
    setStabilityProgress(0)
    setIsWaiting(true)
    setStabilityText('Ready for next reading')
  }, [])

  const exportToCSV = useCallback(() => {
    if (readings.length === 0) {
      toast.error('No readings to export')
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${timestamp}-${getEffectiveCellType().replace('/', '_')}.csv`

    const csvContent = [
      ['Cell #', 'Type', 'Voltage', 'ACIR', 'Time'],
      ...readings.map(r => [r.cellNum, r.cellType || 'N/A', r.voltage + 'V', r.resistance + ' ' + r.rUnit, r.timestamp]),
    ]
      .map(row => row.join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    toast.success('Exported successfully')
  }, [readings, getEffectiveCellType])

  const importFromCSV = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const csvContent = e.target?.result as string
        const lines = csvContent.split('\n')
        const dataLines = lines.slice(1).filter(line => line.trim())

        if (dataLines.length === 0) {
          toast.error('No data found in CSV file')
          return
        }

        const importedReadings: Reading[] = []
        let maxCellNum = 0

        dataLines.forEach(line => {
          const parts = line.split(',')
          if (parts.length >= 5) {
            const cellNum = parseInt(parts[0])
            const cellType = parts[1]
            const voltage = parts[2].replace('V', '')
            const acirParts = parts[3].trim().split(' ')
            const resistance = acirParts[0]
            const rUnit = acirParts[1] || 'mΩ'
            const timestamp = parts[4]

            importedReadings.push({
              cellNum,
              cellType,
              voltage,
              resistance,
              rUnit,
              timestamp,
            })

            if (cellNum > maxCellNum) maxCellNum = cellNum
          }
        })

        setReadings(importedReadings)
        setCellNum(maxCellNum + 1)
        toast.success(`Successfully imported ${importedReadings.length} readings`)
      } catch (error) {
        console.error('Error importing CSV:', error)
        toast.error('Error importing CSV file')
      }
    }
    reader.readAsText(file)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (noSignalTimeoutRef.current) {
        clearTimeout(noSignalTimeoutRef.current)
      }
    }
  }, [])

  return {
    // Connection
    isConnected,
    toggleConnection,

    // Current values
    currentValues,
    cellNum,
    currentReadings,

    // Settings
    cellType,
    setCellType,
    customCellType,
    setCustomCellType,
    enableSound,
    setEnableSound,
    averaging,
    setAveraging,
    numReadings,
    setNumReadings,

    // Stability
    stabilityProgress,
    stabilityText,
    isWaiting,

    // Readings
    readings,
    clearReadings,
    reloadCell,
    deleteMeasurement,

    // Import/Export
    exportToCSV,
    importFromCSV,

    // Helpers
    getEffectiveCellType,
  }
}
