import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider, http, createStorage } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import App from './App';
import './index.css';
import { BitcoinWalletProvider } from './context/BitcoinWalletContext';

const RAINBOW_PROJECT_ID = import.meta.env.VITE_RAINBOW_PROJECT_ID as string;
const RPC_URL = import.meta.env.VITE_RPC_URL as string;

// CRITICAL FIX: Clear ALL stale wagmi/rainbowkit state BEFORE config init
// This prevents "connector.getChainId is not a function" errors from zombie connections
const clearWagmiState = () => {
    try {
        // Clear from localStorage
        const localStorageKeys = Object.keys(localStorage);
        localStorageKeys.forEach(key => {
            if (key.startsWith('wagmi') || key.startsWith('rk-') || key.startsWith('walletconnect')) {
                localStorage.removeItem(key);
            }
        });
        // Clear from sessionStorage 
        const sessionStorageKeys = Object.keys(sessionStorage);
        sessionStorageKeys.forEach(key => {
            if (key.startsWith('wagmi') || key.startsWith('rk-') || key.startsWith('walletconnect')) {
                sessionStorage.removeItem(key);
            }
        });
    } catch (e) {
        console.warn('Failed to clear wagmi state:', e);
    }
};

// Clear state immediately on module load (before wagmi initializes)
clearWagmiState();

// Noop storage to completely disable persistence and prevent stale state issues
const noopStorage = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
};

const config = getDefaultConfig({
    appName: 'GhostYield',
    projectId: RAINBOW_PROJECT_ID,
    chains: [baseSepolia],
    transports: {
        [baseSepolia.id]: http(RPC_URL),
    },
    // FIX: Use noopStorage to completely prevent state persistence
    // This ensures each page load starts with a fresh connection state
    // preventing "connector.getChainId is not a function" zombie connector errors
    storage: createStorage({
        storage: noopStorage as any,
    }),
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                    <BitcoinWalletProvider>
                        <BrowserRouter>
                            <App />
                        </BrowserRouter>
                    </BitcoinWalletProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    </React.StrictMode>
);
