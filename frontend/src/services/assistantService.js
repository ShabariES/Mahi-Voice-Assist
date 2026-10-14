import api from './api';

export const assistantService = {
  async navigate(command, currentPath) {
    const response = await api.post('/api/assistant/navigate', {
      command,
      current_path: currentPath,
    });
    return response.data;
  },
};
