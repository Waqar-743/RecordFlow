#![allow(dead_code)]

use crate::error::RecorderError;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::Arc;

/// Standard AAC-compatible output format used when mixing audio streams.
/// Windows Media Foundation AAC reliably accepts 48 kHz stereo across all hardware.
pub const MIXER_SAMPLE_RATE: u32 = 48_000;
pub const MIXER_CHANNELS: u16 = 2;

#[derive(Debug, Clone)]
pub struct AudioFrame {
    pub data: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub timestamp: u64,
}

fn push_samples_bounded(buffer: &mut VecDeque<f32>, samples: &[f32], max_samples: usize) {
    for &s in samples {
        buffer.push_back(s.clamp(-1.0, 1.0));
    }
    while buffer.len() > max_samples {
        buffer.pop_front();
    }
}

fn build_cpal_capture_stream(
    device: &cpal::Device,
    cfg: &StreamConfig,
    sample_format: SampleFormat,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    max_samples: usize,
    label: &'static str,
) -> Result<cpal::Stream, RecorderError> {
    let err_fn = move |err| {
        eprintln!("RecordFlow: {label} stream error: {err}");
    };

    let stream = match sample_format {
        SampleFormat::F32 => device
            .build_input_stream(
                cfg,
                move |data: &[f32], _| {
                    let mut q = buffer.lock();
                    push_samples_bounded(&mut q, data, max_samples);
                },
                err_fn,
                None,
            )
            .map_err(|e| RecorderError::encoding_failed(format!("{label} stream failed: {e}")))?,
        SampleFormat::I16 => device
            .build_input_stream(
                cfg,
                move |data: &[i16], _| {
                    let converted: Vec<f32> =
                        data.iter().map(|&s| s as f32 / 32768.0).collect();
                    let mut q = buffer.lock();
                    push_samples_bounded(&mut q, &converted, max_samples);
                },
                err_fn,
                None,
            )
            .map_err(|e| RecorderError::encoding_failed(format!("{label} stream failed: {e}")))?,
        SampleFormat::U16 => device
            .build_input_stream(
                cfg,
                move |data: &[u16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 - 32768.0) / 32768.0)
                        .collect();
                    let mut q = buffer.lock();
                    push_samples_bounded(&mut q, &converted, max_samples);
                },
                err_fn,
                None,
            )
            .map_err(|e| RecorderError::encoding_failed(format!("{label} stream failed: {e}")))?,
        other => {
            return Err(RecorderError::invalid_settings(format!(
                "Unsupported {label} sample format: {other:?}"
            )))
        }
    };

    stream
        .play()
        .map_err(|e| RecorderError::encoding_failed(format!("{label} play failed: {e}")))?;

    Ok(stream)
}

/// Resample interleaved `f32` audio from `(src_rate, src_ch)` into stereo
/// `(dst_rate, 2)` with `dst_frames` output frames using linear interpolation.
fn resample_to_stereo(
    src: &[f32],
    src_rate: u32,
    src_ch: u16,
    dst_rate: u32,
    dst_frames: usize,
) -> Vec<f32> {
    let mut out = vec![0.0f32; dst_frames * 2];
    if dst_frames == 0 || src.is_empty() || src_ch == 0 {
        return out;
    }

    let ch = src_ch as usize;
    let src_frames = src.len() / ch;
    if src_frames == 0 {
        return out;
    }

    if src_rate == dst_rate && src_frames == dst_frames {
        for f in 0..dst_frames {
            let base = f * ch;
            let (l, r) = if ch == 1 {
                (src[base], src[base])
            } else {
                (src[base], src[base + 1])
            };
            out[f * 2] = l;
            out[f * 2 + 1] = r;
        }
        return out;
    }

    let ratio = if dst_frames > 1 {
        (src_frames.saturating_sub(1)) as f64 / (dst_frames - 1) as f64
    } else {
        0.0
    };

    for f in 0..dst_frames {
        let pos = f as f64 * ratio;
        let idx0 = (pos.floor() as usize).min(src_frames - 1);
        let idx1 = (idx0 + 1).min(src_frames - 1);
        let frac = (pos - idx0 as f64) as f32;

        let b0 = idx0 * ch;
        let b1 = idx1 * ch;

        let l0 = src[b0];
        let l1 = src[b1];
        let r0 = if ch == 1 { l0 } else { src[b0 + 1] };
        let r1 = if ch == 1 { l1 } else { src[b1 + 1] };

        out[f * 2] = l0 + (l1 - l0) * frac;
        out[f * 2 + 1] = r0 + (r1 - r0) * frac;
    }

    out
}

/// Soft limiter to prevent harsh digital clipping when mixing mic + system audio.
#[inline]
fn soft_limit(sample: f32) -> f32 {
    if sample.abs() <= 0.92 {
        sample
    } else {
        sample.signum() * (0.92 + 0.08 * ((sample.abs() - 0.92) / 0.08).tanh())
    }
}

/// Captures microphone PCM samples via `cpal` into a bounded low-latency ring buffer.
pub struct MicrophoneCapture {
    sample_rate: u32,
    channels: u16,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    _stream: cpal::Stream,
}

impl MicrophoneCapture {
    pub fn new(device_name: Option<&str>) -> Result<Self, RecorderError> {
        let host = cpal::default_host();

        let device = if let Some(name) = device_name
            .filter(|s| !s.trim().is_empty() && !s.eq_ignore_ascii_case("Default"))
        {
            let devices = host
                .input_devices()
                .map_err(|e| RecorderError::device_not_found(format!("Microphone ({e})")))?;
            devices
                .filter_map(|d| d.name().ok().map(|n| (d, n)))
                .find(|(_, n)| n == name)
                .map(|(d, _)| d)
                .or_else(|| host.default_input_device())
                .ok_or_else(|| RecorderError::device_not_found("Microphone"))?
        } else {
            host.default_input_device()
                .ok_or_else(|| RecorderError::device_not_found("Microphone"))?
        };

        let default_config = device
            .default_input_config()
            .map_err(|e| RecorderError::device_not_found(format!("Microphone ({e})")))?;

        let sample_format = default_config.sample_format();
        let cfg: StreamConfig = default_config.into();
        let sample_rate = cfg.sample_rate.0;
        let channels = cfg.channels;

        let buffer = Arc::new(Mutex::new(VecDeque::new()));
        // Keep up to ~350 ms buffered to absorb OS scheduling jitter without growing latency.
        let max_samples = ((sample_rate as usize)
            .saturating_mul(channels as usize)
            .saturating_mul(35))
            / 100;

        let stream = build_cpal_capture_stream(
            &device,
            &cfg,
            sample_format,
            buffer.clone(),
            max_samples.max(channels as usize * 1024),
            "microphone",
        )?;

        Ok(Self {
            sample_rate,
            channels,
            buffer,
            _stream: stream,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn clear(&self) {
        self.buffer.lock().clear();
    }

    pub fn take_f32(&self, sample_count: usize) -> Vec<f32> {
        let mut q = self.buffer.lock();
        let mut out = Vec::with_capacity(sample_count);
        for _ in 0..sample_count {
            out.push(q.pop_front().unwrap_or(0.0));
        }
        out
    }
}

/// Captures Windows system audio via WASAPI loopback (`cpal` input stream on an output device).
///
/// In a real-time pull loop, WASAPI loopback naturally produces no callbacks during
/// silence; `take_f32` fills any empty period with `0.0` immediately, keeping audio
/// locked to the video clock with minimal latency when sound resumes.
pub struct SystemAudioCapture {
    sample_rate: u32,
    channels: u16,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    _stream: cpal::Stream,
}

impl SystemAudioCapture {
    pub fn new(device_name: Option<&str>) -> Result<Self, RecorderError> {
        let host = cpal::default_host();

        let device = if let Some(name) = device_name
            .filter(|s| !s.trim().is_empty() && !s.eq_ignore_ascii_case("Default"))
        {
            let devices = host
                .output_devices()
                .map_err(|e| RecorderError::device_not_found(format!("System audio ({e})")))?;
            devices
                .filter_map(|d| d.name().ok().map(|n| (d, n)))
                .find(|(_, n)| n == name)
                .map(|(d, _)| d)
                .or_else(|| host.default_output_device())
                .ok_or_else(|| RecorderError::device_not_found("System audio"))?
        } else {
            host.default_output_device()
                .ok_or_else(|| RecorderError::device_not_found("System audio"))?
        };

        let default_config = device
            .default_output_config()
            .map_err(|e| RecorderError::device_not_found(format!("System audio ({e})")))?;

        let sample_format = default_config.sample_format();
        let cfg: StreamConfig = default_config.into();
        let sample_rate = cfg.sample_rate.0;
        let channels = cfg.channels;

        let buffer = Arc::new(Mutex::new(VecDeque::new()));
        let max_samples = ((sample_rate as usize)
            .saturating_mul(channels as usize)
            .saturating_mul(35))
            / 100;

        let stream = build_cpal_capture_stream(
            &device,
            &cfg,
            sample_format,
            buffer.clone(),
            max_samples.max(channels as usize * 1024),
            "system audio loopback",
        )?;

        Ok(Self {
            sample_rate,
            channels,
            buffer,
            _stream: stream,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn clear(&self) {
        self.buffer.lock().clear();
    }

    pub fn take_f32(&self, sample_count: usize) -> Vec<f32> {
        let mut q = self.buffer.lock();
        let mut out = Vec::with_capacity(sample_count);
        for _ in 0..sample_count {
            out.push(q.pop_front().unwrap_or(0.0));
        }
        out
    }
}

/// Real-time audio mixer combining optional microphone and WASAPI system audio
/// into a consistent 48 kHz stereo PCM stream with zero cumulative resampling drift.
pub struct LiveAudioMixer {
    mic: Option<MicrophoneCapture>,
    system: Option<SystemAudioCapture>,
    sample_rate: u32,
    channels: u16,
    total_out_frames: u64,
    mic_consumed_frames: u64,
    sys_consumed_frames: u64,
}

impl LiveAudioMixer {
    pub fn new(
        mic_enabled: bool,
        mic_device: Option<&str>,
        system_enabled: bool,
        system_device: Option<&str>,
    ) -> Option<Self> {
        let mic = if mic_enabled {
            eprintln!("RecordFlow: Initializing microphone: {:?}", mic_device);
            match MicrophoneCapture::new(mic_device) {
                Ok(m) => {
                    eprintln!(
                        "RecordFlow: Microphone initialized ({}Hz, {}ch)",
                        m.sample_rate(),
                        m.channels()
                    );
                    Some(m)
                }
                Err(e) => {
                    eprintln!("RecordFlow: microphone init failed, continuing without mic: {e}");
                    None
                }
            }
        } else {
            None
        };

        let system = if system_enabled {
            eprintln!(
                "RecordFlow: Initializing system audio loopback: {:?}",
                system_device
            );
            match SystemAudioCapture::new(system_device) {
                Ok(s) => {
                    eprintln!(
                        "RecordFlow: System audio loopback initialized ({}Hz, {}ch)",
                        s.sample_rate(),
                        s.channels()
                    );
                    Some(s)
                }
                Err(e) => {
                    eprintln!(
                        "RecordFlow: system audio loopback init failed, continuing without system audio: {e}"
                    );
                    None
                }
            }
        } else {
            None
        };

        if mic.is_none() && system.is_none() {
            return None;
        }

        Some(Self {
            mic,
            system,
            sample_rate: MIXER_SAMPLE_RATE,
            channels: MIXER_CHANNELS,
            total_out_frames: 0,
            mic_consumed_frames: 0,
            sys_consumed_frames: 0,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// Discard buffered audio accumulated during pause so playback resumes cleanly in sync.
    pub fn clear_buffers(&self) {
        if let Some(mic) = &self.mic {
            mic.clear();
        }
        if let Some(sys) = &self.system {
            sys.clear();
        }
    }

    /// Pop and mix `output_sample_count` interleaved samples (at 48 kHz stereo) into
    /// little-endian 16-bit PCM bytes ready for `IMFSinkWriter`.
    pub fn take_mixed_pcm_bytes_le(
        &mut self,
        output_sample_count: usize,
        mic_volume: f32,
        system_volume: f32,
    ) -> Vec<u8> {
        let ch = self.channels.max(1) as usize;
        let out_frames = output_sample_count / ch;
        if out_frames == 0 {
            return Vec::new();
        }

        self.total_out_frames = self.total_out_frames.saturating_add(out_frames as u64);
        let mut mixed = vec![0.0f32; out_frames * ch];

        if let Some(mic) = &self.mic {
            let desired_src = (self.total_out_frames as u128 * mic.sample_rate() as u128
                / self.sample_rate.max(1) as u128) as u64;
            let src_frames = desired_src.saturating_sub(self.mic_consumed_frames) as usize;
            self.mic_consumed_frames = desired_src;

            if src_frames > 0 {
                let raw = mic.take_f32(src_frames * mic.channels().max(1) as usize);
                let resampled = resample_to_stereo(
                    &raw,
                    mic.sample_rate(),
                    mic.channels(),
                    self.sample_rate,
                    out_frames,
                );
                // Slight voice clarity boost when competing with system audio.
                let boost = if self.system.is_some() { 1.15 } else { 1.0 };
                let gain = mic_volume.clamp(0.0, 1.5) * boost;
                for (dst, &s) in mixed.iter_mut().zip(resampled.iter()) {
                    *dst += s * gain;
                }
            }
        }

        if let Some(sys) = &self.system {
            let desired_src = (self.total_out_frames as u128 * sys.sample_rate() as u128
                / self.sample_rate.max(1) as u128) as u64;
            let src_frames = desired_src.saturating_sub(self.sys_consumed_frames) as usize;
            self.sys_consumed_frames = desired_src;

            if src_frames > 0 {
                let raw = sys.take_f32(src_frames * sys.channels().max(1) as usize);
                let resampled = resample_to_stereo(
                    &raw,
                    sys.sample_rate(),
                    sys.channels(),
                    self.sample_rate,
                    out_frames,
                );
                let gain = system_volume.clamp(0.0, 1.5);
                for (dst, &s) in mixed.iter_mut().zip(resampled.iter()) {
                    *dst += s * gain;
                }
            }
        }

        let mut out = Vec::with_capacity(mixed.len() * 2);
        for s in mixed {
            let limited = soft_limit(s);
            let i16_s = (limited * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
            out.extend_from_slice(&i16_s.to_le_bytes());
        }
        out
    }
}
