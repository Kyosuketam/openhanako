/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = Record<string, any>;

const mockState: MockState = {};
const mockHanaFetch = vi.fn();

vi.mock('../../settings/store', () => {
  const hook: any = (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  hook.getState = () => mockState;
  hook.setState = (partial: Partial<MockState>) => Object.assign(mockState, partial);
  return { useSettingsStore: hook };
});

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
  hanaUrl: (path: string) => `http://127.0.0.1:14500${path}?token=local`,
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

const baseSummary = {
  network: {
    mode: 'loopback',
    listenHost: '127.0.0.1',
    configuredPort: 14500,
    actualPort: 14500,
    runtimeMode: 'loopback',
    runtimeHost: '127.0.0.1',
    restartRequired: false,
    lanAddresses: ['192.168.31.75'],
    localMobileUrl: 'http://127.0.0.1:14500/mobile/',
    candidateLanMobileUrl: 'http://192.168.31.75:14500/mobile/',
    lanMobileUrl: null,
  },
  account: {
    userId: 'user_owner',
    username: 'Owner',
    displayName: 'Owner',
    passwordSet: false,
  },
  devices: [],
  credentials: [],
};

describe('AccessTab', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, { showToast: vi.fn() });
    mockHanaFetch.mockReset();
    mockHanaFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/access/summary') return Promise.resolve(jsonResponse(baseSummary));
      if (url === '/api/access/network' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          ok: true,
          network: {
            ...baseSummary.network,
            mode: 'lan',
            listenHost: '0.0.0.0',
            configuredPort: 14500,
            lanMobileUrl: 'http://192.168.31.75:14500/mobile/',
            candidateLanMobileUrl: 'http://192.168.31.75:14500/mobile/',
            restartRequired: false,
          },
        }));
      }
      if (url === '/api/access/mobile-credentials' && options?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          ok: true,
          secret: 'hana_dev_visible_once',
          accessUrl: 'http://192.168.31.75:14500/mobile/',
          device: { deviceId: 'device_1', displayName: 'iPhone', status: 'active' },
          credential: { credentialId: 'cred_1', scopes: ['chat', 'files.read', 'files.write'], status: 'active' },
        }));
      }
      if (url === '/api/access/account/profile' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          ok: true,
          account: { ...baseSummary.account, username: 'hana-owner', displayName: 'Hana Owner' },
        }));
      }
      if (url === '/api/access/account/password' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          ok: true,
          account: { ...baseSummary.account, passwordSet: true },
        }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => {}) },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the stable mobile URL and saves LAN network settings', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    await screen.findByText('settings.access.mobileUrlLocalHint');
    expect(screen.queryByDisplayValue('http://127.0.0.1:14500/mobile/')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('14500')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'settings.access.lanToggle' }));
    expect(await screen.findByDisplayValue('http://192.168.31.75:14500/mobile/')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'settings.access.qrCode' })).toHaveAttribute(
      'src',
      expect.stringContaining('/api/access/mobile-qr.svg?port=14500'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'settings.access.saveNetwork' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/network', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ mode: 'lan', listenPort: 14500 }),
      }));
    });
    expect(await screen.findByDisplayValue('http://192.168.31.75:14500/mobile/')).toBeInTheDocument();
    expect(screen.queryByText('settings.access.restartRequired')).not.toBeInTheDocument();
  });

  it('generates a mobile access key and keeps the returned secret visible once', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'settings.access.generateMobileKey' }));

    expect(await screen.findByDisplayValue('hana_dev_visible_once')).toBeInTheDocument();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/mobile-credentials', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Mobile PWA',
        scopes: ['chat', 'files.read', 'files.write'],
      }),
    }));
  });

  it('saves the local owner profile and password from the account section', async () => {
    const { AccessTab } = await import('../../settings/tabs/AccessTab');

    render(<AccessTab />);

    fireEvent.change(await screen.findByLabelText('settings.access.username'), {
      target: { value: 'hana-owner' },
    });
    fireEvent.change(screen.getByLabelText('settings.access.displayName'), {
      target: { value: 'Hana Owner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.access.saveAccount' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/account/profile', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ username: 'hana-owner', displayName: 'Hana Owner' }),
      }));
    });

    fireEvent.change(screen.getByLabelText('settings.access.newPassword'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'settings.access.savePassword' }));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/access/account/password', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ password: 'correct horse battery staple' }),
      }));
    });
  });
});
