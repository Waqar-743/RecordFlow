use crate::error::RecorderError;
use crate::recording::screen_capturer::Frame;
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{
    ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
    Resolution,
};
use nokhwa::Camera;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// Asynchronous camera capturer.
///
/// Runs webcam capture & JPEG decoding on a dedicated background thread so a
/// 15-30 fps camera never throttles a 60 fps screen recording loop.
pub struct CameraCapturer {
    latest: Arc<Mutex<Option<Frame>>>,
    stop_flag: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl CameraCapturer {
    pub fn new(selected_camera: Option<String>) -> Result<Self, RecorderError> {
        eprintln!("RecordFlow: CameraCapturer::new() - Querying cameras...");
        let list = nokhwa::query(ApiBackend::Auto)
            .map_err(|e| RecorderError::device_not_found(format!("Camera ({e})")))?;

        if list.is_empty() {
            return Err(RecorderError::device_not_found("Camera"));
        }

        let selected = selected_camera
            .as_ref()
            .and_then(|s| s.parse::<usize>().ok());

        let chosen_index = match selected {
            Some(n) => {
                let by_index = list.iter().find(|c| match c.index() {
                    CameraIndex::Index(i) => *i as usize == n,
                    _ => false,
                });
                by_index
                    .or_else(|| list.get(n))
                    .map(|c| c.index().clone())
                    .unwrap_or_else(|| list[0].index().clone())
            }
            None => list[0].index().clone(),
        };

        eprintln!("RecordFlow: Starting async camera thread for index {:?}", chosen_index);

        let latest: Arc<Mutex<Option<Frame>>> = Arc::new(Mutex::new(None));
        let stop_flag = Arc::new(AtomicBool::new(false));
        let failed = Arc::new(AtomicBool::new(false));

        let latest_for_thread = latest.clone();
        let stop_for_thread = stop_flag.clone();
        let failed_for_thread = failed.clone();
        let (init_tx, init_rx) = mpsc::channel::<Result<(), RecorderError>>();

        let worker = thread::spawn(move || {
            let requested_format = RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(
                CameraFormat::new(Resolution::new(640, 480), FrameFormat::MJPEG, 30),
            ));

            let mut camera = match Camera::new(chosen_index, requested_format) {
                Ok(c) => c,
                Err(e) => {
                    let _ = init_tx.send(Err(RecorderError::device_not_found(format!(
                        "Camera init failed ({e})"
                    ))));
                    failed_for_thread.store(true, Ordering::SeqCst);
                    return;
                }
            };

            if let Err(e) = camera.open_stream() {
                let _ = init_tx.send(Err(RecorderError::device_not_found(format!(
                    "Camera open failed ({e})"
                ))));
                failed_for_thread.store(true, Ordering::SeqCst);
                return;
            }

            let resolution = camera.resolution();
            eprintln!(
                "RecordFlow: Async camera stream opened ({}x{})",
                resolution.width(),
                resolution.height()
            );
            let _ = init_tx.send(Ok(()));

            let mut frame_number: u64 = 0;
            let mut consecutive_errors: u32 = 0;

            while !stop_for_thread.load(Ordering::Relaxed) {
                match camera.frame() {
                    Ok(buffer) => match buffer.decode_image::<RgbFormat>() {
                        Ok(decoded) => {
                            consecutive_errors = 0;
                            frame_number += 1;
                            let width = decoded.width();
                            let height = decoded.height();
                            let rgb = decoded.into_raw();

                            let mut bgra = Vec::with_capacity(width as usize * height as usize * 4);
                            for px in rgb.chunks_exact(3) {
                                bgra.push(px[2]);
                                bgra.push(px[1]);
                                bgra.push(px[0]);
                                bgra.push(255);
                            }

                            *latest_for_thread.lock() = Some(Frame {
                                data: bgra,
                                width,
                                height,
                                timestamp: 0,
                                frame_number,
                            });
                        }
                        Err(e) => {
                            consecutive_errors += 1;
                            eprintln!("RecordFlow: Camera decode error ({consecutive_errors}): {e}");
                        }
                    },
                    Err(e) => {
                        consecutive_errors += 1;
                        eprintln!("RecordFlow: Camera frame error ({consecutive_errors}): {e}");
                        thread::sleep(Duration::from_millis(15));
                    }
                }

                if consecutive_errors >= 20 {
                    eprintln!("RecordFlow: Camera failed repeatedly, stopping camera worker");
                    failed_for_thread.store(true, Ordering::SeqCst);
                    break;
                }
            }

            eprintln!(
                "RecordFlow: Stopping async camera stream (captured {} frames)",
                frame_number
            );
            let _ = camera.stop_stream();
        });

        match init_rx.recv_timeout(Duration::from_secs(4)) {
            Ok(Ok(())) => Ok(Self {
                latest,
                stop_flag,
                failed,
                worker: Some(worker),
            }),
            Ok(Err(e)) => {
                stop_flag.store(true, Ordering::SeqCst);
                let _ = worker.join();
                Err(e)
            }
            Err(_) => {
                stop_flag.store(true, Ordering::SeqCst);
                Err(RecorderError::device_not_found(
                    "Camera timed out while opening stream",
                ))
            }
        }
    }

    /// Non-blocking read of the most recently decoded webcam frame.
    /// Returns `Ok(None)` while warming up before the first frame arrives.
    pub fn latest_frame(&self) -> Result<Option<Frame>, RecorderError> {
        if self.failed.load(Ordering::Relaxed) {
            return Err(RecorderError::encoding_failed(
                "Camera worker stopped after repeated capture errors",
            ));
        }
        Ok(self.latest.lock().clone())
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for CameraCapturer {
    fn drop(&mut self) {
        self.stop();
    }
}
