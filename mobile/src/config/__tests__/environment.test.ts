import { resolveEnvironment } from '../environment';

describe('environment configuration', () => {
  test('uses the simulator-local backend by default', () => {
    expect(resolveEnvironment({})).toEqual({
      name: 'local',
      apiUrl: 'http://127.0.0.1:8000',
    });
  });

  test('uses an explicit hosted backend URL', () => {
    expect(
      resolveEnvironment({
        EXPO_PUBLIC_APP_ENV: 'hosted',
        EXPO_PUBLIC_API_URL: 'https://books.example.test/',
      }),
    ).toEqual({
      name: 'hosted',
      apiUrl: 'https://books.example.test',
    });
  });

  test('rejects unsupported environment names', () => {
    expect(() =>
      resolveEnvironment({ EXPO_PUBLIC_APP_ENV: 'production-ish' }),
    ).toThrow('Unsupported app environment');
  });
});
