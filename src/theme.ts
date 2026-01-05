// Theme configuration inspired by the terminal music player style
// Orange/coral accents with a dark, minimal aesthetic

export const theme = {
    colors: {
        // Primary accent - golden amber
        primary: '#FFAE00' as const,  // Golden amber
        primaryName: '#FFAE00' as const,   // Golden amber for Ink
        // Secondary - lighter golden
        secondary: '#FFD060' as const,

        // Status colors
        success: 'green' as const,
        warning: 'yellow' as const,
        error: 'red' as const,

        // Text
        text: 'white' as const,
        muted: 'gray' as const,
        dimmed: 'gray' as const,

        // Selection/highlight
        selected: 'red' as const,
        selectedBg: undefined,  // No background, just text color
    },

    borders: {
        section: 'single' as const,
        input: 'single' as const,
        progress: 'single' as const,
    },

    icons: {
        // Status indicators (using ASCII that works in terminals)
        connected: '●',
        disconnected: '○',
        loading: '◐',
        check: '+',
        cross: '-',

        // Navigation
        selected: '>',
        bullet: '•',

        // Features
        saving: '●',
        paused: '○',
    },

    // Section header style (dashed lines like in reference)
    sectionHeader: (title: string, width: number = 40): string => {
        const padding = 2;
        const dashes = '─'.repeat(Math.max(0, width - title.length - padding * 2));
        return `─ ${title} ${dashes}`;
    },
};

// Color type for Ink components
export type InkColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';

export default theme;
