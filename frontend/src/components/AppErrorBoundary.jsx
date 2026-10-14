import React from 'react';

export default class AppErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Application render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" style={{ maxWidth: 640, margin: '10vh auto', padding: 24, textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <p>Your saved form answers are still stored. Reload the page to try again.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
