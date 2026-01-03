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

const config = getDefaultConfig({
    appName: 'GhostYield',
    projectId: RAINBOW_PROJECT_ID,
    chains: [baseSepolia],
    transports: {
        [baseSepolia.id]: http(RPC_URL),
    },
});

// Implementation of "Disconnect on Restart/New Tab, Stay on Refresh"
const isFreshRestart = !sessionStorage.getItem('ghostyield_session_active');

if (isFreshRestart) {
    // Fresh session - clear storage to force fresh connections
    // We clear both ETH and BTC storage
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('wagmi') || key.startsWith('rk-')) {
            localStorage.removeItem(key);
        }
    });
    // BTC wallet context uses sessionStorage now, which naturally clears on Tab close.
    // But we clear it here too just in case it was somehow persisted.
    sessionStorage.removeItem('ghostyield_btc_address');
    sessionStorage.removeItem('ghostyield_btc_pubkey');

    sessionStorage.setItem('ghostyield_session_active', 'true');
}

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
