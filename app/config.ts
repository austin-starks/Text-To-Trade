import { createConfig, http, injected } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    injected(),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
})

export type SupportedChainId = typeof base.id | typeof baseSepolia.id

export const SUPPORTED_NETWORKS = {
  [base.id]: {
    name: 'Base Mainnet',
    shortName: 'Mainnet',
    color: '#3fb950',
  },
  [baseSepolia.id]: {
    name: 'Base Sepolia',
    shortName: 'Testnet',
    color: '#f0883e',
  },
} as const