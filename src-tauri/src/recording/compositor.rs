#![allow(dead_code)]

use crate::error::RecorderError;
use crate::state::app_state::{CameraPosition, CameraSize};
use std::sync::atomic::{AtomicU64, Ordering};

static OVERLAY_COUNT: AtomicU64 = AtomicU64::new(0);

pub struct FrameCompositor;

impl FrameCompositor {
    pub fn overlay_bgra(
        screen: &mut [u8],
        screen_width: u32,
        screen_height: u32,
        camera: &[u8],
        camera_width: u32,
        camera_height: u32,
        position: CameraPosition,
        size: CameraSize,
    ) -> Result<(), RecorderError> {
        let count = OVERLAY_COUNT.fetch_add(1, Ordering::Relaxed);

        // Log first overlay and every 100 overlays
        if count == 0 {
            eprintln!("RecordFlow: Compositor starting overlay operations");
            eprintln!(
                "  Screen: {}x{} ({} bytes)",
                screen_width,
                screen_height,
                screen.len()
            );
            eprintln!(
                "  Camera: {}x{} ({} bytes)",
                camera_width,
                camera_height,
                camera.len()
            );
            eprintln!("  Position: {:?}, Size: {:?}", position, size);
        }

        if screen_width == 0
            || screen_height == 0
            || camera_width == 0
            || camera_height == 0
            || screen.len() < (screen_width as usize * screen_height as usize * 4)
            || camera.len() < (camera_width as usize * camera_height as usize * 4)
        {
            eprintln!("RecordFlow: Compositor error - invalid dimensions!");
            eprintln!(
                "  Screen: {}x{} (expected {} bytes, got {})",
                screen_width,
                screen_height,
                screen_width as usize * screen_height as usize * 4,
                screen.len()
            );
            eprintln!(
                "  Camera: {}x{} (expected {} bytes, got {})",
                camera_width,
                camera_height,
                camera_width as usize * camera_height as usize * 4,
                camera.len()
            );
            return Err(RecorderError::invalid_settings("Invalid frame dimensions"));
        }

        let pct = match size {
            CameraSize::Small => 15,
            CameraSize::Medium => 25,
            CameraSize::Large => 35,
        };

        let target_w = ((screen_width as u64 * pct as u64) / 100).max(1) as u32;
        let target_h =
            ((target_w as u64 * camera_height as u64) / camera_width as u64).max(1) as u32;

        let target_h = target_h.min(screen_height);
        let target_w = target_w.min(screen_width);

        let margin = 16u32;
        let (mut x0, mut y0) = match position {
            CameraPosition::TopLeft => (margin, margin),
            CameraPosition::TopRight => (screen_width.saturating_sub(target_w + margin), margin),
            CameraPosition::BottomLeft => (margin, screen_height.saturating_sub(target_h + margin)),
            CameraPosition::BottomRight => (
                screen_width.saturating_sub(target_w + margin),
                screen_height.saturating_sub(target_h + margin),
            ),
        };

        if x0 + target_w > screen_width {
            x0 = 0;
        }
        if y0 + target_h > screen_height {
            y0 = 0;
        }

        // Log overlay position on first frame
        if count == 0 {
            eprintln!(
                "RecordFlow: Camera overlay target: {}x{} at ({}, {})",
                target_w, target_h, x0, y0
            );
        }

        // Nearest-neighbor resize + overlay (no alpha blending; simple overwrite).
        for dy in 0..target_h {
            let sy = (dy as u64 * camera_height as u64) / target_h as u64;
            for dx in 0..target_w {
                let sx = (dx as u64 * camera_width as u64) / target_w as u64;

                let s_idx = ((sy as u32 * camera_width + sx as u32) * 4) as usize;
                let d_idx = (((y0 + dy) * screen_width + (x0 + dx)) * 4) as usize;

                screen[d_idx..d_idx + 4].copy_from_slice(&camera[s_idx..s_idx + 4]);
            }
        }

        Ok(())
    }
}
