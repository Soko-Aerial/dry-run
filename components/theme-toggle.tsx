import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  useEffect(() => {
    if (theme === 'system' || theme === 'light' || theme === 'dark') window.dryRun.setTheme(theme)
  }, [theme])
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="hidden size-3.5 dark:block" />
      <Moon className="size-3.5 dark:hidden" />
    </Button>
  )
}
