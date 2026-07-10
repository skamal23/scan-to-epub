import { fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../../App';
import type { BackendClient } from '../api/health';

const healthyClient = (): BackendClient => ({
  checkHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    service: 'book-backend',
    environment: 'test',
    fixtureMode: true,
    version: '0.1.0',
  }),
});

describe('<App />', () => {
  test('checks backend connectivity and enters the scanner shell', async () => {
    const view = render(
      <App client={healthyClient()} showScenarioLauncher={false} />,
    );

    expect(view.getByText('Checking backend…')).toBeTruthy();
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());

    fireEvent.press(view.getByRole('button', { name: 'Open scanner' }));
    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    expect(view.getByLabelText('Book scan guide')).toBeTruthy();
  });

  test('shows an unavailable state and retries successfully', async () => {
    const client: BackendClient = {
      checkHealth: jest
        .fn()
        .mockRejectedValueOnce(new Error('Backend unavailable'))
        .mockResolvedValueOnce({
          status: 'ok',
          service: 'book-backend',
          environment: 'test',
          fixtureMode: true,
          version: '0.1.0',
        }),
    };
    const view = render(<App client={client} showScenarioLauncher={false} />);

    await waitFor(() => expect(view.getByText('Backend unavailable')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() => expect(view.getByText('Backend connected')).toBeTruthy());
    expect(client.checkHealth).toHaveBeenCalledTimes(2);
  });

  test('offers deterministic scenarios only in development builds', async () => {
    const hidden = render(
      <App client={healthyClient()} showScenarioLauncher={false} />,
    );
    await waitFor(() => expect(hidden.getByText('Backend connected')).toBeTruthy());
    expect(hidden.queryByText('Test scenarios')).toBeNull();
    hidden.unmount();

    const visible = render(
      <App client={healthyClient()} showScenarioLauncher={true} />,
    );
    await waitFor(() => expect(visible.getByText('Backend connected')).toBeTruthy());
    fireEvent.press(visible.getByRole('button', { name: 'Test scenarios' }));
    expect(visible.getByText('Scenario launcher')).toBeTruthy();

    fireEvent.press(visible.getByRole('button', { name: 'Offline' }));
    expect(visible.getByText('Backend unavailable')).toBeTruthy();
  });
});
