declare const __COMMIT_HASH__: string

import { useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { Usb, RotateCcw, X, ArrowUpDown } from 'lucide-react'

import { useBatteryLogger } from '@/hooks/useBatteryLogger'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

const CELL_TYPES = [
  'N/A',
  'Molicel P45B',
  'Molicel P50B',
  'Molicel P42A',
  'Molicel P28A',
  'Molicel P30B',
  'Samsung 50S',
  'Reliance RS50',
  'Ampace JP40',
  'Eve 40PL',
  'Sony | Murata VTC6',
  'custom',
]

type SortColumn = 'cellNum' | 'voltage' | 'resistance' | 'timestamp'
type SortDirection = 'asc' | 'desc'

function App() {
  const {
    isConnected,
    toggleConnection,
    currentValues,
    cellNum,
    currentReadings,
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
    stabilityProgress,
    stabilityText,
    isWaiting,
    readings,
    clearReadings,
    reloadCell,
    deleteMeasurement,
    exportToCSV,
    importFromCSV,
    getEffectiveCellType,
  } = useBatteryLogger()

  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [numReadingsInput, setNumReadingsInput] = useState(String(numReadings))
  const [reloadDialogOpen, setReloadDialogOpen] = useState(false)
  const [cellToReload, setCellToReload] = useState<number | null>(null)
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Check WebSerial support
  const [isSupported, setIsSupported] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!('serial' in navigator)) {
      setIsSupported(false)
      setErrorMessage('WebSerial is not supported in this browser. Please use a Chromium-based browser (Chrome, Edge, Opera, Brave, etc).')
    } else if (!window.isSecureContext) {
      setIsSupported(false)
      setErrorMessage('WebSerial requires a secure context (HTTPS or localhost).')
    }
  }, [])

  // Dark mode based on system preference
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      document.documentElement.classList.toggle('dark', e.matches)
    }
    updateTheme(mediaQuery)
    mediaQuery.addEventListener('change', updateTheme)
    return () => mediaQuery.removeEventListener('change', updateTheme)
  }, [])

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedReadings = [...readings].sort((a, b) => {
    if (!sortColumn) return b.cellNum - a.cellNum // Default: newest first

    let aVal: number | string, bVal: number | string

    switch (sortColumn) {
      case 'cellNum':
        aVal = a.cellNum
        bVal = b.cellNum
        break
      case 'voltage':
        aVal = parseFloat(a.voltage)
        bVal = parseFloat(b.voltage)
        break
      case 'resistance':
        aVal = parseFloat(a.resistance)
        bVal = parseFloat(b.resistance)
        break
      case 'timestamp':
        aVal = new Date(a.timestamp).getTime()
        bVal = new Date(b.timestamp).getTime()
        break
    }

    if (sortDirection === 'asc') {
      return aVal > bVal ? 1 : -1
    } else {
      return aVal < bVal ? 1 : -1
    }
  })

  // Calculate min/max for highlighting
  const voltages = readings.map(r => parseFloat(r.voltage))
  const resistances = readings.map(r => parseFloat(r.resistance))
  const minVoltage = Math.min(...voltages)
  const maxVoltage = Math.max(...voltages)
  const minResistance = Math.min(...resistances)
  const maxResistance = Math.max(...resistances)

  const getVoltageClass = (voltage: string) => {
    const v = parseFloat(voltage)
    if (readings.length < 2) return ''
    if (v === maxVoltage) return 'text-green-600 dark:text-green-400 font-bold'
    if (v === minVoltage) return 'text-red-600 dark:text-red-400 font-bold'
    return ''
  }

  const getResistanceClass = (resistance: string) => {
    const r = parseFloat(resistance)
    if (readings.length < 2) return ''
    if (r === minResistance) return 'text-green-600 dark:text-green-400 font-bold'
    if (r === maxResistance) return 'text-red-600 dark:text-red-400 font-bold'
    return ''
  }

  const handleReloadClick = (cellNumToReload: number) => {
    setCellToReload(cellNumToReload)
    setReloadDialogOpen(true)
  }

  const confirmReload = () => {
    if (cellToReload !== null) {
      reloadCell(cellToReload)
    }
    setReloadDialogOpen(false)
    setCellToReload(null)
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      importFromCSV(file)
    }
    e.target.value = ''
  }

  const handleClearClick = () => {
    if (readings.length === 0) {
      toast.info('No readings to clear')
      return
    }
    setClearDialogOpen(true)
  }

  const confirmClear = () => {
    clearReadings()
    setClearDialogOpen(false)
  }

  if (!isSupported) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Toaster richColors position="bottom-right" />
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">WebSerial Not Supported</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{errorMessage}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const targetReadings = averaging ? numReadings : 1
  const currentReadingNum = currentReadings.length + 1

  return (
    <div className="min-h-screen">
      <Toaster richColors position="bottom-right" />

      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <header className="flex justify-between items-center pt-12 pb-6 px-6">
          <div className="flex items-center gap-4">
            <img src="./cw-black.png" alt="Carve Workshop Logo" className="h-10 w-auto dark:hidden" />
            <img src="./cw-white.png" alt="Carve Workshop Logo" className="h-10 w-auto hidden dark:block" />
            <h1 className="text-2xl font-bold">Battery Logger for RC3563</h1>
          </div>
          <Button
            onClick={toggleConnection}
            className={cn(
              'rounded-full px-6 transition-all duration-300',
              isConnected && 'connected-glow'
            )}
          >
            {isConnected && <Usb className="h-5 w-5" />}
            <span>{isConnected ? 'Connected' : 'Connect'}</span>
          </Button>
        </header>

        {/* Settings Panel */}
        <Card className="my-4">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cellType">Cell Type</Label>
                <Select value={cellType} onValueChange={setCellType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select cell type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CELL_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {type === 'custom' ? 'Custom...' : type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cellType === 'custom' && (
                  <Input
                    placeholder="Enter custom cell type"
                    value={customCellType}
                    onChange={e => setCustomCellType(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              <div className="flex flex-col items-center justify-center space-y-2">
                <Label htmlFor="sound">Sound</Label>
                <Switch id="sound" checked={enableSound} onCheckedChange={setEnableSound} />
              </div>

              <div className="flex flex-col items-center justify-center space-y-2">
                <Label htmlFor="averaging">Averaging</Label>
                <Switch id="averaging" checked={averaging} onCheckedChange={setAveraging} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="numReadings"># of Readings</Label>
                <Input
                  id="numReadings"
                  type="number"
                  min={1}
                  max={20}
                  value={numReadingsInput}
                  onChange={e => {
                    setNumReadingsInput(e.target.value)
                    const num = parseInt(e.target.value)
                    if (!isNaN(num) && num >= 1 && num <= 20) {
                      setNumReadings(num)
                    }
                  }}
                  onBlur={() => {
                    const num = parseInt(numReadingsInput)
                    if (isNaN(num) || num < 1) {
                      setNumReadingsInput('1')
                      setNumReadings(1)
                    } else if (num > 20) {
                      setNumReadingsInput('20')
                      setNumReadings(20)
                    }
                  }}
                  className="text-center font-semibold"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Current Reading Panel */}
        <Card className="my-4">
          <CardContent className="p-6">
            {(isConnected || readings.length > 0) && (
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Cell #</span>
                  <p className="text-lg font-medium">{cellNum}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Reading #</span>
                  <p className="text-lg font-medium">{isConnected ? `${currentReadingNum}/${targetReadings}` : '-'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Voltage</span>
                  <p className="text-lg font-medium">{currentValues.voltage}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">ACIR</span>
                  <p className="text-lg font-medium">{currentValues.resistance}</p>
                </div>
              </div>
            )}

            <Progress value={stabilityProgress} waiting={isWaiting} className="mb-2" />
            <p className="text-sm text-muted-foreground">{stabilityText}</p>

            {/* Nested Measurements Cards (when averaging) */}
            {averaging && numReadings > 1 && isConnected && (
              <div className="mt-6 pt-6 border-t -mx-6 px-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Measurements</h3>
                <div className="flex flex-wrap gap-3 w-full [&>*]:flex-1 [&>*]:min-w-[120px]">
                  {Array.from({ length: numReadings }).map((_, i) => {
                    const reading = currentReadings[i]
                    return (
                      <Card key={i} className={cn(
                        "relative bg-muted/50",
                        !reading && "border-dashed"
                      )}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-muted-foreground">
                              #{i + 1}
                            </span>
                            {reading && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteMeasurement(i)}
                                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          {reading ? (
                            <div className="space-y-1">
                              <p className="text-sm">
                                <strong>{reading.voltage.toFixed(4)}V</strong>
                              </p>
                              <p className="text-sm">
                                <strong>{reading.resistance.toFixed(4)} {reading.rUnit}</strong>
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <Skeleton className="h-4 w-20" />
                              <Skeleton className="h-4 w-24" />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Readings Log */}
        {(isConnected || readings.length > 0) && (
          <div className="my-4">
            <h2 className="text-xl font-semibold mb-3 px-6">{getEffectiveCellType()} Readings</h2>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('cellNum')}
                    >
                      <div className="flex items-center gap-1">
                        Cell #
                        <ArrowUpDown className="h-4 w-4" />
                        {sortColumn === 'cellNum' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('voltage')}
                    >
                      <div className="flex items-center gap-1">
                        Voltage
                        <ArrowUpDown className="h-4 w-4" />
                        {sortColumn === 'voltage' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('resistance')}
                    >
                      <div className="flex items-center gap-1">
                        ACIR
                        <ArrowUpDown className="h-4 w-4" />
                        {sortColumn === 'resistance' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('timestamp')}
                    >
                      <div className="flex items-center gap-1">
                        Time
                        <ArrowUpDown className="h-4 w-4" />
                        {sortColumn === 'timestamp' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedReadings.map(reading => (
                    <TableRow key={`${reading.cellNum}-${reading.timestamp}`}>
                      <TableCell>{reading.cellNum}</TableCell>
                      <TableCell className={getVoltageClass(reading.voltage)}>
                        {reading.voltage}V
                      </TableCell>
                      <TableCell className={getResistanceClass(reading.resistance)}>
                        {reading.resistance} {reading.rUnit}
                      </TableCell>
                      <TableCell>{reading.timestamp}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleReloadClick(reading.cellNum)}
                          className="reload-btn transition-transform duration-300"
                        >
                          <RotateCcw className="h-5 w-5 text-primary" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3 justify-center mt-12 px-6">
          <Button onClick={exportToCSV} className="rounded-full px-6">
            Export
          </Button>
          <Button variant="secondary" onClick={handleImportClick} className="rounded-full px-6">
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button variant="destructive" onClick={handleClearClick} className="rounded-full px-6">
            Clear
          </Button>
        </div>

        {/* Footer */}
        <footer className="mt-12 pb-6 text-center text-sm text-muted-foreground">
          <p>not my fault if you blow up 💥</p>
          <p className="mt-1">
            commit: <code className="text-foreground">{__COMMIT_HASH__}</code>
          </p>
        </footer>
      </div>

      {/* Clear Confirmation Dialog */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Readings?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all readings? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClear} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reload Confirmation Dialog */}
      <AlertDialog open={reloadDialogOpen} onOpenChange={setReloadDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reload Cell #{cellToReload}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the current reading for Cell #{cellToReload}. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReload}>Reload</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default App
