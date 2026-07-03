use crate::error::RecorderError;
use std::time::Duration;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

const HNS_PER_SEC: i64 = 10_000_000; // 100-ns units

fn duration_to_hns(d: Duration) -> i64 {
    // 1 hns = 100ns
    let hns = (d.as_nanos() / 100) as i128;
    i64::try_from(hns).unwrap_or(i64::MAX)
}

fn pack_u32_pair(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

fn win_err(context: &str, e: windows::core::Error) -> RecorderError {
    RecorderError::encoding_failed(format!("{context}: {e}"))
}

pub struct VideoEncoder {
    writer: IMFSinkWriter,
    video_stream: u32,
    audio_stream: Option<u32>,

    width: u32,
    height: u32,
    fps: u32,

    last_video_time_hns: Option<i64>,

    audio_sample_rate: Option<u32>,
    audio_channels: Option<u16>,
    audio_written_frames: u64,

    com_inited: bool,
    mf_started: bool,
}

impl VideoEncoder {
    pub fn new(
        output_path: &str,
        width: u32,
        height: u32,
        fps: u32,
        bitrate_kbps: u32,
        audio_cfg: Option<(u32, u16)>,
    ) -> Result<Self, RecorderError> {
        // Try to initialize COM - if it's already initialized with a different mode,
        // that's okay, we'll just use the existing initialization
        let com_inited = unsafe {
            match CoInitializeEx(None, COINIT_MULTITHREADED).ok() {
                Ok(()) => true,
                Err(e) if e.code() == RPC_E_CHANGED_MODE => {
                    // COM already initialized with different threading mode - that's fine
                    eprintln!("RecordFlow: COM already initialized, using existing initialization");
                    false
                }
                Err(e) => return Err(win_err("COM init failed", e)),
            }
        };

        unsafe {
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)
                .map_err(|e| win_err("MFStartup failed", e))?;
        }

        let (audio_sample_rate, audio_channels) = audio_cfg
            .map(|(sr, ch)| (Some(sr.max(1)), Some(ch.max(1))))
            .unwrap_or((None, None));

        let url = HSTRING::from(output_path);
        let url = PCWSTR(url.as_ptr());

        let mut attrs: Option<IMFAttributes> = None;
        unsafe {
            MFCreateAttributes(&mut attrs, 1)
                .map_err(|e| win_err("MFCreateAttributes failed", e))?;
        }
        let attrs = attrs
            .ok_or_else(|| RecorderError::encoding_failed("MFCreateAttributes returned null"))?;
        // Software transforms are more tolerant of custom region dimensions.
        let _ = unsafe { attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 0) };

        let writer = unsafe {
            MFCreateSinkWriterFromURL(url, None, Some(&attrs))
                .map_err(|e| win_err("MFCreateSinkWriterFromURL failed", e))?
        };

        // Video output (H.264)
        let video_out =
            unsafe { MFCreateMediaType().map_err(|e| win_err("MFCreateMediaType(video_out)", e))? };
        unsafe {
            video_out
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| win_err("SetGUID(video_out.major)", e))?;
            video_out
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
                .map_err(|e| win_err("SetGUID(video_out.subtype)", e))?;
            video_out
                .SetUINT32(&MF_MT_AVG_BITRATE, bitrate_kbps.saturating_mul(1000))
                .map_err(|e| win_err("SetUINT32(video_out.bitrate)", e))?;
            video_out
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| win_err("SetUINT32(video_out.interlace)", e))?;
            video_out
                .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
                .map_err(|e| win_err("SetUINT64(video_out.frame_size)", e))?;
            video_out
                .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(fps.max(1), 1))
                .map_err(|e| win_err("SetUINT64(video_out.frame_rate)", e))?;
            video_out
                .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u32_pair(1, 1))
                .map_err(|e| win_err("SetUINT64(video_out.par)", e))?;
        }

        let video_stream = unsafe {
            writer
                .AddStream(&video_out)
                .map_err(|e| win_err("AddStream(video)", e))?
        };

        // Video input (ARGB32 ~= BGRA in memory)
        let video_in =
            unsafe { MFCreateMediaType().map_err(|e| win_err("MFCreateMediaType(video_in)", e))? };
        unsafe {
            video_in
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| win_err("SetGUID(video_in.major)", e))?;
            video_in
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_ARGB32)
                .map_err(|e| win_err("SetGUID(video_in.subtype)", e))?;
            video_in
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(|e| win_err("SetUINT32(video_in.interlace)", e))?;
            video_in
                .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
                .map_err(|e| win_err("SetUINT64(video_in.frame_size)", e))?;
            video_in
                .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(fps.max(1), 1))
                .map_err(|e| win_err("SetUINT64(video_in.frame_rate)", e))?;
            video_in
                .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack_u32_pair(1, 1))
                .map_err(|e| win_err("SetUINT64(video_in.par)", e))?;
            video_in
                .SetUINT32(&MF_MT_DEFAULT_STRIDE, width.saturating_mul(4))
                .map_err(|e| win_err("SetUINT32(video_in.stride)", e))?;

            writer
                .SetInputMediaType(video_stream, &video_in, None)
                .map_err(|e| win_err("SetInputMediaType(video)", e))?;
        }

        // Optional audio
        let mut audio_stream: Option<u32> = None;
        if let (Some(sr), Some(ch)) = (audio_sample_rate, audio_channels) {
            let audio_out = unsafe {
                MFCreateMediaType().map_err(|e| win_err("MFCreateMediaType(audio_out)", e))?
            };
            unsafe {
                audio_out
                    .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
                    .map_err(|e| win_err("SetGUID(audio_out.major)", e))?;
                audio_out
                    .SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)
                    .map_err(|e| win_err("SetGUID(audio_out.subtype)", e))?;

                audio_out
                    .SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, sr)
                    .map_err(|e| win_err("SetUINT32(audio_out.sample_rate)", e))?;
                audio_out
                    .SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, ch as u32)
                    .map_err(|e| win_err("SetUINT32(audio_out.channels)", e))?;

                // Conservative defaults for AAC-LC.
                // Avg bytes/sec ~= 128kbps mono / 192kbps stereo.
                let aac_bps: u32 = if ch <= 1 { 128_000 } else { 192_000 };
                audio_out
                    .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, aac_bps / 8)
                    .map_err(|e| win_err("SetUINT32(audio_out.avg_bytes_per_sec)", e))?;
                let _ = audio_out.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0);
                let _ = audio_out.SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29);
            }

            let stream_idx = unsafe {
                writer
                    .AddStream(&audio_out)
                    .map_err(|e| win_err("AddStream(audio)", e))?
            };

            let audio_in = unsafe {
                MFCreateMediaType().map_err(|e| win_err("MFCreateMediaType(audio_in)", e))?
            };
            unsafe {
                audio_in
                    .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
                    .map_err(|e| win_err("SetGUID(audio_in.major)", e))?;
                audio_in
                    .SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)
                    .map_err(|e| win_err("SetGUID(audio_in.subtype)", e))?;
                audio_in
                    .SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, sr)
                    .map_err(|e| win_err("SetUINT32(audio_in.sample_rate)", e))?;
                audio_in
                    .SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, ch as u32)
                    .map_err(|e| win_err("SetUINT32(audio_in.channels)", e))?;
                audio_in
                    .SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)
                    .map_err(|e| win_err("SetUINT32(audio_in.bits_per_sample)", e))?;
                let block_align = (ch as u32).saturating_mul(2);
                audio_in
                    .SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, block_align)
                    .map_err(|e| win_err("SetUINT32(audio_in.block_align)", e))?;
                audio_in
                    .SetUINT32(
                        &MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
                        sr.saturating_mul(block_align),
                    )
                    .map_err(|e| win_err("SetUINT32(audio_in.avg_bytes_per_sec)", e))?;

                writer
                    .SetInputMediaType(stream_idx, &audio_in, None)
                    .map_err(|e| win_err("SetInputMediaType(audio)", e))?;
            }

            audio_stream = Some(stream_idx);
        }

        unsafe {
            writer
                .BeginWriting()
                .map_err(|e| win_err("BeginWriting", e))?;
        }

        Ok(Self {
            writer,
            video_stream,
            audio_stream,
            width,
            height,
            fps: fps.max(1),
            last_video_time_hns: None,
            audio_sample_rate,
            audio_channels,
            audio_written_frames: 0,
            com_inited,
            mf_started: true,
        })
    }

    pub fn audio_samples_needed_for_elapsed(&self, elapsed: Duration) -> Option<usize> {
        let sr = self.audio_sample_rate? as u128;
        let ch = self.audio_channels? as u128;

        let desired_frames = (elapsed.as_nanos() * sr / 1_000_000_000) as u64;
        let to_write = desired_frames.saturating_sub(self.audio_written_frames);
        Some((to_write as usize).saturating_mul(ch as usize))
    }

    pub fn encode_frame(&mut self, bgra: &[u8], elapsed: Duration) -> Result<(), RecorderError> {
        self.encode_frame_internal(bgra, elapsed)?;
        Ok(())
    }

    pub fn encode_frame_with_audio(
        &mut self,
        bgra: &[u8],
        elapsed: Duration,
        audio_pcm_i16le: &[u8],
    ) -> Result<(), RecorderError> {
        self.encode_frame_internal(bgra, elapsed)?;
        self.encode_audio_internal(audio_pcm_i16le)?;
        Ok(())
    }

    fn encode_frame_internal(
        &mut self,
        bgra: &[u8],
        elapsed: Duration,
    ) -> Result<(), RecorderError> {
        let expected = self.width.saturating_mul(self.height).saturating_mul(4) as usize;
        if bgra.len() != expected {
            return Err(RecorderError::encoding_failed(format!(
                "BGRA frame size mismatch: got {} bytes, expected {}",
                bgra.len(),
                expected
            )));
        }

        let time_hns = duration_to_hns(elapsed);
        let duration_hns = match self.last_video_time_hns {
            Some(prev) if time_hns > prev => (time_hns - prev).max(1),
            _ => (HNS_PER_SEC / self.fps as i64).max(1),
        };
        self.last_video_time_hns = Some(time_hns);

        let buffer = unsafe {
            MFCreateMemoryBuffer(bgra.len() as u32)
                .map_err(|e| win_err("MFCreateMemoryBuffer(video)", e))?
        };

        unsafe {
            let mut ptr: *mut u8 = std::ptr::null_mut();
            let mut max_len: u32 = 0;
            let mut cur_len: u32 = 0;
            buffer
                .Lock(
                    &mut ptr,
                    Some(&mut max_len as *mut u32),
                    Some(&mut cur_len as *mut u32),
                )
                .map_err(|e| win_err("IMFMediaBuffer::Lock(video)", e))?;
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), ptr, bgra.len());
            buffer
                .Unlock()
                .map_err(|e| win_err("IMFMediaBuffer::Unlock(video)", e))?;
            buffer
                .SetCurrentLength(bgra.len() as u32)
                .map_err(|e| win_err("IMFMediaBuffer::SetCurrentLength(video)", e))?;

            let sample = MFCreateSample().map_err(|e| win_err("MFCreateSample(video)", e))?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| win_err("IMFSample::AddBuffer(video)", e))?;
            sample
                .SetSampleTime(time_hns)
                .map_err(|e| win_err("IMFSample::SetSampleTime(video)", e))?;
            sample
                .SetSampleDuration(duration_hns)
                .map_err(|e| win_err("IMFSample::SetSampleDuration(video)", e))?;

            self.writer
                .WriteSample(self.video_stream, &sample)
                .map_err(|e| win_err("WriteSample(video)", e))?;
        }

        Ok(())
    }

    fn encode_audio_internal(&mut self, audio_pcm_i16le: &[u8]) -> Result<(), RecorderError> {
        let stream = match self.audio_stream {
            Some(s) => s,
            None => return Ok(()),
        };

        let sr = match self.audio_sample_rate {
            Some(sr) => sr,
            None => return Ok(()),
        };
        let ch = match self.audio_channels {
            Some(ch) => ch,
            None => return Ok(()),
        };

        if audio_pcm_i16le.is_empty() {
            return Ok(());
        }

        let bytes_per_frame = (ch as usize).saturating_mul(2);
        if bytes_per_frame == 0 {
            return Ok(());
        }

        let frames = (audio_pcm_i16le.len() / bytes_per_frame) as u64;
        if frames == 0 {
            return Ok(());
        }

        let sample_time_hns =
            (self.audio_written_frames as i64).saturating_mul(HNS_PER_SEC) / sr as i64;
        let sample_duration_hns = (frames as i64).saturating_mul(HNS_PER_SEC) / sr as i64;
        self.audio_written_frames = self.audio_written_frames.saturating_add(frames);

        let buffer = unsafe {
            MFCreateMemoryBuffer(audio_pcm_i16le.len() as u32)
                .map_err(|e| win_err("MFCreateMemoryBuffer(audio)", e))?
        };

        unsafe {
            let mut ptr: *mut u8 = std::ptr::null_mut();
            let mut max_len: u32 = 0;
            let mut cur_len: u32 = 0;
            buffer
                .Lock(
                    &mut ptr,
                    Some(&mut max_len as *mut u32),
                    Some(&mut cur_len as *mut u32),
                )
                .map_err(|e| win_err("IMFMediaBuffer::Lock(audio)", e))?;
            std::ptr::copy_nonoverlapping(audio_pcm_i16le.as_ptr(), ptr, audio_pcm_i16le.len());
            buffer
                .Unlock()
                .map_err(|e| win_err("IMFMediaBuffer::Unlock(audio)", e))?;
            buffer
                .SetCurrentLength(audio_pcm_i16le.len() as u32)
                .map_err(|e| win_err("IMFMediaBuffer::SetCurrentLength(audio)", e))?;

            let sample = MFCreateSample().map_err(|e| win_err("MFCreateSample(audio)", e))?;
            sample
                .AddBuffer(&buffer)
                .map_err(|e| win_err("IMFSample::AddBuffer(audio)", e))?;
            sample
                .SetSampleTime(sample_time_hns)
                .map_err(|e| win_err("IMFSample::SetSampleTime(audio)", e))?;
            sample
                .SetSampleDuration(sample_duration_hns.max(1))
                .map_err(|e| win_err("IMFSample::SetSampleDuration(audio)", e))?;

            self.writer
                .WriteSample(stream, &sample)
                .map_err(|e| win_err("WriteSample(audio)", e))?;
        }

        Ok(())
    }

    pub fn finalize(&mut self) -> Result<(), RecorderError> {
        unsafe {
            self.writer.Finalize().map_err(|e| win_err("Finalize", e))?;
        }
        if self.mf_started {
            let _ = unsafe { MFShutdown() };
        }
        if self.com_inited {
            unsafe { CoUninitialize() };
        }
        self.mf_started = false;
        self.com_inited = false;
        Ok(())
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        // Best-effort cleanup.
        let _ = unsafe { self.writer.Finalize() };
        if self.mf_started {
            let _ = unsafe { MFShutdown() };
        }
        if self.com_inited {
            unsafe { CoUninitialize() };
        }
    }
}
