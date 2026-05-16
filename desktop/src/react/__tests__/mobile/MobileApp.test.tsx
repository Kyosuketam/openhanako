// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';
import { MobileApp } from '../../mobile/MobileApp';
import registry from '../../../shared/theme-registry';

vi.mock('../../components/InputArea', async () => {
  const ReactModule = await import('react');
  return {
    InputArea: ({ surface }: { surface?: string }) => ReactModule.createElement('div', {
      'data-testid': 'desktop-input-area',
      'data-surface': surface || 'desktop',
    }),
  };
});

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.onclose?.();
  }
}

describe('MobileApp', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    MockWebSocket.instances = [];
    resetStoreForMobileTest();
    window.t = ((key: string) => key) as typeof window.t;
    window.i18n = {
      locale: 'zh',
      defaultName: 'Hanako',
      _data: {},
      _agentOverrides: {},
      load: vi.fn(async function load(this: typeof window.i18n, locale: string) {
        this.locale = locale.startsWith('zh') ? 'zh' : locale;
      }),
      setAgentOverrides: vi.fn(),
      t: (key: string) => key,
    };
    window.setTheme = vi.fn();
    window.setSerifFont = vi.fn();
    window.setPaperTexture = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the access-key login when no browser session exists', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: false, principal: null }));

    render(<MobileApp />);

    expect(await screen.findByText('手机访问 Hana')).toBeInTheDocument();
    expect(screen.getByLabelText('访问密钥')).toBeInTheDocument();
  });

  it('can submit a username and password login without sending a device credential', async () => {
    let sessionCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/web-auth/session')) {
        sessionCalls += 1;
        return Promise.resolve(jsonResponse(sessionCalls === 1
          ? { authenticated: false, principal: null }
          : { authenticated: true, principal: principal(['chat', 'files.read', 'files.write'], 'password') }));
      }
      if (url.includes('/api/web-auth/login')) return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse(jsonResponseForMobile(url, options)));
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByRole('tab', { name: '用户名密码' }));
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'hana-owner' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      const loginCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/web-auth/login'));
      expect(loginCall).toBeTruthy();
      const body = JSON.parse(String(loginCall?.[1]?.body));
      expect(body).toEqual({ username: 'hana-owner', password: 'secret-password' });
      expect(body).not.toHaveProperty('credential');
    });
  });

  it('returns stale browser sessions without file scopes to login', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/web-auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: true, principal: principal(['chat']) }));
      }
      if (url.includes('/api/web-auth/logout')) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse(jsonResponseForMobile(url)));
    });

    render(<MobileApp />);

    expect(await screen.findByText('手机访问 Hana')).toBeInTheDocument();
    expect(screen.getByText('当前登录缺少工作台权限，请重新输入访问密钥。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/web-auth/logout', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('loads chat sessions, desktop input surface, and workbench files for an authenticated phone', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/web-auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: true, principal: principal(['chat', 'files.read', 'files.write']) }));
      }
      return Promise.resolve(jsonResponse(jsonResponseForMobile(url, options)));
    });

    render(<MobileApp />);

    expect(await screen.findByText('日常记录')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-input-area')).toHaveAttribute('data-surface', 'mobile');
    expect(document.querySelector('.titlebar')).toBeInTheDocument();
    expect(document.querySelector('.sidebar')).toBeInTheDocument();
    expect(document.querySelector('.jian-sidebar')).toBeInTheDocument();
    expect(useStore.getState().homeFolder).toBe('/workspace');
    expect(useStore.getState().selectedFolder).toBe('/workspace');
    expect(useStore.getState().agents[0]).toMatchObject({
      id: 'hana',
      homeFolder: '/workspace',
      chatModel: { id: 'deepseek-chat', provider: 'deepseek' },
    });
    fireEvent.click(screen.getByTitle('sidebar.jian'));
    expect(await screen.findByText('note.md')).toBeInTheDocument();
  });

  it('uses the desktop new-session draft flow on mobile instead of creating an empty session immediately', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/web-auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: true, principal: principal(['chat', 'files.read', 'files.write']) }));
      }
      return Promise.resolve(jsonResponse(jsonResponseForMobile(url, options)));
    });

    render(<MobileApp />);
    await screen.findByText('日常记录');
    fireEvent.click(screen.getByTitle('sidebar.newChat'));

    expect(useStore.getState().pendingNewSession).toBe(true);
    expect(useStore.getState().welcomeVisible).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/sessions/new'))).toBe(false);
  });

  it('renders server-broadcast user messages through the desktop websocket handler', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/web-auth/session')) {
        return Promise.resolve(jsonResponse({ authenticated: true, principal: principal(['chat', 'files.read', 'files.write']) }));
      }
      return Promise.resolve(jsonResponse(jsonResponseForMobile(url, options)));
    });

    render(<MobileApp />);

    await screen.findByText('日常记录');
    act(() => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: 'session_user_message',
          sessionPath: '/hana/sessions/one.jsonl',
          message: { id: 'u-mobile-1', text: '手机端发来的消息' },
        }),
      } as MessageEvent);
    });

    expect(await screen.findAllByText('手机端发来的消息')).not.toHaveLength(0);
  });
});

function principal(scopes: string[], credentialKind = 'device_credential') {
  return {
    kind: credentialKind === 'password' ? 'account_user' : 'device',
    credentialKind,
    connectionKind: 'lan',
    trustState: 'lan',
    serverId: 'server_1',
    userId: 'user_1',
    studioId: 'studio_1',
    scopes,
  };
}

function jsonResponseForMobile(url: string, _options?: RequestInit): unknown {
  if (url.includes('/api/server/identity')) {
    return {
      serverId: 'server_1',
      userId: 'user_1',
      studioId: 'studio_1',
      label: 'Hana Studio',
      studioLabel: 'Hana Studio',
      userLabel: 'Owner',
      connectionKind: 'local',
      trustState: 'local',
      credentialKind: 'loopback_token',
      capabilities: ['chat', 'resources', 'files'],
    };
  }
  if (url.includes('/api/mobile/bootstrap')) {
    return {
      locale: 'zh-CN',
      agentName: 'Hana',
      userName: 'Owner',
      currentAgentId: 'hana',
      agentYuan: 'hanako',
      homeFolder: '/workspace',
      cwdHistory: ['/workspace'],
      avatars: { agent: false, user: false },
      agents: [{
        id: 'hana',
        name: 'Hana',
        yuan: 'hanako',
        isPrimary: true,
        hasAvatar: false,
        homeFolder: '/workspace',
        chatModel: { id: 'deepseek-chat', provider: 'deepseek' },
      }],
      appearance: { theme: registry.DEFAULT_THEME, serif: true, paperTexture: false },
    };
  }
  if (url.includes('/api/models')) {
    return { models: [{ id: 'deepseek-chat', name: 'DeepSeek', provider: 'deepseek', isCurrent: true }], activeModel: null };
  }
  if (url.includes('/api/desk/files')) {
    return {
      basePath: '/workspace',
      subdir: '',
      files: [{ name: 'note.md', isDir: false, size: 12, mtime: '2026-05-16T00:00:00.000Z' }],
    };
  }
  if (url.includes('/api/desk/jian')) {
    return { content: null };
  }
  if (url.includes('/api/sessions/messages')) {
    return { messages: [], blocks: [], todos: [], hasMore: false, sessionFiles: [] };
  }
  if (url.includes('/api/sessions')) {
    return [
      { path: '/hana/sessions/one.jsonl', title: '日常记录', firstMessage: '', modified: '2026-05-16T00:00:00.000Z', messageCount: 2, agentId: 'hana', agentName: 'Hana', cwd: '/workspace' },
    ];
  }
  return {};
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
    text: async () => typeof data === 'string' ? data : JSON.stringify(data),
    headers: new Headers(),
  } as Response;
}

function resetStoreForMobileTest(): void {
  useStore.setState({
    serverPort: null,
    serverToken: null,
    serverConnections: {},
    activeServerConnectionId: null,
    activeServerConnection: null,
    connected: false,
    wsState: 'disconnected',
    sessions: [],
    currentSessionPath: null,
    pendingSessionSwitchPath: null,
    pendingNewSession: false,
    chatSessions: {},
    sessionRegistryFilesByPath: {},
    sessionModelsByPath: {},
    _loadMessagesVersion: {},
    streamingSessions: [],
    previewItems: [],
    openTabs: [],
    activeTabId: null,
    previewOpen: false,
    agents: [],
    currentAgentId: null,
    agentName: 'Hanako',
    userName: 'User',
    agentAvatarUrl: null,
    userAvatarUrl: null,
    models: [],
    currentModel: null,
    locale: 'zh',
    currentTab: 'chat',
    sidebarOpen: true,
    jianOpen: false,
    jianAutoCollapsed: false,
    sidebarAutoCollapsed: false,
    deskBasePath: '',
    deskCurrentPath: '',
    deskFiles: [],
    deskTreeFilesByPath: {},
    deskExpandedPaths: [],
    deskDirtyTreePaths: [],
    deskSelectedPath: '',
    deskJianContent: null,
    cwdSkills: [],
    cwdSkillsOpen: false,
    jianDrawerOpen: false,
    rightWorkspaceTab: 'workspace',
    jianView: 'desk',
    activePanel: null,
  });
}
