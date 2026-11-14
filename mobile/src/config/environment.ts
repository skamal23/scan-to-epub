export type EnvironmentConfig = {
  name: 'fixture' | 'local' | 'hosted';
  apiUrl: string;
};

export function resolveEnvironment(
  values: Record<string, string | undefined>,
): EnvironmentConfig {
  const name = values.EXPO_PUBLIC_APP_ENV?.trim() || 'local';
  if (name !== 'fixture' && name !== 'local' && name !== 'hosted') {
    throw new Error(`Unsupported app environment: ${name}`);
  }

  const configuredUrl = values.EXPO_PUBLIC_API_URL?.trim();
  if (name === 'hosted' && !configuredUrl) {
    throw new Error('Hosted environment requires EXPO_PUBLIC_API_URL');
  }

  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Use a valid HTTP or HTTPS service address');
    }
    if (name === 'hosted' && url.protocol !== 'https:') {
      throw new Error('Hosted environment requires HTTPS');
    }
  }

  return {
    name,
    apiUrl: (configuredUrl || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
  };
}
