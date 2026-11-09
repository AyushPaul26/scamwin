export function sandboxEnvironment(value = process.env.OPENMODS_ENV) {
  if (value === undefined || value === '') return 'development';
  if (value !== 'development' && value !== 'production') throw new Error('Invalid OPENMODS_ENV');
  return value;
}
export function sandboxLabels(botId: string, environment = sandboxEnvironment()) {
  return { project: 'openmods', environment, botId };
}
export function desktopWebSocketUrl(preview: string) {
  const url = new URL(preview);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid desktop URL');
  url.protocol = 'wss:';
  url.pathname = '/websockify';
  url.hash = '';
  return url.toString();
}
