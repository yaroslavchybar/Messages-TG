import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { ConvexHttpClient } from 'convex/browser';

const ConvexContext = createContext<ConvexHttpClient | null>(null);

interface ConvexProviderProps {
    children: ReactNode;
}

export function ConvexProvider({ children }: ConvexProviderProps) {
    const client = useMemo(() => {
        const url = process.env.CONVEX_URL;
        if (!url) {
            console.warn('CONVEX_URL not set, Convex features disabled');
            return null;
        }
        return new ConvexHttpClient(url);
    }, []);

    return (
        <ConvexContext.Provider value={client}>
            {children}
        </ConvexContext.Provider>
    );
}

export function useConvex(): ConvexHttpClient | null {
    return useContext(ConvexContext);
}
