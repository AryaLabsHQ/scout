import { createContext, useCallback, useContext, useEffect, useState } from "react"

interface CommandPaletteState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  setOpen: (open: boolean) => void
}

const CommandPaletteContext = createContext<CommandPaletteState>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  setOpen: () => {},
})

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  // Global keyboard listener for Cmd+K / Ctrl+K. Uses capture phase so it wins
  // over focused terminals and other components that might swallow the key.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [])

  return (
    <CommandPaletteContext.Provider value={{ isOpen, open, close, toggle, setOpen: setIsOpen }}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPalette(): CommandPaletteState {
  return useContext(CommandPaletteContext)
}
