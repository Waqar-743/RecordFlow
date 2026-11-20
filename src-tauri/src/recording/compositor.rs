#![allow(dead_code)]

use crate::error::RecorderError;
use crate::state::app_state::{CameraPosition, CameraShape, CameraSize};
use std::sync::atomic::{AtomicU64, Ordering};

static OVERLAY_COUNT: AtomicU64 = AtomicU64::new(0);

pub struct FrameCompositor;

#[inline]
fn sample_bgra_bilinear(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    fx: f32,
    fy: f32,
) -> [u8; 3] {
    let x0 = (fx.floor() as u32).min(src_w.saturating_sub(1));
    let y0 = (fy.floor() as u32).min(src_h.saturating_sub(1));
    let x1 = (x0 + 1).min(src_w.saturating_sub(1));
    let y1 = (y0 + 1).min(src_h.saturating_sub(1));

    let tx = (fx - x0 as f32).clamp(0.0, 1.0);
    let ty = (fy - y0 as f32).clamp(0.0, 1.0);
    let itx = 1.0 - tx;
    let ity = 1.0 - ty;

    let i00 = ((y0 * src_w + x0) * 4) as usize;
    let i10 = ((y0 * src_w + x1) * 4) as usize;
    let i01 = ((y1 * src_w + x0) * 4) as usize;
    let i11 = ((y1 * src_w + x1) * 4) as usize;

    let w00 = itx * ity;
    let w10 = tx * ity;
    let w01 = itx * ty;
    let w11 = tx * ty;

    let b = src[i00] as f32 * w00
        + src[i10] as f32 * w10
        + src[i01] as f32 * w01
        + src[i11] as f32 * w11;
    let g = src[i00 + 1] as f32 * w00
        + src[i10 + 1] as f32 * w10
        + src[i01 + 1] as f32 * w01
        + src[i11 + 1] as f32 * w11;
    let r = src[i00 + 2] as f32 * w00
        + src[i10 + 2] as f32 * w10
        + src[i01 + 2] as f32 * w01
        + src[i11 + 2] as f32 * w11;

    [
        b.round().clamp(0.0, 255.0) as u8,
        g.round().clamp(0.0, 255.0) as u8,
        r.round().clamp(0.0, 255.0) as u8,
    ]
}

/// Signed distance to a rounded rectangle centered at `(0, 0)` with half-extents `(hx, hy)`.
/// Negative = inside, 0 = on edge, positive = outside.
#[inline]
fn sd_rounded_box(px: f32, py: f32, hx: f32, hy: f32, radius: f32) -> f32 {
    let qx = px.abs() - (hx - radius);
    let qy = py.abs() - (hy - radius);
    let out_x = qx.max(0.0);
    let out_y = qy.max(0.0);
    (out_x * out_x + out_y * out_y).sqrt() + qx.max(qy).min(0.0) - radius
}

impl FrameCompositor {
    #[allow(clippy::too_many_arguments)]
    pub fn overlay_bgra(
        screen: &mut [u8],
        screen_width: u32,
        screen_height: u32,
        camera: &[u8],
        camera_width: u32,
        camera_height: u32,
        position: CameraPosition,
        size: CameraSize,
        shape: CameraShape,
        mirror: bool,
    ) -> Result<(), RecorderError> {
        let count = OVERLAY_COUNT.fetch_add(1, Ordering::Relaxed);

        if screen_width == 0
            || screen_height == 0
            || camera_width == 0
            || camera_height == 0
            || screen.len() < (screen_width as usize * screen_height as usize * 4)
            || camera.len() < (camera_width as usize * camera_height as usize * 4)
        {
            return Err(RecorderError::invalid_settings("Invalid frame dimensions"));
        }

        let pct = match size {
            CameraSize::Small => 15,
            CameraSize::Medium => 22,
            CameraSize::Large => 30,
        };

        let (target_w, target_h, crop_x, crop_y, crop_w, crop_h) = match shape {
            CameraShape::Circle => {
                // Center-crop camera frame to a 1:1 square for circular bubble overlay.
                let diameter = ((screen_width.min(screen_height) as u64 * (pct + 6) as u64) / 100)
                    .clamp(48, screen_width.min(screen_height) as u64) as u32;
                let side = camera_width.min(camera_height);
                let cx = (camera_width - side) / 2;
                let cy = (camera_height - side) / 2;
                (diameter, diameter, cx, cy, side, side)
            }
            CameraShape::Rounded | CameraShape::Rectangle => {
                let tw = ((screen_width as u64 * pct as u64) / 100)
                    .clamp(64, screen_width as u64) as u32;
                let th = ((tw as u64 * camera_height as u64) / camera_width as u64)
                    .clamp(48, screen_height as u64) as u32;
                (tw, th, 0, 0, camera_width, camera_height)
            }
        };

        let margin = ((screen_width.min(screen_height) as f32 * 0.022).round() as u32).clamp(12, 32);
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

        if count == 0 {
            eprintln!(
                "RecordFlow: Camera overlay {:?} ({:?}, mirror={}) -> {}x{} at ({}, {})",
                shape, size, mirror, target_w, target_h, x0, y0
            );
        }

        let half_w = target_w as f32 * 0.5;
        let half_h = target_h as f32 * 0.5;
        let radius = match shape {
            CameraShape::Circle => half_w.min(half_h),
            CameraShape::Rounded => (target_w.min(target_h) as f32 * 0.12).clamp(8.0, 28.0),
            CameraShape::Rectangle => 0.0,
        };
        let border_width = 2.0f32;
        // Crisp light border color (BGRA: subtle white-slate)
        let border_bgr = [245.0f32, 240.0f32, 235.0f32];
        let border_alpha = 0.72f32;

        let scale_x = crop_w as f32 / target_w.max(1) as f32;
        let scale_y = crop_h as f32 / target_h.max(1) as f32;

        for dy in 0..target_h {
            let py = dy as f32 + 0.5 - half_h;
            let sy = crop_y as f32 + dy as f32 * scale_y;
            let dst_row = ((y0 + dy) * screen_width) as usize;

            for dx in 0..target_w {
                let px = dx as f32 + 0.5 - half_w;
                let dist = match shape {
                    CameraShape::Circle => (px * px + py * py).sqrt() - radius,
                    CameraShape::Rounded => sd_rounded_box(px, py, half_w, half_h, radius),
                    CameraShape::Rectangle => (px.abs() - half_w).max(py.abs() - half_h),
                };

                // Anti-aliased coverage over 1.2px edge band.
                if dist >= 0.75 {
                    continue;
                }
                let coverage = (0.75 - dist).clamp(0.0, 1.0);

                let src_dx = if mirror {
                    (target_w - 1 - dx) as f32
                } else {
                    dx as f32
                };
                let sx = crop_x as f32 + src_dx * scale_x;
                let cam_bgr = sample_bgra_bilinear(camera, camera_width, camera_height, sx, sy);

                // Subtle inner border ring for clean visual separation over any desktop background.
                let mut fb = cam_bgr[0] as f32;
                let mut fg = cam_bgr[1] as f32;
                let mut fr = cam_bgr[2] as f32;

                if dist > -border_width {
                    let ring_t = ((dist + border_width) / border_width).clamp(0.0, 1.0) * border_alpha;
                    fb = fb * (1.0 - ring_t) + border_bgr[0] * ring_t;
                    fg = fg * (1.0 - ring_t) + border_bgr[1] * ring_t;
                    fr = fr * (1.0 - ring_t) + border_bgr[2] * ring_t;
                }

                let d_idx = (dst_row + (x0 + dx) as usize) * 4;
                if coverage >= 0.999 {
                    screen[d_idx] = fb.round() as u8;
                    screen[d_idx + 1] = fg.round() as u8;
                    screen[d_idx + 2] = fr.round() as u8;
                    screen[d_idx + 3] = 255;
                } else {
                    let inv = 1.0 - coverage;
                    screen[d_idx] = (fb * coverage + screen[d_idx] as f32 * inv).round() as u8;
                    screen[d_idx + 1] = (fg * coverage + screen[d_idx + 1] as f32 * inv).round() as u8;
                    screen[d_idx + 2] = (fr * coverage + screen[d_idx + 2] as f32 * inv).round() as u8;
                    screen[d_idx + 3] = 255;
                }
            }
        }

        Ok(())
    }
}
