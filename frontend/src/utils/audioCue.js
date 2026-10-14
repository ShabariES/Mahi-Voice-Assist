export async function playListeningCue() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return;

  let audioContext;
  try {
    audioContext = new AudioContextConstructor();
    await audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startAt = audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1046.5, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.4, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.13);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.14);

    await new Promise((resolve) => {
      oscillator.onended = resolve;
    });
    // Leave a short gap so the microphone does not capture the cue.
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  } catch {
    // Continue voice capture if audio cues are unavailable or blocked.
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {});
    }
  }
}
