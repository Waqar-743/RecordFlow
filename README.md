<p align="center">
  <img src="public/recordflow.png" alt="RecordFlow icon" width="132" />
</p>

<h1 align="center">RecordFlow</h1>

<p align="center">
  A 100% free, privacy-first Windows recorder for screen, window, camera, microphone, and system audio — built to stay out of your recording.
</p>

<p align="center">
  <a href="https://github.com/Waqar-743/RecordFlow/releases/latest">
    <img alt="Download RecordFlow" src="https://img.shields.io/badge/Download-RecordFlow%20v1.1.0%20for%20Windows-1f6feb?style=for-the-badge&logo=windows" />
  </a>
</p>

## Why RecordFlow Exists

RecordFlow started with a simple idea: screen recording should feel calm, fast, local, and completely free. No accounts, no watermarks, no subscriptions, no cloud uploads, and no waiting for post-processing exports — your H.264/AAC MP4 is ready the moment you click Stop.

Whether you are recording a tutorial, a bug report, a walkthrough, or a product demo, RecordFlow stays invisible to Windows screen capture (`WDA_EXCLUDEFROMCAPTURE`) and lets you control everything from global hotkeys or the system tray.

## Download (Free for Windows)

Get the latest Windows installer from the [RecordFlow releases page](https://github.com/Waqar-743/RecordFlow/releases/latest).

Direct release assets:

- [Download EXE installer (`RecordFlow_1.1.0_x64-setup.exe`)](https://github.com/Waqar-743/RecordFlow/releases/latest/download/RecordFlow_1.1.0_x64-setup.exe)
- [Download MSI installer (`RecordFlow_1.1.0_x64_en-US.msi`)](https://github.com/Waqar-743/RecordFlow/releases/latest/download/RecordFlow_1.1.0_x64_en-US.msi)

## Highlights

- **100% Free & Local**: Zero cost, no accounts, no tracking, no watermarks — everything runs locally on your machine.
- **Full Screen, Custom Area & Single Window Capture**:
  - Multi-monitor selector with live display preview thumbnails.
  - Interactive 8-handle Snipping-style area picker with drag-to-move, live pixel readout, and capture-excluded live border overlay.
  - Native single-window capture directly via Windows Graphics Capture.
- **Real-Time System Audio + Microphone Mixer**:
  - Captures desktop/system audio via Windows WASAPI loopback and mixes it live with your microphone into a 48 kHz stereo AAC track.
  - Real-time microphone VU input level meter and 3-second mic test.
- **60 fps Hardware-First H.264 Recording**:
  - Choose `720p`, `1080p`, or `Native` resolution, `30` or `60 fps`, bitrate presets (`5 / 8 / 14 Mbps`), and cursor capture on/off.
  - Uses hardware-accelerated Windows Media Foundation encoding when available with automatic software fallback.
- **Async Camera Overlay**:
  - Runs webcam capture on a dedicated background thread so a 30 fps webcam never slows down a 60 fps screen recording.
  - Supports **Rectangle**, **Rounded**, and **Circle** shapes, corner positioning, sizing, and horizontal mirror toggle.
- **Global Shortcuts & System Tray**:
  - Control recording from anywhere (`Alt+Shift+R` to Start/Stop, `Alt+Shift+P` to Pause/Resume — fully customizable).
  - Live tray indicator dots (red while recording, amber while paused) and optional **Close to tray** background mode.
- **Presenter Teleprompter (Invisible in Recordings)**:
  - Floating always-on-top script window protected with `WDA_EXCLUDEFROMCAPTURE` so you can read your notes right over your demo without viewers ever seeing it.
  - Auto-scrolls when recording starts, pauses on pause, with speed, opacity, and font size controls.
- **Smooth Recording Workflow**:
  - Cancellable `Off / 3s / 5s` pre-recording countdown and optional *Minimize while recording*.
  - Pause, resume, and stop with accurate elapsed-time tracking and instant MP4 output in `Documents/RecordFlow/Recordings`.
  - Built-in session history, quick Explorer reveal, and automatic GitHub release update notifications.

## Default Global Shortcuts

| Action | Default Shortcut | Notes |
| :--- | :--- | :--- |
| **Start / Stop Recording** | `Alt + Shift + R` | Works even when minimized or in the system tray |
| **Pause / Resume Recording** | `Alt + Shift + P` | Works during active recording |

All shortcuts can be customized inside **Shortcuts** in the top toolbar.

## System Requirements

- Windows 10 version 1903 (build 18362) or later (64-bit).
- 4 GB RAM minimum, 8 GB recommended.
- 250 MB free disk space for installation, plus room for recordings.

Optional hardware:

- Webcam for picture-in-picture camera overlay.
- Microphone for voice commentary.

## Installation

1. Download the `.exe` or `.msi` installer from the [latest release](https://github.com/Waqar-743/RecordFlow/releases/latest).
2. Run the installer.
3. Launch **RecordFlow** from the Start Menu.
4. Pick **Full Screen**, **Custom Area**, or **Window**, configure audio/camera, and click **Start Recording** (or press `Alt+Shift+R`).

## Development

```bash
git clone https://github.com/Waqar-743/RecordFlow.git
cd RecordFlow
npm install
npm run tauri dev
```

Build a production Windows installer:

```bash
npm run tauri -- build
```

## Technology

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Desktop Core**: Tauri v2 & Rust
- **Screen & Window Capture**: Windows Graphics Capture API (`windows-capture`) + GDI thumbnails
- **Video & Audio Encoding**: Windows Media Foundation (hardware-first H.264 + AAC)
- **Audio Capture**: `cpal` (microphone input + Windows WASAPI system audio loopback)
- **Camera Capture**: `nokhwa` (dedicated background thread)
- **System Integration**: Tauri v2 System Tray & Global Shortcuts (`tauri-plugin-global-shortcut`)

## Troubleshooting

If recording does not start:

- Confirm you are on Windows 10 version 1903 (build 18362) or newer.
- In **Window** mode, make sure the target window is open and not minimized.
- Close other apps exclusively locking your webcam or microphone.
- Restart RecordFlow after changing Windows camera/microphone privacy permissions.

### Built with care — 100% free and open source
