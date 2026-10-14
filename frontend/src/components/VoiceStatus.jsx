import React from 'react';
import Icon from './Icon';

export default function VoiceStatus({
  isListening,
  isSpeaking,
  isProcessing,
  isTranscribing = false,
  recordingSeconds = 0,
  engineMode = 'whisper',
  waveform = [],
  translate = (value) => value,
}) {
  let statusText = translate('Ready to speak');
  let statusClass = 'ready';
  let statusIcon = 'check';

  if (isTranscribing) {
    statusText = translate('Translating your answer...');
    statusClass = 'processing';
    statusIcon = 'sparkle';
  } else if (isProcessing) {
    statusText = translate('Saving answer...');
    statusClass = 'processing';
    statusIcon = 'clock';
  } else if (isSpeaking) {
    statusText = translate('Speaking question...');
    statusClass = 'speaking';
    statusIcon = 'volume';
  } else if (isListening) {
    if (engineMode === 'whisper') {
      statusText = `${translate('Recording')} (${recordingSeconds}s) · ${translate('speak your answer')}`;
    } else {
      statusText = translate('Listening... Speak now');
    }
    statusClass = 'listening';
    statusIcon = 'microphone';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '380px' }}>
      <div className={`voice-status ${statusClass}`}>
        <Icon name={statusIcon} />
        <span>{statusText}</span>
      </div>

      {isListening && engineMode === 'whisper' && (
        <div className="voice-status-hint">
        <Icon name="clock" /> {translate('Stops after 3 seconds of silence. You can also stop sooner.')}
        </div>
      )}

      {isListening && engineMode === 'whisper' ? (
        <div className="audio-waveform audio-waveform-live" role="img" aria-label="Live microphone waveform">
          <svg viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="28" x2="300" y2="28" className="audio-waveform-center" />
            <polyline
              className="audio-waveform-line"
              points={waveform.map((sample, index) => {
                const x = waveform.length > 1 ? (index / (waveform.length - 1)) * 300 : 150;
                const y = 28 - sample * 23;
                return `${x},${y}`;
              }).join(' ')}
            />
          </svg>
        </div>
      ) : isSpeaking ? (
        <div className="audio-waveform audio-waveform-speaking" aria-label="Speaking question" style={{ marginTop: '0.75rem' }}>
          <div className="wave-bar" />
          <div className="wave-bar" />
          <div className="wave-bar" />
          <div className="wave-bar" />
          <div className="wave-bar" />
        </div>
      ) : null}
    </div>
  );
}
