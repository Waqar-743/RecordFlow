/**
 * Real-time microphone VU level meter built on Web Audio AnalyserNode.
 * Reports a perceptually scaled level in [0..1] and returns a clean teardown handle.
 */
export function createAudioLevelMeter(
  stream: MediaStream | null,
  onLevel: (level: number) => void,
): () => void {
  if (!stream || typeof window === "undefined") return () => {};
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return () => {};

  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) return () => {};

  let active = true;
  let rafId: number | null = null;

  try {
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    const source = ctx.createMediaStreamSource(new MediaStream([tracks[0]]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!active) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
      }
      const avg = sum / Math.max(1, data.length);
      const normalized = Math.min(1, avg / 95);
      onLevel(Math.pow(normalized, 0.72));
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      active = false;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      try {
        analyser.disconnect();
      } catch {
        // ignore
      }
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {};
  }
}
