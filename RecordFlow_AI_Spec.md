Redesign the entire desktop screen-recording and video-editing application completely from scratch. Treat this as a ground-up architectural and visual overhaul: use your own design creativity to craft a refined, studio-grade desktop interface with cohesive typography, subtle depth, crisp iconography, fluid micro-interactions, and zero visual clutter. While elevating the aesthetics and user experience with your own creative touches, implement every core layout, control, and end-to-end workflow detailed below.

1. Window Launch & Application Shell
Full-Screen Launch: Configure the desktop application to open maximized / full-screen immediately upon startup, presenting the primary recording workspace without cramped layouts or clipped elements.

Top Navigation Bar: Build a streamlined header containing the app logo/branding, a primary Record / Edit workspace switcher, quick project actions (Open project, Save project), an interactive Theme Selector dropdown, a Script panel toggle, and a Shortcuts configuration menu.

Dismissible Alert Banner: Include a non-intrusive, dismissible banner slot beneath the header for system notices or hotkey conflict alerts.

2. Multi-Theme System
Theme Switcher: Clicking the theme button in the top bar (e.g., Graphite) must open a clean dropdown displaying theme preview swatches, names, and short descriptions.

Workable Themes: Implement at least 5–8 fully functional, dynamically applied themes—such as Graphite (calm neutral dark), Ember (warm dark, coral accent), Paper (warm light), Daylight (crisp cool light), Midnight (deep navy, sky accent), Nord (arctic blue-grey), and Rosé (muted violet, rose accent).

System-Wide Persistence: Switching themes must instantly update every surface, canvas backdrop, sidebar, modal, button, and timeline across the entire app and persist the user's choice between sessions.

3. Record Workspace & Capture Modes
Design the main recording dashboard with a clear header ("New recording" plus a concise description of automatic interaction tracking), a live preview stage, and a segmented capture-mode switcher for Screen, Area, and Window.

Screen Mode: Display a live preview of the active display with a floating status and resolution badge (e.g., Ready 1920 × 1080).

Area Mode (Interactive Region Capture):

Clicking Area must immediately hide/minimize the main application window and launch a full-screen, translucent region-selection overlay.

Allow the user to click and drag to draw a precise capture rectangle with live dimension readouts, and press Esc at any time to cancel and restore the app window.

Once a region is confirmed, restore the main app with the selected area locked in and displayed in the preview.

Window Mode (Active Window Detection):

Clicking Window must query the OS for all currently active windows and open applications, displaying them in a clean, scrollable "Choose a window" list showing each window's title and executable/process name, paired with a working Refresh button.

Selecting any window must cleanly target it, display its dimensions and a focused preview state (e.g., window icon, title, and "Only this window is recorded" indicator), and keep all recording toggles and the Start recording bar accessible below.

4. Pre-Recording Controls & Screen-Share Flow
Place three structured, fully functional control cards directly beneath the preview area, followed by a prominent bottom action bar:

Microphone Toggle: Working On/Off switch that actually enables/disables microphone capture (with device selection when enabled).

Camera Toggle: Working On/Off switch that activates the user's webcam feed and records it as an independent, synchronized video stream so it can be edited non-destructively later.

Countdown Selector: Working segmented toggle for Off, 3s, and 5s that displays an on-screen countdown before capture begins.

Hide While Recording Toggle: Working switch (Hide app while recording) that automatically minimizes or hides the desktop app once recording starts.

Start Recording & Source Picker: Clicking the primary Start recording button (labeled with its active keyboard shortcut, e.g., Alt+Shift+R) must allow the user to confirm or select their share target via a clean screen-share picker supporting Window and Entire Screen tabs, live thumbnails, and a functional Share with system audio toggle.

5. Post-Recording Studio (Edit Phase)
When a recording ends, automatically transition into the Edit workspace with the captured footage framed inside a polished presentation canvas (rounded corners, subtle drop shadow, and background padding).

Right Inspector Panel: Build a tabbed editing sidebar covering Canvas, Zoom, Cursor, Audio, Camera, and Blur:

Canvas & Backgrounds: Provide aspect ratio presets (16:9 Landscape, 9:16 Vertical, 1:1 Square, 4:5 Portrait, Original) and framing modes (Fit vs Fill). Include a clickable grid of curated built-in backgrounds (sleek gradients, abstract textures, scenic wallpapers, and solid tones) that update the canvas live on click, plus a Custom Image upload option.

Post-Recording Camera Controls (Camera Tab): Because the webcam is captured as an independent layer, give the user full control after recording to:

Reposition the camera overlay via quick-snap position buttons (Top-Left, Top-Right, Bottom-Left, Bottom-Right, Center-Edge) as well as direct drag-and-drop on the canvas.

Adjust camera size/scale, shape/corner radius (circle, rounded rectangle, square), mirroring, border/shadow styling, or toggle the webcam overlay on/off.

Supporting Tools: Wire up practical controls for Zoom (presets and keyframes), Cursor, Audio (mic/system volume balance), and Blur so no tabs are dead placeholders.

Interactive Timeline & Playback Bar: Include Play/Pause controls, current/total timecode, Trim controls (Start and End timestamps), zoom intensity presets (Subtle, Balanced, Close), Add zoom and Reset actions, a visual waveform/zoom timeline track, and a primary Export button pinned to the bottom right.

6. Local Export Modal
Clicking Export must open a clean, focused Export video dialog emphasizing local rendering ("Rendered on this computer. Nothing is uploaded.") with selectable option cards for:

Format: MP4 (Plays everywhere — recommended) and WebM (For the web).

Resolution: 4K (2160p), 1440p (QHD), 1080p (Full HD), and 720p (Smaller file).

Frame Rate: 60 fps (Smoothest) and 30 fps (Smaller).

Quality: Best, High, and Small.

Execution: Clicking the modal's Export button must composite the screen recording, chosen background, framing, trims, and post-recording camera placement/styling into the selected format and quality, displaying real-time progress and letting the user save the rendered file locally.

7. Engineering & Quality Standards
Structure the codebase cleanly with modular separation between the native desktop shell/window management, capture engine (screen, area overlay, window enumeration, audio, independent webcam stream), theme system, real-time canvas editor, and local export pipeline.

Ensure every visible button, toggle, dropdown, shortcut, and modal is genuinely wired up and responsive—do not leave placeholder or non-functional UI controls.