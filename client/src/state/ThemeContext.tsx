import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../services/api';
import { getSocket } from '../services/socket';

interface Theme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  name: string;
}

interface ThemeContextValue {
  theme: Theme | null;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: null });

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', theme.primaryColor);
  root.style.setProperty('--color-secondary', theme.secondaryColor);
  root.style.setProperty('--color-accent', theme.accentColor);
  root.style.setProperty('--color-background', theme.backgroundColor);
  root.style.setProperty('--color-surface', theme.surfaceColor);
  root.style.setProperty('--color-text', theme.textColor);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Fetch theme on mount
  useEffect(() => {
    api.get<{ theme: Theme }>('/theme')
      .then((r) => {
        setTheme(r.data.theme);
        applyTheme(r.data.theme);
      })
      .catch(() => {
        // Use defaults if fetch fails
      });
  }, []);

  // Listen for live theme updates
  useEffect(() => {
    const socket = getSocket();

    const handleThemeUpdate = ({ theme: newTheme }: { theme: Theme }) => {
      setTheme(newTheme);
      applyTheme(newTheme);
    };

    socket.on('theme.updated', handleThemeUpdate);
    return () => { socket.off('theme.updated', handleThemeUpdate); };
  }, []);

  return (
    <ThemeContext.Provider value={{ theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
