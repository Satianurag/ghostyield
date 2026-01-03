import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider, http } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import App from './App';
import './index.css';

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

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                    <BrowserRouter>
                        <App />
                    </BrowserRouter>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    </React.StrictMode>
);
