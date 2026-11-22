<div align="center">
  <a href="https://waqar-743.github.io/RecordFlow/">
    <img src="public/recordflow.png" alt="RecordFlow Logo" width="128" />
  </a>

  <h1>RecordFlow</h1>

  <p>
    <strong>A 100% free, open-source, privacy-first Windows screen recorder &amp; post-recording auto-zoom studio.</strong><br />
    Invisible to Windows capture (<code>WDA_EXCLUDEFROMCAPTURE</code>) · 60 Hz click tracking · Independent webcam layer · 4K 60fps local export — in a <strong>2.97 MB</strong> native Rust &amp; Tauri v2 app.
  </p>

  <p>
    <a href="https://waqar-743.github.io/RecordFlow/">
      <img alt="Official Website" src="https://img.shields.io/badge/Website-Live%20Interactive%20Demo-ff6b4a?style=for-the-badge&logo=googlechrome&logoColor=white" />
    </a>
    <a href="https://github.com/Waqar-743/RecordFlow/releases/latest">
      <img alt="Download RecordFlow v1.3.3" src="https://img.shields.io/badge/Download-v1.3.3%20for%20Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" />
    </a>
  </p>

  <p>
    <a href="https://github.com/Waqar-743/RecordFlow/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/Waqar-743/RecordFlow?style=flat-square&color=ff6b4a" /></a>
    <a href="https://github.com/Waqar-743/RecordFlow/releases"><img alt="GitHub Downloads" src="https://img.shields.io/github/downloads/Waqar-743/RecordFlow/total?style=flat-square&color=22c55e" /></a>
    <a href="https://github.com/Waqar-743/RecordFlow/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Waqar-743/RecordFlow?style=flat-square&color=f59e0b" /></a>
    <img alt="Platform Windows 10/11 x64" src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64-0ea5e9?style=flat-square" />
    <img alt="Installer Size 2.97 MB" src="https://img.shields.io/badge/Installer-2.97%20MB%20Native-8b5cf6?style=flat-square" />
  </p>

  <p>
    <a href="https://waqar-743.github.io/RecordFlow/">Official Website</a> ·
    <a href="#download-free-for-windows">Download</a> ·
    <a href="#core-features">Features</a> ·
    <a href="#why-recordflow">Comparison</a> ·
    <a href="#default-global-shortcuts">Shortcuts</a> ·
    <a href="#architecture--tech-stack">Architecture</a> ·
    <a href="#development">Build from Source</a>
  </p>
</div>

---

## Overview

**RecordFlow** combines native Windows screen-capture speed with a modern, non-destructive post-recording presentation studio — without accounts, watermarks, subscriptions, or cloud uploads.

- **Try the Interactive Studio Preview Online:** [waqar-743.github.io/RecordFlow](https://waqar-743.github.io/RecordFlow/)
- **Stays Invisible While Recording:** Both the main RecordFlow window and the always-on-top **Presenter Script Teleprompter** use `WDA_EXCLUDEFROMCAPTURE`, so your controls and notes never leak into the captured video.
- **Edit Non-Destructively After Stopping:** Because your cursor clicks (`.cursor.json`) and webcam (`.cam.mp4`) are captured as independent synchronized tracks, you can generate smooth auto-zooms, reposition or reshape your camera overlay, swap backgrounds, blur sensitive regions, and export locally up to **4K 60fps MP4 or WebM**.

---

## Download (Free for Windows)

Get the latest official release from [GitHub Releases](https://github.com/Waqar-743/RecordFlow/releases/latest) or the [RecordFlow Website](https://waqar-743.github.io/RecordFlow/#download):

| Installer | File Name | Size | Best For |
| :--- | :--- | :---: | :--- |
| **EXE Setup (Recommended)** | [`RecordFlow_1.3.3_x64-setup.exe`](https://github.com/Waqar-743/RecordFlow/releases/latest) | `2.97 MB` | Standard Windows 10/11 desktop installation |
| **MSI Package** | [`RecordFlow_1.3.3_x64_en-US.msi`](https://github.com/Waqar-743/RecordFlow/releases/latest) | `3.59 MB` | Silent installs, IT rollouts & Group Policy |

> **100% Offline & Private:** Rendered entirely on your computer. Zero bytes uploaded, zero watermarks, zero time limits.

---

## Core Features

### 1. Capture Engine (`Screen`, `Area` & `Window`)
- **Screen Mode:** Live display preview with resolution/status badge (`Ready · 1920 × 1080`) and multi-monitor switching.
- **Area Mode:** Automatically hides RecordFlow and opens a full-screen translucent region selector with live pixel dimensions, 8 resize handles, and `Esc` to cancel and restore.
- **Window Mode:** Queries active Windows applications with a searchable **Choose a window** list, live `PrintWindow` window thumbnails, and isolated single-window capture.
- **Audio & Independent Camera:** Microphone capture with live Web Audio VU meter, Windows **WASAPI system audio loopback**, countdown selector (`Off / 3s / 5s`), and an independent synchronized webcam track (`.cam.mp4`).

### 2. Post-Recording Edit Studio
- **60 Hz Cursor & Click Auto-Zoom:** Tracks mouse movements and clicks at 60 Hz (`.cursor.json`). Generate one-click auto-zoom keyframes, choose `Subtle / Balanced / Close` zoom intensity, click-to-aim focus, and enable cursor click ripples & spotlight halo.
- **Canvas & Curated Backgrounds:** Aspect ratio presets (`16:9`, `9:16`, `1:1`, `4:5`, `Original`), `Fit` vs `Fill` framing, **18 curated built-in backgrounds** (gradients, meshes, scenic wallpapers, solid tones), plus **Custom Image** uploads.
- **Non-Destructive Webcam Overlay:** Snap to corners (`Top-Left`, `Top-Right`, `Bottom-Left`, `Bottom-Right`, `Center-Edge`) or drag freely on the canvas; adjust scale, shape (`Circle`, `Rounded`, `Square`), corner radius, horizontal mirror, border, shadow, or toggle visibility.
- **Audio Mixer, Privacy Blur & Timeline:** Balance microphone, system audio, and master levels with fade-in/out; add draggable privacy blur masks; scrub and trim with Play/Pause (`Space`), waveform visualization, and zoom keyframe markers.

### 3. Turbo Local Export Engine
- Hardware-first linear decoding with offscreen backdrop/shadow caching and WebCodecs (`mp4-muxer` / `webm-muxer`).
- **Formats:** `MP4` (H.264 + AAC) and `WebM`.
- **Resolutions:** `4K (2160p)`, `1440p (QHD)`, `1080p (Full HD)`, `720p`.
- **Frame Rates & Quality:** `60 fps` or `30 fps` with `Best`, `High`, and `Small` quality profiles.

### 4. Studio Experience, Themes & Teleprompter
- **Invisible Presenter Script Teleprompter:** Always-on-top script window protected by `WDA_EXCLUDEFROMCAPTURE` so you maintain eye contact while reading notes unseen by viewers.
- **8 Dynamic Studio Themes:** Switch live with instant surface updates and persistence across **Obsidian Flame**, **Molten Ember**, **Crimson Noir**, **Burnished Copper**, **Velvet Rosé**, **Royal Amethyst**, **Editorial Ivory**, and **Alabaster Sun**.
- **Conflict-Free Shortcuts & System Tray:** Automatic hotkey conflict detection with fallback and dismissible alert banners.

---

## Why RecordFlow?

| Capability | RecordFlow v1.3.3 | Cloud Recorders (Loom, etc.) | Heavy Suites (OBS / Camtasia) |
| :--- | :---: | :---: | :---: |
| **Price** | **Free & Open Source** | Monthly subscription | Free (OBS) / Paid (Camtasia) |
| **Installer Size** | **2.97 MB** | 120–250 MB | 150–600 MB+ |
| **Invisible UI & Teleprompter** | **Built-in (`WDA_EXCLUDEFROMCAPTURE`)** | Often captured | Manual setup |
| **60 Hz Click Auto-Zoom** | **One-click built-in** | No | Manual keyframes |
| **Post-Recording Editable Webcam** | **Yes (`.cam.mp4`)** | Baked in | Complex multi-track |
| **100% Offline & Watermark-Free** | **Yes** | Cloud-first / Free caps | Local |

---

## Default Global Shortcuts

| Action | Default Shortcut | Behavior |
| :--- | :---: | :--- |
| **Start / Stop Recording** | `Alt + Shift + R` | Works globally, even when minimized to the system tray |
| **Pause / Resume Recording** | `Alt + Shift + P` | Works globally during active recording |
| **Cancel Area Selection** | `Esc` | Exits region picker and restores the workspace |
| **Play / Pause Preview** | `Space` | Controls timeline playback in Edit Studio |

> All global hotkeys can be customized inside **Shortcuts** in the top navigation bar.

---

## System Requirements

| Requirement | Minimum | Recommended |
| :--- | :--- | :--- |
| **OS** | Windows 10 v1903 (build 18362, 64-bit) | Windows 10 / Windows 11 (64-bit) |
| **RAM** | 4 GB | 8 GB+ |
| **Disk Space** | 250 MB + space for recordings | SSD for 4K 60fps exports |
| **Hardware (Optional)** | DX11+ GPU for hardware encoding | Webcam & Microphone for PiP + voiceover |

---

## Architecture & Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Core** | [Tauri v2](https://v2.tauri.app/) & [Rust](https://www.rust-lang.org/) (System Tray, Global Shortcuts, FS & Native Dialogs) |
| **Frontend & Studio UI** | React 19, TypeScript, Vite 7, Tailwind CSS, HTML5 Canvas2D |
| **Screen & Window Capture** | [Windows Graphics Capture API](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture) (`windows-capture`) + GDI `PrintWindow` thumbnails |
| **Video & Audio Encoding** | Windows Media Foundation (hardware-first H.264/AAC) + [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) (`mp4-muxer` / `webm-muxer`) |
| **Audio & Camera Pipelines** | `cpal` (Microphone + Windows WASAPI Loopback) & `nokhwa` (independent `.cam.mp4` thread) |
| **Interaction Tracking** | Win32 60 Hz cursor & click sampler (`.cursor.json`) |

---

## Development

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/) (latest stable)
- Windows 10/11 with Microsoft C++ Build Tools & WebView2 Runtime

### Run Locally
```bash
git clone https://github.com/Waqar-743/RecordFlow.git
cd RecordFlow
npm install
npm run tauri dev
```

### Build Production Installers (`.exe` & `.msi`)
```bash
npm run tauri -- build
```

---

## Contributing & Community

Contributions, bug reports, and feature ideas are welcome!

- **Website & Interactive Demo:** [https://waqar-743.github.io/RecordFlow/](https://waqar-743.github.io/RecordFlow/)
- **Report a Bug / Request a Feature:** [GitHub Issues](https://github.com/Waqar-743/RecordFlow/issues)
- **Releases & Changelogs:** [GitHub Releases](https://github.com/Waqar-743/RecordFlow/releases)

### Recorded a Demo with RecordFlow?
Show support by adding a lightweight badge to your project README or docs:

```markdown
[![Recorded with RecordFlow](https://img.shields.io/badge/Recorded%20with-RecordFlow-ff6b4a?style=flat-square)](https://waqar-743.github.io/RecordFlow/)
```

---

## Related Projects by [Waqar Ahmed](https://waqarahmed.live/)

- [**RecordFlow Website**](https://waqar-743.github.io/RecordFlow/) — Official landing page & interactive browser studio simulator
- [**SnapNote**](https://waqar-743.github.io/SnapNote/) — Modern desktop note-taking app with clipboard capture, OCR, and stay-on-top pinning
- [**Syslume**](https://github.com/Waqar-743/Syslume) — Windows system intelligence app for CPU, RAM, GPU, storage & process monitoring (Tauri + Rust)
- [**Audit AI**](https://audit-ai-fawn.vercel.app) — SEO analyzer delivering actionable insights for search performance optimization
- [**Waqar Ahmed Portfolio**](https://waqarahmed.live/) — More open-source apps, desktop tools, and web engineering projects

---

<p align="center">
  Built with care by <a href="https://waqarahmed.live/"><strong>Waqar Ahmed (@Waqar-743)</strong></a> · 100% free and open source
</p>
