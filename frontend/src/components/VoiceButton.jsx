import React from 'react';
import Icon from './Icon';

export default function VoiceButton({
  isListening,
  isSpeaking,
  onToggleListening,
  disabled = false,
  translate = (value) => value,
}) {
  return (
    <div className="mic-button-wrapper">
      {isListening && (
        <>
          <div className="mic-pulse-ring" />
          <div className="mic-pulse-ring mic-pulse-ring-2" />
        </>
      )}

      <button
        type="button"
        className={`mic-button ${isListening ? 'listening' : ''} ${isSpeaking ? 'speaking' : ''}`}
        onClick={onToggleListening}
        disabled={disabled}
        aria-label={translate(isListening ? 'Stop listening' : 'Start speaking')}
        title={translate(isListening ? 'Click to finish speaking' : 'Click to speak your answer')}
      >
        <Icon name={isListening ? 'stop' : isSpeaking ? 'volume' : 'microphone'} />
      </button>
    </div>
  );
}
