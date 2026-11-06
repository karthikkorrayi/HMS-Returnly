'use client'

import { useEffect, useState } from 'react'

export const themeInit = `(function(){var t='dark';try{var saved=localStorage.getItem('foundora-theme');if(saved==='light'||saved==='dark')t=saved}catch(e){}document.documentElement.dataset.theme=t})()`

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>('dark')
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
            : 'dark'
    }
    window.addEventListener('storage', onStorage)
    return () => {
      observer.disconnect()
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
