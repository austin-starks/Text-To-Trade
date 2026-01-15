'use client';

import { sdk } from '@farcaster/miniapp-sdk';
import { useEffect } from 'react';
import TradingTerminal from './components/TradingTerminal';
import WalletPortfolio from './components/WalletPortfolio';
import { useMiniApp } from './providers/miniAppProvider';

export default function Home() {
  const { isInMiniApp, context } = useMiniApp();

  useEffect(() => {
    sdk.actions.ready();
  }, []);

  return (
    <div className="min-h-screen bg-grid relative">
      {/* Background glow effect */}
      <div className="bg-glow" />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-4 sm:p-6">
        {/* Header */}
        <header className="w-full max-w-[1080px] mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#58a6ff] to-[#a371f7] flex items-center justify-center">
                <span className="text-white text-sm font-bold">⚡</span>
              </div>
              <span className="text-[#8b949e] text-sm font-medium">
                text-to-trade
              </span>
            </div>

            {isInMiniApp && context?.user && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded-full">
                <span className="w-2 h-2 bg-[#3fb950] rounded-full animate-pulse"></span>
                <span className="text-[#8b949e] text-xs">
                  @{context.user.username}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="w-full max-w-[1080px] flex flex-col lg:flex-row gap-6 justify-center items-start">
          <TradingTerminal />
          <WalletPortfolio />
        </main>

        {/* Footer */}
        <footer className="w-full max-w-[1080px] mt-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#484f58]">
            <div className="flex items-center gap-4">
              <a
                href="https://base.org"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#58a6ff] transition-colors"
              >
                Built on Base
              </a>
              <span className="hidden sm:inline">•</span>
              <a
                href="https://1inch.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#58a6ff] transition-colors"
              >
                Powered by 1inch
              </a>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#6e7681]">Preview Mode</span>
              <span className="text-[#3fb950]">•</span>
              <span className="text-[#6e7681]">No real trades</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
