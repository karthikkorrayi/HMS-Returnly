'use client'

import { useEffect, useState } from 'react'

export const themeInit = `(function(){try{var t=localStorage.getItem('foundora-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})()`

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)
  useEffect(() => {
    const sync = () =>
      setTheme(
        document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      )
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'foundora-theme')
        document.documentElement.dataset.theme =
          event.newValue === 'light' || event.newValue === 'dark'
            ? event.newValue
            : matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
    }
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => {
      let saved: string | null = null
      try {
        saved = localStorage.getItem('foundora-theme')
      } catch {
        /* Storage can be disabled. */
      }
      if (saved !== 'light' && saved !== 'dark')
        document.documentElement.dataset.theme = media.matches
          ? 'dark'
          : 'light'
    }
    media.addEventListener('change', onSystem)
    window.addEventListener('storage', onStorage)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', onSystem)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Dark theme"
      aria-pressed={theme === 'dark'}
      onClick={() => {
        const next =
          document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
        document.documentElement.dataset.theme = next
        setTheme(next)
        try {
          localStorage.setItem('foundora-theme', next)
        } catch {
          /* Theme still works without storage. */
        }
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />
      </svg>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  )
}
