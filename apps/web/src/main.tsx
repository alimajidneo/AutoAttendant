import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import App from './App'
import { authConfigured } from '@/lib/supabase'
import './index.css'
import { applyTheme, getInitialTheme } from '@/lib/theme'

applyTheme(getInitialTheme())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {authConfigured ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delay={300}>
            <BrowserRouter><App /></BrowserRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    ) : (
      <main className="mx-auto max-w-form p-8">
        <h1 className="text-2xl font-semibold">DeskRoute setup is incomplete</h1>
        <p className="mt-3">Sign-in is unavailable. Contact the person managing this installation.</p>
        {import.meta.env.DEV && <p className="mt-3">Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local, then restart the web server.</p>}
      </main>
    )}
  </StrictMode>,
)
