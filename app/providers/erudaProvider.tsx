'use client';

import { useEffect } from 'react';

export function ErudaProvider() {
  useEffect(() => {
    // Only load Eruda on the client side to avoid hydration mismatch
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/eruda';
      script.onload = () => {
        // @ts-expect-error - eruda is loaded dynamically
        if (window.eruda) {
          // @ts-expect-error - eruda is loaded dynamically
          window.eruda.init();
        }
      };
      document.body.appendChild(script);
    }
  }, []);

  // Return null - we load the script dynamically to avoid SSR issues
  return null;
}
