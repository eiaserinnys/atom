const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

function buildHeaders(options?: RequestInit): HeadersInit {
  return {
    ...(options?.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...options?.headers,
  };
}

async function fetchApi(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: buildHeaders(options),
  });

  if (res.status === 401) {
    if (window.location.pathname !== '/') {
      window.location.href = '/';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetchApi(path, options);
  return res.json();
}

export async function requestVoid(path: string, options?: RequestInit): Promise<void> {
  await fetchApi(path, options);
}
