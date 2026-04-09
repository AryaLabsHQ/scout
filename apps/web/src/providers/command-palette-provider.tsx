import { createContext, useCallback, useContext, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"

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

  useHotkeys("mod+k", () => {
    setIsOpen((prev) => !prev)
  }, { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true })

  return (
    <CommandPaletteContext.Provider value={{ isOpen, open, close, toggle, setOpen: setIsOpen }}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPalette(): CommandPaletteState {
  return useContext(CommandPaletteContext)
}
