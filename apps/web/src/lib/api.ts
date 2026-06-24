import type {
  AuthUserResponse,
  InviteInput,
  InviteResponse,
  LoginInput,
  MediaPublic,
  RegisterInput,
  UpdateProfileInput,
  UsersListResponse,
} from '@rodinna/shared-types';

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

/** Upload cez multipart/form-data — content-type nesmieme nastaviť ručne (boundary). */
async function upload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', credentials: 'include', body });
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
  invite: (input: InviteInput) =>
    request<InviteResponse>('/auth/invite', { method: 'POST', body: JSON.stringify(input) }),
};

export const usersApi = {
  list: () => request<UsersListResponse>('/users'),
  updateProfile: (input: UpdateProfileInput) =>
    request<AuthUserResponse>('/users/me', { method: 'PATCH', body: JSON.stringify(input) }),
  uploadAvatar: (file: File) => upload<AuthUserResponse>('/users/me/avatar', file),
};

export const mediaApi = {
  upload: (file: File) => upload<MediaPublic>('/media', file),
};
