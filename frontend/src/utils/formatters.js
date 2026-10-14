export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(current, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round(((current - 1) / total) * 100));
}

export function formatFinalPercent(current, total, isCompleted) {
  if (isCompleted) return 100;
  return formatPercent(current, total);
}

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getFieldTypeLabel(type) {
  const map = {
    text: 'Short Text',
    email: 'Email Address',
    phone: 'Phone Number',
    number: 'Number',
    date: 'Date',
    yes_no: 'Yes / No',
    choice: 'Multiple Choice',
    textarea: 'Long Text',
  };
  return map[type] || capitalize(type);
}
