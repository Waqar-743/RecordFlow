# RecordFlow (Windows) — Screen + Camera Recorder

[![Build and Release](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/actions/workflows/release.yml/badge.svg)](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/Waqar-743/Screen-and-Camera-Recording-app?label=Download)](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/releases/latest)

RecordFlow is a lightweight Windows desktop app (Tauri + React + Rust) for recording your screen with an optional camera overlay and microphone audio, saved as an `mp4`.

## Download

### Quick Download (Windows)

[![Download RecordFlow](https://img.shields.io/badge/Download-RecordFlow%20for%20Windows-blue?style=for-the-badge&logo=windows)](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/releases/latest)

**Direct Download Links:**
- [Download .exe Installer (Recommended)](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/releases/latest/download/RecordFlow_1.0.0_x64-setup.exe)
- [Download .msi Installer](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/releases/latest/download/RecordFlow_1.0.0_x64_en-US.msi)

> **Note:** If the direct links don't work, visit the [Releases Page](https://github.com/Waqar-743/Screen-and-Camera-Recording-app/releases/latest) to download manually.

## System Requirements

### Minimum Requirements
- **Operating System**: Windows 10 version 1903 (build 18362) or later
- **RAM**: 4 GB minimum, 8 GB recommended
- **Storage**: 500 MB for installation, additional space for recordings
- **Display**: 1280x720 minimum resolution

### Why Windows 10 1903+?
RecordFlow uses the **Windows Graphics Capture API** for efficient, low-latency screen capture. This API is only available on Windows 10 version 1903 (May 2019 Update) and later versions. If you're running an older version of Windows, you'll need to update your system to use this application.

### Optional Hardware
- **Webcam**: For camera overlay recording (any UVC-compatible webcam)
- **Microphone**: For audio recording (built-in or external)

## Features

- **Screen Recording**: Capture your entire screen at 720p or 1080p resolution
- **Camera Overlay**: Optional webcam overlay with adjustable position (corners) and size (Small/Medium/Large)
- **Microphone Recording**: Record audio with adjustable volume control
- **Pause/Resume**: Pause and resume recording at any time
- **Auto-Save**: Recordings are automatically saved to `Documents/RecordFlow/Recordings` as `recording_YYYYMMDD_HHMMSS.mp4`
- **History**: View your recording history with quick access to files

## Installation

### From Installer (Recommended)
1. Download the installer from the releases page
2. Run the `.exe` or `.msi` installer
3. Follow the installation wizard
4. Launch RecordFlow from the Start Menu

### From Source (Development)
```bash
# Clone the repository
git clone https://github.com/Waqar-743/Screen-and-Camera-Recording-app.git
cd Screen-and-Camera-Recording-app

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Usage

1. **Launch the app** from Start Menu or desktop shortcut
2. **Configure Settings**:
   - Select display to record
   - Enable/disable camera overlay
   - Select microphone and adjust volume
   - Choose resolution (720p/1080p)
3. **Start Recording**: Click the "Start" button
4. **Control Recording**: Use Pause/Resume/Stop buttons as needed
5. **Find Recordings**: Check `Documents/RecordFlow/Recordings` folder

## Troubleshooting

### "Screen capture requires Windows 10 version 1903 or later"
- **Cause**: Your Windows version doesn't support the Graphics Capture API
- **Solution**: Update Windows to version 1903 or later via Windows Update

### "Display not found"
- **Cause**: Screen capture initialization failed
- **Solution**: 
  1. Ensure you have at least one active display
  2. Try restarting the application
  3. Check if your graphics drivers are up to date

### "No cameras detected"
- **Cause**: Camera not connected or drivers not installed
- **Solution**:
  1. Connect a webcam if you want camera overlay
  2. Check Device Manager for camera drivers
  3. This is normal if you don't have a webcam - screen recording will still work

### "No microphones detected"
- **Cause**: No audio input devices available
- **Solution**:
  1. Connect a microphone or use built-in mic
  2. Check Windows Sound Settings
  3. Recording without audio will still work

### Recording fails to start
- **Cause**: Various initialization issues
- **Solution**:
  1. Close other screen recording applications
  2. Run RecordFlow as Administrator
  3. Check Windows Privacy settings for screen recording permissions
  4. Restart your computer

### Video file is corrupted or won't play
- **Cause**: Encoding or file write issues
- **Solution**:
  1. Ensure you have enough disk space
  2. Try recording to a different location
  3. Install the latest Windows Media Feature Pack if codecs are missing

## Technology Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Tauri 2 + Rust
- **Screen Capture**: Windows Graphics Capture API (via `windows-capture` crate)
- **Camera**: nokhwa library with Media Foundation backend
- **Audio**: cpal for audio capture
- **Video Encoding**: Windows Media Foundation (H.264 + AAC)

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # React hooks
│   ├── pages/              # Page components
│   ├── services/           # Tauri service calls
│   └── types/              # TypeScript types
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri commands
│   │   ├── recording/      # Recording logic
│   │   ├── state/          # App state
│   │   └── utils/          # Utilities
│   └── crates/
│       └── windows-capture/ # Patched capture library
└── public/                 # Static assets
```

## Known Limitations

- **Windows Only**: Uses Windows-specific APIs for screen capture
- **No Audio Loopback**: System audio capture is not yet implemented (microphone only)
- **Single Display**: Records one display at a time
- **Fixed Overlay Positions**: Camera overlay positions are preset (corners)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop app framework
- [windows-capture](https://github.com/NiiightmareXD/windows-capture) - Screen capture library
- [nokhwa](https://github.com/l1npengtul/nokhwa) - Camera capture library
- [cpal](https://github.com/RustAudio/cpal) - Audio capture library
