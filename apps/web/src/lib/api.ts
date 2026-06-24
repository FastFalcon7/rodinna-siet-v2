import type { AuthUserResponse, LoginInput, RegisterInput } from '@rodinna/shared-types';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) || `Chyba ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const authApi = {
  me: () => request<AuthUserResponse>('/auth/me'),
  login: (input: LoginInput) =>
    request<AuthUserResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  register: (input: RegisterInput) =>
    request<AuthUserResponse>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<AuthUserResponse>('/auth/logout', { method: 'POST' }),
};
