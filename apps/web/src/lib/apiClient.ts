import axios, { type InternalAxiosRequestConfig } from 'axios'

type TokenGetter = (opts?: { skipCache?: boolean }) => Promise<string | null>

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

const callbackWorkspace = new URLSearchParams(window.location.search).get('workspace')
if (callbackWorkspace && /^[0-9a-f-]{36}$/i.test(callbackWorkspace)) sessionStorage.setItem('deskroute.workspace', callbackWorkspace)
const workspaceId = sessionStorage.getItem('deskroute.workspace')

export function openWorkspace(id: string, path = '/') {
  sessionStorage.setItem('deskroute.workspace', id)
  window.location.assign(path)
}

let _getToken: TokenGetter | null = null

export function setTokenGetter(getter: TokenGetter | null) {
  _getToken = getter
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:8080/api'),
})

apiClient.interceptors.request.use(async (config) => {
  if (workspaceId) config.headers["X-Workspace-Id"] = workspaceId
  if (_getToken) {
    const token = await _getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (r) => r,
  async (error) => {
    const config = error.config as RetriableConfig | undefined
    if (error.response?.status === 401 && config && !config._retried && _getToken) {
      config._retried = true
      try {
        const fresh = await _getToken({ skipCache: true })
        if (fresh) {
          config.headers = config.headers ?? {}
          config.headers.Authorization = `Bearer ${fresh}`
          return apiClient.request(config)
        }
      } catch { /* fall through to the rejection below */ }
    }
    return Promise.reject(error)
  }
)
