import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

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

const BitcoinWalletContext = createContext<(BitcoinWalletState & BitcoinWalletActions) | undefined>(undefined);

const TESTNET4_NETWORK = 'testnet4';
const TATUM_RPC = 'https://bitcoin-testnet4.gateway.tatum.io';

export function BitcoinWalletProvider({ children }: { children: ReactNode }) {
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
                setState(prev => ({ ...prev, isConnected: false, address: null, publicKey: null, balance: null }));
            } else {
                setState(prev => ({ ...prev, address: accts[0] }));
                // Refresh other data when account changes
                window.unisat?.getPublicKey().then(pk => setState(p => ({ ...p, publicKey: pk })));
                window.unisat?.getBalance().then(bal => setState(p => ({ ...p, balance: bal })));
            }
        };

        window.unisat.on('accountsChanged', handleAccountsChanged);
        return () => {
            window.unisat?.removeListener('accountsChanged', handleAccountsChanged);
        };
    }, []);

    const connect = useCallback(async () => {
        if (!window.unisat) throw new Error('Unisat wallet not installed');
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

            if (network !== TESTNET4_NETWORK) {
                try {
                    await window.unisat.switchNetwork(TESTNET4_NETWORK);
                    const newNetwork = await window.unisat.getNetwork();
                    setState(prev => ({ ...prev, network: newNetwork }));
                } catch (e) {
                    console.warn('Could not switch to testnet4:', e);
                }
            }
        } catch (error) {
            console.error('Failed to connect:', error);
            throw error;
        }
    }, []);

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

    const switchToTestnet4 = useCallback(async () => {
        if (!window.unisat) return;
        await window.unisat.switchNetwork(TESTNET4_NETWORK);
        const network = await window.unisat.getNetwork();
        setState(prev => ({ ...prev, network }));
    }, []);

    const refreshBalance = useCallback(async () => {
        if (!window.unisat) return;
        const balance = await window.unisat.getBalance();
        setState(prev => ({ ...prev, balance }));
    }, []);

    const fetchUtxos = useCallback(async (): Promise<UTXO[]> => {
        if (!state.address) return [];
        try {
            const response = await fetch(`https://mempool.space/testnet4/api/address/${state.address}/utxo`);
            if (!response.ok) throw new Error('Failed to fetch UTXOs');
            const data = await response.json();
            const utxos: UTXO[] = data.map((u: any) => ({
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

    const signPsbt = useCallback(async (psbtHex: string): Promise<string> => {
        if (!window.unisat) throw new Error('Wallet not installed');
        return window.unisat.signPsbt(psbtHex, { autoFinalized: true });
    }, []);

    const broadcastPsbt = useCallback(async (psbtHex: string): Promise<string> => {
        if (!window.unisat) throw new Error('Wallet not installed');
        try {
            return await window.unisat.pushPsbt(psbtHex);
        } catch {
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
            if (result.error) throw new Error(result.error.message);
            return result.result;
        }
    }, []);

    const value = {
        ...state,
        connect,
        disconnect,
        switchToTestnet4,
        signPsbt,
        broadcastPsbt,
        refreshBalance,
        fetchUtxos,
    };

    return <BitcoinWalletContext.Provider value={value}>{children}</BitcoinWalletContext.Provider>;
}

export function useBitcoinWallet() {
    const context = useContext(BitcoinWalletContext);
    if (context === undefined) {
        throw new Error('useBitcoinWallet must be used within a BitcoinWalletProvider');
    }
    return context;
}
