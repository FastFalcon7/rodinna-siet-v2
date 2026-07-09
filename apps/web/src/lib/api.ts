import type {
  AddAlbumPhotosInput,
  AgendaResponse,
  AlbumDetail,
  CreateEventInput,
  CreateFragmentInput,
  DiaryEntryPublic,
  DiaryFragmentPublic,
  DiaryFragmentsResponse,
  DiaryListResponse,
  DiarySearchResponse,
  EventPublic,
  GameAnswerInput,
  GamePublic,
  QuizPublic,
  CreateQuizInput,
  UpdateQuizInput,
  LlmStatusResponse,
  NewsCategory,
  NewsPrefsResponse,
  NewsTodayResponse,
  IcsUrlResponse,
  RsvpStatus,
  UpdateEventInput,
  AlbumsListResponse,
  AlbumSuggestionsResponse,
  AuthUserResponse,
  ChatRoomPublic,
  CreateAlbumInput,
  MemoryPublic,
  NoteDetail,
  NoteRevisionsResponse,
  NotesListResponse,
  CreateNoteInput,
  UpdateAlbumInput,
  UpdateNoteInput,
  UpdateNoteItemInput,
  CommentsResponse,
  CreateCommentInput,
  CreatePostInput,
  CreateRoomInput,
  FeedPage,
  InviteInput,
  InviteResponse,
  LinkPreviewPublic,
  LoginInput,
  MediaPublic,
  MessagePublic,
  MessagesPage,
  CreatePollInput,
  NotificationPrefs,
  NotificationPrefsResponse,
  NotificationsListResponse,
  PollPublic,
  PushSubscribeInput,
  VapidKeyResponse,
  PostPublic,
  RegisterInput,
  ReactionSummary,
  RoomsListResponse,
  SendMessageInput,
  SetReactionInput,
  UpdatePostInput,
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

/** Upload cez XHR — jediné API s progress eventmi (fetch ich pri uploade nemá). */
function uploadWithProgress(file: File, onProgress: (pct: number) => void): Promise<MediaPublic> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/media`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* prázdna/nevalidná odpoveď — spadne do error vetvy nižšie */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as MediaPublic);
      } else {
        const err = (data as { error?: unknown } | null)?.error;
        reject(new ApiError(xhr.status, typeof err === 'string' ? err : `Chyba ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Nahrávanie zlyhalo — skontroluj pripojenie'));
    const body = new FormData();
    body.append('file', file);
    xhr.send(body);
  });
}

export const mediaApi = {
  upload: (file: File) => upload<MediaPublic>('/media', file),
  uploadWithProgress,
};

export const linkPreviewApi = {
  get: (url: string) =>
    request<LinkPreviewPublic>(`/link-preview?url=${encodeURIComponent(url)}`),
};

export const feedApi = {
  list: (cursor?: string | null, limit = 20) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return request<FeedPage>(`/feed?${params}`);
  },
  createPost: (input: CreatePostInput) =>
    request<PostPublic>('/feed', { method: 'POST', body: JSON.stringify(input) }),
  updatePost: (id: string, input: UpdatePostInput) =>
    request<PostPublic>(`/feed/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deletePost: (id: string) => request<void>(`/feed/${id}`, { method: 'DELETE' }),
  listComments: (postId: string) => request<CommentsResponse>(`/feed/${postId}/comments`),
  createComment: (postId: string, input: CreateCommentInput) =>
    request<CommentsResponse['comments'][number]>(`/feed/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteComment: (id: string) => request<void>(`/feed/comments/${id}`, { method: 'DELETE' }),
  setReaction: (input: SetReactionInput) =>
    request<{ reactions: ReactionSummary[] }>('/feed/reactions', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};

export const albumsApi = {
  list: () => request<AlbumsListResponse>('/albums'),
  get: (id: string) => request<AlbumDetail>(`/albums/${id}`),
  create: (input: CreateAlbumInput) =>
    request<AlbumDetail>('/albums', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateAlbumInput) =>
    request<AlbumDetail>(`/albums/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/albums/${id}`, { method: 'DELETE' }),
  addPhotos: (id: string, mediaIds: string[]) =>
    request<AlbumDetail>(`/albums/${id}/photos`, { method: 'POST', body: JSON.stringify({ mediaIds }) }),
  removePhoto: (id: string, mediaId: string) =>
    request<void>(`/albums/${id}/photos/${mediaId}`, { method: 'DELETE' }),
  suggestions: () => request<AlbumSuggestionsResponse>('/albums/suggestions'),
  downloadUrl: (id: string) => `${API_URL}/albums/${id}/download`,
  getMemory: (mediaId: string) => request<MemoryPublic>(`/albums/memories/${mediaId}`),
  hideMemory: (mediaId: string) =>
    request<{ ok: boolean }>(`/albums/memories/${mediaId}/hide`, { method: 'POST' }),
};

export const newsApi = {
  getPrefs: () => request<NewsPrefsResponse>('/news/prefs'),
  setPrefs: (categories: NewsCategory[]) =>
    request<NewsPrefsResponse>('/news/prefs', { method: 'PUT', body: JSON.stringify({ categories }) }),
  today: () => request<NewsTodayResponse>('/news/today'),
};

export const gamesApi = {
  /** roomId = null → súkromná praktika proti počítaču (nikde sa neposiela ako správa). */
  createTictactoe: (roomId: string | null) =>
    request<GamePublic>('/games/tictactoe', { method: 'POST', body: JSON.stringify({ roomId }) }),
  get: (id: string) => request<GamePublic>(`/games/${id}`),
  join: (id: string) => request<GamePublic>(`/games/${id}/join`, { method: 'POST' }),
  move: (id: string, cell: number) =>
    request<GamePublic>(`/games/${id}/move`, { method: 'POST', body: JSON.stringify({ cell }) }),
  rematch: (id: string) => request<GamePublic>(`/games/${id}/rematch`, { method: 'POST' }),
  answer: (id: string, input: GameAnswerInput) =>
    request<GamePublic>(`/games/${id}/answer`, { method: 'POST', body: JSON.stringify(input) }),
};

export const quizApi = {
  list: () => request<{ quizzes: QuizPublic[] }>('/quiz'),
  create: (input: CreateQuizInput) =>
    request<QuizPublic>('/quiz', { method: 'POST', body: JSON.stringify(input) }),
  get: (id: string) => request<QuizPublic>(`/quiz/${id}`),
  update: (id: string, input: UpdateQuizInput) =>
    request<QuizPublic>(`/quiz/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  regenerate: (id: string) => request<QuizPublic>(`/quiz/${id}/regenerate`, { method: 'POST' }),
  publish: (id: string) => request<QuizPublic>(`/quiz/${id}/publish`, { method: 'POST' }),
  answer: (id: string, answers: number[]) =>
    request<QuizPublic>(`/quiz/${id}/answers`, { method: 'POST', body: JSON.stringify({ answers }) }),
  remove: (id: string) => request<void>(`/quiz/${id}`, { method: 'DELETE' }),
};

export const diaryApi = {
  entries: () => request<DiaryListResponse>('/diary'),
  status: () => request<LlmStatusResponse>('/diary/status'),
  fragments: (date?: string) =>
    request<DiaryFragmentsResponse>(`/diary/fragments${date ? `?date=${date}` : ''}`),
  addFragment: (input: CreateFragmentInput) =>
    request<DiaryFragmentPublic>('/diary/fragments', { method: 'POST', body: JSON.stringify(input) }),
  removeFragment: (id: string) => request<void>(`/diary/fragments/${id}`, { method: 'DELETE' }),
  generate: (date?: string) =>
    request<{ queued: boolean; date: string }>('/diary/generate', {
      method: 'POST',
      body: JSON.stringify({ date }),
    }),
  search: (q: string) => request<DiarySearchResponse>(`/diary/search?q=${encodeURIComponent(q)}`),
  updateEntry: (id: string, bodyMd: string) =>
    request<DiaryEntryPublic>(`/diary/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ bodyMd }) }),
  confirmEntry: (id: string) =>
    request<DiaryEntryPublic>(`/diary/entries/${id}/confirm`, { method: 'POST' }),
  removeEntry: (id: string) => request<void>(`/diary/entries/${id}`, { method: 'DELETE' }),
};

export const eventsApi = {
  agenda: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<AgendaResponse>(`/events?${params}`);
  },
  get: (id: string) => request<EventPublic>(`/events/${id}`),
  create: (input: CreateEventInput) =>
    request<EventPublic>('/events', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateEventInput) =>
    request<EventPublic>(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/events/${id}`, { method: 'DELETE' }),
  rsvp: (id: string, status: RsvpStatus) =>
    request<EventPublic>(`/events/${id}/rsvp`, { method: 'PUT', body: JSON.stringify({ status }) }),
  icsUrl: () => request<IcsUrlResponse>('/events/ics-url'),
};

export const notesApi = {
  list: () => request<NotesListResponse>('/notes'),
  get: (id: string) => request<NoteDetail>(`/notes/${id}`),
  create: (input: CreateNoteInput) =>
    request<NoteDetail>('/notes', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateNoteInput) =>
    request<NoteDetail>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/notes/${id}`, { method: 'DELETE' }),
  addItem: (id: string, label: string) =>
    request<NoteDetail>(`/notes/${id}/items`, { method: 'POST', body: JSON.stringify({ label }) }),
  updateItem: (itemId: string, input: UpdateNoteItemInput) =>
    request<NoteDetail>(`/notes/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeItem: (itemId: string) => request<NoteDetail>(`/notes/items/${itemId}`, { method: 'DELETE' }),
  duplicate: (id: string, title?: string) =>
    request<NoteDetail>(`/notes/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ title }) }),
  revisions: (id: string) => request<NoteRevisionsResponse>(`/notes/${id}/revisions`),
  restore: (id: string, revId: string) =>
    request<NoteDetail>(`/notes/${id}/revisions/${revId}/restore`, { method: 'POST' }),
};

export const pollsApi = {
  create: (input: CreatePollInput) =>
    request<PollPublic>('/polls', { method: 'POST', body: JSON.stringify(input) }),
  get: (id: string) => request<PollPublic>(`/polls/${id}`),
  vote: (id: string, optionIds: string[]) =>
    request<PollPublic>(`/polls/${id}/vote`, { method: 'PUT', body: JSON.stringify({ optionIds }) }),
  close: (id: string) => request<PollPublic>(`/polls/${id}/close`, { method: 'POST' }),
};

export const notificationsApi = {
  list: () => request<NotificationsListResponse>('/notifications'),
  markRead: (ids?: string[]) =>
    request<NotificationsListResponse>('/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  pushKey: () => request<VapidKeyResponse>('/notifications/push/key'),
  subscribe: (input: PushSubscribeInput) =>
    request<{ ok: boolean }>('/notifications/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  unsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/notifications/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),
  getPrefs: () => request<NotificationPrefsResponse>('/notifications/prefs'),
  setPrefs: (prefs: NotificationPrefs) =>
    request<NotificationPrefsResponse>('/notifications/prefs', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }),
};

export const chatApi = {
  listRooms: () => request<RoomsListResponse>('/chat/rooms'),
  getRoom: (id: string) => request<ChatRoomPublic>(`/chat/rooms/${id}`),
  createRoom: (input: CreateRoomInput) =>
    request<ChatRoomPublic>('/chat/rooms', { method: 'POST', body: JSON.stringify(input) }),
  listMessages: (roomId: string, cursor?: string | null, limit = 30) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return request<MessagesPage>(`/chat/rooms/${roomId}/messages?${params}`);
  },
  sendMessage: (roomId: string, input: SendMessageInput) =>
    request<MessagePublic>(`/chat/rooms/${roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  editMessage: (id: string, bodyMd: string) =>
    request<MessagePublic>(`/chat/messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ bodyMd }),
    }),
  deleteMessage: (id: string) => request<void>(`/chat/messages/${id}`, { method: 'DELETE' }),
  markRead: (roomId: string, messageId: string) =>
    request<{ read: { lastReadAt: string; lastReadMessageId: string } | null }>(
      `/chat/rooms/${roomId}/read`,
      { method: 'POST', body: JSON.stringify({ messageId }) },
    ),
  setReaction: (messageId: string, emoji: string) =>
    request<{ reactions: ReactionSummary[] }>('/chat/reactions', {
      method: 'PUT',
      body: JSON.stringify({ messageId, emoji }),
    }),
};
