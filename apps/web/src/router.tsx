// A few top-level screens need no router library: the path picks the screen, links push history.
import { type AnchorHTMLAttributes, useEffect, useState } from 'react'

const listeners = new Set<() => void>()

export function navigate(to: string) {
  history.pushState(null, '', to)
  listeners.forEach((l) => l())
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const update = () => setPath(location.pathname)
    listeners.add(update)
    addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      removeEventListener('popstate', update)
    }
  }, [])
  return path
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(href)
      }}
      {...rest}
    />
  )
}
