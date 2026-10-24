// Theme system. Each theme is a complete set of CSS custom properties applied to
// the .app root. Palettes are drawn from well-established open-source color schemes
// (Catppuccin, Dracula, Nord, Tokyo Night, Gruvbox) plus the original "Aurora" default.
// Hex values follow each project's published palette.

export type ThemeVars = {
  bg: string; panel: string; panel2: string; line: string
  text: string; muted: string
  blue: string; cyan: string; green: string; purple: string; amber: string; red: string
  shadow: string
  colorScheme: 'dark' | 'light'
}

export type Theme = { id: string; name: string; group: 'Dark' | 'Light'; vars: ThemeVars }

export const THEMES: Theme[] = [
  {
    id: 'aurora', name: 'Aurora', group: 'Dark',
    vars: {
      bg: '#070c14', panel: '#0c1421', panel2: '#101b2b', line: '#1d2a3d',
      text: '#edf4ff', muted: '#7f8da3',
      blue: '#4c8dff', cyan: '#36d7ea', green: '#55dca3', purple: '#a77bf3', amber: '#ffbf69', red: '#ff6b7a',
      shadow: '0 20px 60px rgba(0,0,0,.28)', colorScheme: 'dark',
    },
  },
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha', group: 'Dark',
    vars: {
      bg: '#11111b', panel: '#181825', panel2: '#1e1e2e', line: '#313244',
      text: '#cdd6f4', muted: '#9399b2',
      blue: '#89b4fa', cyan: '#94e2d5', green: '#a6e3a1', purple: '#cba6f7', amber: '#f9e2af', red: '#f38ba8',
      shadow: '0 20px 60px rgba(0,0,0,.45)', colorScheme: 'dark',
    },
  },
  {
    id: 'dracula', name: 'Dracula', group: 'Dark',
    vars: {
      bg: '#21222c', panel: '#282a36', panel2: '#2e3140', line: '#44475a',
      text: '#f8f8f2', muted: '#8a8fa3',
      blue: '#8be9fd', cyan: '#8be9fd', green: '#50fa7b', purple: '#bd93f9', amber: '#f1fa8c', red: '#ff5555',
      shadow: '0 20px 60px rgba(0,0,0,.4)', colorScheme: 'dark',
    },
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', group: 'Dark',
    vars: {
      bg: '#1a1b26', panel: '#1f2335', panel2: '#24283b', line: '#2f334d',
      text: '#c0caf5', muted: '#7a82a8',
      blue: '#7aa2f7', cyan: '#7dcfff', green: '#9ece6a', purple: '#bb9af7', amber: '#e0af68', red: '#f7768e',
      shadow: '0 20px 60px rgba(0,0,0,.45)', colorScheme: 'dark',
    },
  },
  {
    id: 'nord', name: 'Nord', group: 'Dark',
    vars: {
      bg: '#242933', panel: '#2e3440', panel2: '#3b4252', line: '#434c5e',
      text: '#eceff4', muted: '#9aa4b8',
      blue: '#81a1c1', cyan: '#88c0d0', green: '#a3be8c', purple: '#b48ead', amber: '#ebcb8b', red: '#bf616a',
      shadow: '0 20px 60px rgba(0,0,0,.4)', colorScheme: 'dark',
    },
  },
  {
    id: 'gruvbox', name: 'Gruvbox', group: 'Dark',
    vars: {
      bg: '#1d2021', panel: '#282828', panel2: '#32302f', line: '#504945',
      text: '#ebdbb2', muted: '#a89984',
      blue: '#83a598', cyan: '#8ec07c', green: '#b8bb26', purple: '#d3869b', amber: '#fabd2f', red: '#fb4934',
      shadow: '0 20px 60px rgba(0,0,0,.4)', colorScheme: 'dark',
    },
  },
  {
    id: 'daylight', name: 'Daylight', group: 'Light',
    vars: {
      bg: '#edf2f8', panel: '#ffffff', panel2: '#f7f9fc', line: '#dce4ef',
      text: '#142033', muted: '#657287',
      blue: '#2563eb', cyan: '#0891b2', green: '#059669', purple: '#7c3aed', amber: '#d97706', red: '#dc2626',
      shadow: '0 18px 55px rgba(36,55,87,.12)', colorScheme: 'light',
    },
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte', group: 'Light',
    vars: {
      bg: '#eff1f5', panel: '#ffffff', panel2: '#e6e9ef', line: '#ccd0da',
      text: '#4c4f69', muted: '#6c6f85',
      blue: '#1e66f5', cyan: '#179299', green: '#40a02b', purple: '#8839ef', amber: '#df8e1d', red: '#d20f39',
      shadow: '0 18px 55px rgba(76,79,105,.14)', colorScheme: 'light',
    },
  },
]

const STORAGE_KEY = 'mimo.theme.v1'
export const DEFAULT_THEME_ID = 'aurora'

export function getTheme(id: string): Theme {
  return THEMES.find(t => t.id === id) ?? THEMES[0]
}

export function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

export function saveThemeId(id: string): void {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
}

// Apply a theme by writing CSS variables onto the given element (the .app root).
export function applyTheme(el: HTMLElement, theme: Theme): void {
  const v = theme.vars
  const set = (name: string, value: string) => el.style.setProperty(name, value)
  set('--bg', v.bg); set('--panel', v.panel); set('--panel-2', v.panel2); set('--line', v.line)
  set('--text', v.text); set('--muted', v.muted)
  set('--blue', v.blue); set('--cyan', v.cyan); set('--green', v.green)
  set('--purple', v.purple); set('--amber', v.amber); set('--red', v.red)
  set('--shadow', v.shadow)
  set('color-scheme', v.colorScheme)
}
