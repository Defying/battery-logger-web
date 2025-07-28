# Battery Logger WebSerial

A web-based version of the Battery Logger for RC3563, using WebSerial API to communicate with the device directly from your browser.

## Features

- Real-time battery voltage and ACIR measurements
- Automatic stability detection
- Averaging of multiple readings
- CSV export functionality
- Modern, responsive web interface
- Works directly in your browser - no installation needed!

## Requirements

- Google Chrome or Microsoft Edge browser (WebSerial API is required)
- RC3563 Battery Tester connected via USB
- Web server to host the files (or you can open index.html directly)

## Usage

1. Connect your RC3563 Battery Tester to your computer via USB
2. Open the web application in Chrome or Edge
3. Click "Connect Device" and select your RC3563 from the port list
4. (Optional) Configure settings:
   - Enter cell type (e.g., "50S")
   - Enable averaging if desired
   - Set number of readings to average
5. Start taking measurements:
   - The interface will show current readings in real-time
   - Wait for readings to stabilize (progress bar will fill)
   - Once stable, readings will be automatically recorded
   - Move to next cell when prompted
6. Export your data:
   - Click "Export CSV" to download your readings
   - Files are named with timestamp and cell type

## Settings

- **Cell Type**: Optional identifier for the type of cells being tested
- **Enable Averaging**: Toggle to average multiple readings per cell
- **Number of Readings**: How many readings to average (when averaging is enabled)

## Data Format

The exported CSV file contains:
- Cell number
- Cell type
- Voltage (V)
- ACIR (mΩ or Ω)
- Timestamp

## Troubleshooting

1. **Device Not Found**
   - Ensure the RC3563 is properly connected via USB
   - Try unplugging and reconnecting the device
   - Make sure no other application is using the serial port

2. **Browser Not Supported**
   - Use Google Chrome or Microsoft Edge
   - Make sure your browser is up to date

3. **Connection Issues**
   - Check USB cable connection
   - Try a different USB port
   - Close any other applications that might be using the serial port

## Browser Support

The WebSerial API is currently supported in:
- Google Chrome (version 89 or later)
- Microsoft Edge (version 89 or later)
- Chrome for Android (with enabled flag)

Other browsers do not support WebSerial at this time.

## Security Notes

- The web application requires permission to access serial ports
- All data processing is done locally in your browser
- No data is sent to any external servers
- CSV files are generated and downloaded locally

## Development

The application consists of three main files:
- `index.html`: Main interface structure
- `styles.css`: Visual styling
- `script.js`: Application logic and WebSerial communication

To modify or extend the application, edit these files as needed. 