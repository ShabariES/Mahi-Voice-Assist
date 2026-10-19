import api from './api';

export const authService = {
  // Register a new user
  async register(name, email, password) {
    const response = await api.post('/api/auth/register', { name, email, password });
    if (response.data.access_token) {
      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Login existing user
  async login(email, password) {
    const response = await api.post('/api/auth/login', { email, password });
    if (response.data.access_token) {
      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Logout
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  // Get currently logged-in user profile
  async getMe() {
    const response = await api.get('/api/auth/me');
    return response.data;
  },

  async updatePreferredLanguage(preferred_language) {
    const response = await api.patch('/api/auth/me/language', { preferred_language });
    localStorage.setItem('user', JSON.stringify(response.data));
    return response.data;
  },

  // Admin: get all registered users
  async getAllUsers() {
    const response = await api.get('/api/auth/users');
    return response.data;
  },

  async updateUserRole(userId, role) {
    const response = await api.patch(`/api/auth/users/${userId}/role`, { role });
    return response.data;
  },

  // Get current stored user from localStorage
  getCurrentStoredUser() {
    const userStr = localStorage.getItem('user');
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  },

  getToken() {
    return localStorage.getItem('token');
  }
};
