// Bitcoin Wallet Hook for Unisat/Xverse browser wallet integration
// Provides connection, address, UTXOs, and PSBT signing capabilities

import { useState, useEffect, useCallback } from 'react';

// Type definitions for Unisat Wallet API
declare global {
    interface Window {
        unisat?: {
            requestAccounts(): Promise<string[]>;
            getAccounts(): Promise<string[]>;
            getNetwork(): Promise<string>;
            switchNetwork(network: string): Promise<void>;
            getPublicKey(): Promise<string>;
            getBalance(): Promise<{ confirmed: number; unconfirmed: number; total: number }>;
            signPsbt(psbtHex: string, options?: { autoFinalized?: boolean }): Promise<string>;
            signPsbts(psbtHexs: string[], options?: { autoFinalized?: boolean }): Promise<string[]>;
            pushPsbt(psbtHex: string): Promise<string>;
            sendBitcoin(address: string, satoshis: number, options?: object): Promise<string>;
            on(event: string, callback: (data: unknown) => void): void;
            removeListener(event: string, callback: (data: unknown) => void): void;
        };
    }
}

export interface UTXO {
    txid: string;
    vout: number;
    value: number;
    scriptPubKey?: string;
}

export interface BitcoinWalletState {
    isInstalled: boolean;
    isConnected: boolean;
    address: string | null;
    publicKey: string | null;
    balance: {
        confirmed: number;
        unconfirmed: number;
        total: number;
    } | null;
    network: string | null;
    utxos: UTXO[];
}

export interface BitcoinWalletActions {
    connect: () => Promise<void>;
    disconnect: () => void;
    switchToTestnet4: () => Promise<void>;
    signPsbt: (psbtHex: string) => Promise<string>;
    broadcastPsbt: (psbtHex: string) => Promise<string>;
    refreshBalance: () => Promise<void>;
    fetchUtxos: () => Promise<UTXO[]>;
}

const TESTNET4_NETWORK = 'testnet4';
const TATUM_RPC = 'https://bitcoin-testnet4.gateway.tatum.io';

export function useBitcoinWallet(): BitcoinWalletState & BitcoinWalletActions {
    const [state, setState] = useState<BitcoinWalletState>({
        isInstalled: false,
        isConnected: false,
        address: null,
        publicKey: null,
        balance: null,
        network: null,
        utxos: [],
    });

    // Check if Unisat is installed
    useEffect(() => {
        const checkInstalled = () => {
            setState(prev => ({ ...prev, isInstalled: !!window.unisat }));
        };

        // Check immediately and after a delay (wallet may inject late)
        checkInstalled();
        const timeout = setTimeout(checkInstalled, 1000);

        return () => clearTimeout(timeout);
    }, []);

    // Listen for account changes
    useEffect(() => {
        if (!window.unisat) return;

        const handleAccountsChanged = (accounts: unknown) => {
            const accts = accounts as string[];
            if (accts.length === 0) {
                setState(prev => ({ ...prev, isConnected: false, address: null }));
            } else {
                setState(prev => ({ ...prev, address: accts[0] }));
            }
        };

        window.unisat.on('accountsChanged', handleAccountsChanged);

        return () => {
            window.unisat?.removeListener('accountsChanged', handleAccountsChanged);
        };
    }, []);

    // Connect wallet
    const connect = useCallback(async () => {
        if (!window.unisat) {
            throw new Error('Unisat wallet not installed. Please install from unisat.io');
        }

        try {
            const accounts = await window.unisat.requestAccounts();
            const publicKey = await window.unisat.getPublicKey();
            const network = await window.unisat.getNetwork();
            const balance = await window.unisat.getBalance();

            setState(prev => ({
                ...prev,
                isConnected: true,
                address: accounts[0] || null,
                publicKey,
                network,
                balance,
            }));

            // Switch to testnet4 if not already
            if (network !== TESTNET4_NETWORK) {
                // Switch to testnet4 if not already
                try {
                    await window.unisat.switchNetwork(TESTNET4_NETWORK);
                    const newNetwork = await window.unisat.getNetwork();
                    setState(prev => ({ ...prev, network: newNetwork }));
                } catch (e) {
                    console.warn('Could not switch to testnet4:', e);
                }
            }
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            throw error;
        }
    }, []);

    // Disconnect wallet
    const disconnect = useCallback(() => {
        setState(prev => ({
            ...prev,
            isConnected: false,
            address: null,
            publicKey: null,
            balance: null,
            utxos: [],
        }));
    }, []);

    // Switch to testnet4
    const switchToTestnet4 = useCallback(async () => {
        if (!window.unisat) throw new Error('Wallet not installed');
        await window.unisat.switchNetwork(TESTNET4_NETWORK);
        const network = await window.unisat.getNetwork();
        setState(prev => ({ ...prev, network }));
    }, []);

    // Refresh balance
    const refreshBalance = useCallback(async () => {
        if (!window.unisat) return;
        try {
            const balance = await window.unisat.getBalance();
            setState(prev => ({ ...prev, balance }));
        } catch (error) {
            console.error('Failed to refresh balance:', error);
        }
    }, []);

    // Fetch UTXOs from public API (mempool.space or Tatum)
    const fetchUtxos = useCallback(async (): Promise<UTXO[]> => {
        if (!state.address) return [];

        try {
            // Try mempool.space testnet4 API
            const response = await fetch(
                `https://mempool.space/testnet4/api/address/${state.address}/utxo`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch UTXOs');
            }

            const data = await response.json();
            const utxos: UTXO[] = data.map((u: { txid: string; vout: number; value: number }) => ({
                txid: u.txid,
                vout: u.vout,
                value: u.value,
            }));

            setState(prev => ({ ...prev, utxos }));
            return utxos;
        } catch (error) {
            console.error('Failed to fetch UTXOs:', error);
            return [];
        }
    }, [state.address]);

    // Sign PSBT with wallet
    const signPsbt = useCallback(async (psbtHex: string): Promise<string> => {
        if (!window.unisat) throw new Error('Wallet not installed');
        if (!state.isConnected) throw new Error('Wallet not connected');

        try {
            const signedPsbt = await window.unisat.signPsbt(psbtHex, {
                autoFinalized: true,
            });
            return signedPsbt;
        } catch (error) {
            console.error('Failed to sign PSBT:', error);
            throw error;
        }
    }, [state.isConnected]);

    // Broadcast signed PSBT
    const broadcastPsbt = useCallback(async (psbtHex: string): Promise<string> => {
        if (!window.unisat) throw new Error('Wallet not installed');

        try {
            // Use Unisat's built-in broadcast
            const txid = await window.unisat.pushPsbt(psbtHex);
            return txid;
        } catch {
            // Fallback: broadcast via Tatum RPC
            // Fallback: broadcast via Tatum RPC

            const response = await fetch(TATUM_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'sendrawtransaction',
                    params: [psbtHex],
                    id: 1,
                }),
            });

            const result = await response.json();
            if (result.error) {
                throw new Error(result.error.message);
            }
            return result.result;
        }
    }, []);

    return {
        ...state,
        connect,
        disconnect,
        switchToTestnet4,
        signPsbt,
        broadcastPsbt,
        refreshBalance,
        fetchUtxos,
    };
}

export default useBitcoinWallet;
