// Bitcoin Wallet Connect Button Component
// Similar to RainbowKit's ConnectButton but for Bitcoin wallets

import { useBitcoinWallet } from '../hooks/useBitcoinWallet';

export function BitcoinWalletButton() {
    const {
        isInstalled,
        isConnected,
        address,
        balance,
        network,
        connect,
        disconnect,
    } = useBitcoinWallet();

    if (!isInstalled) {
        return (
            <a
                href="https://unisat.io"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
                <span>₿</span>
                Install Unisat
            </a>
        );
    }

    if (!isConnected) {
        return (
            <button
                onClick={connect}
                className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
                <span>₿</span>
                Connect BTC
            </button>
        );
    }

    const shortAddress = address
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : '';

    const balanceDisplay = balance
        ? `${(balance.confirmed / 100_000_000).toFixed(5)} BTC`
        : '...';

    const isTestnet4 = network === 'testnet4';

    return (
        <div className="flex items-center gap-2">
            {/* Network indicator */}
            <div
                className={`px-2 py-1 rounded text-xs font-medium ${isTestnet4
                        ? 'bg-green-600/20 text-green-400'
                        : 'bg-yellow-600/20 text-yellow-400'
                    }`}
            >
                {network || 'Unknown'}
            </div>

            {/* Wallet info dropdown */}
            <div className="relative group">
                <button className="px-3 py-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-orange-400 text-sm font-medium flex items-center gap-2 hover:bg-orange-600/30 transition-colors">
                    <span>₿</span>
                    <span>{shortAddress}</span>
                    <span className="text-orange-300 text-xs">
                        ({balanceDisplay})
                    </span>
                </button>

                {/* Dropdown menu */}
                <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    <div className="p-2">
                        <div className="px-3 py-2 text-xs text-gray-400">
                            Balance: {balanceDisplay}
                        </div>
                        <button
                            onClick={disconnect}
                            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                            Disconnect
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default BitcoinWalletButton;
