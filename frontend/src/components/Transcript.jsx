import React from 'react';

export default function Transcript({ partialTranscript, finalTranscript, isListening }) {
  const hasContent = Boolean(finalTranscript || partialTranscript);

  return (
    <div className="transcript-box">
      {!hasContent ? (
        <span className="transcript-placeholder">
          {isListening ? 'Listening for your voice... speak your answer' : 'Click the microphone to answer with voice'}
        </span>
      ) : (
        <div>
          {finalTranscript && (
            <p className="transcript-final">"{finalTranscript}"</p>
          )}
          {partialTranscript && !finalTranscript && (
            <p className="transcript-partial">"{partialTranscript}..."</p>
          )}
        </div>
      )}
    </div>
  );
}
