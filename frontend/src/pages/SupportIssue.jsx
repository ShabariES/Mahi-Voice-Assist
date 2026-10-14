import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useVoice } from '../hooks/useVoice';
import { useAuth } from '../context/AuthContext';
import { issueService } from '../services/issueService';
import Button from '../components/Button';
import Icon from '../components/Icon';
import '../styles/issues.css';

export default function SupportIssue() {
  const { user } = useAuth();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [activeTarget, setActiveTarget] = useState(null);
  const [submittedReport, setSubmittedReport] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const targetRef = useRef(null);
  const flowActiveRef = useRef(false);
  const nextStepTimerRef = useRef(null);

  const handleFinalTranscript = useCallback((transcript) => {
    const value = transcript.trim();
    if (!value) return;
    if (targetRef.current === 'subject') {
      setSubject(value);
      targetRef.current = 'description';
      setActiveTarget('description');
      if (flowActiveRef.current) {
        nextStepTimerRef.current = setTimeout(() => startListening(), 2000);
      }
    } else if (targetRef.current === 'description') {
      setDescription(value);
      targetRef.current = null;
      setActiveTarget(null);
      flowActiveRef.current = false;
    }
  }, []);

  const {
    isListening,
    isTranscribing,
    error: voiceError,
    startListening,
    stopListening,
  } = useVoice({
    onFinalTranscript: handleFinalTranscript,
    silenceTimeoutMs: 2000,
    fieldContext: { fieldType: 'text', question: 'Transcribe this support issue clearly and preserve important details.' },
  });

  useEffect(() => () => {
    if (nextStepTimerRef.current) clearTimeout(nextStepTimerRef.current);
  }, []);

  const toggleVoice = () => {
    setSubmitError('');
    if (flowActiveRef.current && isListening) {
      stopListening();
      return;
    }
    if (flowActiveRef.current && voiceError) {
      startListening();
      return;
    }
    if (isListening || isTranscribing) return;
    flowActiveRef.current = true;
    targetRef.current = 'subject';
    setActiveTarget('subject');
    startListening();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    if (subject.trim().length < 3 || description.trim().length < 8) {
      setSubmitError('Please add a short title and describe what happened.');
      return;
    }
    setIsSubmitting(true);
    try {
      const report = await issueService.createReport({ subject: subject.trim(), description: description.trim() });
      setSubmittedReport(report);
    } catch (error) {
      setSubmitError(error.response?.data?.detail || 'We could not submit your report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubject('');
    setDescription('');
    setSubmittedReport(null);
    setSubmitError('');
  };

  if (submittedReport) {
    return (
      <section className="issue-page">
        <div className="issue-card issue-success-card">
          <span className="issue-icon"><Icon name="circleCheck" /></span>
          <p className="issue-eyebrow">REPORT RECEIVED</p>
          <h1>Your report is with our team.</h1>
          <p>We’ll follow up at <strong>{user?.email}</strong> when an admin responds.</p>
          <p className="issue-reference">Report #{submittedReport.id} · Open</p>
          <Button variant="secondary" onClick={resetForm}>Send another report</Button>
        </div>
      </section>
    );
  }

  const currentStepText = activeTarget === 'subject'
    ? 'Say a short title for the issue.'
    : activeTarget === 'description'
      ? 'Now describe what happened and what help you need.'
      : 'Speak your issue title and details, one after the other.';

  return (
    <section className="issue-page">
      <div className="issue-card">
        <p className="issue-eyebrow"><Icon name="warning" /> MAHI SUPPORT</p>
        <h1>Tell us what went wrong.</h1>
        <p className="issue-intro">Use one microphone to report the issue. We’ll send it to the support team and reply to your account email.</p>

        <div className={`issue-voice-panel ${isListening ? 'is-listening' : ''}`}>
          <button
            type="button"
            className="issue-voice-button"
            onClick={toggleVoice}
            disabled={isTranscribing}
            aria-label={isListening ? 'Stop voice report' : flowActiveRef.current ? 'Retry current report section' : 'Start voice report'}
          >
            <Icon name={isListening ? 'stop' : 'microphone'} />
            <span>{isListening ? 'Done speaking' : isTranscribing ? 'Transcribing…' : flowActiveRef.current ? 'Retry voice' : 'Report by voice'}</span>
          </button>
          <span className="issue-voice-instruction" role="status" aria-live="polite">
            {isTranscribing ? 'Turning your speech into text…' : currentStepText}
          </span>
        </div>
        {voiceError && <p className="issue-error" role="alert">{voiceError}</p>}

        <form className="issue-form" onSubmit={handleSubmit}>
          <label>
            <span>Issue title</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} placeholder="For example: I didn’t receive my welcome email" required />
          </label>
          <label>
            <span>What happened?</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={6} placeholder="Describe the problem and any steps you already tried…" required />
          </label>
          {submitError && <p className="issue-error" role="alert">{submitError}</p>}
          <div className="issue-actions">
            <span>Signed in as {user?.email}</span>
            <Button type="submit" variant="primary" disabled={isSubmitting || isListening || isTranscribing}>
              <Icon name="envelope" /> {isSubmitting ? 'Sending report…' : 'Submit report'}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
