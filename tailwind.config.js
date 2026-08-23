/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#ede6d6', // Warm Cream (papel)
        foreground: '#3b2a22',
        card: '#f5f0e3',
        'card-foreground': '#3b2a22',
        primary: '#37656e', // Vintage Blue
        'primary-foreground': '#f5f0e3',
        secondary: '#8b9a7a', // Dusty Sage
        'secondary-foreground': '#2c3125',
        muted: '#e2d9c3',
        'muted-foreground': '#6f6350',
        accent: '#b85c38', // Muted Terracotta
        'accent-foreground': '#f5f0e3',
        destructive: '#b85c38',
        'destructive-foreground': '#f5f0e3',
        rosewood: '#7a2e22', // reservado ao badge de status "atrasado"
        'rosewood-foreground': '#f5f0e3',
        success: '#8b9a7a',
        'success-foreground': '#2c3125',
        warning: '#b85c38',
        'warning-foreground': '#f5f0e3',
        border: '#d6c9ae',
        input: '#d6c9ae',
        ring: '#37656e',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'serif'],
        sans: ['"IBM Plex Mono"', 'monospace'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        sm: '0.3rem',
        md: '0.4rem',
        lg: '0.5rem',
        xl: '0.7rem',
        '2xl': '0.9rem',
      },
    },
  },
  plugins: [],
}