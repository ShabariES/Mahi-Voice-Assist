import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';

import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Forms from './pages/Forms';
import FormDetail from './pages/FormDetail';
import FormFill from './pages/FormFill';
import Admin from './pages/Admin';
import SupportIssue from './pages/SupportIssue';
import NavigationAssistant from './components/NavigationAssistant';

import './styles/global.css';
import './styles/premium.css';
import './styles/polish.css';

function AppLayout() {
  const location = useLocation();

  return (
    <div className="app-container" data-theme="dark">
      <Navbar />
      <main className="main-content page-transition" key={location.pathname}>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected User Routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/forms"
            element={
              <ProtectedRoute>
                <Forms />
              </ProtectedRoute>
            }
          />
          <Route
            path="/forms/:id"
            element={
              <ProtectedRoute>
                <FormDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/forms/:id/fill"
            element={
              <ProtectedRoute>
                <FormFill />
              </ProtectedRoute>
            }
          />
          <Route
            path="/support/report"
            element={
              <ProtectedRoute>
                <SupportIssue />
              </ProtectedRoute>
            }
          />

          {/* Admin / Form Manager Route */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin', 'form_manager']}>
                <Admin />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <NavigationAssistant />
    </div>
  );
}

export default function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </Router>
  );
}
